const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const processor = require("../services/processor");
const Conversion = require("../models/Conversion");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

// small helper to log a conversion + not crash the response if DB is down
async function logConversion(data) {
  try {
    await Conversion.create(data);
  } catch (e) {
    console.warn("Could not log conversion (DB may be offline):", e.message);
  }
}

function cleanup(...files) {
  for (const f of files) {
    if (f && fs.existsSync(f)) fs.unlink(f, () => {});
  }
}

function sendResult(res, filePath, downloadName) {
  res.download(filePath, downloadName, (err) => {
    // clean up the processed file after it's been sent
    fs.unlink(filePath, () => {});
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Could not send file." });
    }
  });
}

function ensureFile(req, res) {
  if (!req.file && !(req.files && req.files.length)) {
    res.status(400).json({ error: "No file uploaded." });
    return false;
  }
  return true;
}

// 1. Compress
router.post("/compress", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.compress(req.file, req.body);
    const stat = fs.statSync(dest);
    await logConversion({
      tool: "compress",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultSize: stat.size,
      resultFile: path.basename(dest),
      meta: { quality: req.body.quality },
    });
    sendResult(res, dest, `compressed-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Compression failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 2. Resize
router.post("/resize", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.resize(req.file, req.body);
    await logConversion({
      tool: "resize",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
      meta: req.body,
    });
    sendResult(res, dest, `resized-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Resize failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 3. JPG <-> PNG
router.post("/jpg-png", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.jpgPngSwap(req.file);
    await logConversion({
      tool: req.file.mimetype.includes("png") ? "png-to-jpg" : "jpg-to-png",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
    });
    sendResult(res, dest, `converted-${path.parse(req.file.originalname).name}${path.extname(dest)}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Conversion failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 4. WebP converter
router.post("/webp", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.webpConvert(req.file, req.body);
    await logConversion({
      tool: "webp",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
      meta: { direction: req.body.direction },
    });
    sendResult(res, dest, `${path.parse(req.file.originalname).name}${path.extname(dest)}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "WebP conversion failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 5. Crop
router.post("/crop", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.crop(req.file, req.body);
    await logConversion({
      tool: "crop",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
      meta: req.body,
    });
    sendResult(res, dest, `cropped-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Crop failed. Check the selection is inside the image." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 6. Rotate
router.post("/rotate", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.rotate(req.file, req.body);
    await logConversion({
      tool: "rotate",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
      meta: { angle: req.body.angle },
    });
    sendResult(res, dest, `rotated-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Rotate failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 7. PDF -> Images
router.post("/pdf-to-image", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.pdfToImages(req.file, req.body);
    await logConversion({
      tool: "pdf-to-image",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
      meta: { dpi: req.body.dpi },
    });
    sendResult(res, dest, `${path.parse(req.file.originalname).name}-pages.zip`);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error:
        "PDF conversion failed. This tool needs GraphicsMagick + Ghostscript installed on the server (see README).",
    });
  } finally {
    cleanup(req.file?.path);
  }
});

// 8. Images -> PDF (multiple files)
router.post("/image-to-pdf", upload.array("files", 20), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.imagesToPdf(req.files);
    await logConversion({
      tool: "image-to-pdf",
      originalName: `${req.files.length} images`,
      resultFile: path.basename(dest),
      meta: { count: req.files.length },
    });
    sendResult(res, dest, "converted.pdf");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "PDF creation failed." });
  } finally {
    cleanup(...req.files.map((f) => f.path));
  }
});

// 9. Watermark
router.post("/watermark", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.watermark(req.file, req.body);
    await logConversion({
      tool: "watermark",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
      meta: { position: req.body.position, opacity: req.body.opacity },
    });
    sendResult(res, dest, `watermarked-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Watermark failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 10. Merge PDFs (multiple files)
router.post("/merge-pdf", upload.array("files", 20), async (req, res) => {
  if (!ensureFile(req, res)) return;
  if (req.files.length < 2) {
    cleanup(...req.files.map((f) => f.path));
    return res.status(400).json({ error: "Upload at least 2 PDFs to merge." });
  }
  try {
    const dest = await processor.mergePdfs(req.files);
    await logConversion({
      tool: "merge-pdf",
      originalName: `${req.files.length} PDFs`,
      resultFile: path.basename(dest),
      meta: { count: req.files.length },
    });
    sendResult(res, dest, "merged.pdf");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Merge failed. Make sure every file is a valid PDF." });
  } finally {
    cleanup(...req.files.map((f) => f.path));
  }
});

// 11. Split PDF
router.post("/split-pdf", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.splitPdf(req.file);
    await logConversion({
      tool: "split-pdf",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
    });
    sendResult(res, dest, `${path.parse(req.file.originalname).name}-pages.zip`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Split failed. Make sure the file is a valid PDF." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 12. Compress PDF
router.post("/compress-pdf", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.compressPdf(req.file, req.body);
    const stat = fs.statSync(dest);
    await logConversion({
      tool: "compress-pdf",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultSize: stat.size,
      resultFile: path.basename(dest),
      meta: { level: req.body.level },
    });
    sendResult(res, dest, `compressed-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "PDF compression failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 13. Rotate PDF
router.post("/rotate-pdf", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.rotatePdf(req.file, req.body);
    await logConversion({
      tool: "rotate-pdf",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
      meta: { angle: req.body.angle },
    });
    sendResult(res, dest, `rotated-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Rotate failed. Make sure the file is a valid PDF." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 14. Unlock PDF (requires the existing password)
router.post("/unlock-pdf", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.unlockPdf(req.file, req.body);
    await logConversion({
      tool: "unlock-pdf",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
    });
    sendResult(res, dest, `unlocked-${req.file.originalname}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unlock failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 15. PDF -> Word
router.post("/pdf-to-word", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.pdfToWord(req.file);
    await logConversion({
      tool: "pdf-to-word",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
    });
    sendResult(res, dest, `${path.parse(req.file.originalname).name}.docx`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "PDF to Word conversion failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

// 16. Word -> PDF
router.post("/word-to-pdf", upload.single("file"), async (req, res) => {
  if (!ensureFile(req, res)) return;
  try {
    const dest = await processor.wordToPdf(req.file);
    await logConversion({
      tool: "word-to-pdf",
      originalName: req.file.originalname,
      originalSize: req.file.size,
      resultFile: path.basename(dest),
    });
    sendResult(res, dest, `${path.parse(req.file.originalname).name}.pdf`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Word to PDF conversion failed." });
  } finally {
    cleanup(req.file?.path);
  }
});

module.exports = router;
