const mongoose = require("mongoose");

// Guest-mode friendly: no user reference needed.
// We just log anonymous usage so the site can show live stats
// (e.g. "12,403 files processed") and so history can later be
// looked up by a one-time sessionId stored in the browser cookie.
const conversionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, index: true },
    tool: {
      type: String,
      required: true,
      enum: [
        "compress",
        "resize",
        "jpg-to-png",
        "png-to-jpg",
        "webp",
        "crop",
        "rotate",
        "pdf-to-image",
        "image-to-pdf",
        "watermark",
        "merge-pdf",
        "split-pdf",
        "compress-pdf",
        "rotate-pdf",
        "unlock-pdf",
        "pdf-to-word",
        "word-to-pdf",
      ],
    },
    originalName: String,
    originalSize: Number, // bytes
    resultSize: Number, // bytes
    resultFile: String, // stored filename in /processed
    meta: mongoose.Schema.Types.Mixed, // tool-specific options used (width, angle, quality, etc.)
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversion", conversionSchema);
