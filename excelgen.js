import ExcelJS from "exceljs";

const NAVY = "FF1F3864", LIGHT = "FFD9E1F2", WHITE = "FFFFFFFF", RED = "FFC00000", AMBER = "FFFFF2CC";

function allThin() { const s = { style: "thin", color: { argb: "FF999999" } }; return { top: s, bottom: s, left: s, right: s }; }
function hdr(cell) { cell.font = { name: "Arial", bold: true, color: { argb: WHITE }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = allThin(); }
function num(cell) { cell.numFmt = "#,##0.00"; cell.alignment = { horizontal: "right" }; cell.border = allThin(); cell.font = { name: "Arial", size: 10 }; }
function txt(cell) { cell.font = { name: "Arial", size: 10 }; cell.border = allThin(); cell.alignment = { vertical: "middle", wrapText: true }; }
function totCell(cell) { cell.font = { name: "Arial", bold: true, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }; cell.border = allThin(); }

export async function buildExcel(result, period, outPath) {
  const wb = new ExcelJS.Workbook();
  const periodLabel = period.type === "mensuel"
    ? `Mois ${String(period.month).padStart(2, "0")}/${period.year}`
    : `Trimestre ${period.quarter}/${period.year}`;

  // ---- 1. Déductions ----
  const s1 = wb.addWorksheet("Déductions", { views: [{ showGridLines: false }] });
  s1.mergeCells("A1:Q1");
  s1.getCell("A1").value = `1. TABLEAU DES DÉDUCTIONS (FACTURES D'ACHAT) — ${periodLabel}`;
  s1.getCell("A1").font = { name: "Arial", bold: true, size: 13, color: { argb: NAVY } };
  const cols1 = ["N° Facture","Date","Fournisseur","Identifiant Fiscal","ICE","Désignation","Montant H.T.","Taux","Montant TVA","Montant TTC","Mode Paiement","Date Paiement","Prorata","Compte charge","Compte trésorerie","Code TVA","Compte fournisseur"];
  cols1.forEach((c, i) => hdr(Object.assign(s1.getCell(3, i + 1), { value: c })));
  let r = 4;
  result.deductions.forEach((d) => {
    const row = [d.numeroFacture, d.date, d.fournisseur, d.identifiantFiscal, d.ice, d.designation,
      d.montantHT, d.taux ? `${d.taux}%` : null, d.montantTVA, d.montantTTC,
      d.modePaiement, d.datePaiement, d.prorata, "", d.compteTresorerie, "", ""];
    row.forEach((v, i) => { const cell = s1.getCell(r, i + 1); cell.value = v; [7,9,10].includes(i+1) ? num(cell) : txt(cell); });
    // IF et ICE forcés en texte (règles B & D)
    s1.getCell(r,4).numFmt = "@"; s1.getCell(r,5).numFmt = "@";
    r++;
  });
  // Règle I : totaux séparés par taux
  const tauxOrder = Object.keys(result.totauxParTaux).map(Number).sort((a,b)=>a-b);
  tauxOrder.forEach((t) => {
    const x = result.totauxParTaux[t];
    s1.getCell(r,1).value = `Total ${t}%`;
    for (let c=1;c<=17;c++) totCell(s1.getCell(r,c));
    s1.getCell(r,7).value = x.ht; s1.getCell(r,7).numFmt = "#,##0.00";
    s1.getCell(r,9).value = x.tva; s1.getCell(r,9).numFmt = "#,##0.00";
    s1.getCell(r,10).value = x.ttc; s1.getCell(r,10).numFmt = "#,##0.00";
    r++;
  });
  [13,11,26,15,17,14,12,7,12,12,13,13,8,13,15,9,15].forEach((w,i)=>s1.getColumn(i+1).width=w);

  // ---- 2. CA Encaissé ----
  const s2 = wb.addWorksheet("CA Encaissé", { views: [{ showGridLines: false }] });
  s2.mergeCells("A1:D1");
  s2.getCell("A1").value = `2. CHIFFRE D'AFFAIRES ENCAISSÉ — ${periodLabel}`;
  s2.getCell("A1").font = { name: "Arial", bold: true, size: 13, color: { argb: NAVY } };
  s2.getCell("A3").value = "C.A. ENCAISSÉ"; s2.getCell("A3").font = { name: "Arial", bold: true, size: 11, color: { argb: NAVY } };
  ["","TTC","HT","TVA"].forEach((h,i)=>{ if(i){ const c=s2.getCell(3,i+1); c.value=h; hdr(c);} });
  let r2 = 4;
  [20,14,10,7].forEach((t) => {
    const d = result.caParTaux[t];
    if (d) {
      s2.getCell(r2,1).value = `Taux ${t} %`; s2.getCell(r2,1).font={name:"Arial",bold:true,size:10}; s2.getCell(r2,1).border=allThin();
      s2.getCell(r2,2).value = d.ttc; num(s2.getCell(r2,2));
      s2.getCell(r2,3).value = d.ht; num(s2.getCell(r2,3));
      s2.getCell(r2,4).value = d.tva; num(s2.getCell(r2,4));
      r2++;
    }
  });
  if (r2 === 4) { s2.getCell(r2,1).value = "Aucun encaissement retrouvé sur la période."; s2.getCell(r2,1).font={name:"Arial",italic:true,size:10,color:{argb:RED}}; }
  [22,16,16,16].forEach((w,i)=>s2.getColumn(i+1).width=w);

  // ---- 3. Récap TVA ----
  const s3 = wb.addWorksheet("Récap TVA", { views: [{ showGridLines: false }] });
  s3.mergeCells("A1:B1");
  s3.getCell("A1").value = `3. RÉCAPITULATIF TVA — ${periodLabel}`;
  s3.getCell("A1").font = { name: "Arial", bold: true, size: 13, color: { argb: NAVY } };
  const rec = result.recapTVA;
  [["TVA facturée", rec.tvaFacturee],["TVA récupérable / période", rec.tvaRecuperable],
   ["Crédit TVA des périodes précédentes", rec.creditPrecedent || ""],["Total TVA récupérable", rec.totalRecup],
   ["TVA due", rec.tvaDue],["Crédit TVA", rec.creditTVA]].forEach(([l,v],i) => {
    const rr = 3+i;
    s3.getCell(rr,1).value = l; s3.getCell(rr,1).font={name:"Arial",bold:true,size:10}; s3.getCell(rr,1).border=allThin();
    const cell = s3.getCell(rr,2); cell.value = v; num(cell);
  });
  s3.getColumn(1).width = 42; s3.getColumn(2).width = 16;

  // ---- 4. Rapprochement ----
  const s4 = wb.addWorksheet("Rapprochement", { views: [{ showGridLines: false }] });
  s4.mergeCells("A1:F1");
  s4.getCell("A1").value = `4. RAPPROCHEMENT FACTURES / BANQUE — ${periodLabel}`;
  s4.getCell("A1").font = { name: "Arial", bold: true, size: 13, color: { argb: NAVY } };
  s4.mergeCells("A3:C3"); s4.getCell("A3").value = "FACTURE"; hdr(s4.getCell("A3"));
  s4.mergeCells("D3:F3"); s4.getCell("D3").value = "BANQUE"; hdr(s4.getCell("D3"));
  ["N° Facture","Date","Montant","N° (ou référence)","Date","Montant"].forEach((c,i)=>hdr(Object.assign(s4.getCell(4,i+1),{value:c})));
  let r4 = 5;
  result.rapprochement.forEach((rp) => {
    [rp.factNum, rp.factDate, rp.factMontant, rp.bqRef, rp.bqDate, rp.bqMontant]
      .forEach((v,i)=>{const cell=s4.getCell(r4,i+1);cell.value=v;[3,6].includes(i+1)?num(cell):txt(cell);});
    r4++;
  });
  s4.getCell(r4,1).value="TOTAL"; s4.getCell(r4,4).value="TOTAL";
  for(let c=1;c<=6;c++) totCell(s4.getCell(r4,c));
  s4.getCell(r4,3).value={formula:`SUM(C5:C${r4-1})`}; s4.getCell(r4,3).numFmt="#,##0.00";
  s4.getCell(r4,6).value={formula:`SUM(F5:F${r4-1})`}; s4.getCell(r4,6).numFmt="#,##0.00";
  [14,11,13,32,11,13].forEach((w,i)=>s4.getColumn(i+1).width=w);

  // ---- 5. Anomalies ----
  const s5 = wb.addWorksheet("Anomalies", { views: [{ showGridLines: false }] });
  s5.mergeCells("A1:C1");
  s5.getCell("A1").value = "5. ANOMALIES";
  s5.getCell("A1").font = { name: "Arial", bold: true, size: 13, color: { argb: NAVY } };
  ["Facture concernée","Description","Écart constaté"].forEach((c,i)=>hdr(Object.assign(s5.getCell(3,i+1),{value:c})));
  let r5 = 4;
  if (result.anomalies.length === 0) {
    s5.mergeCells("A4:C4"); s5.getCell("A4").value = "Aucune anomalie constatée."; s5.getCell("A4").font = { name: "Arial", italic: true, size: 10 };
  } else {
    result.anomalies.forEach((a) => {
      [a.facture, a.description, a.ecart].forEach((v,i)=>{const cell=s5.getCell(r5,i+1);cell.value=v;txt(cell);});
      s5.getRow(r5).height = 45; r5++;
    });
  }
  s5.getColumn(1).width = 26; s5.getColumn(2).width = 70; s5.getColumn(3).width = 45;

  // ---- 6. Journal d'exceptions (règle A) ----
  const s6 = wb.addWorksheet("Journal Exceptions", { views: [{ showGridLines: false }] });
  s6.mergeCells("A1:E1");
  s6.getCell("A1").value = "6. JOURNAL D'EXCEPTIONS (lignes exclues du calcul)";
  s6.getCell("A1").font = { name: "Arial", bold: true, size: 13, color: { argb: RED } };
  ["Facture","Date facture","Date paiement","Montant TTC","Motif"].forEach((c,i)=>hdr(Object.assign(s6.getCell(3,i+1),{value:c})));
  let r6 = 4;
  if (result.journalExceptions.length === 0) {
    s6.mergeCells("A4:E4"); s6.getCell("A4").value = "Aucune ligne exclue."; s6.getCell("A4").font = { name: "Arial", italic: true, size: 10 };
  } else {
    result.journalExceptions.forEach((e) => {
      [e.facture, e.dateFacture, e.datePaiement, e.montantTTC, e.motif].forEach((v,i)=>{
        const cell=s6.getCell(r6,i+1); cell.value=v; i===3?num(cell):txt(cell);
        cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:AMBER}};
      });
      s6.getRow(r6).height = 40; r6++;
    });
  }
  [24,13,13,14,55].forEach((w,i)=>s6.getColumn(i+1).width=w);

  await wb.xlsx.writeFile(outPath);
  return outPath;
}
