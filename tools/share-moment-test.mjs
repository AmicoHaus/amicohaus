// Share Your Moment (owner tools batch, role M): awarded_at on hire, the owner-only `moment` facts on the detail GET,
// the repost OK endpoint and the admin list, and the client renderers (Reveal Mode, Hired! story slides) run in a
// stubbed browser. Checks that nothing drawn or rendered carries a fee, price, agent name, brokerage, address or ZIP,
// and that the operator line is always on the story when Rudy is the hired agent. In-memory SQLite stand-in for D1.
// Usage: node --disable-warning=ExperimentalWarning tools/share-moment-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const read = (f) => readFileSync(`${root}/${f}`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(read('schema.sql'));
let prepared = 0;
const DB = {
  prepare(sql) {
    prepared++;
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
const env = { DB, PHOTOS: { get: async () => null, put: async () => {}, delete: async () => {}, head: async () => null }, EMAIL_DEV_LOG: '1' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);

let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);

// 1 owner, 2-4 approved agents, 5 the operator (admin + approved agent), 6 admin with no agent profile, 7 demo owner.
const people = [[1, 'user', 0, 'owner@example.test'], [2, 'user', 1, 'a2@example.test'], [3, 'user', 1, 'a3@example.test'], [4, 'user', 1, 'a4@example.test'],
  [5, 'admin', 1, 'rudy@example.test'], [6, 'admin', 0, 'staff@example.test'], [7, 'user', 0, 'demo7@demo.amicohaus.local']];
const NAMES = { 2: 'Zelda Quill', 3: 'Orrin Pell', 4: 'Tamsin Vey', 5: 'Rudy Flores' };
const BROKERAGES = { 2: 'Harborline Realty', 3: 'Saltmarsh Homes', 4: 'Copperfield Group', 5: 'Coldwell Banker West' };
for (const [id, role, agent, email] of people) {
  run('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)', id, email, NAMES[id] || `User ${id}`, role);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
  if (agent) run("INSERT INTO agent_profiles (user_id, status, brokerage_name, license_number) VALUES (?, 'approved', ?, '0123456' || ?)", id, BROKERAGES[id], id);
}
const ADDRESS = '1218 Secret Ct';
const home = (id, owner, { status = 'open', due = null, createdSql = "datetime('now')" } = {}) => run(
  `INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address, status, proposals_due_at, created_at)
   VALUES (?, ?, 'Chula Vista', 'CA', '91913', 'Single Family Home', 4, 3, 899000, ?, ?, ?, ${createdSql})`, id, owner, ADDRESS, status, due);
const past = new Date(Date.now() - 3600000).toISOString();
const later = new Date(Date.now() + 48 * 3600000).toISOString();
home(10, 1, { due: past });                                   // Decision Night opened
home(11, 1, { due: later });                                  // sealed
home(12, 1);                                                  // no Decision Night, open
home(20, 1, { createdSql: "datetime('now', '-4 days', '-12 hours')" }); // hired through acceptBid, after 4.5 days
home(21, 1);                                                  // hired the same day
// An hour short of 2 days, so a clock tick between this insert and the hire can't push the count to 3.
home(22, 1, { due: past, createdSql: "datetime('now', '-2 days', '+1 hour')" });  // hired the operator, 2 interviews done
home(23, 1, { status: 'awarded' });                           // awarded before v45: no awarded_at
home(30, 7, { status: 'awarded' });                           // a demo owner
let bidId = 100;
const bid = (pl, agent, { submittedSql = "datetime('now', '-3 hours')", status = 'pending' } = {}) => {
  bidId++;
  run(`INSERT INTO service_bids (id, request_type, request_id, agent_user_id, commission_pct, flat_fee, message, status, submitted_at)
       VALUES (?, 'pre_listing', ?, ?, 2.5, 9000, 'Pick me, my fee is 2.5%', ?, ${submittedSql})`, bidId, pl, agent, status);
  return bidId;
};
for (const a of [2, 3, 4]) bid(10, a);
for (const a of [2, 3]) bid(11, a);
const b20 = bid(20, 2); bid(20, 3);
const b21 = bid(21, 3);
const b22 = bid(22, 5); bid(22, 2);
const b23 = bid(23, 4, { status: 'accepted' });
run('UPDATE pre_listings SET awarded_bid_id = ? WHERE id = 23', b23);
for (const a of [5, 2]) run("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status) VALUES (22, ?, 'done')", a);
run("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status) VALUES (22, 3, 'canceled')");
const b30 = bid(30, 2, { status: 'accepted' });
run('UPDATE pre_listings SET awarded_bid_id = ? WHERE id = 30', b30);

const call = async (handler, method, path, who, params, body) => {
  const request = new Request(`https://amicohaus.com${path}`, {
    method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  return { status: res.status, headers: res.headers, json: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : null };
};
console.log = () => {};

// ---- acceptBid sets awarded_at on pre-listings only ----
const marketplace = await mod('functions/_lib/marketplace.js');
await marketplace.acceptBid(DB, 'pre_listing', 20, b20);
await marketplace.acceptBid(DB, 'pre_listing', 21, b21);
await marketplace.acceptBid(DB, 'pre_listing', 22, b22);
const r20 = one('SELECT status, awarded_bid_id, awarded_at FROM pre_listings WHERE id = 20');
check('acceptBid: the pre-listing is awarded with awarded_at as SQL text', r20.status === 'awarded' && r20.awarded_bid_id === b20 && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r20.awarded_at || ''), JSON.stringify(r20));
run("INSERT INTO listings (id, user_id, property_type, city, state, estimated_value, price_tier) VALUES (900, 1, 'Condo', 'Chula Vista', 'CA', 1, 'a'), (901, 7, 'Condo', 'Bonita', 'CA', 1, 'a')");
run('INSERT INTO transaction_requests (id, opened_by_user_id, listing_a_id, listing_b_id, user_a_id, user_b_id) VALUES (50, 1, 900, 901, 1, 7)');
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, status) VALUES (500, 'transaction', 50, 2, 'pending')");
let txOk = true;
try { await marketplace.acceptBid(DB, 'transaction', 50, 500); } catch (e) { txOk = false; realLog(e.message); }
const tx = one('SELECT status, awarded_bid_id FROM transaction_requests WHERE id = 50');
check('acceptBid: the transaction path still works (no awarded_at column there)', txOk && tx.status === 'awarded' && tx.awarded_bid_id === 500, JSON.stringify(tx));

// ---- momentForOwner: one statement at most, none without a Decision Night or a hire ----
const moment = await mod('functions/_lib/moment.js');
const countingDb = { prepare(sql) { countingDb.n++; return DB.prepare(sql); }, n: 0 };
const row = (id) => one('SELECT * FROM pre_listings WHERE id = ?', id);
let m = await moment.momentForOwner(countingDb, row(12), []);
check('momentForOwner: nothing and no statement for an open home with no Decision Night', m === undefined && countingDb.n === 0, `${countingDb.n}`);
countingDb.n = 0;
m = await moment.momentForOwner(countingDb, row(22), [{ id: b22, isPlatformOperator: true }]);
check('momentForOwner: exactly 1 statement for an awarded home', countingDb.n === 1 && m && m.interviewsDone === 2 && m.hiredIsOperator === true, `${countingDb.n} ${JSON.stringify(m)}`);
countingDb.n = 0;
m = await moment.momentForOwner(countingDb, row(11), []);
check('momentForOwner: 1 statement for a sealed Decision Night (no proposals read)', countingDb.n === 1 && m.daysToHire === null && m.hiredIsOperator === false, `${countingDb.n}`);
check('daysBetweenSql: at least 1, whole days, null when missing', moment.daysBetweenSql('2026-11-01 10:00:00', '2026-11-01 10:05:00') === 1
  && moment.daysBetweenSql('2026-11-01 10:00:00', '2026-11-03 11:00:00') === 3 && moment.daysBetweenSql(null, '2026-11-01 10:00:00') === null && moment.daysBetweenSql('2026-11-01 10:00:00', '') === null);

// ---- The detail GET: owner only, exactly the 4 keys ----
const detail = await mod('functions/api/pre-listings/[id].js');
const get = (id, who) => call(detail.onRequestGet, 'GET', '/x', who, { id: String(id) });
let r = await get(22, 1);
const KEYS = 'daysToHire,hiredIsOperator,interviewsDone,repost';
check('owner GET (awarded): moment has exactly interviewsDone, daysToHire, hiredIsOperator, repost', r.status === 200 && r.json.preListing.moment
  && Object.keys(r.json.preListing.moment).sort().join() === KEYS && Object.keys(r.json.preListing.moment.repost).sort().join() === 'hired,reveal', JSON.stringify(r.json.preListing && r.json.preListing.moment));
check('owner GET: hiring the operator (role admin) sets hiredIsOperator, 2 done interviews counted, 2 days', r.json.preListing.moment.hiredIsOperator === true && r.json.preListing.moment.interviewsDone === 2 && r.json.preListing.moment.daysToHire === 2, JSON.stringify(r.json.preListing.moment));
check('owner GET: the moment carries no names, fees, address, ZIP or price', !/Rudy|Zelda|Coldwell|Harborline|2\.5|9000|Secret|91913|899000/.test(JSON.stringify(r.json.preListing.moment)));
r = await get(20, 1);
check('owner GET: hiring a regular agent -> hiredIsOperator false; 4.5 days rounds up to 5', r.json.preListing.moment.hiredIsOperator === false && r.json.preListing.moment.daysToHire === 5 && r.json.preListing.moment.interviewsDone === 0, JSON.stringify(r.json.preListing.moment));
r = await get(21, 1);
check('owner GET: a same-day hire is 1 day', r.json.preListing.moment.daysToHire === 1, JSON.stringify(r.json.preListing.moment));
r = await get(23, 1);
check('owner GET: no awarded_at (hired before v45) -> daysToHire null', r.json.preListing.moment.daysToHire === null, JSON.stringify(r.json.preListing.moment));
r = await get(10, 1);
check('owner GET (Decision Night opened, still open): moment present, daysToHire null', r.json.preListing.moment && r.json.preListing.moment.daysToHire === null);
r = await get(12, 1);
check('owner GET (no Decision Night, not hired): no moment key', r.status === 200 && !('moment' in r.json.preListing));
for (const [id, who, what] of [[20, 3, 'an approved agent'], [20, 2, 'the hired agent'], [20, 6, 'an admin'], [22, 5, 'the operator (admin + agent), hired here']]) {
  r = await get(id, who);
  check(`${what} gets no moment key`, r.status === 200 && !('moment' in r.json.preListing), `${r.status} ${JSON.stringify(r.json && r.json.preListing && r.json.preListing.moment)}`);
}

// ---- PUT /api/pre-listings/:id/repost-ok ----
const repost = await mod('functions/api/pre-listings/[id]/repost-ok.js');
const put = (id, who, body) => call(repost.onRequestPut, 'PUT', '/x', who, { id: String(id) }, body);
const alerts = () => one("SELECT COUNT(*) AS n FROM admin_alerts_sent WHERE kind = 'repost_ok'").n;
r = await put(20, null, { moment: 'hired', ok: true });
check('repost-ok: 401 signed out', r.status === 401);
r = await put(999, 1, { moment: 'hired', ok: true });
check('repost-ok: 404 for a home that does not exist', r.status === 404);
r = await put(20, 2, { moment: 'hired', ok: true });
check('repost-ok: 403 for an agent (even the hired one)', r.status === 403 && r.json.error === 'Only the homeowner can do this.');
r = await put(20, 6, { moment: 'hired', ok: true });
check('repost-ok: 403 for an admin', r.status === 403);
r = await put(20, 1, { moment: 'price', ok: true });
check('repost-ok: 400 for another moment', r.status === 400 && r.json.error === 'Pick reveal or hired.');
r = await put(11, 1, { moment: 'reveal', ok: true });
check('repost-ok: 409 not_available for Reveal Mode while sealed', r.status === 409 && r.json.code === 'not_available' && r.json.error === "This isn't available for this home yet.");
r = await put(12, 1, { moment: 'reveal', ok: true });
check('repost-ok: 409 for Reveal Mode with no Decision Night', r.status === 409 && r.json.code === 'not_available');
r = await put(10, 1, { moment: 'hired', ok: true });
check('repost-ok: 409 for the Hired! story while still open', r.status === 409 && r.json.code === 'not_available');
r = await put(11, 1, { moment: 'reveal', ok: false });
check('repost-ok: taking back is always allowed', r.status === 200 && r.json.repost.reveal === false);
check('repost-ok: nothing stored and no alert so far', one('SELECT COUNT(*) AS n FROM moment_repost_consents').n === 0 && alerts() === 0);
r = await put(20, 1, { moment: 'hired', ok: true });
const c1 = one("SELECT * FROM moment_repost_consents WHERE pre_listing_id = 20 AND moment = 'hired'");
check('repost-ok: OK saved with the wording version, private no-store', r.status === 200 && r.json.ok === true && r.json.repost.hired === true && r.json.repost.reveal === false
  && c1 && c1.user_id === 1 && c1.consent_version === moment.MOMENT_CONSENT_VERSION && c1.withdrawn_at === null && r.headers.get('Cache-Control') === 'private, no-store', JSON.stringify(r.json));
check('repost-ok: an OK sends one capped admin alert', alerts() === 1);
r = await put(20, 1, { moment: 'hired', ok: false });
const c2 = one("SELECT * FROM moment_repost_consents WHERE pre_listing_id = 20 AND moment = 'hired'");
check('repost-ok: take back sets withdrawn_at, no alert', r.status === 200 && r.json.repost.hired === false && c2.withdrawn_at && alerts() === 1 && r.headers.get('Cache-Control') === 'private, no-store');
run("UPDATE moment_repost_consents SET consented_at = '2026-01-01 00:00:00', consent_version = 'old' WHERE pre_listing_id = 20");
r = await put(20, 1, { moment: 'hired', ok: true });
const c3 = one("SELECT * FROM moment_repost_consents WHERE pre_listing_id = 20 AND moment = 'hired'");
check('repost-ok: renewing clears withdrawn_at, moves consented_at, stores the current wording', r.json.repost.hired === true && c3.withdrawn_at === null && c3.consented_at > '2026-01-01 00:00:00'
  && c3.consent_version === moment.MOMENT_CONSENT_VERSION && one('SELECT COUNT(*) AS n FROM moment_repost_consents WHERE pre_listing_id = 20').n === 1 && alerts() === 2, JSON.stringify(c3));
r = await put(10, 1, { moment: 'reveal', ok: true });
check('repost-ok: Reveal Mode OK after Decision Night opened', r.status === 200 && r.json.repost.reveal === true);
await put(10, 1, { moment: 'reveal', ok: false });
r = await put(30, 7, { moment: 'hired', ok: true });
check('repost-ok: a demo owner can OK, but no admin alert', r.status === 200 && r.json.repost.hired === true && one("SELECT COUNT(*) AS n FROM admin_alerts_sent WHERE kind = 'repost_ok' AND user_id = 7").n === 0);
r = await get(20, 1);
check('owner GET: repost reflects the OK', r.json.preListing.moment.repost.hired === true && r.json.preListing.moment.repost.reveal === false);

// ---- GET /api/admin/repost-oks ----
const adminList = await mod('functions/api/admin/repost-oks.js');
r = await call(adminList.onRequestGet, 'GET', '/x', null, {});
check('admin repost-oks: 401 signed out', r.status === 401);
r = await call(adminList.onRequestGet, 'GET', '/x', 2, {});
check('admin repost-oks: 403 for an approved agent who is not an admin', r.status === 403 && r.json.error === 'Admin only.');
r = await call(adminList.onRequestGet, 'GET', '/x', 6, {});
const rows = (r.json && r.json.consents) || [];
const NINE = 'city,consentVersion,consentedAt,moment,ownerName,ownerUserId,preListingId,state,withdrawnAt';
check('admin repost-oks: 200, private no-store, rows with exactly the 9 keys', r.status === 200 && r.headers.get('Cache-Control') === 'private, no-store' && rows.length === 2 && rows.every(x => Object.keys(x).sort().join() === NINE), JSON.stringify(rows));
check('admin repost-oks: the withdrawn Reveal Mode OK is listed with withdrawnAt', rows.some(x => x.preListingId === 10 && x.moment === 'reveal' && x.withdrawnAt));
check('admin repost-oks: demo owners left out', !rows.some(x => x.ownerUserId === 7));
check('admin repost-oks: no proposal, fee, agent or address fields', !/Secret|91913|commission|fee|Zelda|Harborline|899000/i.test(JSON.stringify(rows)));
run("UPDATE moment_repost_consents SET consented_at = datetime('now', '-200 days'), withdrawn_at = datetime('now', '-190 days') WHERE pre_listing_id = 10");
r = await call(adminList.onRequestGet, 'GET', '/x', 6, {});
check('admin repost-oks: only the last 180 days', r.json.consents.length === 1 && r.json.consents[0].preListingId === 20);

// ---- Jury: the server files read no proposal text, fees or price opinions ----
for (const f of ['functions/api/pre-listings/[id]/repost-ok.js', 'functions/_lib/moment.js', 'functions/api/admin/repost-oks.js']) {
  const src = read(f);
  check(`${f}: no commission / flat_fee / price_opinion / message reads`, !/commission|flat_fee|price_opinion|message/i.test(src));
}

// ---- Client: decision-night.js + share-moment.js in a stubbed browser ----
// A tiny DOM: enough for the Reveal Mode overlay (createElement, append, textContent, classes, closest).
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parent = null; this._text = ''; this.className = ''; this.dataset = {}; this.attrs = {}; this.hidden = false; this.listeners = {}; this.removed = false; this.disabled = false; this.type = ''; }
  get classList() { const el = this; const list = () => el.className.split(/\s+/).filter(Boolean); return { add: (c) => { if (!list().includes(c)) el.className = [...list(), c].join(' '); }, remove: (c) => { el.className = list().filter(x => x !== c).join(' '); }, contains: (c) => list().includes(c), toggle: () => {} }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  focus() { doc.activeElement = this; }
  click() {}
  matches(sel) { if (sel === '[data-moment-action]') return !!this.dataset.momentAction; if (sel.startsWith('.')) return this.classList.contains(sel.slice(1)); return false; }
  closest(sel) { for (let e = this; e; e = e.parent) { if (sel.split(',').some(s => e.matches && e.matches(s.trim()))) return e; } return null; }
  querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const d = c.querySelector(sel); if (d) return d; } return null; }
  querySelectorAll(sel) { const out = []; for (const c of this.children) { if (c.matches(sel)) out.push(c); out.push(...c.querySelectorAll(sel)); } return out; }
  all() { return [this, ...this.children.flatMap(c => c.all())]; }
}
const docListeners = {};
const boxes = {};
const fillTexts = [];
const fakeCtx = () => new Proxy({ measureText: (t) => ({ width: String(t).length * 22 }), fillText: (t) => fillTexts.push(String(t)), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
const body = new El('body');
const doc = {
  activeElement: null, body, documentElement: new El('html'), readyState: 'complete', referrer: '',
  addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter(f => f !== fn); },
  getElementById: (id) => boxes[id] || null,
  querySelector: (sel) => body.querySelector(sel), querySelectorAll: (sel) => body.querySelectorAll(sel),
  createElement: (tag) => { const el = new El(tag); if (tag === 'canvas') { el.getContext = () => fakeCtx(); el.toBlob = (cb) => cb(new Blob(['png'], { type: 'image/png' })); } return el; },
};
const toasts = [];
const fetches = [];
let fetchReply = () => ({ ok: true, status: 200, json: async () => ({}) });
let coarse = false;
const shared = [];
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, atob, btoa, Blob, File, Notification: {},
  navigator: { userAgent: 'node', canShare: () => true, share: async (d) => { shared.push(d); } },
  window: { matchMedia: () => ({ matches: coarse }), addEventListener() {}, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com', origin: 'https://amicohaus.com' } },
  location: { origin: 'https://amicohaus.com' },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  document: doc, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async (path, opts = {}) => { fetches.push({ path, opts }); return fetchReply(path, opts); },
};
sandbox.window.document = doc;
vm.createContext(sandbox);
let loaded = true;
try { for (const f of ['client.js', 'decision-night.js', 'share-moment.js']) vm.runInContext(read(f), sandbox, { filename: f }); } catch (e) { loaded = false; realLog(e); }
check('client.js + decision-night.js + share-moment.js load together', loaded);
vm.runInContext('toast = (m) => { __toasts.push(m); };', Object.assign(sandbox, { __toasts: toasts }));
const g = (expr) => vm.runInContext(expr, sandbox);
// share-moment.js alone (demo.html loads it without decision-night.js) must load and run openRevealMode.
const demoBox = { ...sandbox, document: doc };
vm.createContext(demoBox);
let demoOk = true;
try { for (const f of ['client.js', 'share-moment.js']) vm.runInContext(read(f), demoBox, { filename: f }); vm.runInContext("openRevealMode([{ letter: 'Agent A', reel: true }, { letter: 'Agent B', reel: false }], { city: 'Chula Vista', state: 'CA', sample: true })", demoBox); } catch (e) { demoOk = false; realLog(e); }
const demoOverlay = body.querySelector('.moment-overlay');
check('demo: share-moment.js without decision-night.js loads and opens Reveal Mode', demoOk && !!demoOverlay);
// Close it the way a person would (Esc), so its key listener is gone before the app's overlay opens.
const keyListenersBefore = (docListeners.keydown || []).length;
for (const fn of [...(docListeners.keydown || [])]) { try { fn({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, target: body }); } catch { /* client.js's own key handlers expect a real page */ } }
check('demo: Esc closed the demo overlay and dropped its key listener', !body.querySelector('.moment-overlay') && (docListeners.keydown || []).length === keyListenersBefore - 1);

const fixtureBids = [
  { id: 1, agentUserId: 2, agentName: 'Zelda Quill', brokerageName: 'Harborline Realty', licenseNumber: '01234562', status: 'pending', commissionPct: 2.5, flatFee: 9000, message: 'My fee is 2.5%', submittedAt: '2026-11-04 10:00:00', hasPitchVideo: false },
  { id: 2, agentUserId: 3, agentName: 'Orrin Pell', brokerageName: 'Saltmarsh Homes', status: 'pending', commissionPct: 2, submittedAt: '2026-11-03 09:00:00', hasPitchVideo: true },
  { id: 3, agentUserId: 4, agentName: 'Tamsin Vey', brokerageName: 'Copperfield Group', status: 'withdrawn', submittedAt: '2026-11-02 09:00:00', hasPitchVideo: true },
  { id: 4, agentUserId: 6, agentName: 'Late Larkin', brokerageName: 'Afterhours Realty', status: 'pending', submittedAt: '2026-11-06 09:00:00', afterDecisionNight: true, hasPitchVideo: false },
];
const FIXTURE_LEAKS = /Zelda|Quill|Orrin|Pell|Tamsin|Larkin|Harborline|Saltmarsh|Copperfield|Afterhours|Secret|91913|899|0123456/;
const BANNED = /\$|\d\s?[kKmM]\b|fee|commission|%|price|appraisal|worth/i;
const NO_REWARD = /reward|\bearn|bonus|gift/i;
// The fixed copy says what the slides leave out ("no names, fees or prices", "No payment or reward"); those exact
// negations are taken out before the word checks.
const NEGATIONS = ['with no names, fees or prices', 'No names, fees, prices or address', 'No payment or reward.'];
const strip = (html) => NEGATIONS.reduce((s, n) => s.split(n).join(''), String(html).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
sandbox.__bids = fixtureBids;
const pOpen = { id: 10, status: 'open', city: 'Chula Vista', state: 'CA', zip: '91913', address: ADDRESS, askingPrice: 899000, decisionNight: { dueAt: past, sealed: false }, moment: { interviewsDone: 0, daysToHire: null, hiredIsOperator: false, repost: { reveal: false, hired: false } } };
sandbox.__p = pOpen;
const buttons = g('momentButtonsHtml(__p, __bids)');
check('Reveal Mode button: shown after Decision Night with 2+ opened together', buttons.includes('data-moment-action="reveal"') && buttons.includes('▶ Reveal Mode'));
check('Reveal Mode button: hidden while sealed, with no Decision Night, or with 1 opened together', g("momentButtonsHtml({ ...__p, decisionNight: { sealed: true } }, __bids)") === ''
  && g("momentButtonsHtml({ ...__p, decisionNight: undefined }, __bids)") === '' && g('momentButtonsHtml(__p, __bids.slice(0, 1))') === '');
const REVEAL_CONSENT = 'Rudy Flores may repost my video or screenshots of this Reveal Mode on Amico Haus and his social accounts. Everyone shown or heard in my recording is OK with that. No payment or reward. I can take this back anytime here, and he&#39;ll remove his reposts.';
const HIRED_CONSENT = REVEAL_CONSENT.replace('this Reveal Mode', 'this Hired! story');
check('Reveal Mode consent label exact, unticked, tied to its box', buttons.includes(`<label class="checkbox-row moment-consent" for="momentRepostReveal"><input type="checkbox" id="momentRepostReveal" data-moment-repost="reveal"><span>${REVEAL_CONSENT}</span></label>`)
  && buttons.includes('<p class="tiny">You send him your recording yourself. Amico Haus never records your screen.</p>'), buttons);
const pAwarded = { ...pOpen, status: 'awarded', awardedBidId: 1, moment: { interviewsDone: 2, daysToHire: 6, hiredIsOperator: false, repost: { reveal: false, hired: true } } };
sandbox.__pa = pAwarded;
const story = g('momentStoryHtml(__pa, __bids)');
check('Hired! story: shown only when awarded', story.includes('data-moment-action="story"') && g('momentStoryHtml(__p, __bids)') === '');
check('Hired! story consent label exact and ticked from moment.repost', story.includes(`<label class="checkbox-row moment-consent" for="momentRepostHired"><input type="checkbox" id="momentRepostHired" data-moment-repost="hired" checked><span>${HIRED_CONSENT}</span></label>`), story);
check('Hired! story: the owner\'s own count (opened together) and pick line', story.includes('"2 agents sent me proposals"') && story.includes('"I interviewed 2 and picked 1 in 6 days"'), story);
check('Hired! story: no Decision Night counts every live proposal', g("momentStoryHtml({ ...__pa, decisionNight: undefined }, __bids)").includes('"3 agents sent me proposals"'));
check('Hired! story: the count slide is offered only with 1 or more', !g("momentStoryHtml({ ...__pa, decisionNight: undefined }, [])").includes('momentSlideCount') && g("momentStoryHtml({ ...__pa, moment: { interviewsDone: 0, daysToHire: 1, repost: {} } }, __bids)").includes('"I picked my agent in 1 day"'));
check('every label in the moment HTML is tied to a box', ![...(buttons + story).matchAll(/<label[^>]*>/g)].some(m => !/for="/.test(m[0])));
for (const [name, html] of [['Reveal Mode button', buttons], ['Hired! story', story]]) {
  const text = strip(html);
  check(`${name}: no money, price or value words`, !BANNED.test(text), (text.match(BANNED) || [])[0]);
  check(`${name}: no agent names, brokerages, address or ZIP`, !FIXTURE_LEAKS.test(html));
  check(`${name}: no reward wording`, !NO_REWARD.test(text));
}
check('CSP: no inline style or handler in the moment HTML', !/\sstyle\s*=|\son[a-z]+\s*=/i.test(buttons + story));

// decision-night.js wiring
const dnOpen = g('decisionNightOwnerHtml(__p, __bids)');
check('Decision Night panel: Reveal Mode after the share card', dnOpen.includes('moment-actions') && dnOpen.indexOf('share-card') < dnOpen.indexOf('moment-actions'));
const dnAwarded = g('decisionNightOwnerHtml({ ...__pa, debrief: undefined }, __bids)');
check('Decision Night panel: the Hired! story shows on an awarded home even without a debrief', dnAwarded.includes('moment-story'));
const dnDebrief = g("decisionNightOwnerHtml({ ...__pa, debrief: { finalists: [{ agentName: 'Orrin Pell' }], sent: true } }, __bids)");
check('Decision Night panel: debrief first, then the story', dnDebrief.indexOf('Your finalists got your feedback') >= 0 && dnDebrief.indexOf('Your finalists got your feedback') < dnDebrief.indexOf('moment-story'));

// Reveal click: cards from the opened-together proposals in arrival order, letters only.
g('decisionNightOwnerHtml(__p, __bids)');
let revealArgs = null;
sandbox.__spy = (cards, opts) => { revealArgs = { cards, opts }; };
g('var __realReveal = openRevealMode; openRevealMode = __spy;');
// Each listener on its own, like a browser: client.js's own handlers expect a real page and may throw here.
const fire = async (type, ev) => { for (const fn of [...(docListeners[type] || [])]) { try { await fn(ev); } catch { /* not ours */ } } };
const btnEl = (action) => { const b = new El('button'); b.dataset.momentAction = action; return b; };
await fire('click', { target: btnEl('reveal') });
check('Reveal click: opened-together, non-withdrawn proposals in submittedAt order', revealArgs && revealArgs.cards.length === 2 && revealArgs.cards[0].letter === 'Agent A' && revealArgs.cards[0].reel === true
  && revealArgs.cards[1].letter === 'Agent B' && revealArgs.cards[1].reel === false, JSON.stringify(revealArgs));
check('Reveal click: each card is only { letter, reel }; city and state only', revealArgs && revealArgs.cards.every(c => Object.keys(c).sort().join() === 'letter,reel')
  && JSON.stringify(revealArgs.opts) === JSON.stringify({ city: 'Chula Vista', state: 'CA' }));
g('openRevealMode = __realReveal;');
check('letters: A to Z, then "Agent 27"', g('MOMENT_letter(0)') === 'Agent A' && g('MOMENT_letter(25)') === 'Agent Z' && g('MOMENT_letter(26)') === 'Agent 27');

// Reveal Mode overlay
g("openRevealMode([{ letter: 'Agent A', reel: true }, { letter: 'Agent B', reel: false }, { letter: 'Agent C', reel: false }], { city: 'Chula Vista', state: 'CA', sample: true })");
const overlay = body.querySelector('.moment-overlay');
const cards = overlay ? overlay.querySelectorAll('.moment-card') : [];
const finalEl = overlay && overlay.querySelector('.moment-final');
check('overlay: full-screen dialog with the title, city line, face-down cards and the sample label', overlay && overlay.getAttribute('role') === 'dialog' && overlay.textContent.includes('My Decision Night')
  && overlay.textContent.includes('Chula Vista, CA') && cards.length === 3 && cards.every(c => !c.classList.contains('moment-card-flipped')) && overlay.querySelector('.moment-sample') && finalEl && finalEl.hidden === true);
check('overlay: the DRE and broker lines on every frame', overlay && overlay.textContent.includes('Presented by Rudy Flores, Realtor® · DRE #02257808') && overlay.textContent.includes('Coldwell Banker West'));
const nextBtn = overlay && overlay.querySelector('[data-moment-action]');
const sound = overlay && overlay.all().find(e => e.dataset.momentAction === 'sound');
check('overlay: Sound is off by default (aria-pressed false)', sound && sound.getAttribute('aria-pressed') === 'false');
const clickOverlay = (target) => overlay.listeners.click.forEach(fn => fn({ target }));
clickOverlay(nextBtn);
check('overlay: Next flips one card', cards[0].classList.contains('moment-card-flipped') && !cards[1].classList.contains('moment-card-flipped'));
await fire('keydown', { key: 'ArrowRight', preventDefault() {}, stopImmediatePropagation() {}, target: body });
await fire('keydown', { key: ' ', preventDefault() {}, stopImmediatePropagation() {}, target: body });
check('overlay: → and Space flip the rest; the final frame shows', cards.every(c => c.classList.contains('moment-card-flipped')) && finalEl.hidden === false
  && finalEl.textContent.includes('3 agents sent me proposals') && finalEl.textContent.includes('AMICO HAUS')
  && finalEl.textContent.includes("Amico Haus: the real estate marketplace of tomorrow! Everything that's missing from the real estate market for the homeowner!"));
check('overlay: a pitch reel only adds "with a pitch reel"', cards[0].textContent.includes('Agent A') && cards[0].textContent.includes('with a pitch reel') && !cards[1].textContent.includes('pitch reel'));
const overlayText = NEGATIONS.reduce((s, n) => s.split(n).join(''), overlay.textContent);
check('overlay: no money, price or value words, no reward wording', !BANNED.test(overlayText) && !NO_REWARD.test(overlayText), (overlayText.match(BANNED) || [])[0]);
clickOverlay(sound);
check('overlay: Sound toggles aria-pressed', sound.getAttribute('aria-pressed') === 'true');
await fire('keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, target: body });
check('overlay: Esc closes it', overlay.removed && !body.querySelector('.moment-overlay') && !body.classList.contains('reel-open'));

// Hired! story slides: canvas text, operator line, the share text.
fetchReply = (path) => ({ ok: true, status: 200, json: async () => (String(path).includes('/api/referrals') ? { referralCode: 'AB12', referredCount: 0 } : {}) });
const setBoxes = (count, pick, turn) => { boxes.momentSlideCount = { checked: count }; boxes.momentSlidePick = { checked: pick }; boxes.momentSlideTurn = { checked: turn }; };
const pOp = { ...pAwarded, moment: { ...pAwarded.moment, hiredIsOperator: true } };
sandbox.__pop = pOp;
const drawn = async (pExpr, count, pick, turn) => { fillTexts.length = 0; setBoxes(count, pick, turn); await g(`MOMENT_makeStory(${pExpr}, __bids)`); return fillTexts.slice(); };
let texts = await drawn('__pa', true, true, true);
check('story slides: HIRED!, count, pick, your turn, brand lines', texts.filter(t => t === 'HIRED!').length === 3 && texts.join(' ').includes('2 agents sent me proposals')
  && texts.join(' ').includes('Your turn') && texts.join(' ').includes('amicohaus.com') && texts.filter(t => t === 'AMICO HAUS').length === 3
  && texts.filter(t => t === 'Presented by Rudy Flores, Realtor® · DRE #02257808').length === 3 && texts.filter(t => t === 'Coldwell Banker West').length === 3, JSON.stringify(texts));
check('story slides: the full tagline, wrapped', texts.join(' ').includes('Amico Haus: the real estate marketplace of tomorrow!') && texts.join(' ').includes('for the homeowner!'));
check('story slides: no operator line when the hired agent is not the operator', !texts.some(t => t.includes('runs Amico Haus')));
const canvasText = texts.join(' | ');
check('story slides: no money, price or value words', !BANNED.test(canvasText), (canvasText.match(BANNED) || [])[0]);
check('story slides: no agent names, brokerages, address or ZIP; no reward wording', !FIXTURE_LEAKS.test(canvasText) && !NO_REWARD.test(canvasText));
texts = await drawn('__pop', true, true, true);
check('operator hired: "The agent I picked runs Amico Haus" on the pick slide', texts.filter(t => t.includes('The agent I picked runs Amico Haus')).length === 1);
texts = await drawn('__pop', true, false, false);
check('operator hired, pick slide off: the line goes on the last slide made', texts.filter(t => t.includes('runs Amico Haus')).length === 1 && texts.join(' ').includes('agents sent me proposals'));
texts = await drawn('__pop', false, false, true);
check('operator hired, only "Your turn": the line is still drawn', texts.some(t => t.includes('runs Amico Haus')));
fillTexts.length = 0; toasts.length = 0; setBoxes(false, false, false);
await g('MOMENT_makeStory(__pa, __bids)');
check('no slides ticked: nothing drawn, a short note', fillTexts.length === 0 && toasts.includes('Pick at least one slide.'));
coarse = true; shared.length = 0;
await drawn('__pop', true, true, true);
const s0 = shared[0] || {};
check('phone: one share sheet with every slide and the referral link', shared.length === 1 && s0.files.length === 3 && s0.files[0].name === 'amico-haus-hired-1.png'
  && s0.text.startsWith('I picked my agent on Amico Haus. Your turn: https://amicohaus.com/signup?as=homeowner&ref=AB12'), JSON.stringify(s0.text));
check('phone share text: the operator connection is said, no reward wording', s0.text.includes('The agent I picked runs Amico Haus') && !NO_REWARD.test(s0.text) && !BANNED.test(s0.text.replace(/https?:\S+/g, '')));
fetchReply = () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
shared.length = 0;
await drawn('__pa', false, false, true);
check('no referral code: the plain signup link', shared[0] && shared[0].text === 'I picked my agent on Amico Haus. Your turn: https://amicohaus.com/signup?as=homeowner');
coarse = false;

// Repost OK box: PUT, toast, and revert on error.
fetches.length = 0; toasts.length = 0;
fetchReply = () => ({ ok: true, status: 200, json: async () => ({ ok: true, repost: { reveal: false, hired: true } }) });
g('decisionNightOwnerHtml(__pa, __bids)');
const box = Object.assign(new El('input'), { checked: true, disabled: false });
box.dataset.momentRepost = 'hired';
await fire('change', { target: box });
const sentPut = fetches.find(f => String(f.path).includes('/repost-ok'));
check('repost box: PUT /api/pre-listings/<id>/repost-ok with { moment, ok }', sentPut && sentPut.path === '/api/pre-listings/10/repost-ok' && sentPut.opts.method === 'PUT' && sentPut.opts.body === JSON.stringify({ moment: 'hired', ok: true }), JSON.stringify(sentPut));
check('repost box: "Thanks! Rudy will see your OK."', toasts.includes('Thanks! Rudy will see your OK.'));
box.checked = false;
await fire('change', { target: box });
check('repost box: "Done. Your OK is taken back."', toasts.includes('Done. Your OK is taken back.'));
fetchReply = () => ({ ok: false, status: 409, json: async () => ({ error: "This isn't available for this home yet.", code: 'not_available' }) });
box.checked = true;
await fire('change', { target: box });
check('repost box: an error puts the box back', box.checked === false && box.disabled === false);

// ---- Source: only the three top-level functions; everything else prefixed or in the IIFE ----
const src = read('share-moment.js');
const tops = [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1] || m[2]);
const allowed = new Set(['momentButtonsHtml', 'momentStoryHtml', 'openRevealMode']);
check('share-moment.js: top-level names are the 3 functions or MOMENT_/moment-prefixed', tops.every(n => allowed.has(n) || /^MOMENT_|^moment[A-Z]/.test(n)), tops.join(','));
check('share-moment.js: no inline style or handler, no fixed price/fee strings', !/\sstyle\s*=\s*["'`]|\son[a-z]+\s*=\s*["'`]/i.test(src) && !/commission|flat_?fee|askingPrice|\.address|\.zip\b/.test(src));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
