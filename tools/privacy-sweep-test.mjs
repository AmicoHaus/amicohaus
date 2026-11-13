// Privacy Sweep (owner tools batch, migration_v45): the swept mark on new photos, the owner-only "Sweep done" list on
// the detail GET, the swept-copy replacement (owner only, new id, same place, old file removed, rate-limited), the
// photo_sweep limit, and the client editor (privacy-sweep.js) in a stubbed browser: the result contract, sweepIsDone,
// the stored picks, the photo controls, labels and wording. Runs the real handlers against an in-memory SQLite
// stand-in for D1 and a Map stand-in for R2. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/privacy-sweep-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const read = (f) => readFileSync(`${root}/${f}`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(read('schema.sql'));
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : stmt.run()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const objects = new Map();
const PHOTOS = {
  put: async (key, body) => { objects.set(key, new Uint8Array(body instanceof ArrayBuffer ? body : body.buffer ? body : await new Response(body).arrayBuffer())); },
  get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
  head: async (key) => (objects.has(key) ? { size: objects.get(key).length } : null),
  delete: async (keys) => { for (const k of [].concat(keys)) objects.delete(k); },
};
const env = { DB, PHOTOS };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const all = (sql, ...a) => sqlite.prepare(sql).all(...a);

let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
console.log = () => {};

// 1 owner, 2 approved agent, 3 admin (no agent profile), 4 another owner, 6 plain homeowner.
for (const [id, role, agent] of [[1, 'user', 0], [2, 'user', 1], [3, 'admin', 0], [4, 'user', 0], [6, 'user', 0]]) {
  run('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)', id, `u${id}@example.test`, `User ${id}`, role);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
  if (agent) run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', '01234567', 'Test Realty')", id);
}
for (const [id, owner] of [[10, 1], [11, 4]]) {
  run(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address)
    VALUES (?, ?, 'Chula Vista', 'CA', '91913', 'Single Family Home', 4, 3, 900000, '123 Secret St')`, id, owner);
}

const call = async (handler, method, who, params, body) => {
  const headers = who ? { Cookie: `ah_session=t${who}` } : {};
  const init = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await handler({ request: new Request('https://amicohaus.com/x', init), env: context.env || env, params, waitUntil() {} });
  const type = res.headers.get('Content-Type') || '';
  const text = type.includes('json') ? await res.text() : '';
  return { status: res.status, headers: res.headers, cache: res.headers.get('Cache-Control'), text, json: text ? JSON.parse(text) : null };
};
const context = {};
const jpegBytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const photoForm = (fields = {}, file = new File([jpegBytes()], 'p.jpg', { type: 'image/jpeg' })) => {
  const fd = new FormData();
  if (file) fd.append('photo', file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};
const SQL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const photosApi = await mod('functions/api/pre-listings/[id]/photos/index.js');
const photoApi = await mod('functions/api/pre-listings/[id]/photos/[photoId].js');
const detail = await mod('functions/api/pre-listings/[id].js');
const rl = await mod('functions/_lib/rateLimits.js');

// ---- New photos: swept=1 sets swept_at (SQL text); without it, NULL ----
let r = await call(photosApi.onRequestPost, 'POST', 1, { id: '10' }, photoForm({ swept: '1' }));
const sweptId = r.json && r.json.id;
check('a swept photo uploads (201, { id })', r.status === 201 && Object.keys(r.json).join() === 'id', r.text);
check('...swept_at is datetime(\'now\') text', SQL_TIME.test(one('SELECT swept_at FROM pre_listing_photos WHERE id = ?', sweptId).swept_at || ''));
r = await call(photosApi.onRequestPost, 'POST', 1, { id: '10' }, photoForm());
const plainId = r.json && r.json.id;
check('a photo without swept has swept_at NULL', r.status === 201 && one('SELECT swept_at FROM pre_listing_photos WHERE id = ?', plainId).swept_at === null);
r = await call(photosApi.onRequestPost, 'POST', 1, { id: '10' }, photoForm({ swept: 'yes' }));
const oddId = r.json && r.json.id;
check("...only swept=1 counts ('yes' is not a tick)", one('SELECT swept_at FROM pre_listing_photos WHERE id = ?', oddId).swept_at === null);
run("INSERT INTO pre_listing_photos (id, pre_listing_id, r2_key, content_type, position) VALUES (900, 11, 'pre-listings/11/x', 'image/jpeg', 0)");
objects.set('pre-listings/11/x', jpegBytes());

// ---- Detail GET: sweptPhotoIds only for the owner ----
r = await call(detail.onRequestGet, 'GET', 1, { id: '10' });
check('the owner gets sweptPhotoIds = exactly the swept photos', r.status === 200 && JSON.stringify(r.json.preListing.sweptPhotoIds) === JSON.stringify([sweptId]), JSON.stringify(r.json && r.json.preListing && r.json.preListing.sweptPhotoIds));
check('...and photoIds still lists every photo', JSON.stringify(r.json.preListing.photoIds) === JSON.stringify([sweptId, plainId, oddId]));
r = await call(detail.onRequestGet, 'GET', 2, { id: '10' });
check('an approved agent gets no sweptPhotoIds key', r.status === 200 && !('sweptPhotoIds' in r.json.preListing));
check('...and nothing about sweeping anywhere in the response', !/swept|sweep/i.test(r.text));
r = await call(detail.onRequestGet, 'GET', 3, { id: '10' });
check('an admin gets no sweptPhotoIds key either', r.status === 200 && !('sweptPhotoIds' in r.json.preListing) && !/swept/i.test(r.text));
r = await call(photosApi.onRequestGet, 'GET', 2, { id: '10' });
check('the photo list an agent can read never carries swept_at', r.status === 200 && !/swept/i.test(r.text));

// ---- Replace with a swept copy ----
const oldRow = one('SELECT id, r2_key, position FROM pre_listing_photos WHERE id = ?', plainId);
objects.set(oldRow.r2_key, jpegBytes());
r = await call(photoApi.onRequestPost, 'POST', null, { id: '10', photoId: String(plainId) }, photoForm({ swept: '1' }));
check('replace: signed out is 401', r.status === 401);
r = await call(photoApi.onRequestPost, 'POST', 2, { id: '10', photoId: String(plainId) }, photoForm({ swept: '1' }));
check('replace: an agent is 403', r.status === 403);
r = await call(photoApi.onRequestPost, 'POST', 3, { id: '10', photoId: String(plainId) }, photoForm({ swept: '1' }));
check('replace: an admin is 403 too (owner only)', r.status === 403);
r = await call(photoApi.onRequestPost, 'POST', 1, { id: '10', photoId: '900' }, photoForm({ swept: '1' }));
check("replace: another home's photo is 404 (and untouched)", r.status === 404 && one('SELECT COUNT(*) AS n FROM pre_listing_photos WHERE id = 900').n === 1 && objects.has('pre-listings/11/x'));
r = await call(photoApi.onRequestPost, 'POST', 1, { id: '99', photoId: String(plainId) }, photoForm());
check('replace: a missing pre-listing is 404', r.status === 404);
r = await call(photoApi.onRequestPost, 'POST', 1, { id: '10', photoId: String(plainId) }, photoForm({}, new File([new Uint8Array(10)], 'x.txt', { type: 'text/plain' })));
check('replace: a bad type gets the photo message', r.status === 400 && r.json.error === 'Photos must be JPEG, PNG, WEBP, or GIF.');
r = await call(photoApi.onRequestPost, 'POST', 1, { id: '10', photoId: String(plainId) }, photoForm({}, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' })));
check('replace: over 5MB gets the size message', r.status === 400 && r.json.error === 'Photo must be under 5MB.');
r = await call(photoApi.onRequestPost, 'POST', 1, { id: '10', photoId: String(plainId) }, photoForm({}, null));
check('replace: no file is 400', r.status === 400 && r.json.error === 'No photo file provided.');
check('...none of those refused tries used up the limit', one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'photo_sweep'").n === 0);
const noBucket = await photoApi.onRequestPost({ request: new Request('https://amicohaus.com/x', { method: 'POST', headers: { Cookie: 'ah_session=t1' }, body: photoForm() }), env: { DB }, params: { id: '10', photoId: String(plainId) } });
check('replace: no bucket is 503', noBucket.status === 503);

r = await call(photoApi.onRequestPost, 'POST', 1, { id: '10', photoId: String(plainId) }, photoForm({ swept: '1' }));
const newRow = r.json && one('SELECT id, r2_key, position, swept_at FROM pre_listing_photos WHERE id = ?', r.json.id);
check('replace: 200 { id, replaced }, private, no-store', r.status === 200 && r.json.replaced === plainId && r.cache === 'private, no-store' && Object.keys(r.json).sort().join() === 'id,replaced', r.text);
check('...a NEW row id, at the same position, with swept_at', newRow && newRow.id !== plainId && newRow.position === oldRow.position && SQL_TIME.test(newRow.swept_at || ''));
check('...the old row is gone', !one('SELECT id FROM pre_listing_photos WHERE id = ?', plainId));
check('...the old file is deleted and the new one is stored', !objects.has(oldRow.r2_key) && objects.has(newRow.r2_key) && newRow.r2_key.startsWith('pre-listings/10/'));
check('...one photo_sweep claim, ref pre_listing:10', one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'photo_sweep' AND user_id = 1 AND ref = 'pre_listing:10'").n === 1);
r = await call(photoApi.onRequestPost, 'POST', 1, { id: '10', photoId: String(oddId) }, photoForm());
const unswept = r.json && one('SELECT swept_at, position FROM pre_listing_photos WHERE id = ?', r.json.id);
check('replace without swept=1: swept_at NULL, same position', r.status === 200 && unswept.swept_at === null && unswept.position === 2);
r = await call(detail.onRequestGet, 'GET', 1, { id: '10' });
check('the owner detail now lists the replacement as swept, in the same order', JSON.stringify(r.json.preListing.photoIds) === JSON.stringify([sweptId, newRow.id, all('SELECT id FROM pre_listing_photos WHERE pre_listing_id = 10 ORDER BY position')[2].id])
  && r.json.preListing.sweptPhotoIds.includes(newRow.id) && r.json.preListing.sweptPhotoIds.length === 2, JSON.stringify(r.json.preListing));

// A failed batch leaves the old photo in place and removes the new upload.
const before = new Set(objects.keys());
const failingDB = { ...DB, batch: async () => { throw new Error('D1 down'); } };
let threw = false;
try {
  await photoApi.onRequestPost({ request: new Request('https://amicohaus.com/x', { method: 'POST', headers: { Cookie: 'ah_session=t1' }, body: photoForm() }), env: { DB: failingDB, PHOTOS }, params: { id: '10', photoId: String(sweptId) } });
} catch { threw = true; }
check('a failed swap throws, keeps the old row and file, and removes the new upload', threw && !!one('SELECT id FROM pre_listing_photos WHERE id = ?', sweptId)
  && [...objects.keys()].every(k => before.has(k)) && [...before].every(k => objects.has(k)));

// The limit: 40 in an hour (counted per person), then 429.
run('DELETE FROM user_action_log');
for (let i = 0; i < 40; i++) run("INSERT INTO user_action_log (user_id, kind, ref) VALUES (1, 'photo_sweep', 'pre_listing:10')");
const cur = one('SELECT id FROM pre_listing_photos WHERE pre_listing_id = 10 ORDER BY position LIMIT 1');
r = await call(photoApi.onRequestPost, 'POST', 1, { id: '10', photoId: String(cur.id) }, photoForm({ swept: '1' }));
check('the 41st sweep in an hour is 429 rate_limited, and nothing changes', r.status === 429 && r.json.code === 'rate_limited' && !!one('SELECT id FROM pre_listing_photos WHERE id = ?', cur.id));
run('DELETE FROM user_action_log');

// The existing DELETE still works for the owner and admins.
r = await call(photoApi.onRequestDelete, 'DELETE', 2, { id: '10', photoId: String(cur.id) });
check('DELETE is still owner or admin only', r.status === 403);

// ---- USER_LIMITS ----
// The nuanced ideas batch adds its eight kinds after report.
check('USER_LIMITS order: ... saved_search, timing_edit, photo_sweep, report', Object.keys(rl.USER_LIMITS).slice(0, Object.keys(rl.USER_LIMITS).indexOf('report') + 1).slice(-4).join() === 'saved_search,timing_edit,photo_sweep,report', Object.keys(rl.USER_LIMITS).join());
check('photo_sweep is 40 an hour and 120 a day', JSON.stringify(rl.USER_LIMITS.photo_sweep) === JSON.stringify([{ max: 40, minutes: 60 }, { max: 120, minutes: 1440 }]));

// ---- The client editor, in a stubbed browser ----
const noop = () => {};
const ctxCalls = [];
const fakeCtx = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1, imageSmoothingEnabled: true,
  fillRect(...a) { ctxCalls.push(['fillRect', this.fillStyle, ...a]); }, drawImage(...a) { ctxCalls.push(['drawImage', a.length]); },
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => ctxCalls.push(['putImageData']),
  save: noop, restore: noop, beginPath: noop, moveTo: noop, arc: noop, clip: () => ctxCalls.push(['clip']), strokeRect: noop, setLineDash: noop,
});
const makeEl = (tag) => {
  const cls = new Set();
  const el = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, parentNode: null, textContent: '', disabled: false, checked: false, dataset: {},
    style: { setProperty: noop },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : on; if (v) cls.add(c); else cls.delete(c); return v; }, contains: (c) => cls.has(c) },
    get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, removeEventListener: noop,
    fire(t, e = {}) { for (const f of this.listeners[t] || []) f({ preventDefault: noop, target: this, ...e }); },
    focus: noop, setPointerCapture: noop, getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 100, height: this.height || 100 }; },
    querySelector(sel) { return findIn(this, n => sel.startsWith('#') && n.id === sel.slice(1)); },
    set innerHTML(html) {
      this._html = html;
      this.children = [];
      const m = /<input type="checkbox" id="([^"]+)">/.exec(html);
      if (m) { const box = makeEl('input'); box.setAttribute('id', m[1]); box.type = 'checkbox'; this.appendChild(box); }
    },
    get innerHTML() { return this._html || ''; },
  };
  if (el.tagName === 'CANVAS') {
    el.width = 0; el.height = 0;
    el.getContext = () => fakeCtx();
    el.toBlob = (cb, type) => cb(new Blob([new Uint8Array([9, 9, 9])], { type }));
  }
  return el;
};
function findIn(node, pred) {
  for (const c of node.children || []) { if (pred(c)) return c; const d = findIn(c, pred); if (d) return d; }
  return null;
}
const docListeners = {};
const inputs = {};
const body = makeEl('body');
const toasts = [];
const sandbox = {
  console: { log: noop, error: noop }, setTimeout, clearTimeout, URLSearchParams, Blob, File, FormData, Promise, Math, Date, JSON, WeakSet,
  navigator: { userAgent: 'node' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
  document: {
    addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); }, removeEventListener: noop,
    getElementById: (id) => inputs[id] || findIn(body, n => n.id === id), querySelector: () => null, querySelectorAll: () => [],
    createElement: makeEl, body, readyState: 'complete', documentElement: makeEl('html'), referrer: '', activeElement: null,
  },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  createImageBitmap: async (file) => { if (/heic/i.test(file.type)) throw new Error('cannot decode'); return { width: 4000, height: 3000, close: noop }; },
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(read('client.js'), sandbox, { filename: 'client.js' });
sandbox.toast = (m) => toasts.push(m);
vm.runInContext(read('privacy-sweep.js'), sandbox, { filename: 'privacy-sweep.js' });
const S = (expr) => vm.runInContext(expr, sandbox);
const tick = () => new Promise(res => setTimeout(res, 5));
const overlay = () => body.children.find(c => c.className.includes('sweep-overlay'));
const button = (text) => findIn(overlay(), n => n.tagName === 'BUTTON' && n.textContent === text);
const fileA = new File([new Uint8Array([1, 2, 3])], 'kitchen.png', { type: 'image/png' });
const fileB = new File([new Uint8Array([4, 5, 6])], 'den.jpg', { type: 'image/jpeg' });
sandbox.fileA = fileA; sandbox.fileB = fileB;

check('sweepIsDone is false for an untouched File', S('sweepIsDone(fileA)') === false && S('sweepIsDone(null)') === false);

// Tick photo 1, leave photo 2, Use these photos.
let calls = [];
sandbox.collect = (results) => calls.push(results);
S('openPrivacySweep([fileA, fileB], { onDone: collect })');
await tick();
check('the editor opens as a dialog with the exact title and sub', !!overlay() && overlay().attrs.role === 'dialog' && findIn(overlay(), n => n.tagName === 'H2').textContent === 'Privacy Sweep'
  && !!findIn(overlay(), n => n.textContent === "Blur or cover anything private before your photos upload: faces, family photos, kids' names, mail and papers, house numbers, license plates. Only the swept copy leaves your device."));
check('...tools are buttons with aria-pressed; Cover box is on first', ['Blur box', 'Cover box', 'Brush'].every(t => button(t) && 'aria-pressed' in button(t).attrs) && button('Cover box').attrs['aria-pressed'] === 'true' && !!button('Undo'));
check('...no "Suggest faces" without a FaceDetector', !button('Suggest faces') && !findIn(overlay(), n => /suggest faces we can spot/.test(n.textContent)));
check('...the photo is drawn on the canvas at most 2048 px', (() => { const c = findIn(overlay(), n => n.tagName === 'CANVAS'); return c && c.width === 2048 && c.height === 1536; })());
const box1 = sandbox.document.getElementById('sweepCheck');
check('...the "I checked this photo" box is there', !!box1 && overlay().children[0].children.some(Boolean));
box1.checked = true; box1.fire('change');
button('Next photo').fire('click');
await tick();
button('Use these photos').fire('click');
await tick(); await tick();
check('onDone is called once, in pick order', calls.length === 1 && calls[0].length === 2);
const [resA, resB] = calls[0] || [];
check('...the ticked photo comes back as a new JPEG File, swept true, and sweepIsDone is true for it', resA && resA.file !== fileA && resA.file.type === 'image/jpeg' && resA.file.name === 'kitchen.jpg' && resA.swept === true && S('sweepIsDone') (resA.file) === true);
check('...the untouched, unticked photo is the original File, swept false', resB && resB.file === fileB && resB.swept === false && S('sweepIsDone')(fileB) === false && S('sweepIsDone')(fileA) === false);
check('...and the editor is gone', !overlay());

// A cover box, no tick: a swept copy, swept false. The cover is a solid #2b2b2b fill.
calls = [];
S('openPrivacySweep([fileA], { onDone: collect })');
await tick();
let canvas = findIn(overlay(), n => n.tagName === 'CANVAS');
ctxCalls.length = 0;
canvas.fire('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
canvas.fire('pointermove', { clientX: 50, clientY: 40, pointerId: 1 });
canvas.fire('pointerup', { pointerId: 1 });
check('a dragged cover box draws a solid #2b2b2b box', ctxCalls.some(c => c[0] === 'fillRect' && c[1] === '#2b2b2b'));
button('Blur box').fire('click');
check('...switching tools moves aria-pressed', button('Blur box').attrs['aria-pressed'] === 'true' && button('Cover box').attrs['aria-pressed'] === 'false');
ctxCalls.length = 0;
canvas.fire('pointerdown', { clientX: 60, clientY: 60, pointerId: 1 });
canvas.fire('pointermove', { clientX: 90, clientY: 90, pointerId: 1 });
canvas.fire('pointerup', { pointerId: 1 });
check('...a blur box pixelates (reads and writes the blocks)', ctxCalls.some(c => c[0] === 'putImageData'));
button('Brush').fire('click');
ctxCalls.length = 0;
canvas.fire('pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
canvas.fire('pointermove', { clientX: 30, clientY: 8, pointerId: 1 });
canvas.fire('pointerup', { pointerId: 1 });
check('...the brush pixelates inside its stroke (clipped)', ctxCalls.some(c => c[0] === 'clip') && ctxCalls.some(c => c[0] === 'putImageData'));
button('Undo').fire('click');
button('Use these photos').fire('click');
await tick(); await tick();
check('changed but not ticked: a new File, swept false, not sweepIsDone', calls.length === 1 && calls[0][0].file !== fileA && calls[0][0].swept === false && S('sweepIsDone')(calls[0][0].file) === false);

// Esc, Close and "Upload without sweeping" give back the originals.
for (const how of ['esc', 'close', 'skip']) {
  calls = [];
  S('openPrivacySweep([fileA, fileB], { onDone: collect })');
  await tick();
  sandbox.document.getElementById('sweepCheck').checked = true;
  sandbox.document.getElementById('sweepCheck').fire('change');
  if (how === 'esc') for (const f of docListeners.keydown || []) f({ key: 'Escape', preventDefault: noop });
  if (how === 'close') findIn(overlay(), n => n.attrs && n.attrs['aria-label'] === 'Close').fire('click');
  if (how === 'skip') button('Upload without sweeping').fire('click');
  await tick();
  check(`${how === 'esc' ? 'Esc' : how === 'close' ? 'Close' : '"Upload without sweeping"'}: every original, swept false, onDone once`, calls.length === 1 && calls[0][0].file === fileA && calls[0][1].file === fileB && calls[0].every(x => x.swept === false) && !overlay());
}

// Opening a second editor ends the first one cleanly (its onDone gets the originals).
calls = [];
sandbox.collect2 = (results) => calls.push(['second', results]);
S('openPrivacySweep([fileA], { onDone: collect })');
await tick();
S('openPrivacySweep([fileB], { onDone: collect2 })');
await tick();
check('a second open closes the first with its originals, and only one editor is up', calls.length === 1 && calls[0][0].file === fileA && body.children.filter(c => c.className.includes('sweep-overlay')).length === 1);
button('Upload without sweeping').fire('click');
await tick();

// A photo the browser can't open (HEIC): the message, no tick possible, original back.
calls = [];
const heic = new File([new Uint8Array([1])], 'x.heic', { type: 'image/heic' });
sandbox.heic = heic;
S('openPrivacySweep([heic], { onDone: collect })');
await tick();
check("a photo that can't be opened shows the exact message and can't be ticked", findIn(overlay(), n => n.textContent.includes("We couldn't open this photo to sweep it. Save it as a JPEG and try again, or upload it as is.")) && sandbox.document.getElementById('sweepCheck').disabled === true);
button('Use these photos').fire('click');
await tick();
check('...and it comes back as the original', calls.length === 1 && calls[0][0].file === heic && calls[0][0].swept === false);
const gif = new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' });
sandbox.gif = gif;
S('openPrivacySweep([gif], { onDone: collect })');
await tick();
check('a GIF gets the still-photo note', !!findIn(overlay(), n => n.textContent.includes('Sweeping turns an animated GIF into a still photo.')));
button('Upload without sweeping').fire('click');
await tick();

// Faces: only with a FaceDetector; suggestions become blur boxes the owner can undo.
sandbox.window.FaceDetector = class { async detect() { return [{ boundingBox: { x: 100, y: 100, width: 200, height: 200 } }]; } };
calls = [];
S('openPrivacySweep([fileA], { onDone: collect })');
await tick();
check('with a FaceDetector: "Suggest faces" and the exact hint', !!button('Suggest faces') && !!findIn(overlay(), n => n.textContent === "We'll suggest faces we can spot. Check every corner yourself."));
button('Suggest faces').fire('click');
await tick();
check('...a suggestion is added as a box the owner can undo', button('Undo').disabled === false && /Suggested 1 face/.test(findIn(overlay(), n => n.attrs && n.attrs.role === 'status').textContent));
button('Undo').fire('click');
check('...Undo takes it back', button('Undo').disabled === true);
button('Use these photos').fire('click');
await tick(); await tick();
check('...nothing changed and nothing ticked: the original comes back', calls.length === 1 && calls[0][0].file === fileA);
delete sandbox.window.FaceDetector;

// Picks on #plPhotos: the change opens the editor; sweepPickedFiles waits for it and returns the swept copies.
const pl = makeEl('input'); pl.setAttribute('id', 'plPhotos'); pl.files = [fileA, fileB]; inputs.plPhotos = pl;
for (const f of docListeners.change || []) f({ target: pl });
await tick();
check('picking pre-listing photos opens Privacy Sweep', !!overlay());
sandbox.document.getElementById('sweepCheck').checked = true;
sandbox.document.getElementById('sweepCheck').fire('change');
const pending = S("sweepPickedFiles('plPhotos')");
button('Use these photos').fire('click');
const picked = await pending;
check('sweepPickedFiles resolves to the swept copy and the original, in pick order', picked.length === 2 && picked[0] !== fileA && picked[0].type === 'image/jpeg' && S('sweepIsDone')(picked[0]) && picked[1] === fileB);
pl.files = [fileB];
const raw = await S("sweepPickedFiles('plPhotos')");
check('...a different selection (no new pick stored) gives the raw files', raw.length === 1 && raw[0] === fileB);
pl.files = [];
check('...a cleared input gives nothing (never the last pick again)', (await S("sweepPickedFiles('plPhotos')")).length === 0);
check('...an input with no stored pick gives its raw files', (inputs.plePhotos = Object.assign(makeEl('input'), { files: [fileA] })) && (await S("sweepPickedFiles('plePhotos')"))[0] === fileA);
pl.files = [fileA];
for (const f of docListeners.change || []) f({ target: pl });
await tick();
button('Upload without sweeping').fire('click');
const again = await S("sweepPickedFiles('plPhotos')");
check('...a new pick replaces the stored set', again.length === 1 && again[0] === fileA && !S('sweepIsDone')(again[0]));
const other = makeEl('input'); other.setAttribute('id', 'listingPhotos'); other.files = [fileA];
for (const f of docListeners.change || []) f({ target: other });
check('...other photo inputs never open it', !overlay());

// The owner's photo controls.
const on = S("privacySweepPhotoControlsHtml(10, 55, true)");
const off = S("privacySweepPhotoControlsHtml(10, 55, false)");
check('photo controls: "✓ Sweep done" only when swept', on.includes('<span class="sweep-chip">✓ Sweep done</span>') && !off.includes('Sweep done'));
check('...the "Sweep this photo" button carries the ids', off === '<button type="button" class="btn btn-ghost btn-sm" data-sweep-action="resweep" data-pre-listing-id="10" data-photo-id="55">Sweep this photo</button>');
check('...ids are escaped', !S(`privacySweepPhotoControlsHtml('"><x', 1, false)`).includes('"><x'));

// ---- Source checks: labels, CSP, wording ----
const src = read('privacy-sweep.js');
const tn = read('then-now.js');
for (const [f, s] of [['privacy-sweep.js', src], ['then-now.js', tn]]) {
  check(`${f}: every <label> has for=`, !/<label(?![^>]*\bfor=)[^>]*>/.test(s));
  check(`${f}: no inline style="" or on*= handler`, !/\sstyle\s*=\s*["'`]/i.test(s) && !/\son[a-z]+\s*=\s*["'`]/i.test(s));
}
check('privacy-sweep.js: the exact checkbox label', src.includes('<label class="checkbox-row sweep-check" for="sweepCheck"><input type="checkbox" id="sweepCheck"><span>I checked this photo</span></label>'));
check('privacy-sweep.js: exact copy (sub, tool hint, faces hint, re-sweep toast, buttons)', [
  "Blur or cover anything private before your photos upload: faces, family photos, kids' names, mail and papers, house numbers, license plates. Only the swept copy leaves your device.",
  'Use Cover for house numbers, mail and plates: a blur can sometimes be undone.',
  "We'll suggest faces we can spot. Check every corner yourself.",
  'Swept copy saved. Agents who already opened your pre-listing may have seen the earlier version. The earlier file is removed for good.',
  "'Previous'", "'Next photo'", "'Use these photos'", "'Upload without sweeping'", "'Blur box'", "'Cover box'", "'Brush'", "'Undo'", "'Suggest faces'",
].every(t => src.includes(t)));
check('privacy-sweep.js: no claims (all faces, Amico blurred, guarantee, 100%, safe, protected)', !/all faces|amico blurred|guarantee|100%|safe\b|protected/i.test(src), (src.match(/all faces|amico blurred|guarantee|100%|safe\b|protected/i) || [])[0]);
check('privacy-sweep.js: the preview stays on the canvas (no blob: or object URLs)', !/createObjectURL|blob:/.test(src));
check('privacy-sweep.js: no network call inside the editor (fetch only in the re-sweep click)', (src.match(/fetch\(/g) || []).length === 1 && src.indexOf('fetch(') > src.indexOf('"Sweep this photo" on a photo'));
const tops = [...src.matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm)].map(m => m[1] || m[2]);
const allowed = new Set(['sweepIsDone', 'sweepPickedFiles', 'privacySweepPhotoControlsHtml', 'openPrivacySweep']);
check('privacy-sweep.js: top-level names are the 4 contract functions or start with SWEEP_/sweep', tops.every(n => allowed.has(n) || /^(SWEEP_|sweep)/.test(n)), tops.join());

console.log = realLog;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
