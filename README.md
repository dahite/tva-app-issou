# TVA Maroc — App locale (extraction via Gemini)

Lit factures d'achat, factures de vente et relevés bancaires (PDF), extrait les données via l'API Gemini
(gratuite), te laisse vérifier/corriger, puis calcule le rapprochement + TVA (régime des encaissements)
et génère un Excel. Règles A→I intégrées.

## Prérequis (une fois)
1. Node.js installé (`node -v` doit afficher une version).
2. Une clé API Gemini GRATUITE : https://aistudio.google.com/apikey → "Create API key". Copie-la.

## Installation
Dans Git Bash, dans le dossier tva-app :
```
npm install
cp .env.example .env
notepad .env      # colle ta clé GEMINI_API_KEY, enregistre, ferme
```

## Lancer
```
npm start
```
Ouvre http://localhost:3000. Arrêter : Ctrl + C.

## Utilisation
1. Choisis la période (mensuel/trimestriel) + année.
2. Dépose les PDF (achats, ventes, relevé).
3. "Lire les documents" -> vérifie/corrige les tableaux.
4. "Calculer & générer l'Excel" -> télécharge le fichier (6 onglets).

## Notes
- Factures Word : convertis-les en PDF avant dépôt (l'IA lit PDF et images).
- Règle A : une facture est exclue si le MOIS de paiement est antérieur au MOIS de la facture.
- Pour passer plus tard à l'API Anthropic : remplacer extractor.js et la clé dans .env.
