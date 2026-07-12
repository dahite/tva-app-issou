import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { extractAchats, extractVentes, extractReleve } from "./extractor.js";
import { computeAll } from "./calc.js";
import { buildExcel } from "./excelgen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ dest: path.join(__dirname, "uploads") });

if (!process.env.GEMINI_API_KEY) {
  console.warn("\n⚠️  GEMINI_API_KEY manquante. Copie .env.example en .env et colle ta clé (gratuite sur https://aistudio.google.com/apikey).\n");
}

// Étape 1 : upload + extraction IA -> renvoie les données brutes (éditables côté client)
app.post("/api/extract", upload.fields([
  { name: "achats", maxCount: 20 },
  { name: "ventes", maxCount: 20 },
  { name: "releve", maxCount: 10 },
]), async (req, res) => {
  try {
    const f = req.files || {};
    const [achats, ventes, releve] = await Promise.all([
      f.achats ? extractAchats(f.achats) : Promise.resolve([]),
      f.ventes ? extractVentes(f.ventes) : Promise.resolve([]),
      f.releve ? extractReleve(f.releve) : Promise.resolve([]),
    ]);
    // nettoyage des fichiers temporaires
    Object.values(f).flat().forEach((file) => fs.unlink(file.path, () => {}));
    res.json({ ok: true, achats, ventes, releve });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Étape 2 : reçoit les données (corrigées) + période -> calcule + génère l'Excel
app.post("/api/generate", async (req, res) => {
  try {
    const { achats = [], ventes = [], releve = [], period } = req.body;
    if (!period || !period.year) return res.status(400).json({ ok: false, error: "Période invalide." });
    const result = computeAll({ achats, ventes, releve, period });
    const label = period.type === "mensuel"
      ? `${period.year}-${String(period.month).padStart(2, "0")}`
      : `${period.year}-T${period.quarter}`;
    const outName = `TVA_${label}.xlsx`;
    const outPath = path.join(__dirname, "output", outName);
    await buildExcel(result, period, outPath);
    res.json({ ok: true, result, file: `/download/${outName}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/download/:name", (req, res) => {
  const p = path.join(__dirname, "output", path.basename(req.params.name));
  if (!fs.existsSync(p)) return res.status(404).send("Fichier introuvable");
  res.download(p);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ App TVA lancée : http://localhost:${PORT}\n`);
});
