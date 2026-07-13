// Logique métier — régime des ENCAISSEMENTS + règles A→I.

function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [_, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  return { d: +d, m: +mo, y: +y };
}
function dnum(dt) { return dt ? dt.y * 10000 + dt.m * 100 + dt.d : null; }
// Règle A : comparaison sur MOIS + ANNEE uniquement (le jour est ignoré)
function ymNum(dt) { return dt ? dt.y * 100 + dt.m : null; }

function inPeriod(dateStr, period) {
  const dt = parseDate(dateStr);
  if (!dt) return false;
  if (dt.y !== period.year) return false;
  if (period.type === "mensuel") return dt.m === period.month;
  const q = Math.ceil(dt.m / 3);
  return q === period.quarter;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Règle C : normalisation mode de paiement
function normalizePayment(op, modeFacture) {
  const blob = `${op ? (op.nature || "") + " " + (op.reference || "") : ""} ${modeFacture || ""}`.toLowerCase();
  if (/\bvir|virement\b/.test(blob)) return "VR";
  if (/ch(e|è)que|\bchq\b/.test(blob)) return "CHQ";
  if (/carte|gab|retrait/.test(blob)) return "Autre";
  if (modeFacture) {
    const mf = modeFacture.toLowerCase();
    if (mf.includes("vir")) return "VR";
    if (mf.includes("chèq") || mf.includes("cheq") || mf.includes("chq")) return "CHQ";
    if (mf.includes("carte")) return "Autre";
  }
  return op ? "Autre" : null;
}
// Règle H : compte trésorerie
function compteTresorerie(mode) {
  if (mode === "VR") return "5141";
  if (mode === "CHQ") return "5142";
  return "";
}
function matchInReleve(montantTTC, hints, releve) {
  const cands = releve.filter((op) => {
    const amt = op.debit != null ? op.debit : op.credit;
    return amt != null && Math.abs(round2(amt) - round2(montantTTC)) < 0.01;
  });
  if (cands.length === 0) return null;
  if (hints && hints.length) {
    for (const op of cands) {
      const b = `${op.reference || ""} ${op.nature || ""}`.toLowerCase();
      if (hints.some((h) => h && b.includes(String(h).toLowerCase()))) return op;
    }
  }
  return cands[0];
}
function paymentHints(modePaiement, fournisseur) {
  const hints = [];
  if (modePaiement) {
    const nums = String(modePaiement).match(/\d{4,}/g);
    if (nums) hints.push(...nums.map((n) => n.slice(-6)));
  }
  if (fournisseur) hints.push(String(fournisseur).split(/\s+/)[0]);
  return hints;
}

// Étape 1 : enrichit les achats (mode paiement, compte trésorerie, prorata) et applique la règle A
export function buildDeductions(achats, releve) {
  const journalExceptions = [];

  const enriched = achats.map((f) => {
    const hints = paymentHints(f.modePaiementFacture, f.fournisseur);
    const op = matchInReleve(f.montantTTC, hints, releve);
    const mode = normalizePayment(op, f.modePaiementFacture);
    return {
      ...f,
      modePaiement: mode,
      datePaiement: op ? op.dateOperation : null,
      compteTresorerie: compteTresorerie(mode),
      prorata: 100,
      _op: op,
    };
  });

  const deductions = [];
  enriched.forEach((d) => {
    const mf = ymNum(parseDate(d.date));
    const mp = ymNum(parseDate(d.datePaiement));
    if (mf != null && mp != null && mp < mf) {
      journalExceptions.push({
        facture: `${d.numeroFacture || "?"} (${d.fournisseur || ""})`,
        dateFacture: d.date, datePaiement: d.datePaiement, montantTTC: d.montantTTC,
        motif: "Mois de paiement antérieur au mois de la facture — ligne exclue du calcul (règle A).",
      });
    } else {
      deductions.push(d);
    }
  });

  return { deductions, journalExceptions };
}

// Cherche un sous-ensemble de ventes (même client) dont la somme des TTC égale le crédit (±0,01).
// Essaie d'abord le groupe complet (cas le plus fréquent : un seul virement pour plusieurs factures),
// puis les sous-ensembles plus petits si le groupe est de taille raisonnable.
function groupSumMatch(group, creditAmount, maxCombinations = 12) {
  const n = group.length;
  if (n === 0) return null;
  if (n > maxCombinations) {
    const total = round2(group.reduce((s, v) => s + (v.montantTTC || 0), 0));
    return total === round2(creditAmount) ? group.map((v) => v._idx) : null;
  }
  for (let mask = (1 << n) - 1; mask >= 1; mask--) {
    let sum = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += group[i].montantTTC || 0;
    if (Math.abs(round2(sum) - round2(creditAmount)) < 0.01) {
      return group.filter((_, i) => mask & (1 << i)).map((v) => v._idx);
    }
  }
  return null;
}

// Étape 2 : rapproche les ventes avec le relevé et détermine ce qui est encaissé sur la période.
// Le régime des encaissements se base sur la date du CRÉDIT bancaire, jamais sur la date de facture.
export function buildVentesEncaissees(ventes, releve, period) {
  const credits = releve
    .map((op, idx) => ({ ...op, _creditIdx: idx }))
    .filter((op) => op.credit != null);
  const usedCredits = new Set();
  const enriched = ventes.map((v, idx) => ({
    ...v, _idx: idx, datePaiement: null, refBanque: null, encaisse: false, horsPeriode: false,
  }));
  const matched = new Set();

  // Passe 1 : correspondance individuelle exacte (une facture = un crédit)
  enriched.forEach((v) => {
    const hints = [String(v.numeroFacture || ""), (v.client || "").split(/\s+/)[0]];
    const candidats = credits.filter((op) => !usedCredits.has(op._creditIdx)
      && Math.abs(round2(op.credit) - round2(v.montantTTC)) < 0.01);
    let op = candidats.find((c) => hints.some((h) => h && `${c.reference || ""} ${c.nature || ""}`.toLowerCase().includes(String(h).toLowerCase())));
    if (!op) op = candidats[0];
    if (op) {
      v.datePaiement = op.dateOperation;
      v.refBanque = op.reference || op.nature;
      matched.add(v._idx);
      usedCredits.add(op._creditIdx);
    }
  });

  // Passe 2 : paiement groupé — un crédit unique correspond à la somme de plusieurs
  // factures du même client (ex : 3 factures payées par un seul virement). Toutes les
  // factures du groupe sont marquées encaissées à la date de ce crédit, automatiquement.
  const parClient = {};
  enriched.forEach((v) => {
    if (matched.has(v._idx)) return;
    const cle = (v.client || "").trim().toLowerCase() || "?";
    (parClient[cle] = parClient[cle] || []).push(v);
  });
  credits.forEach((op) => {
    if (usedCredits.has(op._creditIdx)) return;
    for (const cle in parClient) {
      const groupe = parClient[cle].filter((v) => !matched.has(v._idx));
      if (groupe.length < 2) continue;
      const idxs = groupSumMatch(groupe, op.credit);
      if (idxs) {
        idxs.forEach((i) => {
          const v = enriched[i];
          v.datePaiement = op.dateOperation;
          v.refBanque = op.reference || op.nature;
          matched.add(i);
        });
        usedCredits.add(op._creditIdx);
        break;
      }
    }
  });

  return enriched.map(({ _idx, ...v }) => {
    const dansPeriode = v.datePaiement && inPeriod(v.datePaiement, period);
    return { ...v, encaisse: !!dansPeriode, horsPeriode: !!(v.datePaiement && !dansPeriode) };
  });
}

// Étape 3 : à partir des déductions et ventes encaissées (éventuellement corrigées à la main),
// calcule les totaux, le récapitulatif TVA, le rapprochement et les anomalies.
export function finalize({ deductions, journalExceptions = [], ventesEncaissees, period }) {
  // Règle I : totaux par taux
  const totauxParTaux = {};
  deductions.forEach((d) => {
    const t = d.taux || 0;
    totauxParTaux[t] = totauxParTaux[t] || { ht: 0, tva: 0, ttc: 0 };
    totauxParTaux[t].ht += d.montantHT || 0;
    totauxParTaux[t].tva += d.montantTVA || 0;
    totauxParTaux[t].ttc += d.montantTTC || 0;
  });
  Object.values(totauxParTaux).forEach((x) => { x.ht = round2(x.ht); x.tva = round2(x.tva); x.ttc = round2(x.ttc); });
  const totTVAdeduc = round2(Object.values(totauxParTaux).reduce((s, x) => s + x.tva, 0));

  // 2. CA encaissé (règle F)
  const caParTaux = {};
  ventesEncaissees.forEach((v) => {
    if (!v.encaisse) return;
    const t = v.taux || 0;
    caParTaux[t] = caParTaux[t] || { ttc: 0, ht: 0, tva: 0 };
    caParTaux[t].ttc += v.montantTTC || 0;
    caParTaux[t].ht += v.montantHT || 0;
    caParTaux[t].tva += v.montantTVA || 0;
  });
  Object.values(caParTaux).forEach((x) => { x.ttc = round2(x.ttc); x.ht = round2(x.ht); x.tva = round2(x.tva); });

  // 3. Récap TVA (F)
  const tvaFacturee = round2(Object.values(caParTaux).reduce((s, x) => s + x.tva, 0));
  const tvaRecuperable = totTVAdeduc;
  const creditPrecedent = period.creditPrecedent || 0;
  const totalRecup = round2(tvaRecuperable + creditPrecedent);
  const tvaDue = tvaFacturee - totalRecup > 0 ? round2(tvaFacturee - totalRecup) : 0;
  const creditTVA = totalRecup - tvaFacturee > 0 ? round2(totalRecup - tvaFacturee) : 0;

  // 4. Rapprochement (G) — achats conformes + toutes les ventes
  const rapprochement = [];
  deductions.forEach((d) => {
    rapprochement.push({
      factNum: d.numeroFacture, factDate: d.date, factMontant: d.montantTTC,
      bqRef: d._op ? (d._op.reference || null) : null, bqDate: d.datePaiement,
      bqMontant: d._op ? (d._op.debit ?? d._op.credit) : null,
    });
  });
  ventesEncaissees.forEach((v) => {
    rapprochement.push({
      factNum: v.numeroFacture, factDate: v.date, factMontant: v.montantTTC,
      bqRef: v.refBanque, bqDate: v.datePaiement,
      bqMontant: v.datePaiement ? v.montantTTC : null,
    });
  });
  const totFactRappro = round2(rapprochement.reduce((s, r) => s + (r.factMontant || 0), 0));
  const totBqRappro = round2(rapprochement.reduce((s, r) => s + (r.bqMontant || 0), 0));

  // 5. Anomalies
  const anomalies = [];
  deductions.forEach((d) => {
    if (!d._op) {
      anomalies.push({ facture: `${d.numeroFacture || "?"} (${d.fournisseur || ""})`, description: "Paiement introuvable dans le relevé bancaire.", ecart: "" });
      return;
    }
    const bqAmt = d._op.debit ?? d._op.credit;
    if (Math.abs(round2(bqAmt) - round2(d.montantTTC)) >= 0.01) {
      anomalies.push({ facture: `${d.numeroFacture} (${d.fournisseur || ""})`, description: "Écart de montant entre facture et paiement bancaire.", ecart: `Facture ${d.montantTTC} vs Banque ${bqAmt}` });
    }
    if (d.modePaiementFacture && d._op) {
      const fNums = String(d.modePaiementFacture).match(/\d{5,}/g) || [];
      const bBlob = `${d._op.reference || ""} ${d._op.nature || ""}`;
      const bNums = bBlob.match(/\d{5,}/g) || [];
      if (fNums.length && bNums.length && !fNums.some((n) => bNums.some((m) => m.includes(n.slice(-6)) || n.includes(m.slice(-6))))) {
        anomalies.push({ facture: `${d.numeroFacture} (${d.fournisseur || ""})`, description: "Numéro de chèque/référence divergent entre facture et relevé.", ecart: `Facture ${fNums.join(",")} vs Relevé ${bNums.join(",")}` });
      }
    }
  });
  ventesEncaissees.forEach((v) => {
    if (!v.datePaiement) anomalies.push({ facture: `${v.numeroFacture || "?"} (vente)`, description: "Facture de vente en attente d'encaissement.", ecart: "" });
    else if (v.horsPeriode) anomalies.push({ facture: `${v.numeroFacture} (vente)`, description: "Encaissement hors période déclarée (non retenu dans le CA).", ecart: `Encaissé le ${v.datePaiement}` });
  });

  return {
    deductions, totauxParTaux, totTVAdeduc,
    caParTaux, ventesEncaissees,
    recapTVA: { tvaFacturee, tvaRecuperable, creditPrecedent, totalRecup, tvaDue, creditTVA },
    rapprochement, totFactRappro, totBqRappro,
    anomalies, journalExceptions,
  };
}

// Calcul complet en un seul appel, à partir des données brutes extraites par l'IA
export function computeAll({ achats, ventes, releve, period }) {
  const { deductions, journalExceptions } = buildDeductions(achats, releve);
  const ventesEncaissees = buildVentesEncaissees(ventes, releve, period);
  return finalize({ deductions, journalExceptions, ventesEncaissees, period });
}
