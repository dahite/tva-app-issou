import AdmZip from "adm-zip";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export function isDocx(file) {
  return file.mimetype === DOCX_MIME || /\.docx$/i.test(file.originalname || "");
}

export function extractImagesFromDocx(filePath, originalName) {
  const zip = new AdmZip(filePath);
  const images = [];
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith("word/media/")) continue;
    const ext = entry.entryName.slice(entry.entryName.lastIndexOf(".")).toLowerCase();
    const mimeType = IMAGE_MIME_BY_EXT[ext];
    if (!mimeType) continue;
    images.push({ data: entry.getData().toString("base64"), mimeType });
  }
  if (images.length === 0) {
    throw new Error(`Aucune photo trouvée dans le document Word "${originalName}". Le fichier doit contenir des images scannées de la facture.`);
  }
  return images;
}
