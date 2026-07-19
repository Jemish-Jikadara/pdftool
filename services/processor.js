const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { PDFDocument } = require("pdf-lib");
const { nanoid } = require("nanoid");

const PROCESSED_DIR = path.join(__dirname, "..", "processed");

function outPath(ext) {
  return path.join(PROCESSED_DIR, `${Date.now()}-${nanoid(6)}.${ext}`);
}

// 1. Compress -----------------------------------------------------------
async function compress(file, { quality = 75 }) {
  quality = Math.max(10, Math.min(95, parseInt(quality) || 75));
  const ext = file.mimetype.includes("png") ? "png" : file.mimetype.includes("webp") ? "webp" : "jpg";
  const dest = outPath(ext);
  let pipeline = sharp(file.path);
  if (ext === "png") pipeline = pipeline.png({ quality, compressionLevel: 9 });
  else if (ext === "webp") pipeline = pipeline.webp({ quality });
  else pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  await pipeline.toFile(dest);
  return dest;
}

// 2. Resize ---------------------------------------------------------------
async function resize(file, { width, height, keepRatio }) {
  const ext = path.extname(file.originalname).replace(".", "") || "jpg";
  const dest = outPath(ext);
  const w = width ? parseInt(width) : null;
  const h = height ? parseInt(height) : null;
  await sharp(file.path)
    .resize(w, h, { fit: keepRatio ? "inside" : "fill", withoutEnlargement: false })
    .toFile(dest);
  return dest;
}

// 3. JPG <-> PNG -----------------------------------------------------------
async function jpgPngSwap(file) {
  const isPng = file.mimetype.includes("png");
  const dest = outPath(isPng ? "jpg" : "png");
  if (isPng) {
    await sharp(file.path).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toFile(dest);
  } else {
    await sharp(file.path).png().toFile(dest);
  }
  return dest;
}

// 4. WebP converter ---------------------------------------------------------
async function webpConvert(file, { direction = "to-webp" }) {
  if (direction === "from-webp") {
    const dest = outPath("jpg");
    await sharp(file.path).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toFile(dest);
    return dest;
  }
  const dest = outPath("webp");
  await sharp(file.path).webp({ quality: 80 }).toFile(dest);
  return dest;
}

// 5. Crop --------------------------------------------------------------------
async function crop(file, { x, y, width, height }) {
  const ext = path.extname(file.originalname).replace(".", "") || "jpg";
  const dest = outPath(ext);
  await sharp(file.path)
    .extract({
      left: Math.max(0, parseInt(x) || 0),
      top: Math.max(0, parseInt(y) || 0),
      width: Math.max(1, parseInt(width) || 1),
      height: Math.max(1, parseInt(height) || 1),
    })
    .toFile(dest);
  return dest;
}

// 6. Rotate --------------------------------------------------------------------
async function rotate(file, { angle = 90 }) {
  const ext = path.extname(file.originalname).replace(".", "") || "jpg";
  const dest = outPath(ext);
  await sharp(file.path)
    .rotate(parseInt(angle) || 0, { background: "#ffffff" })
    .toFile(dest);
  return dest;
}

// 7. PDF -> Images (zipped) ------------------------------------------------
async function pdfToImages(file, { dpi = 150 }) {
  // Lazy-require so the app still boots even if the optional
  // system dependency (GraphicsMagick/ImageMagick + Ghostscript) is missing.
  const { fromPath } = require("pdf2pic");
  const tmpDir = path.join(PROCESSED_DIR, `pdf-${nanoid(6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const converter = fromPath(file.path, {
    density: parseInt(dpi) || 150,
    saveFilename: "page",
    savePath: tmpDir,
    format: "jpg",
    width: 1600,
    height: 2200,
  });

  await converter.bulk(-1); // convert every page

  const zipDest = outPath("zip");
  await zipFolder(tmpDir, zipDest);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return zipDest;
}

// 8. Image(s) -> PDF ---------------------------------------------------------
async function imagesToPdf(files) {
  const pdfDoc = await PDFDocument.create();
  for (const file of files) {
    const bytes = fs.readFileSync(file.path);
    const isPng = file.mimetype.includes("png");
    // normalize everything else (webp etc.) to jpeg buffer via sharp first
    let embedded;
    if (isPng) {
      embedded = await pdfDoc.embedPng(bytes);
    } else if (file.mimetype.includes("jpeg") || file.mimetype.includes("jpg")) {
      embedded = await pdfDoc.embedJpg(bytes);
    } else {
      const jpgBuffer = await sharp(file.path).jpeg({ quality: 92 }).toBuffer();
      embedded = await pdfDoc.embedJpg(jpgBuffer);
    }
    const page = pdfDoc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  const dest = outPath("pdf");
  fs.writeFileSync(dest, await pdfDoc.save());
  return dest;
}

// 9. Watermark ----------------------------------------------------------------
async function watermark(file, { text = "", opacity = 40, position = "bottom-right" }) {
  const ext = path.extname(file.originalname).replace(".", "") || "jpg";
  const dest = outPath(ext);
  const img = sharp(file.path);
  const meta = await img.metadata();
  const w = meta.width || 800;
  const h = meta.height || 600;
  const fontSize = Math.max(18, Math.round(w / 18));
  const alpha = Math.max(0.1, Math.min(1, (parseInt(opacity) || 40) / 100));
  const safeText = (text || "watermark").replace(/[<>&]/g, "");

  const makeSvg = (tiled) => {
    if (!tiled) {
      return `<svg width="${w}" height="${h}">
        <style>.wm{fill:#ffffff;fill-opacity:${alpha};font-size:${fontSize}px;font-family:sans-serif;font-weight:700;}</style>
        <text class="wm" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">${safeText}</text>
      </svg>`;
    }
    // tiled: repeat text in a grid pattern across the whole image
    let tiles = "";
    const stepX = fontSize * 8;
    const stepY = fontSize * 4;
    for (let ty = 0; ty < h + stepY; ty += stepY) {
      for (let tx = 0; tx < w + stepX; tx += stepX) {
        tiles += `<text class="wm" x="${tx}" y="${ty}" transform="rotate(-30 ${tx} ${ty})">${safeText}</text>`;
      }
    }
    return `<svg width="${w}" height="${h}">
      <style>.wm{fill:#ffffff;fill-opacity:${alpha};font-size:${Math.round(fontSize * 0.6)}px;font-family:sans-serif;font-weight:700;}</style>
      ${tiles}
    </svg>`;
  };

  let svg;
  let gravity = "southeast";
  if (position === "center") { svg = makeSvg(false); gravity = "center"; }
  else if (position === "top-left") { svg = makeSvg(false); gravity = "northwest"; }
  else if (position === "tile") { svg = makeSvg(true); }
  else { svg = makeSvg(false); gravity = "southeast"; }

  const svgBuffer = Buffer.from(svg);
  if (position === "tile") {
    await img.composite([{ input: svgBuffer, top: 0, left: 0 }]).toFile(dest);
  } else {
    await img.composite([{ input: svgBuffer, gravity }]).toFile(dest);
  }
  return dest;
}

// helper: zip a folder --------------------------------------------------------
function zipFolder(srcDir, destZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

// helper: run a system command (used for Ghostscript / qpdf / LibreOffice) ----
function runCommand(cmd, args) {
  const { spawn } = require("child_process");
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject); // e.g. ENOENT — command not installed
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}

// 10. Merge PDFs ----------------------------------------------------------------
async function mergePdfs(files) {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const bytes = fs.readFileSync(file.path);
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  const dest = outPath("pdf");
  fs.writeFileSync(dest, await merged.save());
  return dest;
}

// 11. Split PDF -------------------------------------------------------------------
async function splitPdf(file) {
  const bytes = fs.readFileSync(file.path);
  const src = await PDFDocument.load(bytes);
  const pageCount = src.getPageCount();

  const tmpDir = path.join(PROCESSED_DIR, `split-${nanoid(6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  for (let i = 0; i < pageCount; i++) {
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(src, [i]);
    single.addPage(page);
    fs.writeFileSync(path.join(tmpDir, `page-${i + 1}.pdf`), await single.save());
  }

  const zipDest = outPath("zip");
  await zipFolder(tmpDir, zipDest);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return zipDest;
}

// 12. Compress PDF (uses Ghostscript — same dependency as PDF -> Image) -----------
async function compressPdf(file, { level = "ebook" }) {
  const allowed = ["screen", "ebook", "printer"];
  const setting = allowed.includes(level) ? level : "ebook";
  const dest = outPath("pdf");

  try {
    await runCommand("gs", [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=/${setting}`,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${dest}`,
      file.path,
    ]);
  } catch (err) {
    throw new Error(
      "PDF compression needs Ghostscript installed on the server (same requirement as PDF → Image). " + err.message
    );
  }
  return dest;
}

// 13. Rotate PDF -------------------------------------------------------------------
async function rotatePdf(file, { angle = 90 }) {
  const { degrees } = require("pdf-lib");
  const bytes = fs.readFileSync(file.path);
  const doc = await PDFDocument.load(bytes);
  const addBy = parseInt(angle) || 90;
  doc.getPages().forEach((page) => {
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + addBy) % 360));
  });
  const dest = outPath("pdf");
  fs.writeFileSync(dest, await doc.save());
  return dest;
}

// 14. Unlock PDF (requires the existing password — does not crack passwords) -----
async function unlockPdf(file, { password = "" }) {
  if (!password) throw new Error("Enter the PDF's current password to unlock it.");
  const dest = outPath("pdf");
  try {
    await runCommand("qpdf", ["--decrypt", `--password=${password}`, file.path, dest]);
  } catch (err) {
    throw new Error(
      "Could not unlock the PDF — check the password is correct, and that qpdf is installed on the server. " +
        err.message
    );
  }
  return dest;
}

// 15 & 16. PDF <-> Word (uses LibreOffice headless conversion) --------------------
async function officeConvert(file, targetExt, extraArgs = []) {
  const tmpDir = path.join(PROCESSED_DIR, `office-${nanoid(6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    await runCommand("soffice", [
      "--headless",
      ...extraArgs,
      "--convert-to",
      targetExt,
      "--outdir",
      tmpDir,
      file.path,
    ]);
    const produced = fs.readdirSync(tmpDir).find((f) => f.endsWith(`.${targetExt}`));
    if (!produced) throw new Error("Conversion produced no output file.");
    const dest = outPath(targetExt);
    fs.copyFileSync(path.join(tmpDir, produced), dest);
    return dest;
  } catch (err) {
    throw new Error(
      `This conversion needs LibreOffice installed on the server (command: soffice). ` + err.message
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function pdfToWord(file) {
  // Without this flag LibreOffice opens the PDF as a Draw/image document
  // and has no docx export filter for it. This flag forces it to import
  // the PDF as an editable Writer document instead.
  return officeConvert(file, "docx", ["--infilter=writer_pdf_import"]);
}

async function wordToPdf(file) {
  return officeConvert(file, "pdf");
}

module.exports = {
  compress,
  resize,
  jpgPngSwap,
  webpConvert,
  crop,
  rotate,
  pdfToImages,
  imagesToPdf,
  watermark,
  mergePdfs,
  splitPdf,
  compressPdf,
  rotatePdf,
  unlockPdf,
  pdfToWord,
  wordToPdf,
};
