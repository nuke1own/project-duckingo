const TOOLS = ["merge", "split", "reorder", "rotate", "compress", "watermark", "numbers", "images", "photos"];
const EMPTY = {
  merge: ["Drop PDFs to merge", "Add two or more PDFs, then download one file."],
  split: ["Drop a PDF to split", "Extract a range, or save every page as its own file."],
  reorder: ["Drop a PDF to reorder", "Move pages, then save the new sequence."],
  rotate: ["Drop a PDF to rotate", "Turn pages 90° at a time, then download."],
  compress: ["Drop a PDF to compress", "Rewrite the file with object streams in this browser."],
  watermark: ["Drop a PDF to watermark", "Stamp text on every page. Nothing is uploaded."],
  numbers: ["Drop a PDF to number", "Add a header or footer number on each page."],
  images: ["Drop a PDF to export", "Each page becomes a PNG or JPEG inside a ZIP."],
  photos: ["Drop images to make a PDF", "PNG and JPEG become pages, in the order you add them."],
};

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const browseBtn = document.getElementById("browse-btn");
const emptyPanel = document.getElementById("empty-panel");
const workspacePanel = document.getElementById("workspace-panel");
const fileBoard = document.getElementById("file-board");
const errorEl = document.getElementById("error");
const progressEl = document.getElementById("progress");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const docName = document.getElementById("doc-name");
const emptyTitle = document.getElementById("empty-title");
const emptyLead = document.getElementById("empty-lead");
const replaceBtn = document.getElementById("replace-btn");
const runTop = document.getElementById("run-top");

let tool = "merge";
let files = [];
let pdfBytes = null;
let pageCount = 0;
let order = [];
let rotation = 0;
let numberPos = "bottom-center";
let busy = false;
const dependencyPromises = new Map();
const DEPENDENCIES = {
  pdfLib: "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  pdfJs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js",
  jsZip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
};

function loadScript(name, source, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (dependencyPromises.has(name)) return dependencyPromises.get(name);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`${name} loaded without its global.`));
    script.onerror = () => reject(new Error(`Could not load ${name}. Check your connection and try again.`));
    document.head.appendChild(script);
  });
  dependencyPromises.set(name, promise);
  return promise;
}

async function pdfLib() {
  return loadScript("pdf-lib", DEPENDENCIES.pdfLib, "PDFLib");
}

async function ensurePdfJs() {
  const pdfjs = await loadScript("PDF.js", DEPENDENCIES.pdfJs, "pdfjsLib");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
  }
  return pdfjs;
}

function ensureJsZip() {
  return loadScript("JSZip", DEPENDENCIES.jsZip, "JSZip");
}

function formatBytes(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function downloadBlob(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

function setError(msg) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg || "";
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function setProgress(pct, hide = false) {
  if (hide) {
    progressEl.hidden = true;
    progressEl.value = 0;
    return;
  }
  progressEl.hidden = false;
  progressEl.value = pct;
}

function stem(name) {
  return String(name || "document").replace(/\.[^.]+$/, "");
}

function isPdf(file) {
  return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
}

function isImage(file) {
  return file && /image\/(png|jpeg|jpg|webp)/i.test(file.type);
}

function currentAccept() {
  return tool === "photos" ? "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" : "application/pdf,.pdf";
}

function currentMultiple() {
  return tool === "merge" || tool === "photos";
}

function setBusy(on) {
  busy = on;
  document.querySelector(".studio-shell").classList.toggle("is-busy", on);
  syncActions();
}

function showWorkspace(on) {
  emptyPanel.hidden = on;
  workspacePanel.hidden = !on;
  replaceBtn.disabled = !on;
}

function setTool(next) {
  if (!TOOLS.includes(next)) next = "merge";
  tool = next;
  document.querySelectorAll(".rail__btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tool === tool);
  });
  document.querySelectorAll(".inspector .panel").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tool;
  });
  const copy = EMPTY[tool];
  emptyTitle.textContent = copy[0];
  emptyLead.textContent = copy[1];
  fileInput.accept = currentAccept();
  fileInput.multiple = currentMultiple();
  if (location.hash !== `#${tool}`) history.replaceState(null, "", `#${tool}`);
  replaceBtn.textContent = tool === "merge" || tool === "photos" ? "Add files" : "Replace";
  runTop.textContent = {
    merge: "Merge",
    split: "Split",
    reorder: "Save order",
    rotate: "Download",
    compress: "Compress",
    watermark: "Stamp",
    numbers: "Number",
    images: "Export",
    photos: "Build PDF",
  }[tool] || "Download";
  if (tool !== "merge" && tool !== "photos" && !pdfBytes) {
    const pdf = files.find(isPdf);
    if (pdf) {
      loadPdfFile(pdf).then(() => {
        renderBoard();
        syncActions();
      }).catch((err) => setError(err instanceof Error ? err.message : "Could not read that PDF."));
    }
  }
  renderBoard();
  syncActions();
}

function syncActions() {
  const hasPhotos = tool === "photos" && files.filter(isImage).length > 0;
  const ready = tool === "photos" ? hasPhotos : tool === "merge" ? files.filter(isPdf).length >= 2 : Boolean(pdfBytes);
  runTop.disabled = !ready || busy;
  document.getElementById("merge-run").disabled = files.filter(isPdf).length < 2 || busy;
  document.getElementById("split-run").disabled = !pdfBytes || busy;
  document.getElementById("reorder-run").disabled = !pdfBytes || busy;
  document.getElementById("rotate-run").disabled = !pdfBytes || busy;
  document.getElementById("compress-run").disabled = !pdfBytes || busy;
  document.getElementById("watermark-run").disabled = !pdfBytes || busy;
  document.getElementById("numbers-run").disabled = !pdfBytes || busy;
  document.getElementById("images-run").disabled = !pdfBytes || busy;
  document.getElementById("photos-run").disabled = files.filter(isImage).length < 1 || busy;
  document.getElementById("split-range").hidden = document.getElementById("split-mode").value !== "range";
}

function renderBoard() {
  fileBoard.className = "file-board";
  if (tool === "merge") {
    const pdfs = files.filter(isPdf);
    if (!pdfs.length) {
      showWorkspace(false);
      docName.textContent = "Drop PDFs, then merge, split, or convert";
      metaEl.textContent = "";
      return;
    }
    showWorkspace(true);
    docName.textContent = `${pdfs.length} PDF${pdfs.length === 1 ? "" : "s"} ready to merge`;
    metaEl.textContent = pdfs.map((f) => f.name).join(" · ");
    fileBoard.innerHTML = "";
    pdfs.forEach((file, index) => {
      fileBoard.appendChild(row(file.name, formatBytes(file.size), index, pdfs.length, "pdf"));
    });
    return;
  }

  if (tool === "photos") {
    const images = files.filter(isImage);
    if (!images.length) {
      showWorkspace(false);
      docName.textContent = "Drop images to make a PDF";
      metaEl.textContent = "";
      return;
    }
    showWorkspace(true);
    docName.textContent = `${images.length} image${images.length === 1 ? "" : "s"} → PDF`;
    metaEl.textContent = images.map((f) => f.name).join(" · ");
    fileBoard.className = "thumb-grid";
    fileBoard.innerHTML = "";
    images.forEach((file, index) => {
      const card = document.createElement("div");
      card.className = "thumb-card";
      const img = document.createElement("img");
      img.alt = file.name;
      img.src = URL.createObjectURL(file);
      const label = document.createElement("p");
      label.className = "thumb-card__label";
      label.textContent = `${index + 1}. ${file.name}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--sm";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        files = files.filter((item) => item !== file);
        renderBoard();
        syncActions();
      });
      card.append(img, label, remove);
      fileBoard.appendChild(card);
    });
    return;
  }

  fileBoard.className = "file-board";
  if (!pdfBytes) {
    showWorkspace(false);
    docName.textContent = "Drop PDFs, then merge, split, or convert";
    metaEl.textContent = "";
    return;
  }

  showWorkspace(true);
  const name = files.find(isPdf)?.name || "document.pdf";
  docName.textContent = name;
  metaEl.textContent = `${pageCount} page${pageCount === 1 ? "" : "s"}`;
  fileBoard.innerHTML = "";

  if (tool === "reorder") {
    order.forEach((pageIndex, i) => {
      fileBoard.appendChild(row(`Page ${pageIndex + 1}`, `Position ${i + 1}`, i, order.length, "page"));
    });
  } else {
    fileBoard.appendChild(row(name, `${pageCount} pages · ${formatBytes(pdfBytes.byteLength)}`, 0, 1, "single"));
  }
}

function row(title, meta, index, total, kind) {
  const el = document.createElement("div");
  el.className = "file-row";
  el.innerHTML = `<div class="file-row__name">${escapeHtml(title)}<div class="file-row__meta">${escapeHtml(meta)}</div></div>`;
  if (kind !== "single") {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn btn--sm";
    up.textContent = "↑";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveItem(kind, index, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn btn--sm";
    down.textContent = "↓";
    down.disabled = index === total - 1;
    down.addEventListener("click", () => moveItem(kind, index, 1));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--sm";
    remove.textContent = "×";
    remove.addEventListener("click", () => removeItem(kind, index));
    el.append(up, down, remove);
  }
  return el;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function moveItem(kind, index, delta) {
  const list = kind === "page" ? order : files.filter(isPdf);
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  if (kind === "page") {
    [order[index], order[next]] = [order[next], order[index]];
  } else {
    const pdfs = files.filter(isPdf);
    const a = files.indexOf(pdfs[index]);
    const b = files.indexOf(pdfs[next]);
    [files[a], files[b]] = [files[b], files[a]];
  }
  renderBoard();
}

function removeItem(kind, index) {
  if (kind === "page") {
    if (order.length < 2) return;
    order.splice(index, 1);
  } else {
    const pdfs = files.filter(isPdf);
    files = files.filter((item) => item !== pdfs[index]);
    if (!files.some(isPdf)) resetFiles();
  }
  renderBoard();
  syncActions();
}

function resetFiles() {
  files = [];
  pdfBytes = null;
  pageCount = 0;
  order = [];
  rotation = 0;
  showWorkspace(false);
  setError("");
  setStatus("");
  metaEl.textContent = "";
  document.getElementById("compress-stats").textContent = "";
  renderBoard();
  syncActions();
}

async function loadPdfFile(file) {
  const { PDFDocument } = await pdfLib();
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  pdfBytes = bytes;
  pageCount = doc.getPageCount();
  order = Array.from({ length: pageCount }, (_, i) => i);
  rotation = 0;
  document.getElementById("split-start").value = "1";
  document.getElementById("split-end").value = String(pageCount);
  document.getElementById("split-start").max = String(pageCount);
  document.getElementById("split-end").max = String(pageCount);
}

async function handleFiles(list) {
  setError("");
  const incoming = Array.from(list || []);
  if (!incoming.length) return;
  try {
    if (tool === "photos") {
      const images = incoming.filter(isImage);
      if (!images.length) throw new Error("Choose PNG, JPEG, or WebP images.");
      files = files.concat(images);
    } else if (tool === "merge") {
      const pdfs = incoming.filter(isPdf);
      if (!pdfs.length) throw new Error("Choose PDF files.");
      files = files.concat(pdfs);
    } else {
      const pdf = incoming.find(isPdf);
      if (!pdf) throw new Error("Choose a PDF file.");
      files = [pdf];
      await loadPdfFile(pdf);
    }
    renderBoard();
    syncActions();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not read that file.");
  }
}

async function runCurrent() {
  const actions = {
    merge: runMerge,
    split: runSplit,
    reorder: runReorder,
    rotate: runRotate,
    compress: runCompress,
    watermark: runWatermark,
    numbers: runNumbers,
    images: runImages,
    photos: runPhotos,
  };
  const fn = actions[tool];
  if (!fn) return;
  setBusy(true);
  setError("");
  setProgress(12);
  try {
    await fn();
    setProgress(100);
    setStatus("Downloaded. Files stayed on this device.");
  } catch (err) {
    setError(err instanceof Error ? err.message : "That PDF action failed.");
    setStatus("");
  } finally {
    setBusy(false);
    syncActions();
    setTimeout(() => setProgress(0, true), 900);
  }
}

async function runMerge() {
  const pdfs = files.filter(isPdf);
  if (pdfs.length < 2) throw new Error("Add at least two PDFs.");
  setStatus("Merging PDFs…");
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  for (let i = 0; i < pdfs.length; i += 1) {
    const src = await PDFDocument.load(await pdfs[i].arrayBuffer(), { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((page) => out.addPage(page));
    setProgress(20 + Math.round(((i + 1) / pdfs.length) * 70));
  }
  downloadBlob(await out.save(), "duckingo-merged.pdf", "application/pdf");
}

async function runSplit() {
  if (!pdfBytes) throw new Error("Drop a PDF first.");
  const { PDFDocument } = await pdfLib();
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const mode = document.getElementById("split-mode").value;
  const base = stem(files[0]?.name);
  if (mode === "all") {
    const JSZip = await ensureJsZip();
    setStatus("Splitting every page…");
    const zip = new JSZip();
    for (let i = 0; i < pageCount; i += 1) {
      const one = await PDFDocument.create();
      const [page] = await one.copyPages(src, [i]);
      one.addPage(page);
      zip.file(`${base}-page-${i + 1}.pdf`, await one.save());
      setProgress(15 + Math.round(((i + 1) / pageCount) * 75));
    }
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${base}-split.zip`, "application/zip");
    return;
  }
  const start = Number(document.getElementById("split-start").value);
  const end = Number(document.getElementById("split-end").value);
  if (!start || !end || start < 1 || end > pageCount || start > end) {
    throw new Error("Check the page range.");
  }
  setStatus(`Extracting pages ${start}–${end}…`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
  copied.forEach((page) => out.addPage(page));
  downloadBlob(await out.save(), `${base}-pages-${start}-${end}.pdf`, "application/pdf");
}

async function runReorder() {
  if (!pdfBytes) throw new Error("Drop a PDF first.");
  setStatus("Saving new page order…");
  const { PDFDocument } = await pdfLib();
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order);
  copied.forEach((page) => out.addPage(page));
  downloadBlob(await out.save(), `${stem(files[0]?.name)}-reordered.pdf`, "application/pdf");
}

async function runRotate() {
  if (!pdfBytes) throw new Error("Drop a PDF first.");
  setStatus("Rotating pages…");
  const { PDFDocument, degrees } = await pdfLib();
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  doc.getPages().forEach((page) => {
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + rotation + 360) % 360));
  });
  downloadBlob(await doc.save(), `${stem(files[0]?.name)}-rotated.pdf`, "application/pdf");
}

async function runCompress() {
  if (!pdfBytes) throw new Error("Drop a PDF first.");
  setStatus("Compressing…");
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await doc.save({ useObjectStreams: true });
  const saved = pdfBytes.byteLength - out.length;
  const pct = Math.round((saved / pdfBytes.byteLength) * 100);
  const stats = document.getElementById("compress-stats");
  if (saved > 0 && pct >= 1) {
    stats.textContent = `${formatBytes(pdfBytes.byteLength)} → ${formatBytes(out.length)} (${pct}% smaller)`;
  } else {
    stats.textContent = "Already tight — downloaded with a rewritten structure.";
  }
  downloadBlob(out, `${stem(files[0]?.name)}-compressed.pdf`, "application/pdf");
}

async function runWatermark() {
  if (!pdfBytes) throw new Error("Drop a PDF first.");
  const text = document.getElementById("wm-text").value.trim();
  if (!text) throw new Error("Enter watermark text.");
  setStatus("Stamping pages…");
  const { PDFDocument, StandardFonts, rgb, degrees } = await pdfLib();
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const opacity = Number(document.getElementById("wm-opacity").value) / 100;
  const angle = Number(document.getElementById("wm-angle").value) || 0;
  doc.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const size = Math.max(18, Math.min(64, Math.floor(Math.min(width, height) / 8)));
    const textWidth = font.widthOfTextAtSize(text, size);
    const rad = (angle * Math.PI) / 180;
    const x = width / 2 - (textWidth / 2) * Math.cos(rad);
    const y = height / 2 - (textWidth / 2) * Math.sin(rad);
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
      opacity,
      rotate: degrees(angle),
    });
  });
  downloadBlob(await doc.save(), `${stem(files[0]?.name)}-watermarked.pdf`, "application/pdf");
}

async function runNumbers() {
  if (!pdfBytes) throw new Error("Drop a PDF first.");
  setStatus("Numbering pages…");
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const start = Math.max(1, Number(document.getElementById("num-start").value) || 1);
  const size = Math.max(8, Math.min(24, Number(document.getElementById("num-size").value) || 11));
  const format = document.getElementById("num-format").value;
  const margin = 22;
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const n = start + i;
    let label = String(n);
    if (format === "page-n") label = `Page ${n}`;
    if (format === "n-of-total") label = `${n} / ${pages.length}`;
    if (format === "page-n-of-total") label = `Page ${n} of ${pages.length}`;
    const textWidth = font.widthOfTextAtSize(label, size);
    const [v, h] = numberPos.split("-");
    const x = h === "left" ? margin : h === "right" ? width - textWidth - margin : (width - textWidth) / 2;
    const y = v === "top" ? height - margin - size : margin;
    page.drawText(label, { x, y, size, font, color: rgb(0.15, 0.15, 0.15) });
  });
  downloadBlob(await doc.save(), `${stem(files[0]?.name)}-numbered.pdf`, "application/pdf");
}

async function runImages() {
  if (!pdfBytes) throw new Error("Drop a PDF first.");
  const pdfjs = await ensurePdfJs();
  const JSZip = await ensureJsZip();
  setStatus("Rendering pages…");
  const pdf = await pdfjs.getDocument({ data: pdfBytes.slice(0) }).promise;
  const scale = Number(document.getElementById("img-scale").value) || 1.5;
  const format = document.getElementById("img-format").value;
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const ext = format === "jpeg" ? "jpg" : "png";
  const zip = new JSZip();
  const base = stem(files[0]?.name);
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
    zip.file(`${base}-page-${String(i).padStart(3, "0")}.${ext}`, await blob.arrayBuffer());
    setProgress(10 + Math.round((i / pdf.numPages) * 80));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${base}-images.zip`, "application/zip");
}

async function embedImage(doc, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/png/i.test(file.type) || /\.png$/i.test(file.name)) return doc.embedPng(bytes);
  if (/jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name)) return doc.embedJpg(bytes);
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return doc.embedPng(new Uint8Array(await png.arrayBuffer()));
}

async function runPhotos() {
  const images = files.filter(isImage);
  if (!images.length) throw new Error("Add at least one image.");
  setStatus("Building PDF…");
  const { PDFDocument, PageSizes } = await pdfLib();
  const doc = await PDFDocument.create();
  const sizeOpt = document.getElementById("photo-size").value;
  for (let i = 0; i < images.length; i += 1) {
    const embedded = await embedImage(doc, images[i]);
    let pageW = embedded.width;
    let pageH = embedded.height;
    if (sizeOpt === "a4") [pageW, pageH] = PageSizes.A4;
    if (sizeOpt === "letter") [pageW, pageH] = PageSizes.Letter;
    const page = doc.addPage([pageW, pageH]);
    const dims = embedded.scaleToFit(pageW, pageH);
    page.drawImage(embedded, {
      x: (pageW - dims.width) / 2,
      y: (pageH - dims.height) / 2,
      width: dims.width,
      height: dims.height,
    });
    setProgress(15 + Math.round(((i + 1) / images.length) * 75));
  }
  downloadBlob(await doc.save(), "duckingo-images.pdf", "application/pdf");
}

function bindDrop(el) {
  el.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-drag");
  });
  el.addEventListener("dragleave", () => dropzone.classList.remove("is-drag"));
  el.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-drag");
    handleFiles(event.dataTransfer.files);
  });
}

document.querySelectorAll(".rail__btn").forEach((btn) => {
  btn.addEventListener("click", () => setTool(btn.dataset.tool));
});

browseBtn.addEventListener("click", () => fileInput.click());
replaceBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  handleFiles(fileInput.files);
  fileInput.value = "";
});
bindDrop(dropzone);
bindDrop(workspacePanel);

runTop.addEventListener("click", runCurrent);
document.getElementById("merge-run").addEventListener("click", () => { setTool("merge"); runCurrent(); });
document.getElementById("split-run").addEventListener("click", () => { setTool("split"); runCurrent(); });
document.getElementById("reorder-run").addEventListener("click", () => { setTool("reorder"); runCurrent(); });
document.getElementById("rotate-run").addEventListener("click", () => { setTool("rotate"); runCurrent(); });
document.getElementById("compress-run").addEventListener("click", () => { setTool("compress"); runCurrent(); });
document.getElementById("watermark-run").addEventListener("click", () => { setTool("watermark"); runCurrent(); });
document.getElementById("numbers-run").addEventListener("click", () => { setTool("numbers"); runCurrent(); });
document.getElementById("images-run").addEventListener("click", () => { setTool("images"); runCurrent(); });
document.getElementById("photos-run").addEventListener("click", () => { setTool("photos"); runCurrent(); });

document.getElementById("split-mode").addEventListener("change", syncActions);
document.getElementById("wm-opacity").addEventListener("input", (event) => {
  document.getElementById("wm-opacity-label").textContent = event.target.value;
});
document.getElementById("rotate-cw").addEventListener("click", () => {
  rotation = (rotation + 90) % 360;
  setStatus(`Next download will rotate ${rotation}°.`);
});
document.getElementById("rotate-ccw").addEventListener("click", () => {
  rotation = (rotation + 270) % 360;
  setStatus(`Next download will rotate ${rotation}°.`);
});
document.querySelectorAll("#num-pos button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#num-pos button").forEach((item) => item.classList.remove("is-active"));
    btn.classList.add("is-active");
    numberPos = btn.dataset.pos;
  });
});

window.addEventListener("hashchange", () => {
  const next = location.hash.replace("#", "");
  if (TOOLS.includes(next) && next !== tool) setTool(next);
});

const start = location.hash.replace("#", "");
setTool(TOOLS.includes(start) ? start : "merge");
