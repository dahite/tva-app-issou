import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = "gemini-2.0-flash";

// Convertit un fichier local en "part" pour Gemini (PDF ou image, en base64)
function fileToPart(filePath, mimeType) {
  const data = fs.readFileSync(filePath).toString("base64");
  return { inlineData: { data, mimeType } };
}
function stripJson(text) { return text.replace(/```json/gi, "").replace(/```/g, "").trim(); }

async function runGemini(parts, prompt) {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  const result = await model.generateContent([...parts, { text: prompt }]);
  const text = result.response.text();
  return JSON.parse(stripJson(text));
}

export async function extractAchats(files) {
  const parts = files.map((f) => fileToPart(f.path, f.mimetype));
  const prompt = `Tu es un expert-comptable spécialisé en TVA marocaine.
Analyse les factures d'ACHAT fournies. Extrais UNIQUEMENT ce qui est réellement écrit. N'invente rien. Absent => null.

RÈGLES D'EXTRACTION STRICTES :
- "identifiantFiscal" (IF) : chaîne de caractères (texte) de 8 chiffres EXACTS, telle qu'écrite, sans troncature ni conversion. (règle B)
- "ice" : uniquement le champ précédé du libellé « ICE » ou « Identifiant Commun de l'Entreprise », composé de 15 chiffres. Ne JAMAIS deviner ni copier un autre numéro. Si non identifiable ou incomplet => null. (règle D)
- "designation" : UN SEUL mot-clé générique (ex: "Fournitures", "Carburant", "Service", "Honoraires", "Maintenance", "Achat", "Matériaux"). Interdit de copier la description complète. (règle E)
- "modePaiementFacture" : recopie ce qui est écrit sur la facture (ex: "Chèque N° 1300044", "Virement").

Retourne STRICTEMENT un tableau JSON, un objet par facture :
[
  {"numeroFacture": string|null, "date": string|null, "fournisseur": string|null,
   "identifiantFiscal": string|null, "ice": string|null, "designation": string|null,
   "montantHT": number|null, "taux": number|null, "montantTVA": number|null,
   "montantTTC": number|null, "modePaiementFacture": string|null}
]
IMPORTANT : "identifiantFiscal" et "ice" doivent rester des CHAÎNES (guillemets), jamais des nombres.
Montants sans espace ni symbole (ex: 10909.09). Dates au format JJ/MM/AAAA.`;
  return runGemini(parts, prompt);
}

export async function extractVentes(files) {
  const parts = files.map((f) => fileToPart(f.path, f.mimetype));
  const prompt = `Tu es un expert-comptable spécialisé en TVA marocaine.
Analyse les factures de VENTE émises par le contribuable. Extrais uniquement ce qui est écrit. N'invente rien. Absent => null.

RÈGLE : "designation" = UN SEUL mot-clé générique (ex: "Carburant", "Fournitures", "Service"). Interdit de copier la description complète. (règle E)

Retourne STRICTEMENT un tableau JSON, un objet par facture :
[
  {"numeroFacture": string|null, "date": string|null, "client": string|null,
   "designation": string|null, "montantHT": number|null, "taux": number|null,
   "montantTVA": number|null, "montantTTC": number|null}
]
Montants sans espace ni symbole. Dates JJ/MM/AAAA.`;
  return runGemini(parts, prompt);
}

export async function extractReleve(files) {
  const parts = files.map((f) => fileToPart(f.path, f.mimetype));
  const prompt = `Tu es un expert-comptable. Analyse le relevé bancaire fourni.
Extrais CHAQUE ligne d'opération telle qu'écrite. N'invente rien. Absent => null.

Retourne STRICTEMENT un tableau JSON, un objet par opération :
[
  {"dateOperation": string|null, "reference": string|null, "nature": string|null,
   "debit": number|null, "credit": number|null}
]
Ignore les lignes "ANCIEN SOLDE", "SOLDE A REPORTER", "SOLDE REPORT", "NOUVEAU SOLDE".
"dateOperation" au format JJ/MM/AAAA (utilise la Date opération). Montants sans espace ni symbole.`;
  return runGemini(parts, prompt);
}
