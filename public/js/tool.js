(function () {
  const uploadSlot = document.getElementById("uploadSlot");
  const fileInput = document.getElementById("fileInput");
  const previewStrip = document.getElementById("previewStrip");
  const runBtn = document.getElementById("runBtn");
  const statusArea = document.getElementById("statusArea");
  const cropperWrap = document.getElementById("cropperWrap");
  const cropperImg = document.getElementById("cropperImg");

  let selectedFiles = [];
  let cropperInstance = null;
  let naturalDims = null; // { width, height } of the currently loaded image

  // ---------- range field live value display ----------
  document.querySelectorAll('input[type="range"]').forEach((input) => {
    const out = document.getElementById("val-" + input.name);
    if (!out) return;
    const unit = out.textContent.replace(/[-\d.]/g, "").trim();
    out.textContent = input.value + unit;
    input.addEventListener("input", () => (out.textContent = input.value + unit));
  });

  // ---------- resize tool: live width/height aspect-ratio lock ----------
  const widthField = document.getElementById("field-width");
  const heightField = document.getElementById("field-height");
  const keepRatioField = document.getElementById("field-keepRatio");
  let syncing = false; // guards against the two listeners triggering each other in a loop

  function loadNaturalDims(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }

  if (widthField && heightField && keepRatioField) {
    widthField.addEventListener("input", () => {
      if (syncing || !keepRatioField.checked || !naturalDims || !widthField.value) return;
      syncing = true;
      const ratio = naturalDims.height / naturalDims.width;
      heightField.value = Math.round(parseFloat(widthField.value) * ratio);
      syncing = false;
    });

    heightField.addEventListener("input", () => {
      if (syncing || !keepRatioField.checked || !naturalDims || !heightField.value) return;
      syncing = true;
      const ratio = naturalDims.width / naturalDims.height;
      widthField.value = Math.round(parseFloat(heightField.value) * ratio);
      syncing = false;
    });

    // Toggling the checkbox back on should immediately re-sync using whichever field has a value
    keepRatioField.addEventListener("change", () => {
      if (!keepRatioField.checked || !naturalDims) return;
      if (widthField.value) widthField.dispatchEvent(new Event("input"));
      else if (heightField.value) heightField.dispatchEvent(new Event("input"));
    });
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function renderPreviews() {
    previewStrip.innerHTML = "";
    selectedFiles.forEach((file, idx) => {
      if (file.type === "application/pdf") return; // no thumb for pdf
      const div = document.createElement("div");
      div.className = "preview-thumb";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      const rm = document.createElement("button");
      rm.className = "rm";
      rm.textContent = "×";
      rm.onclick = (e) => {
        e.stopPropagation();
        selectedFiles.splice(idx, 1);
        renderPreviews();
        updateCropper();
        toggleRunBtn();
      };
      div.appendChild(img);
      div.appendChild(rm);
      previewStrip.appendChild(div);
    });
  }

  function updateCropper() {
    if (!NEEDS_CROPPER) return;
    if (cropperInstance) {
      cropperInstance.destroy();
      cropperInstance = null;
    }
    if (selectedFiles.length) {
      cropperWrap.classList.remove("hidden");
      cropperImg.src = URL.createObjectURL(selectedFiles[0]);
      cropperImg.onload = () => {
        cropperInstance = new Cropper(cropperImg, { viewMode: 1, autoCropArea: 0.8 });
      };
    } else {
      cropperWrap.classList.add("hidden");
    }
  }

  function toggleRunBtn() {
    runBtn.disabled = selectedFiles.length === 0;
  }

  function addFiles(fileList) {
    const arr = Array.from(fileList);
    if (MULTIPLE) {
      selectedFiles = selectedFiles.concat(arr);
    } else {
      selectedFiles = arr.slice(0, 1);
    }
    renderPreviews();
    updateCropper();
    toggleRunBtn();

    if (widthField && heightField && selectedFiles.length && selectedFiles[0].type !== "application/pdf") {
      loadNaturalDims(selectedFiles[0]).then((dims) => {
        naturalDims = dims;
        // pre-fill both fields with the actual size so the ratio is obvious right away
        if (dims && !widthField.value && !heightField.value) {
          widthField.value = dims.width;
          heightField.value = dims.height;
        }
      });
    }
  }

  uploadSlot.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => addFiles(e.target.files));

  ["dragenter", "dragover"].forEach((evt) =>
    uploadSlot.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadSlot.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    uploadSlot.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadSlot.classList.remove("dragover");
    })
  );
  uploadSlot.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  // ---------- status panel states ----------
  function showWorking() {
    statusArea.innerHTML = `
      <div class="status-working">
        <div class="spinner"></div>
        <p>Processing on the bench…</p>
      </div>`;
  }

  function showError(msg) {
    statusArea.innerHTML = `
      <div class="error-box">
        <svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M10.3 3.9L2 18a1.5 1.5 0 0 0 1.3 2.2h17.4A1.5 1.5 0 0 0 22 18L13.7 3.9a1.5 1.5 0 0 0-2.6 0z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>${msg}</p>
      </div>`;
  }

  function showResult(blob, filename, originalSize) {
    const url = URL.createObjectURL(blob);
    const resultSize = blob.size;
    let compareHtml = "";
    if (originalSize) {
      const diff = originalSize - resultSize;
      const pct = Math.round((diff / originalSize) * 100);
      compareHtml = `
        <div class="size-compare">
          <span>${fmtSize(originalSize)}</span>
          <span>→</span>
          <span class="to">${fmtSize(resultSize)}</span>
          ${diff > 0 ? `<span class="saved">−${pct}%</span>` : ""}
        </div>`;
    }
    statusArea.innerHTML = `
      <div class="result-box">
        <span class="badge-ok"><span class="dot"></span> Done — ready to download</span>
        ${compareHtml}
        <a class="download-btn" href="${url}" download="${filename}">
          <svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M12 4v12M7 11l5 5 5-5M4 20h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Download result
        </a>
      </div>`;
  }

  runBtn.addEventListener("click", async () => {
    if (!selectedFiles.length) return;
    runBtn.disabled = true;
    showWorking();

    const formData = new FormData();
    if (MULTIPLE) {
      selectedFiles.forEach((f) => formData.append("files", f));
    } else {
      formData.append("file", selectedFiles[0]);
    }

    // crop coordinates from Cropper.js, converted to natural pixel values
    if (NEEDS_CROPPER && cropperInstance) {
      const data = cropperInstance.getData(true);
      formData.set("x", Math.round(data.x));
      formData.set("y", Math.round(data.y));
      formData.set("width", Math.round(data.width));
      formData.set("height", Math.round(data.height));
    }

    // all other visible fields
    document.querySelectorAll("#uploadSlot ~ .field-group input, #uploadSlot ~ .field-group select").forEach((el) => {
      if (NEEDS_CROPPER && ["x", "y", "width", "height"].includes(el.name)) return;
      if (el.type === "checkbox") {
        formData.set(el.name, el.checked ? "true" : "");
      } else {
        formData.set(el.name, el.value);
      }
    });

    const originalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);

    try {
      const res = await fetch("/api/" + TOOL_SLUG, { method: "POST", body: formData });
      if (!res.ok) {
        let msg = "Something went wrong. Please try again.";
        try {
          const j = await res.json();
          if (j.error) msg = j.error;
        } catch (e) {}
        showError(msg);
        runBtn.disabled = false;
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "result";
      showResult(blob, filename, originalSize);
    } catch (err) {
      showError("Network error — is the server running?");
    } finally {
      runBtn.disabled = selectedFiles.length === 0;
    }
  });
})();
