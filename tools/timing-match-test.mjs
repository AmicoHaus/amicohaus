// Timing Match (batch R3-1b): the pure date helpers and the fit rule, the owner's timing on create and on its own
// PUT, the owner-only "buyers whose timing fits" count, what agents see, the browse "Timing fits" ids (city only),
// saved-search move-in windows, the 29-day stay cap (CHECK + API), no money fields, no reasons-for-moving words, and
// the client renderers. Runs the real handlers against an in-memory SQLite stand-in for D1. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/timing-match-test.mjs <projectRoot>
process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: a date helper that parses in local time shifts a day here.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
if (!root) { console.error('Usage: node tools/timing-match-test.mjs <projectRoot>'); process.exit(2); }
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
  put: async (key, body) => { objects.set(key, body); },
  get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
  head: async (key) => (objects.has(key) ? { size: 1 } : null),
  delete: async (key) => { objects.delete(key); },
  list: async () => ({ objects: [], truncated: false }),
};
// A test key with fetch stubbed below, so Rudy's admin alert is captured (no network).
const env = { DB, PHOTOS, RESEND_API_KEY: 'test-key' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
globalThis.fetch = async (url, opts) => { try { sent.push(JSON.parse(opts.body)); } catch { /* not an email */ } return new Response('{}', { status: 200 }); };
const call = async (handler, method, path, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${path}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json: parsed, text, cache: res.headers.get('Cache-Control') || '' };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
console.log = () => {};

const tm = await mod('functions/_lib/timingMatch.js');
const bd = await mod('functions/_lib/buyerDemand.js');
const rl = await mod('functions/_lib/rateLimits.js');
const index = await mod('functions/api/pre-listings/index.js');
const detail = await mod('functions/api/pre-listings/[id].js');
const timingApi = await mod('functions/api/pre-listings/[id]/timing.js');
const savedApi = await mod('functions/api/saved-searches/index.js');
const savedOne = await mod('functions/api/saved-searches/[id].js');

// ================= Pure helpers =================
check('addDays across a month (no local-time shift)', tm.addDays('2027-02-25', 7) === '2027-03-04', tm.addDays('2027-02-25', 7));
check('addDays across a year', tm.addDays('2026-12-28', 7) === '2027-01-04');
check('addDays onto a leap day', tm.addDays('2028-02-28', 1) === '2028-02-29');
check('windowLabel in one year', tm.windowLabel('2027-03-01', '2027-05-31') === 'Mar 1 – May 31, 2027', tm.windowLabel('2027-03-01', '2027-05-31'));
check('windowLabel across two years', tm.windowLabel('2026-12-01', '2027-02-15') === 'Dec 1, 2026 – Feb 15, 2027', tm.windowLabel('2026-12-01', '2027-02-15'));
check('pacificToday is a YYYY-MM-DD in Pacific time', tm.pacificToday(Date.UTC(2026, 10, 5, 6, 0)) === '2026-11-04' && tm.pacificToday(Date.UTC(2026, 10, 5, 9, 0)) === '2026-11-05');
check('the stay choices are 0, 7, 14 and 29 (Rudy 11.04), capped at 29', JSON.stringify(tm.STAY_DAYS) === '[0,7,14,29]' && tm.STAY_MAX_DAYS === 29 && tm.WINDOW_MAX_DAYS === 366 && tm.WINDOW_HORIZON_DAYS === 730);

const NOW = Date.UTC(2026, 10, 4, 20, 0); // Nov 4, 2026, noon Pacific
const vw = (a, b, o = {}) => tm.validateWindow(a, b, { nowMs: NOW, ...o });
check('validateWindow: both blank clears', vw('', '').value === null && vw(null, undefined).value === null && !vw('', '').error);
check('validateWindow: half a closing window', vw('2027-03-01', '').error === 'Pick both dates for your closing window, or clear both.');
check('validateWindow: half a move-in window', vw('', '2027-03-01', { kind: 'move' }).error === 'Pick both dates for your move-in window, or clear both.');
const RANGE = 'Pick closing dates between today and two years from now.';
check('validateWindow: a bad format', vw('03/01/2027', '2027-03-31').error === RANGE);
check('validateWindow: not a real date', vw('2027-02-30', '2027-03-31').error === RANGE);
check('validateWindow: a start in the past', vw('2026-11-03', '2027-03-31').error === RANGE);
check('validateWindow: today is fine', vw('2026-11-04', '2026-12-01').value && vw('2026-11-04', '2026-12-01').value.from === '2026-11-04');
check('validateWindow: more than 2 years out', vw('2028-10-01', '2028-11-05').error === RANGE);
check('validateWindow: the move-in range message', vw('2020-01-01', '2020-02-01', { kind: 'move' }).error === 'Pick move-in dates between today and two years from now.');
check('validateWindow: end before start', vw('2027-03-10', '2027-03-01').error === 'The end date has to be on or after the start date.');
check('validateWindow: a 400-day span', vw('2026-12-01', '2028-01-05').error === 'Keep the window to one year or less.');
check('validateWindow: a one-day window is fine', !!vw('2027-03-01', '2027-03-01').value);
check('validateWindow: an unchanged past pair passes with prev', vw('2026-01-01', '2026-02-01', { prev: { from: '2026-01-01', to: '2026-02-01' } }).value.from === '2026-01-01');
check('validateWindow: a changed past pair does not', vw('2026-01-01', '2026-02-02', { prev: { from: '2026-01-01', to: '2026-02-01' } }).error === RANGE);
for (const ok of [0, 7, 14, 29, '7', '29']) check(`validateStayDays ${JSON.stringify(ok)} is OK`, tm.validateStayDays(ok).value === Number(ok));
check("validateStayDays '' is 0", tm.validateStayDays('').value === 0 && tm.validateStayDays(undefined).value === 0);
for (const bad of [3, 30, 31, 45, -1, 'abc', true]) check(`validateStayDays ${JSON.stringify(bad)} is refused`, tm.validateStayDays(bad).error === 'Pick no stay, or up to 7, 14 or 29 days.');
check('validateOwnerTiming maps the fields', JSON.stringify(tm.validateOwnerTiming({}).data) === '{"closeFrom":null,"closeTo":null,"stayAfterDays":0}');
check('validateSearchTiming uses move_from/move_to as prev', tm.validateSearchTiming({ moveFrom: '2026-01-01', moveTo: '2026-02-01', stayOfferDays: 7 }, { move_from: '2026-01-01', move_to: '2026-02-01' }).data.stayOfferDays === 7);

// timingFits (today 2026-11-04; home 2027-03-01..2027-03-31)
const TODAY = '2026-11-04';
const H = (s) => ({ closeFrom: '2027-03-01', closeTo: '2027-03-31', stayAfterDays: s });
const S = (from, to, b) => ({ move_from: from, move_to: to, stay_offer_days: b });
check('fits: S0/B0 overlapping', tm.timingFits(S('2027-03-15', '2027-04-15', 0), H(0), TODAY) === true);
check('fits: a move-in window before the closing window', tm.timingFits(S('2027-01-01', '2027-02-27', 0), H(0), TODAY) === false);
check('fits: touching days count', tm.timingFits(S('2027-01-01', '2027-03-01', 0), H(0), TODAY) === true);
check('fits: the owner wants more stay than the buyer offers (S14/B7)', tm.timingFits(S('2027-03-15', '2027-04-15', 7), H(14), TODAY) === false);
check('fits: S7/B30 with the hand-over moved by 7 days', tm.timingFits(S('2027-04-05', '2027-04-30', 30), H(7), TODAY) === true);
check('fits: S7/B30 when the buyer moves in before the hand-over', tm.timingFits(S('2027-03-01', '2027-03-07', 30), H(7), TODAY) === false);
check('fits: an expired home window', tm.timingFits(S('2026-09-01', '2027-04-30', 0), { closeFrom: '2026-09-01', closeTo: '2026-10-01', stayAfterDays: 0 }, TODAY) === false);
check('fits: an expired search window', tm.timingFits(S('2026-09-01', '2026-10-01', 0), { closeFrom: '2026-09-01', closeTo: '2027-10-01', stayAfterDays: 0 }, TODAY) === false);
check('fits: missing windows', tm.timingFits(S(null, null, 0), H(0), TODAY) === false && tm.timingFits(S('2027-03-01', '2027-03-31', 0), { closeFrom: null, closeTo: null }, TODAY) === false);

// timingForViewer and the alert line
const rowSet = { close_from: '2099-03-01', close_to: '2099-03-31', stay_after_days: 7 };
const rowPast = { close_from: '2020-03-01', close_to: '2020-03-31', stay_after_days: 0 };
const rowNone = { close_from: null, close_to: null, stay_after_days: 0 };
check('timingForViewer: owner always, with windowPassed', JSON.stringify(tm.timingForViewer(rowNone, { isOwner: true })) === '{"closeFrom":null,"closeTo":null,"stayAfterDays":0,"windowPassed":false}'
  && tm.timingForViewer(rowPast, { isOwner: true }).windowPassed === true);
check('timingForViewer: agent gets it without windowPassed', JSON.stringify(tm.timingForViewer(rowSet, { isAgent: true })) === '{"closeFrom":"2099-03-01","closeTo":"2099-03-31","stayAfterDays":7}');
check('timingForViewer: a passed window goes to agents as null dates', JSON.stringify(tm.timingForViewer(rowPast, { isAdmin: true })) === '{"closeFrom":null,"closeTo":null,"stayAfterDays":0}');
check('timingForViewer: nothing set -> nothing for agents and admins', tm.timingForViewer(rowNone, { isAgent: true }) === undefined && tm.timingForViewer(rowNone, { isAdmin: true }) === undefined);
check('timingForViewer: anyone else gets nothing', tm.timingForViewer(rowSet, {}) === undefined);
check('timingAlertLine with a window and a stay', tm.timingAlertLine({ closeFrom: '2027-03-01', closeTo: '2027-05-31', stayAfterDays: 14 }) === 'Ideal closing: Mar 1 – May 31, 2027 · stay up to 14 days after closing');
check('timingAlertLine with a window only', tm.timingAlertLine({ closeFrom: '2027-03-01', closeTo: '2027-05-31', stayAfterDays: 0 }) === 'Ideal closing: Mar 1 – May 31, 2027');
check('timingAlertLine with a stay only', tm.timingAlertLine({ closeFrom: null, closeTo: null, stayAfterDays: 7 }) === 'Ideal closing: not picked · stay up to 7 days after closing');
check('timingAlertLine with nothing', tm.timingAlertLine({ closeFrom: null, closeTo: null, stayAfterDays: 0 }) === '');

// ================= People and homes =================
// 1 owner A, 2 approved agent G, 3 approved agent H, 4 buyer, 5 admin (no agent profile), 7 owner B,
// 20-29 buyers, 30 demo buyer, 31 suspended buyer, 32 wish-list trader, 40-42 saved-search users.
const user = (id, extra = {}) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, extra.email ?? `u${id}@example.test`, `User ${id}`,
    extra.role ?? 'user', extra.status ?? 'active');
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
for (const id of [1, 2, 3, 4, 7, 32, 40, 41, 42]) user(id);
for (let id = 20; id <= 29; id++) user(id);
user(5, { role: 'admin' });
user(30, { email: 'buyer30@demo.amicohaus.local' });
user(31, { status: 'suspended' });
const agent = (id, lic) => run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', ?, 'Pacific Realty')", id, lic);
agent(2, '01234567'); agent(3, '07654321');
const home = (id, owner, status = 'open') => run(
  `INSERT INTO pre_listings (id, user_id, title, city, state, zip, neighborhood, property_type, beds, baths, asking_price, address, status)
   VALUES (?, ?, 'Home', 'Chula Vista', 'CA', '91913', 'EastLake', 'Single Family Home', 3, 2, 750000, '456 Hidden Ave', ?)`, id, owner, status);
home(10, 1); home(11, 7); home(13, 1, 'closed'); home(14, 1, 'awarded');

const T = tm.pacificToday();
const D = (n) => tm.addDays(T, n);
const P10 = { id: '10' };

// ================= POST /api/pre-listings with timing =================
const base = { city: 'Chula Vista', state: 'CA', zip: '91913', propertyType: 'Single Family Home', beds: 3, baths: 2, occupancyStatus: 'occupied', askingPrice: '700000' };
const countHomes = () => one('SELECT COUNT(*) AS n FROM pre_listings').n;
let r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 7, {}, { ...base, closeFrom: D(60), closeTo: D(90), stayAfterDays: 14 });
const NEW = r.json && r.json.id;
let row = NEW && one('SELECT close_from, close_to, stay_after_days FROM pre_listings WHERE id = ?', NEW);
check('create with timing stores the window and stay', r.status === 201 && row && row.close_from === D(60) && row.close_to === D(90) && row.stay_after_days === 14, JSON.stringify([r, row]));
check('create response is still just { id }', r.json && Object.keys(r.json).join() === 'id');
const alertMail = sent.find(m => /New pre-listing/.test(m.subject || ''));
check("Rudy's new pre-listing alert has the timing line", !!alertMail && JSON.stringify(alertMail).includes(`Ideal closing: ${tm.windowLabel(D(60), D(90))} · stay up to 14 days after closing`), alertMail ? alertMail.text || alertMail.html : 'no alert');
let before = countHomes();
r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 7, {}, { ...base, closeFrom: D(60), closeTo: '' });
check('create with half a window -> 400, nothing inserted', r.status === 400 && r.json.error === 'Pick both dates for your closing window, or clear both.' && countHomes() === before, JSON.stringify(r.json));
r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 7, {}, { ...base, stayAfterDays: 30 });
check('create with a 30-day stay -> 400 (cap is 29), nothing inserted', r.status === 400 && /29 days/.test(r.json.error) && countHomes() === before, JSON.stringify(r.json));
r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 7, {}, { ...base, stayAfterDays: 31 });
check('create with a 31-day stay -> 400', r.status === 400 && countHomes() === before);
r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 7, {}, { ...base });
row = r.json && one('SELECT close_from, close_to, stay_after_days FROM pre_listings WHERE id = ?', r.json.id);
check('create without timing still works (nothing set)', r.status === 201 && row.close_from === null && row.stay_after_days === 0);

// ================= PUT /api/pre-listings/:id/timing =================
const put = (who, params, body) => call(timingApi.onRequestPut, 'PUT', '/x', who, params, body);
const good = { closeFrom: D(100), closeTo: D(130), stayAfterDays: 7 };
r = await put(1, P10, { ...good, rentBackAmount: 987654, deposit: 987653, perDiem: 987652 });
row = one('SELECT close_from, close_to, stay_after_days FROM pre_listings WHERE id = 10');
check('owner PUT /timing -> 200 and stored', r.status === 200 && row.close_from === D(100) && row.close_to === D(130) && row.stay_after_days === 7, JSON.stringify(r.json));
check('the response has timing (with windowPassed) and timingDemand', r.json && JSON.stringify(r.json.timing) === JSON.stringify({ ...good, windowPassed: false }) && 'timingDemand' in r.json && r.json.timingDemand === null, JSON.stringify(r.json));
check('PUT /timing is private, no-store', r.cache === 'private, no-store', r.cache);
const dump = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  .map(t => JSON.stringify(q(`SELECT * FROM "${t.name}"`))).join('\n');
check('rentBackAmount / deposit / perDiem are ignored and stored nowhere', !/98765[234]/.test(dump));
check('an approved agent cannot PUT /timing (403)', (await put(2, P10, good)).status === 403);
check('another homeowner cannot (403)', (await put(7, P10, good)).status === 403);
check('an admin cannot (403)', (await put(5, P10, good)).status === 403);
check('signed out -> 401', (await put(null, P10, good)).status === 401);
r = await put(1, { id: '999' }, good);
check('a missing home -> 404', r.status === 404 && r.json.error === 'Pre-listing not found.');
r = await put(1, { id: '13' }, good);
check('a closed home -> 400 not_open', r.status === 400 && r.json.code === 'not_open' && r.json.error === "This pre-listing is closed, so its timing can't change.", JSON.stringify(r.json));
r = await put(1, { id: '14' }, good);
check('an awarded home -> 200', r.status === 200 && one('SELECT stay_after_days FROM pre_listings WHERE id = 14').stay_after_days === 7);
r = await put(1, P10, '{not json');
check('bad JSON -> 400', r.status === 400 && r.json.error === 'Invalid request body.');
r = await put(1, P10, { closeFrom: D(100), closeTo: '' });
check('half a window -> 400', r.status === 400 && r.json.error === 'Pick both dates for your closing window, or clear both.');
r = await put(1, P10, { ...good, stayAfterDays: 30 });
check('a 30-day stay -> 400 (cap 29)', r.status === 400 && r.json.error === 'Pick no stay, or up to 7, 14 or 29 days.');
r = await put(1, P10, { ...good, stayAfterDays: 29 });
check('a 29-day stay -> 200', r.status === 200 && one('SELECT stay_after_days FROM pre_listings WHERE id = 10').stay_after_days === 29);
run("DELETE FROM user_action_log WHERE user_id = 1 AND kind = 'timing_edit'");
r = await put(1, P10, { ...good, stayAfterDays: 29 });
check('an unchanged PUT -> 200 with no user_action_log row', r.status === 200 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 1 AND kind = 'timing_edit'").n === 0);
let okCount = 0;
for (let i = 0; i < 10; i++) { r = await put(1, P10, { ...good, stayAfterDays: i % 2 ? 29 : 14 }); if (r.status === 200) okCount++; }
check('10 changes in a day are allowed', okCount === 10, String(okCount));
r = await put(1, P10, { ...good, stayAfterDays: 0 });
check('the 11th change in a day -> 429 rate_limited, nothing changed', r.status === 429 && r.json.code === 'rate_limited' && one('SELECT stay_after_days FROM pre_listings WHERE id = 10').stay_after_days === 29, JSON.stringify(r.json));
check('timing_edit is 10 a day in USER_LIMITS', JSON.stringify(rl.USER_LIMITS.timing_edit) === '[{"max":10,"minutes":1440}]');
run("DELETE FROM user_action_log WHERE user_id = 1 AND kind = 'timing_edit'");
run('UPDATE pre_listings SET close_from = ?, close_to = ?, stay_after_days = 7 WHERE id = 10', D(100), D(130));

// The full-row edit (PUT /api/pre-listings/:id) leaves timing alone.
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P10, { ...base, title: 'Edited', askingPrice: '750000', neighborhood: 'EastLake', address: '456 Hidden Ave' });
row = one('SELECT title, close_from, close_to, stay_after_days FROM pre_listings WHERE id = 10');
check('[id].js PUT full-row edit keeps the timing', r.status === 200 && row.title === 'Edited' && row.close_from === D(100) && row.stay_after_days === 7, JSON.stringify([r.json, row]));

// ================= The owner's count and the detail GET =================
const search = (uid, loc, from, to, offer, extra = {}) => run(
  `INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max, move_from, move_to, stay_offer_days)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, uid, loc, extra.type ?? 'Any', extra.min ?? 0, extra.max ?? 0, from, to, offer);
// Fitting (hand-over D(107)..D(137)): 20, 21. Not counted: demo 30, suspended 31, the owner's own search, an
// expired window (23, set below), a stay offer under the owner's (24), no window (25, 26), a window that misses (27).
search(20, 'Chula Vista', D(110), D(140), 7);
search(21, 'Chula Vista', D(90), D(108), 14);
search(30, 'Chula Vista', D(110), D(140), 7);
search(31, 'Chula Vista', D(110), D(140), 7);
search(1, 'Chula Vista', D(110), D(140), 7);
run(`INSERT INTO saved_searches (user_id, locations, property_type, move_from, move_to, stay_offer_days) VALUES (23, 'Chula Vista', 'Any', '2020-01-01', '2020-02-01', 7)`);
search(24, 'Chula Vista', D(110), D(140), 0);
search(25, 'Chula Vista', null, null, 0);
search(26, 'EastLake', null, null, 0);
search(27, 'Chula Vista', D(10), D(50), 29);
// A wish list (a trader's listing) counts toward buyerDemand only, never toward timingDemand.
run(`INSERT INTO listings (id, user_id, city, state, property_type, beds, baths, estimated_value, price_tier, status)
     VALUES (500, 32, 'San Diego', 'CA', 'Condo', 2, 2, 500000, 'tier1', 'active')`);
run(`INSERT INTO desired_criteria (listing_id, locations, property_type) VALUES (500, 'Chula Vista', 'Any')`);
// buyerDemand: 20, 21, 23, 24, 25, 26 (EastLake = the neighborhood), 27, 32 = 8.
const homeArgs = () => {
  const h = one('SELECT * FROM pre_listings WHERE id = 10');
  return { userId: h.user_id, city: h.city, state: h.state, neighborhood: h.neighborhood, propertyType: h.property_type, price: h.asking_price,
    priceOpen: false, beds: h.beds, baths: h.baths, closeFrom: h.close_from, closeTo: h.close_to, stayAfterDays: h.stay_after_days };
};
let det = await bd.countBuyerDemandDetail(DB, homeArgs());
check('countBuyerDemandDetail: total 8, timingFit 2', det.total === 8 && det.timingFit === 2, JSON.stringify(det));
check('countBuyerDemand still returns the plain total', (await bd.countBuyerDemand(DB, homeArgs())) === 8);
const get = (who, params = P10) => call(detail.onRequestGet, 'GET', '/x', who, params);
r = await get(1);
check('owner detail GET: timing with windowPassed', r.status === 200 && JSON.stringify(r.json.preListing.timing) === JSON.stringify({ closeFrom: D(100), closeTo: D(130), stayAfterDays: 7, windowPassed: false }), JSON.stringify(r.json && r.json.preListing && r.json.preListing.timing));
check('owner: timingDemand is null with 2 fitting buyers', r.json.preListing.timingDemand === null, String(r.json.preListing.timingDemand));
check('owner: buyerDemand keeps its value (8)', r.json.preListing.buyerDemand === 8, String(r.json.preListing.buyerDemand));
search(22, 'Chula Vista', D(130), D(200), 29);
r = await get(1);
check('owner: timingDemand is 3 with 3 fitting buyers', r.json.preListing.timingDemand === 3 && r.json.preListing.buyerDemand === 9, JSON.stringify([r.json.preListing.timingDemand, r.json.preListing.buyerDemand]));
check("the owner's response never names the buyers", !/User 2[0-9]|u2[0-9]@example|buyer30|User 3[0-2]/.test(r.text));
check('the owner detail GET is private, no-store', r.cache === 'private, no-store');
r = await put(1, P10, { ...good, stayAfterDays: 7 });
check('PUT /timing returns the same count as the page (3)', r.status === 200 && r.json.timingDemand === 3, JSON.stringify(r.json));
r = await put(1, P10, { closeFrom: '', closeTo: '', stayAfterDays: 0 });
check('clearing the window -> timingDemand null, timing cleared', r.status === 200 && r.json.timingDemand === null && r.json.timing.closeFrom === null && r.json.timing.stayAfterDays === 0, JSON.stringify(r.json));
r = await get(1);
check('owner with no window: timing still sent (to fill in), timingDemand null', !!r.json.preListing.timing && r.json.preListing.timingDemand === null);
r = await get(2);
check('agent with nothing set: no timing at all', r.status === 200 && r.json.preListing.timing === undefined && !('timingDemand' in r.json.preListing), JSON.stringify(r.json.preListing.timing));
run('UPDATE pre_listings SET close_from = ?, close_to = ?, stay_after_days = 7 WHERE id = 10', D(100), D(130));
r = await get(2);
check('an approved agent gets timing without windowPassed', r.status === 200 && JSON.stringify(r.json.preListing.timing) === JSON.stringify({ closeFrom: D(100), closeTo: D(130), stayAfterDays: 7 }), JSON.stringify(r.json.preListing.timing));
check('an approved agent never gets timingDemand', !('timingDemand' in r.json.preListing) && !/timingDemand/.test(r.text));
check('the agent still gets buyerDemand', r.json.preListing.buyerDemand === 9);
r = await get(5);
check('an admin (not an agent) gets timing, never timingDemand', r.status === 200 && !!r.json.preListing.timing && !('timingDemand' in r.json.preListing) && !('windowPassed' in r.json.preListing.timing));
r = await get(4);
check('a non-agent gets 403 with no timing in the body', r.status === 403 && !/timing|close_from|closeFrom/i.test(r.text), r.text);
run("UPDATE pre_listings SET close_from = '2020-03-01', close_to = '2020-03-31', stay_after_days = 7 WHERE id = 10");
r = await get(2);
check('a passed window shows to the agent with null dates', JSON.stringify(r.json.preListing.timing) === '{"closeFrom":null,"closeTo":null,"stayAfterDays":7}', JSON.stringify(r.json.preListing.timing));
r = await get(1);
check('...and to the owner as windowPassed, with no timingDemand', r.json.preListing.timing.windowPassed === true && r.json.preListing.timingDemand === null);
r = await put(1, P10, { closeFrom: '2020-03-01', closeTo: '2020-03-31', stayAfterDays: 14 });
check('a passed window can be re-saved unchanged with a new stay', r.status === 200 && r.json.timing.windowPassed === true && r.json.timing.stayAfterDays === 14, JSON.stringify(r.json));
run('UPDATE pre_listings SET close_from = ?, close_to = ?, stay_after_days = 7 WHERE id = 10', D(100), D(130));

// ================= Browse: timingFitIds =================
search(4, 'Chula Vista', D(110), D(140), 7); // fits home 10
search(28, 'EastLake', D(110), D(140), 7); // the hidden neighborhood only: never a fit on the teaser
search(2, 'Chula Vista', D(110), D(140), 7); // the agent's own search
const browse = (who, qs = '') => call(index.onRequestGet, 'GET', `/api/pre-listings${qs}`, who);
r = await browse(4);
check('a buyer with a fitting "Chula Vista" timed search gets the id', r.status === 200 && Array.isArray(r.json.timingFitIds) && r.json.timingFitIds.includes(10), JSON.stringify(r.json && r.json.timingFitIds));
check('teaser rows still have exactly the 12 keys', r.json.preListings.length > 0 && r.json.preListings.every(p => Object.keys(p).length === 12), JSON.stringify(r.json.preListings[0]));
check('the browse never shows the dates or the neighborhood', !/close_?from|closeTo|stay_?after|EastLake/i.test(r.text));
check('the browse is private, no-store', r.cache === 'private, no-store');
r = await browse(28);
check('an "EastLake"-only timed search never fits on the teaser, and the text has no EastLake', r.status === 200 && !r.json.timingFitIds.includes(10) && !/EastLake/.test(r.text), JSON.stringify(r.json.timingFitIds));
r = await browse(1);
check("the viewer's own home is skipped", r.status === 200 && !r.json.timingFitIds.includes(10), JSON.stringify(r.json.timingFitIds));
r = await browse(41);
check('no timed search -> an empty list', r.status === 200 && JSON.stringify(r.json.timingFitIds) === '[]');
r = await browse(2);
check("an agent's full-card response also has timingFitIds", r.status === 200 && r.json.timingFitIds.includes(10) && r.json.preListings.some(p => p.id === 10 && !p.teaser), JSON.stringify(r.json.timingFitIds));
check("the full card doesn't add the dates either", !/close_?from|closeTo|stay_?after/i.test(r.text));
r = await browse(1, '?mine=1');
check('?mine=1 has no timingFitIds', r.status === 200 && !('timingFitIds' in r.json) && r.cache === 'private, no-store');
run('UPDATE pre_listings SET stay_after_days = 29 WHERE id = 10');
r = await browse(4);
check('an owner stay longer than the buyer offers -> no fit', !r.json.timingFitIds.includes(10));
run('UPDATE pre_listings SET stay_after_days = 7 WHERE id = 10');
const counted = [];
const countingDB = { prepare: (sql) => { counted.push(sql); return DB.prepare(sql); }, batch: DB.batch };
await bd.timingFitIdsFor(countingDB, 41, [{ id: 10, user_id: 1, city: 'Chula Vista', state: 'CA', property_type: 'Single Family Home', asking_price: 750000, close_from: D(100), close_to: D(130), stay_after_days: 7 }]);
check('timingFitIdsFor is one query', counted.length === 1);

// ================= Saved searches =================
const sPost = (who, body) => call(savedApi.onRequestPost, 'POST', '/api/saved-searches', who, {}, body);
r = await sPost(40, { locations: 'Bonita', moveFrom: D(30), moveTo: D(60), stayOfferDays: 14 });
let ss = r.json && one('SELECT * FROM saved_searches WHERE id = ?', r.json.id);
check('POST with timing stores it', r.status === 201 && ss.move_from === D(30) && ss.move_to === D(60) && ss.stay_offer_days === 14, JSON.stringify([r.json, ss]));
const SS = r.json.id;
r = await sPost(40, { locations: 'National City' });
ss = r.json && one('SELECT * FROM saved_searches WHERE id = ?', r.json.id);
check('POST without timing still works', r.status === 201 && ss.move_from === null && ss.stay_offer_days === 0);
r = await sPost(40, { locations: 'Otay Ranch', moveFrom: D(30) });
check('POST with half a window -> 400', r.status === 400 && r.json.error === 'Pick both dates for your move-in window, or clear both.');
r = await sPost(40, { locations: 'Otay Ranch', stayOfferDays: 30 });
check('POST with a 30-day stay offer -> 400', r.status === 400 && r.json.error === 'Pick no stay, or up to 7, 14 or 29 days.');
r = await sPost(40, { locations: 'Otay Ranch', priceMin: 900000, priceMax: 500000 });
check('the L1 price message still holds', r.status === 400 && r.json.error === 'Max price must be at or above the min price.');
r = await sPost(40, { locations: 'bonita', moveFrom: D(70), moveTo: D(80) });
check('the same criteria with different timing -> saved_search_duplicate', r.status === 400 && r.json.code === 'saved_search_duplicate', JSON.stringify(r.json));
for (let i = 1; i <= 8; i++) await sPost(40, { locations: `Town ${i}` });
r = await sPost(40, { locations: 'Town 11', moveFrom: D(30), moveTo: D(60) });
check('the 11th search -> saved_search_limit', r.status === 400 && r.json.code === 'saved_search_limit', JSON.stringify(r.json));
r = await call(savedApi.onRequestGet, 'GET', '/api/saved-searches', 40);
const gs = r.json && r.json.searches.find(s => s.id === SS);
check('GET has move_from, move_to, stay_offer_days', r.status === 200 && r.json.max === 10 && gs && gs.move_from === D(30) && gs.move_to === D(60) && gs.stay_offer_days === 14, JSON.stringify(gs));
check('GET saved searches is private, no-store', r.cache === 'private, no-store');
const sPut = (who, id, body) => call(savedOne.onRequestPut, 'PUT', '/x', who, { id: String(id) }, body);
run("DELETE FROM user_action_log WHERE user_id = 40");
r = await sPut(40, SS, { moveFrom: D(30), moveTo: D(60), stayOfferDays: 14 });
check('PUT unchanged -> 200 with no claim', r.status === 200 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 40").n === 0);
r = await sPut(40, SS, { moveFrom: D(40), moveTo: D(90), stayOfferDays: 29, locations: 'Somewhere else' });
ss = one('SELECT * FROM saved_searches WHERE id = ?', SS);
check('PUT owner -> 200, timing changed, criteria untouched', r.status === 200 && r.json.ok === true && r.json.moveFrom === D(40) && r.json.stayOfferDays === 29 && ss.move_to === D(90) && ss.locations === 'Bonita', JSON.stringify([r.json, ss]));
check('PUT counts against the saved_search limit', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 40 AND kind = 'saved_search'").n === 1);
check('PUT saved search is private, no-store', r.cache === 'private, no-store');
check("PUT someone else's search -> 403", (await sPut(42, SS, { moveFrom: '', moveTo: '' })).status === 403);
r = await sPut(40, 'abc', { moveFrom: '', moveTo: '' });
check('PUT a bad id -> 404', r.status === 404 && r.json.error === 'Saved search not found.');
check('PUT a missing id -> 404', (await sPut(40, 99999, { moveFrom: '', moveTo: '' })).status === 404);
check('PUT signed out -> 401', (await sPut(null, SS, {})).status === 401);
r = await sPut(40, SS, { moveFrom: D(40), moveTo: '' });
check('PUT half a window -> 400', r.status === 400 && r.json.error === 'Pick both dates for your move-in window, or clear both.');
r = await sPut(40, SS, { moveFrom: '', moveTo: '', stayOfferDays: 0 });
check('PUT can clear the window', r.status === 200 && one('SELECT move_from FROM saved_searches WHERE id = ?', SS).move_from === null);
for (let i = 0; i < 19; i++) run("INSERT INTO user_action_log (user_id, kind) VALUES (40, 'saved_search')");
r = await sPut(40, SS, { moveFrom: D(40), moveTo: D(90), stayOfferDays: 7 });
check('...and shares the saved_search limit (429 after 20 in a day)', r.status === 429 && r.json.code === 'rate_limited', JSON.stringify(r.json));

// ================= Jury test: no money, the 29-day cap, no reasons for moving =================
const MONEY = /rent|deposit|per_diem|holdback|credit/i;
for (const t of ['pre_listings', 'saved_searches']) {
  const cols = q(`PRAGMA table_info(${t})`).map(c => c.name);
  check(`${t} has no money column`, !cols.some(c => MONEY.test(c)), cols.filter(c => MONEY.test(c)).join());
}
check('a direct SQL stay_after_days = 30 or 31 throws (CHECK)', throws(() => run('UPDATE pre_listings SET stay_after_days = 30 WHERE id = 10')) && throws(() => run('UPDATE pre_listings SET stay_after_days = 31 WHERE id = 10')));
check('a direct SQL stay_after_days = 29 is fine', !throws(() => run('UPDATE pre_listings SET stay_after_days = 29 WHERE id = 10')));
check('a direct SQL stay_offer_days = 30 throws (CHECK)', throws(() => run('UPDATE saved_searches SET stay_offer_days = 30 WHERE id = ?', SS)));
const client = read('timing-match.js');
const lib = read('functions/_lib/timingMatch.js');
const REASONS = /\b(school|jobs?|baby|divorce|family|kids|retire\w*|lease)\b/i;
check('timing-match.js says "Your agents write the rent-back terms"', client.includes('Your agents write the rent-back terms'));
check('timing-match.js has no reasons for moving', !REASONS.test(client), (client.match(REASONS) || [])[0]);
check('timingMatch.js has no reasons for moving', !REASONS.test(lib), (lib.match(REASONS) || [])[0]);
check('timing-match.js offers "Up to 29 days", never 30', client.includes("29: 'Up to 29 days'") && !/\b30\b/.test(client));
check('timing-match.js has no money fields or amounts', !/per ?diem|deposit|holdback|amount|\$\d/i.test(client));
const sbf = read('sell-or-buy-first.html');
check('sell-or-buy-first: the rent-back sentence with 29 days', sbf.includes(' On Amico Haus, you can pick your ideal closing window and a stay of up to 29 days when you post a pre-listing. Your agents write the rent-back terms.</li>'));

// ================= Client renderers (vm) =================
const noop = () => {};
const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, insertBefore: noop, setAttribute: noop, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, parentNode: { insertBefore: noop } });
const sandbox = {
  console, URLSearchParams, setTimeout, clearTimeout, atob, btoa, Notification: {}, navigator: { userAgent: 'node' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), readyState: 'complete', documentElement: el(), referrer: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
let loaded = true;
try { for (const f of ['client.js', 'timing-match.js']) vm.runInContext(read(f), sandbox, { filename: f }); } catch (e) { loaded = false; realLog(e); }
check('client.js + timing-match.js load together', loaded);
const c = (expr) => vm.runInContext(expr, sandbox);
const badge = c('timingFitsBadgeHtml()');
check('timingFitsBadgeHtml: "Timing fits", not badge-active', badge.includes('Timing fits') && badge.includes('timing-fits') && !badge.includes('badge-active'));
check('timingDemandHtml({ timingDemand: null }) is empty', c('timingDemandHtml({ timingDemand: null })') === '');
check('timingDemandHtml with 4', c('timingDemandHtml({ timingDemand: 4 })') === '<p class="demand-meter">🗓️ <strong>4 interested buyers</strong> have a move-in window that fits yours.</p>');
const pOpen = `({ id: 10, status: 'open', timing: { closeFrom: '2027-03-01', closeTo: '2027-05-31', stayAfterDays: 7, windowPassed: false }, timingDemand: null })`;
const panel = c(`renderTimingPanel(${pOpen})`);
check('renderTimingPanel: the summary with the window', panel.includes('<summary>Timing: your ideal closing window (Mar 1 – May 31, 2027)</summary>'));
check('renderTimingPanel: the copy says 29 days and the agents write the terms', panel.includes('Your agents write the rent-back terms. Stays are capped at 29 days.'));
check('renderTimingPanel: options 0/7/14/29 with 7 selected', panel.includes('<option value="0">No stay</option><option value="7" selected>Up to 7 days</option><option value="14">Up to 14 days</option><option value="29">Up to 29 days</option>'));
check('renderTimingPanel: save + clear buttons and the meter', panel.includes('data-tm-action="save-timing"') && panel.includes('data-tm-action="clear-timing"') && panel.includes("The count shows once 3 or more interested buyers' move-in windows fit yours."));
check('renderTimingPanel: every label has for=', (panel.match(/<label(?![^>]*\bfor=)/g) || []).length === 0 && (panel.match(/<label/g) || []).length === 3);
const closedPanel = c(`renderTimingPanel({ id: 13, status: 'closed', timing: { closeFrom: null, closeTo: null, stayAfterDays: 0, windowPassed: false } })`);
check('renderTimingPanel for a closed home: no data-tm-action, inputs disabled', !closedPanel.includes('data-tm-action') && (closedPanel.match(/ disabled/g) || []).length === 3 && closedPanel.includes('This pre-listing is closed.'));
check('renderTimingPanel: a passed window asks for a new one', c(`renderTimingPanel({ id: 1, status: 'open', timing: { closeFrom: '2020-01-01', closeTo: '2020-02-01', stayAfterDays: 0, windowPassed: true } })`).includes('That window has passed. Pick a new one?'));
check('renderTimingPanel: none without p.timing', c(`renderTimingPanel({ id: 1, status: 'open' })`) === '');
check('timingFactsHtml (owner)', c(`timingFactsHtml(${pOpen}, true)`) === '<p class="tiny timing-line"><span class="label">Your ideal closing</span> Mar 1 – May 31, 2027 · Stay up to 7 days after closing</p>');
check('timingFactsHtml (agent)', c(`timingFactsHtml(${pOpen}, false)`) === `<p class="tiny timing-line"><span class="label">Ideal closing (owner's preference)</span> Mar 1 – May 31, 2027 · Would like to stay up to 7 days after closing. The agents write any rent-back terms.</p>`);
check('timingFactsHtml (agent, stay only)', c(`timingFactsHtml({ timing: { closeFrom: null, closeTo: null, stayAfterDays: 14 } }, false)`).includes('Not picked yet · Would like to stay up to 14 days'));
check('timingFactsHtml: nothing set -> empty', c(`timingFactsHtml({ timing: { closeFrom: null, closeTo: null, stayAfterDays: 0, windowPassed: false } }, true)`) === '' && c('timingFactsHtml({}, false)') === '');
const row1 = c(`savedSearchTimingHtml({ id: 7, move_from: '2026-12-01', move_to: '2027-02-15', stay_offer_days: 29 })`);
check('savedSearchTimingHtml: the label', row1.includes('<span class="saved-timing"> · Move-in Dec 1, 2026 – Feb 15, 2027 · seller can stay up to 29 days</span>'), row1);
check('savedSearchTimingHtml: Edit timing + every label has for=', row1.includes('>Edit timing</button>') && (row1.match(/<label(?![^>]*\bfor=)/g) || []).length === 0 && (row1.match(/<label for="saved\w+-7"/g) || []).length === 3);
const row2 = c(`savedSearchTimingHtml({ id: 8, move_from: null, move_to: null, stay_offer_days: 0 })`);
check('savedSearchTimingHtml without a window: "Add move-in window", empty label', row2.includes('>Add move-in window</button>') && row2.includes('<span class="saved-timing"></span>'));
check('the client date label never shifts a day (UTC+14)', c(`timingWindowLabel('2027-03-01', '2027-03-01')`) === 'Mar 1 – Mar 1, 2027');
check('timingFromPostForm with no form on the page', c('JSON.stringify(timingFromPostForm())') === '{"closeFrom":"","closeTo":"","stayAfterDays":0}');
check("savedSearchLabel is unchanged (client.js)", c(`savedSearchLabel({ locations: 'Chula Vista', property_type: 'Any', price_min: 0, price_max: 0 })`) === 'Any type in Chula Vista');
// Only the 9 renderers plus TIMING_/timing-prefixed names live at the top level.
const SPEC_NAMES = ['timingFromPostForm', 'resetPostFormTiming', 'timingFactsHtml', 'timingDemandHtml', 'renderTimingPanel', 'timingFitsBadgeHtml', 'savedSearchTimingFromForm', 'resetSavedSearchTimingForm', 'savedSearchTimingHtml'];
const topNames = [...client.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1] || m[2]);
check('timing-match.js: all 9 renderers exist', SPEC_NAMES.every(n => topNames.includes(n)));
check('timing-match.js: every other top-level name has the timing prefix', topNames.every(n => SPEC_NAMES.includes(n) || /^(TIMING_|timing)/.test(n)), topNames.filter(n => !SPEC_NAMES.includes(n) && !/^(TIMING_|timing)/.test(n)).join());
check('timing-match.js: no inline style or handler', !/\sstyle\s*=\s*["'`]/.test(client) && !/\son[a-z]+\s*=\s*["'`]/i.test(client));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
