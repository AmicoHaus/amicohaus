/* Amico Haus — Privacy Sweep: blur or cover private things on the device before photos upload (loaded before main.js).
   When an owner picks pre-listing photos (#plPhotos, #plePhotos), the editor opens one photo at a time on a canvas:
   Blur box, Cover box, Brush, Undo, and "Suggest faces" where the browser has a FaceDetector (worked out on the
   device, never sent). Only the swept copy leaves the device; untouched photos go as picked (the server still removes
   their hidden metadata). "I checked this photo" is the owner's own mark, shown only to them ("Sweep done"); the site
   never claims a photo is clean. Then & Now (then-now.js) and the Mystery Home admin upload use openPrivacySweep too.
   Uses client.js helpers (escapeHtml, apiUpload, toast, toastActionError) and, after a re-sweep, main.js
   (openPreListingDetail) when it's there. No network call happens inside the editor. */

// The swept copies the owner ticked "I checked this photo" for (main.js sends swept=1 for these).
const SWEEP_DONE = new WeakSet();
// inputId -> { originals: File[], promise } for the latest pick on each photo input.
const SWEEP_PICKS = {};
const SWEEP_INPUT_IDS = ['plPhotos', 'plePhotos'];
const SWEEP_MAX_SIDE = 2048;
const SWEEP_COVER_COLOR = '#2b2b2b';
const SWEEP_COPY = {
  title: 'Privacy Sweep',
  sub: "Blur or cover anything private before your photos upload: faces, family photos, kids' names, mail and papers, house numbers, license plates. Only the swept copy leaves your device.",
  toolHint: 'Use Cover for house numbers, mail and plates: a blur can sometimes be undone.',
  facesHint: "We'll suggest faces we can spot. Check every corner yourself.",
  cantOpen: "We couldn't open this photo to sweep it. Save it as a JPEG and try again, or upload it as is.",
  gif: 'Sweeping turns an animated GIF into a still photo.',
  resweepSaved: 'Swept copy saved. Agents who already opened your pre-listing may have seen the earlier version. The earlier file is removed for good.',
};

function sweepIsDone(file) {
  return !!file && typeof file === 'object' && SWEEP_DONE.has(file);
}

// Same picks? (A FileList hands back the same File objects; name, size and date cover a browser that doesn't.)
function sweepSameFiles(a, b) {
  return a.length === b.length && a.every((f, i) => f === b[i]
    || (f.name === b[i].name && f.size === b[i].size && f.lastModified === b[i].lastModified));
}

// The files to upload for a photo input, in pick order: the swept copy where the owner made one, the original
// otherwise. The raw input files when the editor never ran for this pick (or the input was cleared or changed since).
async function sweepPickedFiles(inputId) {
  const el = document.getElementById(inputId);
  const raw = el && el.files ? [...el.files] : [];
  const pick = SWEEP_PICKS[inputId];
  if (!pick || !raw.length || !sweepSameFiles(pick.originals, raw)) return raw;
  const results = await pick.promise;
  return results.map(r => r.file);
}

// The owner's edit gallery, under each photo's Remove button. "Sweep done" is the owner's own mark (owner only).
function privacySweepPhotoControlsHtml(preListingId, photoId, swept) {
  const id = escapeHtml(String(preListingId));
  const pid = escapeHtml(String(photoId));
  return `${swept ? '<span class="sweep-chip">✓ Sweep done</span>' : ''}<button type="button" class="btn btn-ghost btn-sm" data-sweep-action="resweep" data-pre-listing-id="${id}" data-photo-id="${pid}">Sweep this photo</button>`;
}

// ---- The editor ----
// openPrivacySweep(files, { onDone }): onDone([{ file, swept }]) is called exactly once, in pick order. file is the
// swept copy (a new File) when the owner changed or ticked that photo, else the original; swept is true only when "I
// checked this photo" was ticked. "Upload without sweeping", Esc and Close give back every original with swept false.
let sweepActive = null; // the open editor's cancel function, so a second open closes the first one cleanly
function openPrivacySweep(files, opts) {
  const onDone = opts && typeof opts.onDone === 'function' ? opts.onDone : () => {};
  const list = [...(files || [])];
  if (sweepActive) sweepActive();
  if (!list.length) { onDone([]); return; }
  sweepEditor(list, onDone);
}

// Small DOM helper: an element with attributes and optional text.
function sweepEl(tag, attrs = {}, text = '') {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else el.setAttribute(k, v);
  }
  if (text) el.textContent = text;
  return el;
}

// Pixelate one area of the canvas (blocks, no smoothing) and add light noise, so the area can't be sharpened back.
function sweepPixelate(ctx, canvas, x, y, w, h, block, seed) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.width, Math.ceil(x + w));
  const y1 = Math.min(canvas.height, Math.ceil(y + h));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 1 || bh < 1) return;
  const sw = Math.max(1, Math.ceil(bw / block));
  const sh = Math.max(1, Math.ceil(bh / block));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d');
  sctx.drawImage(canvas, x0, y0, bw, bh, 0, 0, sw, sh);
  const img = sctx.getImageData(0, 0, sw, sh);
  let s = (seed >>> 0) || 1;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = (s % 33) - 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  sctx.putImageData(img, 0, 0);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, sw, sh, x0, y0, bw, bh);
  ctx.imageSmoothingEnabled = smooth;
}

// Draws one photo with its edits (and the box being dragged, outlined) onto a canvas at the editor's size.
function sweepPaint(canvas, photo, preview) {
  canvas.width = photo.w;
  canvas.height = photo.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG has no transparency: a see-through PNG gets white, not black
  ctx.fillRect(0, 0, photo.w, photo.h);
  ctx.drawImage(photo.bitmap, 0, 0, photo.w, photo.h);
  const block = Math.max(12, Math.max(photo.w, photo.h) / 40);
  const apply = (op) => {
    if (op.type === 'cover') {
      ctx.fillStyle = SWEEP_COVER_COLOR;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.type === 'blur') {
      sweepPixelate(ctx, canvas, op.x, op.y, op.w, op.h, block, op.seed);
    } else if (op.type === 'brush' && op.points.length) {
      const xs = op.points.map(p => p.x);
      const ys = op.points.map(p => p.y);
      const minX = Math.min(...xs) - op.r;
      const minY = Math.min(...ys) - op.r;
      ctx.save();
      ctx.beginPath();
      // Circles along the stroke, with extra ones between far-apart points so a fast stroke leaves no gaps.
      op.points.forEach((p, i) => {
        const prev = op.points[i - 1];
        const steps = prev ? Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (op.r / 2))) : 1;
        for (let k = 1; k <= steps; k++) {
          const cx = prev ? prev.x + (p.x - prev.x) * (k / steps) : p.x;
          const cy = prev ? prev.y + (p.y - prev.y) * (k / steps) : p.y;
          ctx.moveTo(cx + op.r, cy);
          ctx.arc(cx, cy, op.r, 0, Math.PI * 2);
        }
      });
      ctx.clip();
      sweepPixelate(ctx, canvas, minX, minY, Math.max(...xs) + op.r - minX, Math.max(...ys) + op.r - minY, block, op.seed);
      ctx.restore();
    }
  };
  photo.ops.forEach(apply);
  if (preview) {
    apply(preview);
    if (preview.type !== 'brush') {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, block / 6);
      ctx.setLineDash([block / 2, block / 3]);
      ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
      ctx.restore();
    }
  }
}

function sweepEditor(files, onDone) {
  const hasFaces = typeof window !== 'undefined' && 'FaceDetector' in window;
  const photos = files.map(file => ({
    file, bitmap: null, w: 0, h: 0, error: false, loaded: false, ops: [], checked: false,
    isGif: /gif$/i.test(file.type || '') || /\.gif$/i.test(file.name || ''),
  }));
  const returnFocus = document.activeElement;
  let index = 0;
  let tool = 'cover'; // text and numbers are the usual things to hide, and a cover can't be undone like a blur
  let drag = null;
  let finished = false;

  // ---- Build ----
  const overlay = sweepEl('div', { class: 'sweep-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sweepTitle' });
  const box = sweepEl('div', { class: 'panel' });
  const closeBtn = sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Close' }, '×');
  const title = sweepEl('h2', { id: 'sweepTitle' }, SWEEP_COPY.title);
  const sub = sweepEl('p', { class: 'tiny' }, SWEEP_COPY.sub);
  const tools = sweepEl('div', { class: 'sweep-tools', role: 'toolbar', 'aria-label': 'Sweep tools' });
  const toolBtns = {};
  for (const [key, label] of [['blur', 'Blur box'], ['cover', 'Cover box'], ['brush', 'Brush']]) {
    toolBtns[key] = sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false', 'data-sweep-tool': key }, label);
    tools.appendChild(toolBtns[key]);
  }
  const undoBtn = sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Undo');
  tools.appendChild(undoBtn);
  const facesBtn = hasFaces ? sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Suggest faces') : null;
  if (facesBtn) tools.appendChild(facesBtn);
  const toolHint = sweepEl('p', { class: 'tiny sweep-note' }, SWEEP_COPY.toolHint);
  const facesHint = hasFaces ? sweepEl('p', { class: 'tiny sweep-note' }, SWEEP_COPY.facesHint) : null;
  const status = sweepEl('p', { class: 'tiny sweep-note', role: 'status', 'aria-live': 'polite' });
  const canvas = sweepEl('canvas', { class: 'sweep-canvas', 'aria-label': 'Photo to sweep' });
  const checkWrap = sweepEl('div');
  checkWrap.innerHTML = '<label class="checkbox-row sweep-check" for="sweepCheck"><input type="checkbox" id="sweepCheck"><span>I checked this photo</span></label>';
  const check = checkWrap.querySelector('#sweepCheck');
  const thumbs = sweepEl('div', { class: 'sweep-thumbs', role: 'group', 'aria-label': 'Photos' });
  const thumbBtns = photos.map((_, i) => {
    const b = sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm sweep-thumb' }, String(i + 1));
    b.addEventListener('click', () => go(i));
    thumbs.appendChild(b);
    return b;
  });
  const actions = sweepEl('div', { class: 'card-actions' });
  const prevBtn = sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Previous');
  const nextBtn = sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Next photo');
  const useBtn = sweepEl('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Use these photos');
  const skipBtn = sweepEl('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Upload without sweeping');
  if (photos.length > 1) { actions.appendChild(prevBtn); actions.appendChild(nextBtn); }
  actions.appendChild(useBtn);
  actions.appendChild(skipBtn);
  for (const el of [closeBtn, title, sub, tools, toolHint, facesHint, status, canvas, checkWrap, photos.length > 1 ? thumbs : null, actions]) {
    if (el) box.appendChild(el);
  }
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // ---- State -> screen ----
  const current = () => photos[index];
  const setTool = (key) => {
    tool = key;
    for (const [k, b] of Object.entries(toolBtns)) {
      b.setAttribute('aria-pressed', k === key ? 'true' : 'false');
      b.classList.toggle('sweep-tool-active', k === key);
    }
  };
  const draw = (preview) => {
    const p = current();
    if (p.loaded && !p.error) sweepPaint(canvas, p, preview);
  };
  const refresh = () => {
    const p = current();
    const notes = [];
    if (photos.length > 1) notes.push(`Photo ${index + 1} of ${photos.length}.`);
    if (!p.loaded) notes.push('Opening the photo…');
    else if (p.error) notes.push(SWEEP_COPY.cantOpen);
    else if (p.isGif) notes.push(SWEEP_COPY.gif);
    status.textContent = notes.join(' ');
    const usable = p.loaded && !p.error;
    canvas.classList.toggle('hidden', !usable);
    check.checked = p.checked;
    check.disabled = !usable;
    for (const b of [...Object.values(toolBtns), facesBtn].filter(Boolean)) b.disabled = !usable;
    undoBtn.disabled = !usable || !p.ops.length;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === photos.length - 1;
    thumbBtns.forEach((b, i) => {
      b.textContent = `${i + 1}${photos[i].checked ? ' ✓' : ''}`;
      b.setAttribute('aria-label', `Photo ${i + 1}${photos[i].checked ? ', checked' : ''}`);
      if (i === index) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    draw();
  };
  const load = async (p) => {
    if (p.loaded) return;
    try {
      p.bitmap = await createImageBitmap(p.file);
      const scale = Math.min(1, SWEEP_MAX_SIDE / Math.max(p.bitmap.width, p.bitmap.height));
      p.w = Math.max(1, Math.round(p.bitmap.width * scale));
      p.h = Math.max(1, Math.round(p.bitmap.height * scale));
    } catch { p.error = true; }
    p.loaded = true;
  };
  const go = async (i) => {
    if (i < 0 || i >= photos.length || finished) return;
    index = i;
    drag = null;
    refresh();
    await load(photos[i]);
    if (index === i && !finished) refresh();
  };

  // ---- Drawing with the pointer (mouse, pen or finger) ----
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / (r.width || 1)), y: (e.clientY - r.top) * (canvas.height / (r.height || 1)) };
  };
  const boxOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const seed = () => Math.floor(Math.random() * 0x7fffffff) + 1;
  const dragOp = () => {
    if (!drag) return null;
    if (drag.type === 'brush') return { type: 'brush', points: drag.points, r: drag.r, seed: drag.seed };
    return { type: drag.type, ...boxOf(drag.start, drag.end), seed: drag.seed };
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = current();
    if (!p.loaded || p.error) return;
    e.preventDefault();
    const pt = toCanvas(e);
    const r = Math.max(12, Math.max(p.w, p.h) / 40) * 1.5;
    drag = tool === 'brush' ? { type: 'brush', points: [pt], r, seed: seed() } : { type: tool, start: pt, end: pt, seed: seed() };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    draw(dragOp());
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pt = toCanvas(e);
    if (drag.type === 'brush') drag.points.push(pt); else drag.end = pt;
    draw(dragOp());
  });
  const endDrag = () => {
    if (!drag) return;
    const op = dragOp();
    drag = null;
    if (op.type === 'brush' || (op.w >= 4 && op.h >= 4)) current().ops.push(op);
    refresh();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- Buttons ----
  for (const [key, b] of Object.entries(toolBtns)) b.addEventListener('click', () => setTool(key));
  undoBtn.addEventListener('click', () => { current().ops.pop(); refresh(); });
  check.addEventListener('change', () => { current().checked = check.checked; refresh(); });
  prevBtn.addEventListener('click', () => go(index - 1));
  nextBtn.addEventListener('click', () => go(index + 1));
  if (facesBtn) {
    facesBtn.addEventListener('click', async () => {
      const p = current();
      if (!p.loaded || p.error) return;
      facesBtn.disabled = true;
      try {
        const scale = p.w / p.bitmap.width;
        const faces = await new window.FaceDetector({ maxDetectedFaces: 20 }).detect(p.bitmap);
        for (const f of faces) {
          const b = f.boundingBox;
          const pad = Math.max(b.width, b.height) * 0.15;
          p.ops.push({ type: 'blur', x: (b.x - pad) * scale, y: (b.y - pad) * scale, w: (b.width + 2 * pad) * scale, h: (b.height + 2 * pad) * scale, seed: seed() });
        }
        refresh();
        status.textContent = faces.length
          ? `Suggested ${faces.length} face${faces.length === 1 ? '' : 's'}. Undo any you don't want, and check every corner yourself.`
          : 'No faces suggested on this photo. Check every corner yourself.';
      } catch {
        status.textContent = "Face suggestions didn't work on this photo. Check every corner yourself.";
      } finally { facesBtn.disabled = false; }
    });
  }

  // ---- Finish (exactly once) ----
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    for (const p of photos) { if (p.bitmap && p.bitmap.close) p.bitmap.close(); p.bitmap = null; }
    if (sweepActive === cancel) sweepActive = null;
    if (returnFocus && typeof returnFocus.focus === 'function') { try { returnFocus.focus(); } catch { /* gone */ } }
  };
  const finish = (results) => {
    if (finished) return;
    finished = true;
    close();
    onDone(results);
  };
  const cancel = () => finish(photos.map(p => ({ file: p.file, swept: false })));
  const useThese = async () => {
    if (finished) return;
    useBtn.disabled = true;
    skipBtn.disabled = true;
    status.textContent = 'Saving your swept copies…';
    const results = [];
    for (const p of photos) {
      if (finished) return;
      if (p.error || !p.loaded || (!p.ops.length && !p.checked)) { results.push({ file: p.file, swept: false }); continue; }
      const out = document.createElement('canvas');
      sweepPaint(out, p, null);
      const blob = await new Promise(resolve => { try { out.toBlob(resolve, 'image/jpeg', 0.85); } catch { resolve(null); } });
      if (!blob) { results.push({ file: p.file, swept: false }); continue; }
      const base = String(p.file.name || 'photo').replace(/\.[^.]*$/, '') || 'photo';
      const copy = new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      if (p.checked) SWEEP_DONE.add(copy);
      results.push({ file: copy, swept: !!p.checked });
    }
    finish(results);
  };
  useBtn.addEventListener('click', useThese);
  skipBtn.addEventListener('click', cancel);
  closeBtn.addEventListener('click', cancel);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }
  document.addEventListener('keydown', onKey, true);
  sweepActive = cancel;

  setTool(tool);
  go(0);
  try { toolBtns[tool].focus(); } catch { /* not focusable yet */ }
}

// ---- Picks on the pre-listing photo inputs open the editor; a new pick replaces the stored set ----
document.addEventListener('change', (e) => {
  const input = e.target;
  if (!input || !SWEEP_INPUT_IDS.includes(input.id) || !input.files) return;
  const files = [...input.files];
  if (!files.length) { delete SWEEP_PICKS[input.id]; return; }
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  SWEEP_PICKS[input.id] = { originals: files, promise };
  openPrivacySweep(files, { onDone: resolve });
});

// ---- "Sweep this photo" on a photo that's already up: sweep a copy, then replace the old one ----
document.addEventListener('click', async (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-sweep-action="resweep"]') : null;
  if (!btn) return;
  const id = btn.dataset.preListingId;
  const pid = btn.dataset.photoId;
  btn.disabled = true;
  try {
    // Same origin, so the canvas can read it back.
    const res = await fetch(`/api/pre-listing-photos/${encodeURIComponent(pid)}`, { credentials: 'include' });
    if (!res.ok) throw new Error("We couldn't open this photo. Please try again.");
    const blob = await res.blob();
    const type = blob.type || 'image/jpeg';
    const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type] || 'jpg';
    const original = new File([blob], `photo-${pid}.${ext}`, { type });
    const [result] = await new Promise(resolve => openPrivacySweep([original], { onDone: resolve }));
    if (!result || result.file === original) return; // closed, or nothing changed: nothing to upload
    const formData = new FormData();
    formData.append('photo', result.file);
    if (result.swept) formData.append('swept', '1');
    await apiUpload(`/api/pre-listings/${encodeURIComponent(id)}/photos/${encodeURIComponent(pid)}`, formData);
    toast(SWEEP_COPY.resweepSaved, { durationMs: 9000 });
    if (typeof openPreListingDetail === 'function') openPreListingDetail(id);
  } catch (err) {
    if (typeof toastActionError === 'function') toastActionError(err); else toast(err.message);
  } finally { btn.disabled = false; }
});
