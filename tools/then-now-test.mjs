// Then & Now (owner tools batch, migration_v45): the owner's upgrade list (CRUD, caps, validation, no cost, fair-housing
// and address checks, closed homes), who sees what on the GET (permit answers only for the owner, the hired agent and
// agents with a contact share, never admins; the label per viewer; access as visibility.js decides), photo pairs
// (rights box, cap, metadata scrubbed, rate limit, delete), the photo files' access and cache, cascades and storage
// cleanup (pre-listing delete, account delete), the export rows, and then-now.js rendered in a stubbed browser.
// Runs the real handlers against an in-memory SQLite stand-in for D1 and a Map stand-in for R2. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/then-now-test.mjs <projectRoot>
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

let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
console.log = () => {};

// 1 owner; 2 approved agent; 3 admin (no agent profile); 4 hired agent; 5 agent with a contact share; 6 plain
// homeowner; 7 agent the owner blocked; 8 approved agent who never took part; 9 another owner.
const users = [[1, 'user', 0], [2, 'user', 1], [3, 'admin', 0], [4, 'user', 1], [5, 'user', 1], [6, 'user', 0], [7, 'user', 1], [8, 'user', 1], [9, 'user', 0]];
for (const [id, role, agent] of users) {
  run('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)', id, `u${id}@example.test`, `User ${id}`, role);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
  if (agent) run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', '01234567', 'Test Realty')", id);
}
const home = (id, owner, status) => run(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address, status)
  VALUES (?, ?, 'Chula Vista', 'CA', '91913', 'Single Family Home', 4, 3, 900000, '123 Secret St', ?)`, id, owner, status);
home(10, 1, 'open'); home(12, 1, 'awarded'); home(13, 1, 'closed'); home(20, 9, 'open');
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, commission_pct, status) VALUES (500, 'pre_listing', 12, 4, 2.5, 'accepted')");
run('UPDATE pre_listings SET awarded_bid_id = 500 WHERE id = 12');
run('INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (10, 1, 5)');
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 7)');

const call = async (handler, method, who, params, body) => {
  const headers = who ? { Cookie: `ah_session=t${who}` } : {};
  const init = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await handler({ request: new Request('https://amicohaus.com/x', init), env, params, waitUntil() {} });
  const type = res.headers.get('Content-Type') || '';
  const isJson = type.includes('json');
  const text = isJson ? await res.text() : '';
  return { status: res.status, type, cache: res.headers.get('Cache-Control'), text, json: text ? JSON.parse(text) : null, bytes: isJson ? null : new Uint8Array(await res.arrayBuffer()) };
};

const tn = await mod('functions/_lib/thenNow.js');
const ht = await mod('functions/_lib/homeText.js');
const upgradesApi = await mod('functions/api/pre-listings/[id]/upgrades/index.js');
const upgradeApi = await mod('functions/api/pre-listings/[id]/upgrades/[upgradeId].js');
const thenNowApi = await mod('functions/api/pre-listings/[id]/then-now/index.js');
const pairApi = await mod('functions/api/pre-listings/[id]/then-now/[pairId].js');
const thenPhoto = await mod('functions/api/then-now-photos/[id]/then.js');
const nowPhoto = await mod('functions/api/then-now-photos/[id]/now.js');
const P = (id, extra = {}) => ({ id: String(id), ...extra });
const good = { category: 'kitchen', doneYear: 2021, doneMonth: 3, note: 'Quartz counters and new cabinets', permit: 'yes' };

// ---- Upgrades: who can write ----
let r = await call(upgradesApi.onRequestPost, 'POST', null, P(10), good);
check('add upgrade: signed out 401', r.status === 401);
r = await call(upgradesApi.onRequestPost, 'POST', 2, P(10), good);
check('add upgrade: an agent is 403', r.status === 403);
r = await call(upgradesApi.onRequestPost, 'POST', 3, P(10), good);
check('add upgrade: an admin is 403 (owner only)', r.status === 403);
r = await call(upgradesApi.onRequestPost, 'POST', 1, P(99), good);
check('add upgrade: a missing home is 404', r.status === 404);
r = await call(upgradesApi.onRequestPost, 'POST', 1, P(10), { ...good, cost: 50000, value: 90000 });
const kitchenId = r.json && r.json.id;
check('the owner adds an upgrade: 201 { id }, private, no-store', r.status === 201 && Number.isInteger(kitchenId) && r.cache === 'private, no-store', r.text);
const cols = sqlite.prepare('PRAGMA table_info(pre_listing_upgrades)').all().map(c => c.name);
check('...a cost (or any other key) is ignored: there is no column for it', !cols.some(c => /cost|value|price|worth/i.test(c)) && one('SELECT note, permit, done_month FROM pre_listing_upgrades WHERE id = ?', kitchenId).permit === 'yes');
const errOf = async (body, home = 10) => (await call(upgradesApi.onRequestPost, 'POST', 1, P(home), body)).json?.error;
check('validation: category', await errOf({ ...good, category: 'pool_house' }) === 'Pick a category.');
check('validation: year (missing, before 1900, next year)', await errOf({ ...good, doneYear: '' }) === 'Add the year the work was done.'
  && await errOf({ ...good, doneYear: 1899 }) === 'Add the year the work was done.' && await errOf({ ...good, doneYear: new Date().getFullYear() + 2 }) === 'Add the year the work was done.'
  && await errOf({ ...good, doneYear: 2020.5 }) === 'Add the year the work was done.');
check('validation: month 1-12 or blank', await errOf({ ...good, doneMonth: 13 }) === 'Pick a month, or leave it blank.' && (await call(upgradesApi.onRequestPost, 'POST', 1, P(10), { ...good, doneMonth: '' })).status === 201);
check('validation: note up to 120 characters', await errOf({ ...good, note: 'x'.repeat(121) }) === 'Keep the note to 120 characters or fewer.');
check('validation: permit Yes / No / Not sure or unanswered', /permit question/.test(await errOf({ ...good, permit: 'maybe' }) || '') && (await call(upgradesApi.onRequestPost, 'POST', 1, P(10), { ...good, permit: null })).status === 201);
check('fair housing: "Great for kids" is refused with STEERING_ERROR', await errOf({ ...good, note: 'Great for kids' }) === ht.STEERING_ERROR);
check('...as are "Safe neighborhood" and "The area feels safe"', await errOf({ ...good, note: 'Safe neighborhood' }) === ht.STEERING_ERROR && await errOf({ ...good, note: 'The area feels safe' }) === ht.STEERING_ERROR);
r = await call(upgradesApi.onRequestPost, 'POST', 1, P(10), { ...good, category: 'water_heater', note: 'Seismic safety straps on the water heater' });
const r2 = await call(upgradesApi.onRequestPost, 'POST', 1, P(10), { ...good, note: 'Integrated fridge panels' });
check('...while "Seismic safety straps on the water heater" and "Integrated fridge panels" pass', r.status === 201 && r2.status === 201);
check('a street address in the note is refused', await errOf({ ...good, note: 'New roof at 1218 La Vida Ct' }) === ht.ADDRESS_ERROR);
check('a closed home is read-only: 409 code closed', (await call(upgradesApi.onRequestPost, 'POST', 1, P(13), good)).json?.code === 'closed'
  && (await call(upgradesApi.onRequestPost, 'POST', 1, P(13), good)).status === 409);
r = await call(upgradesApi.onRequestPost, 'POST', 1, P(12), { category: 'roof', doneYear: 2019, permit: 'not_sure' });
const awardedUpgrade = r.json && r.json.id;
check('an awarded home still takes upgrades', r.status === 201);

// The cap: 20 per home.
const have = one('SELECT COUNT(*) AS n FROM pre_listing_upgrades WHERE pre_listing_id = 10').n;
for (let i = have; i < 20; i++) await call(upgradesApi.onRequestPost, 'POST', 1, P(10), { category: 'paint', doneYear: 2020 });
r = await call(upgradesApi.onRequestPost, 'POST', 1, P(10), { category: 'paint', doneYear: 2020 });
check('the 21st upgrade is refused', r.status === 400 && r.json.error === 'A home can have up to 20 upgrades.' && one('SELECT COUNT(*) AS n FROM pre_listing_upgrades WHERE pre_listing_id = 10').n === 20);
check('...positions run 0..19 in the order added', one('SELECT MIN(position) AS lo, MAX(position) AS hi FROM pre_listing_upgrades WHERE pre_listing_id = 10').hi === 19);

// Edit and remove.
r = await call(upgradeApi.onRequestPut, 'PUT', 1, P(10, { upgradeId: String(kitchenId) }), { ...good, note: 'New cabinets', permit: 'no', cost: 1 });
check('the owner edits an upgrade', r.status === 200 && r.json.ok === true && one('SELECT note, permit FROM pre_listing_upgrades WHERE id = ?', kitchenId).permit === 'no');
r = await call(upgradeApi.onRequestPut, 'PUT', 1, P(20, { upgradeId: String(kitchenId) }), good);
check("...not through another owner's home (403)", r.status === 403);
r = await call(upgradeApi.onRequestPut, 'PUT', 1, P(12, { upgradeId: String(kitchenId) }), good);
check('...and an upgrade that is not on this home is 404', r.status === 404);
r = await call(upgradeApi.onRequestPut, 'PUT', 2, P(10, { upgradeId: String(kitchenId) }), good);
check('...an agent cannot edit (403)', r.status === 403);
r = await call(upgradeApi.onRequestPut, 'PUT', 1, P(10, { upgradeId: String(kitchenId) }), { ...good, note: 'Near the school' });
check('...edits run the same checks', r.status === 400 && r.json.error === ht.STEERING_ERROR);
run("INSERT INTO pre_listing_upgrades (id, pre_listing_id, category, done_year, permit) VALUES (300, 13, 'roof', 2015, 'yes')");
r = await call(upgradeApi.onRequestPut, 'PUT', 1, P(13, { upgradeId: '300' }), good);
check('...a closed home cannot be edited (409)', r.status === 409 && r.json.code === 'closed');
r = await call(upgradeApi.onRequestDelete, 'DELETE', 1, P(13, { upgradeId: '300' }));
check('...but the owner can still remove something from a closed home', r.status === 200 && !one('SELECT id FROM pre_listing_upgrades WHERE id = 300'));
r = await call(upgradeApi.onRequestDelete, 'DELETE', 3, P(10, { upgradeId: String(kitchenId) }));
check('an admin cannot remove an upgrade (403)', r.status === 403);
r = await call(upgradeApi.onRequestDelete, 'DELETE', 1, P(12, { upgradeId: String(kitchenId) }));
check('removing an upgrade that is not on this home is 404', r.status === 404);

// ---- Photo pairs ----
// A JPEG with a GPS block (the image-metadata fixture, built byte by byte).
const bytes = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const str = (s) => new Uint8Array([...s].map(c => c.charCodeAt(0)));
const has = (hay, needle) => { outer: for (let i = 0; i <= hay.length - needle.length; i++) { for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer; return true; } return false; };
const seg = (marker, payload) => bytes(new Uint8Array([0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]), payload);
const GPS_MARK = new Uint8Array([0x13, 0x37, 0xbe, 0xef, 0x0a, 0x0b, 0x0c, 0x0d]);
function exifWithGps() {
  const tiff = new Uint8Array(8 + 2 + 24 + 4 + 2 + 12 + 4 + 8);
  const dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]); dv.setUint32(4, 8, true);
  dv.setUint16(8, 2, true);
  dv.setUint16(10, 0x0112, true); dv.setUint16(12, 3, true); dv.setUint32(14, 1, true); dv.setUint16(18, 6, true);
  const gpsIfd = 8 + 2 + 24 + 4;
  dv.setUint16(22, 0x8825, true); dv.setUint16(24, 4, true); dv.setUint32(26, 1, true); dv.setUint32(30, gpsIfd, true);
  dv.setUint32(34, 0, true);
  dv.setUint16(gpsIfd, 1, true);
  const ratAt = gpsIfd + 2 + 12 + 4;
  dv.setUint16(gpsIfd + 2, 0x0002, true); dv.setUint16(gpsIfd + 4, 5, true); dv.setUint32(gpsIfd + 6, 1, true); dv.setUint32(gpsIfd + 10, ratAt, true);
  tiff.set(GPS_MARK, ratAt);
  return bytes(str('Exif\0\0'), tiff);
}
const scan = new Uint8Array([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9]);
const gpsJpeg = () => bytes(new Uint8Array([0xff, 0xd8]), seg(0xe1, exifWithGps()), seg(0xfe, str('shot at 123 Secret St')), seg(0xdb, new Uint8Array(65)), scan);
const jpeg = (name) => new File([gpsJpeg()], name, { type: 'image/jpeg' });
const pairForm = (fields = {}, files = { then: jpeg('then.jpg'), now: jpeg('now.jpg') }) => {
  const fd = new FormData();
  for (const [k, f] of Object.entries(files)) if (f) fd.append(k, f);
  for (const [k, v] of Object.entries({ rights: '1', ...fields })) if (v !== undefined) fd.append(k, v);
  return fd;
};
const pairErr = async (fields, files) => (await call(thenNowApi.onRequestPost, 'POST', 1, P(10), pairForm(fields, files))).json?.error;
check('pair: the rights box is required', await pairErr({ rights: undefined }) === 'Please confirm you took these photos or have permission to use them.');
check('pair: both photos are required', await pairErr({}, { then: jpeg('t.jpg') }) === 'Add a then photo and a now photo.');
check('pair: same type and size rules as photos', await pairErr({}, { then: new File([new Uint8Array(3)], 'x.txt', { type: 'text/plain' }), now: jpeg('n.jpg') }) === 'Photos must be JPEG, PNG, WEBP, or GIF.'
  && await pairErr({}, { then: jpeg('t.jpg'), now: new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }) }) === 'Photo must be under 5MB.');
check('pair: caption checks (steering, address, 80 characters)', await pairErr({ caption: 'Family-friendly street' }) === ht.STEERING_ERROR
  && await pairErr({ caption: '1218 La Vida Ct kitchen' }) === ht.ADDRESS_ERROR && await pairErr({ caption: 'x'.repeat(81) }) === 'Keep the caption to 80 characters or fewer.');
check('pair: the old photo year is 1900..this year or blank', await pairErr({ thenYear: '1850' }) === 'Add the year of the old photo, or leave it blank.');
const otherUpgrade = one('SELECT id FROM pre_listing_upgrades WHERE pre_listing_id = 12').id;
check("pair: an upgrade from another home can't be linked", await pairErr({ upgradeId: String(otherUpgrade) }) === "That upgrade isn't on this home.");
check('...and none of those refused tries stored a file or used up the limit', objects.size === 0 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'photo_sweep'").n === 0);
r = await call(thenNowApi.onRequestPost, 'POST', 2, P(10), pairForm());
check('pair: an agent is 403', r.status === 403);
r = await call(thenNowApi.onRequestPost, 'POST', 3, P(10), pairForm());
check('pair: an admin is 403', r.status === 403);
r = await call(thenNowApi.onRequestPost, 'POST', 1, P(13), pairForm());
check('pair: a closed home is 409', r.status === 409 && r.json.code === 'closed');

r = await call(thenNowApi.onRequestPost, 'POST', 1, P(10), pairForm({ caption: 'The kitchen', thenYear: '2009', upgradeId: String(kitchenId), swept: '1' }));
const pairId = r.json && r.json.id;
const pairRow = pairId && one('SELECT * FROM pre_listing_then_now WHERE id = ?', pairId);
check('the owner adds a pair: 201 { id }, private, no-store', r.status === 201 && Object.keys(r.json).join() === 'id' && r.cache === 'private, no-store', r.text);
check('...keys pre-listing-then-now/10/<uuid>, stored with swept_at, caption, year and the link', pairRow && /^pre-listing-then-now\/10\/[0-9a-f-]{36}$/.test(pairRow.then_r2_key) && /^pre-listing-then-now\/10\//.test(pairRow.now_r2_key)
  && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(pairRow.swept_at || '') && pairRow.caption === 'The kitchen' && pairRow.then_year === 2009 && pairRow.upgrade_id === kitchenId && pairRow.position === 0);
check('...both files lost their GPS block and comment (scrubbed), the image data is kept', [pairRow.then_r2_key, pairRow.now_r2_key].every(k => objects.has(k) && !has(objects.get(k), GPS_MARK) && !has(objects.get(k), str('Secret St')) && has(objects.get(k), scan)));
check('...one photo_sweep claim for the pair', one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'photo_sweep' AND ref = 'pre_listing:10'").n === 1);
r = await call(thenNowApi.onRequestPost, 'POST', 1, P(10), pairForm({ swept: '0' }));
check('...without swept=1, swept_at is NULL', r.status === 201 && one('SELECT swept_at FROM pre_listing_then_now WHERE id = ?', r.json.id).swept_at === null);
await call(thenNowApi.onRequestPost, 'POST', 1, P(10), pairForm());
await call(thenNowApi.onRequestPost, 'POST', 1, P(10), pairForm());
const keysBefore = objects.size;
r = await call(thenNowApi.onRequestPost, 'POST', 1, P(10), pairForm());
check('a fifth pair is refused, and nothing new is stored', r.status === 400 && r.json.error === 'A home can have up to 4 photo pairs.' && objects.size === keysBefore && one('SELECT COUNT(*) AS n FROM pre_listing_then_now WHERE pre_listing_id = 10').n === 4);
run('DELETE FROM user_action_log');
for (let i = 0; i < 40; i++) run("INSERT INTO user_action_log (user_id, kind, ref) VALUES (1, 'photo_sweep', 'pre_listing:12')");
r = await call(thenNowApi.onRequestPost, 'POST', 1, P(12), pairForm());
check('after 40 sweeps in an hour the next pair is 429 (photo_sweep), with nothing stored', r.status === 429 && r.json.code === 'rate_limited' && objects.size === keysBefore);
run('DELETE FROM user_action_log');
r = await call(thenNowApi.onRequestPost, 'POST', 1, P(12), pairForm({ caption: 'Roof' }));
const awardedPair = r.json && r.json.id;
check('an awarded home takes pairs too', r.status === 201);

// ---- GET: who sees what ----
const get = (who, id = 10) => call(thenNowApi.onRequestGet, 'GET', who, P(id));
r = await get(1);
check('owner GET: upgrades with permit, pairs with sweptDone, the owner label, canEdit', r.status === 200 && r.cache === 'private, no-store' && r.json.permitsShown === true
  && r.json.upgrades.every(u => 'permit' in u) && r.json.pairs.every(p => 'sweptDone' in p) && r.json.pairs[0].sweptDone === true && r.json.pairs[1].sweptDone === false
  && r.json.label === tn.OWNER_REPORTED_LABEL && r.json.canEdit === true);
check('...upgrade rows have exactly { id, category, label, doneYear, doneMonth, note, permit }', Object.keys(r.json.upgrades[0]).sort().join() === 'category,doneMonth,doneYear,id,label,note,permit' && r.json.upgrades[0].label === 'Kitchen');
check('...pair rows have exactly { id, upgradeId, caption, thenYear, sweptDone } and no storage key', Object.keys(r.json.pairs[0]).sort().join() === 'caption,id,sweptDone,thenYear,upgradeId' && !/r2_key|pre-listing-then-now/.test(r.text));
check('...no cost anywhere', !/cost/i.test(r.text));
r = await get(2);
check('approved agent: no permit key, no sweptDone, the agent label', r.status === 200 && r.json.permitsShown === false && r.json.upgrades.length === 20 && r.json.upgrades.every(u => !('permit' in u))
  && r.json.pairs.every(p => !('sweptDone' in p)) && r.json.label === tn.OWNER_REPORTED_LABEL_AGENT && !('canEdit' in r.json) && !/swept/i.test(r.text));
r = await get(5);
check('agent with a contact share: with permit', r.status === 200 && r.json.permitsShown === true && r.json.upgrades.some(u => u.permit === 'no') && r.json.label === tn.OWNER_REPORTED_LABEL_AGENT);
r = await get(4, 12);
check('the hired agent: with permit', r.status === 200 && r.json.permitsShown === true && r.json.upgrades[0].permit === 'not_sure');
r = await get(4, 10);
check('...but the agent hired on one home gets no permits on another home', r.status === 200 && r.json.permitsShown === false && r.json.upgrades.every(u => !('permit' in u)));
r = await get(3);
check('an admin who is not an approved agent: NO permit key', r.status === 200 && r.json.permitsShown === false && r.json.upgrades.every(u => !('permit' in u)) && r.json.label === tn.OWNER_REPORTED_LABEL_AGENT);
r = await get(3, 12);
check('...on an awarded home too', r.status === 200 && r.json.upgrades.every(u => !('permit' in u)));
r = await get(7);
check('a blocked agent gets 404', r.status === 404);
r = await get(6);
check('a signed-in non-agent gets agents_only', r.status === 403 && r.json.code === 'agents_only');
r = await get(null);
check('signed out is 401', r.status === 401);
r = await get(8, 12);
check('after award, an agent who never took part gets 404', r.status === 404);
r = await get(1, 13);
check('a closed home: canEdit false for the owner', r.status === 200 && r.json.canEdit === false);
r = await get(1, 99);
check('a missing home is 404', r.status === 404);

// ---- The photo files ----
const photo = (h, who, id = pairId) => call(h.onRequestGet, 'GET', who, { id: String(id) });
r = await photo(thenPhoto, 2);
check('photo: an approved agent gets the then file, private, max-age=3600', r.status === 200 && r.type === 'image/jpeg' && r.cache === 'private, max-age=3600' && r.bytes.length > 0);
r = await photo(nowPhoto, 1);
check('photo: the owner gets the now file', r.status === 200 && r.cache === 'private, max-age=3600');
check('photo: then and now are different files', has(objects.get(pairRow.then_r2_key), scan) && pairRow.then_r2_key !== pairRow.now_r2_key);
r = await photo(thenPhoto, 6);
check('photo: agents_only viewers get 404 (never a hint)', r.status === 404);
r = await photo(nowPhoto, 7);
check('photo: a blocked agent gets 404', r.status === 404);
r = await photo(thenPhoto, null);
check('photo: signed out is 401', r.status === 401);
r = await photo(thenPhoto, 8, awardedPair);
check('photo: after award, an agent who never took part gets 404', r.status === 404);
r = await photo(thenPhoto, 4, awardedPair);
check('photo: the hired agent gets it', r.status === 200);
r = await photo(thenPhoto, 2, 9999);
check('photo: a missing pair is 404', r.status === 404);

// ---- Cascades ----
r = await call(upgradeApi.onRequestDelete, 'DELETE', 1, P(10, { upgradeId: String(kitchenId) }));
check('removing an upgrade leaves its pair, unlinked (upgrade_id NULL)', r.status === 200 && one('SELECT upgrade_id FROM pre_listing_then_now WHERE id = ?', pairId).upgrade_id === null);

// ---- Pair delete ----
r = await call(pairApi.onRequestDelete, 'DELETE', 2, P(10, { pairId: String(pairId) }));
check('pair delete: an agent is 403', r.status === 403);
r = await call(pairApi.onRequestDelete, 'DELETE', 1, P(12, { pairId: String(pairId) }));
check('pair delete: a pair that is not on this home is 404', r.status === 404);
r = await call(pairApi.onRequestDelete, 'DELETE', 1, P(10, { pairId: String(pairId) }));
check('pair delete: the owner removes it and both files go', r.status === 200 && r.cache === 'private, no-store' && !one('SELECT id FROM pre_listing_then_now WHERE id = ?', pairId)
  && !objects.has(pairRow.then_r2_key) && !objects.has(pairRow.now_r2_key));
const apRow = one('SELECT then_r2_key, now_r2_key FROM pre_listing_then_now WHERE id = ?', awardedPair);
r = await call(pairApi.onRequestDelete, 'DELETE', 3, P(12, { pairId: String(awardedPair) }));
check('pair delete: an admin can take one down, on the admin activity log', r.status === 200 && !objects.has(apRow.then_r2_key) && !objects.has(apRow.now_r2_key)
  && one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'delete_then_now' AND target_type = 'pre_listing' AND target_id = 12").n === 1);

// ---- Storage cleanup: pre-listing delete and account delete ----
const detail = await mod('functions/api/pre-listings/[id].js');
run("INSERT INTO pre_listing_then_now (pre_listing_id, then_r2_key, then_content_type, now_r2_key, now_content_type) VALUES (13, 'pre-listing-then-now/13/t', 'image/jpeg', 'pre-listing-then-now/13/n', 'image/jpeg')");
objects.set('pre-listing-then-now/13/t', new Uint8Array(1)); objects.set('pre-listing-then-now/13/n', new Uint8Array(1));
r = await call(detail.onRequestDelete, 'DELETE', 1, P(13));
check('deleting a pre-listing removes both files of its pairs', r.status === 200 && !objects.has('pre-listing-then-now/13/t') && !objects.has('pre-listing-then-now/13/n'), r.text);
const { hashPassword } = await mod('functions/_lib/auth.js');
const accountDelete = await mod('functions/api/account/delete.js');
run('INSERT INTO users (id, email, display_name, password_hash) VALUES (30, ?, ?, ?)', 'u30@example.test', 'User 30', await hashPassword('pw-30'));
run("INSERT INTO sessions (token, user_id, expires_at) VALUES ('t30', 30, datetime('now', '+1 day'))");
home(31, 30, 'open');
run("INSERT INTO pre_listing_upgrades (pre_listing_id, category, done_year) VALUES (31, 'roof', 2020)");
run("INSERT INTO pre_listing_then_now (pre_listing_id, then_r2_key, then_content_type, now_r2_key, now_content_type) VALUES (31, 'pre-listing-then-now/31/t', 'image/jpeg', 'pre-listing-then-now/31/n', 'image/jpeg')");
objects.set('pre-listing-then-now/31/t', new Uint8Array(1)); objects.set('pre-listing-then-now/31/n', new Uint8Array(1));
r = await call(accountDelete.onRequestPost, 'POST', 30, {}, { password: 'pw-30' });
check('deleting the account removes both files and every row', r.status === 200 && !objects.has('pre-listing-then-now/31/t') && !objects.has('pre-listing-then-now/31/n')
  && one('SELECT COUNT(*) AS n FROM pre_listing_then_now WHERE pre_listing_id = 31').n === 0 && one('SELECT COUNT(*) AS n FROM pre_listing_upgrades WHERE pre_listing_id = 31').n === 0, r.text);

// ---- Export ----
const exportApi = await mod('functions/api/account/export.js');
r = await call(exportApi.onRequestGet, 'GET', 1, {});
const ownerTools = (r.json && r.json.ownerTools) || [];
check('export: the owner gets upgrade and then_now_pair rows', r.status === 200 && ownerTools.some(t => t.kind === 'upgrade') && ownerTools.some(t => t.kind === 'then_now_pair'), r.text.slice(0, 300));
check('...with the permit answer and caption, and no storage key anywhere', ownerTools.some(t => t.kind === 'upgrade' && /permit/.test(JSON.stringify(t))) && !/r2_key|pre-listing-then-now\//.test(r.text));
r = await call(exportApi.onRequestGet, 'GET', 2, {});
check("...an agent's export has none of the owner's Then & Now rows", !((r.json && r.json.ownerTools) || []).some(t => t.kind === 'upgrade' || t.kind === 'then_now_pair'));

// ---- Library pieces ----
check('validateUpgrade ignores cost and returns only the five fields', JSON.stringify(Object.keys(tn.validateUpgrade({ ...good, cost: 5 }).data).sort()) === JSON.stringify(['category', 'doneMonth', 'doneYear', 'note', 'permit']));
check('validateUpgrade: this year (Pacific) passes, next year does not', !!tn.validateUpgrade({ category: 'roof', doneYear: Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 4)) }).data
  && !!tn.validateUpgrade({ category: 'roof', doneYear: 2027 }, { nowMs: Date.UTC(2026, 11, 31, 12) }).error);
check('the categories are the fixed 18', Object.keys(tn.UPGRADE_CATEGORIES).length === 18 && tn.MAX_UPGRADES === 20 && tn.MAX_PAIRS === 4);
let counted = 0;
const countingDb = { prepare: (sql) => { counted++; return DB.prepare(sql); }, batch: DB.batch };
await tn.fetchThenNow(countingDb, 10, { isOwner: true, showPermits: true });
check('fetchThenNow is 2 statements', counted === 2, String(counted));
counted = 0;
await tn.canSeePermits(countingDb, { id: 10, awarded_bid_id: null }, { id: 2 }, { isOwner: false, isAdmin: false, isApprovedAgent: true });
check('canSeePermits is at most 1 statement (owner: none)', counted === 1 && (counted = 0, await tn.canSeePermits(countingDb, { id: 10 }, { id: 1 }, { isOwner: true }), counted === 0));

// ---- then-now.js in a stubbed browser ----
const noop = () => {};
const mounts = {};
const mk = () => ({ innerHTML: '', classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, setAttribute: noop, style: {}, dataset: {}, appendChild: noop, querySelector: () => null });
let nextGet = null;
const sandbox = {
  console: { log: noop, error: noop }, setTimeout, clearTimeout, URLSearchParams, Blob, File, FormData, Promise, Math, Date, JSON, WeakSet,
  navigator: { userAgent: 'node' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
  document: { addEventListener: noop, getElementById: (id) => mounts[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: mk, body: mk(), readyState: 'complete', documentElement: mk(), referrer: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => ({ ok: true, json: async () => nextGet }),
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
for (const f of ['client.js', 'privacy-sweep.js', 'then-now.js']) vm.runInContext(read(f), sandbox, { filename: f });
const S = (expr) => vm.runInContext(expr, sandbox);
check('then-now.js categories and labels match thenNow.js', JSON.stringify(S('TN_CATEGORIES')) === JSON.stringify(tn.UPGRADE_CATEGORIES)
  && S('TN_OWNER_LABEL') === tn.OWNER_REPORTED_LABEL && S('TN_AGENT_LABEL') === tn.OWNER_REPORTED_LABEL_AGENT && S('TN_PERMIT_NOTE') === tn.PERMIT_ASK_AGENT && JSON.stringify(S('TN_PERMITS')) === JSON.stringify(tn.PERMIT_ANSWERS));
sandbox.ownerData = { upgrades: [{ id: 1, category: 'kitchen', label: 'Kitchen', doneYear: 2021, doneMonth: 3, note: 'New <b>cabinets</b>', permit: 'not_sure' }, { id: 2, category: 'roof', label: 'Roof', doneYear: 2019, doneMonth: null, note: '', permit: 'yes' }],
  pairs: [{ id: 7, upgradeId: 1, caption: 'The kitchen', thenYear: 2009, sweptDone: true }], permitsShown: true, label: tn.OWNER_REPORTED_LABEL, canEdit: true };
sandbox.agentData = { upgrades: [{ id: 1, category: 'kitchen', label: 'Kitchen', doneYear: 2021, doneMonth: 3, note: 'New cabinets' }], pairs: [{ id: 7, upgradeId: 1, caption: 'The kitchen', thenYear: 2009 }], permitsShown: false, label: tn.OWNER_REPORTED_LABEL_AGENT };
const ownerHtml = S('tnPanelHtml(ownerData, true)');
const agentHtml = S('tnPanelHtml(agentData, false)');
check('owner panel: heading, the exact sub and the owner label', ownerHtml.includes('<h3>Then &amp; Now</h3>')
  && ownerHtml.includes("Show agents what you've done to your home: an old photo next to today's, and a dated list of your upgrades.")
  && ownerHtml.includes(`<p class="tiny owner-reported">${tn.OWNER_REPORTED_LABEL.replace(/'/g, '&#39;')}</p>`));
check('owner panel: the form ids, each with a label', ['tnCategory', 'tnYear', 'tnMonth', 'tnNote', 'tnPermit', 'tnThen', 'tnNow', 'tnCaption', 'tnThenYear', 'tnUpgrade', 'tnRights'].every(id => ownerHtml.includes(`id="${id}"`) && ownerHtml.includes(`for="${id}"`))
  && !/<label(?![^>]*\bfor=)/.test(ownerHtml) && ownerHtml.includes('maxlength="120"'));
check('owner panel: permit options and hints exact', ownerHtml.includes('<option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option><option value="not_sure">Not sure</option>')
  && ownerHtml.includes('Only you, the agent you hire and agents you share your contact info with see permit answers.') && ownerHtml.includes('Describe the work, not who lives here.'));
check('owner panel: "Not sure" shows only "Ask your agent how this gets disclosed."', ownerHtml.includes('<span class="permit-note">Ask your agent how this gets disclosed.</span>') && (ownerHtml.match(/permit-note/g) || []).length === 1);
check('owner panel: rights box, the old-listing line, the Add buttons', ownerHtml.includes('I took these photos or have permission to use them.') && ownerHtml.includes("Don&#39;t use photos from an old listing website unless you have permission.") === false
  && ownerHtml.includes("Don't use photos from an old listing website unless you have permission.") && ownerHtml.includes('>Add upgrade<') && ownerHtml.includes('>Add photo pair<'));
check('owner panel: user text is escaped', ownerHtml.includes('New &lt;b&gt;cabinets&lt;/b&gt;') && !ownerHtml.includes('<b>cabinets'));
check('slider: two images, the range with its aria-label, alt Then:/Now:', ownerHtml.includes('<img class="tn-img" src="/api/then-now-photos/7/then" alt="Then: The kitchen"') && ownerHtml.includes('<img class="tn-img tn-now" src="/api/then-now-photos/7/now" alt="Now: The kitchen"')
  && ownerHtml.includes('<input type="range" class="tn-range" min="0" max="100" value="50" aria-label="Drag to compare then and now">'));
check('owner panel: "✓ Sweep done" on a swept pair, owner only', ownerHtml.includes('✓ Sweep done') && !agentHtml.includes('Sweep done'));
check('agent panel: the agent label, the list, the pairs, the reuse line; no forms, no permit', agentHtml.includes(tn.OWNER_REPORTED_LABEL_AGENT.replace(/'/g, '&#39;')) && agentHtml.includes('Kitchen')
  && agentHtml.includes("Agents may not use these photos in ads or the MLS without the homeowner&#39;s OK.") && !agentHtml.includes('id="tnCategory"') && !/Permit/.test(agentHtml) && !agentHtml.includes('Remove'));
sandbox.permitAgent = { ...sandbox.agentData, upgrades: [{ ...sandbox.agentData.upgrades[0], permit: 'no' }], permitsShown: true };
const permitAgentHtml = S('tnPanelHtml(permitAgent, false)');
check('agent panel with permits: the answer, but not the owner-only "ask your agent" line', permitAgentHtml.includes('Permit: No') && !permitAgentHtml.includes('permit-note'));
sandbox.closedData = { ...sandbox.ownerData, canEdit: false };
const closedHtml = S('tnPanelHtml(closedData, true)');
check('a closed home: no forms and no Edit, but the owner can still remove things', !closedHtml.includes('id="tnCategory"') && !closedHtml.includes('id="tnThen"') && !closedHtml.includes('>Edit<')
  && closedHtml.includes('data-tn-action="delete-upgrade"') && closedHtml.includes('data-tn-action="delete-pair"'));
sandbox.fullData = { ...sandbox.ownerData, pairs: [1, 2, 3, 4].map(i => ({ id: i, upgradeId: null, caption: '', thenYear: null, sweptDone: false })) };
check('four pairs: the pair form is gone', !S('tnPanelHtml(fullData, true)').includes('id="tnThen"'));
mounts.thenNowAgentPanel = mk();
mounts.thenNowAgentPanel.innerHTML = 'old';
nextGet = { upgrades: [], pairs: [], permitsShown: false, label: tn.OWNER_REPORTED_LABEL_AGENT };
await S('loadThenNowInto(10, false)');
check('agents see nothing when there are no upgrades and no pairs', mounts.thenNowAgentPanel.innerHTML === '');
mounts.thenNowPanel = mk();
nextGet = { upgrades: [], pairs: [], permitsShown: true, label: tn.OWNER_REPORTED_LABEL, canEdit: true };
await S('loadThenNowInto(10, true)');
check('the owner always gets the panel (with the forms)', mounts.thenNowPanel.innerHTML.includes('Then &amp; Now') && mounts.thenNowPanel.innerHTML.includes('id="tnCategory"'));

// ---- Jury and wording ----
const tnSrc = read('then-now.js');
const libSrc = read('functions/_lib/thenNow.js');
check('then-now.js and thenNow.js carry the owner-reported label and the permit line', [tnSrc, libSrc].every(s => s.includes(tn.OWNER_REPORTED_LABEL) && s.includes('Ask your agent how this gets disclosed.')));
// User-facing strings: every string literal, without HTML tags (attribute names like value="" aren't words anyone reads).
const userStrings = (src) => [...src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)]
  .map(m => m[0].replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]*>/g, ' ')).join('\n');
const JURY = /\bvalue\b|worth|\badds?\b \$|ROI|pays? back|unpermitted|illegal|code violation|\bcost\b/i;
check('then-now.js: no value/worth/ROI/cost/"unpermitted" wording in what users read', !JURY.test(userStrings(tnSrc)), (userStrings(tnSrc).match(JURY) || [])[0]);
check('thenNow.js: the same for every message it sends', !JURY.test(userStrings(libSrc)), (userStrings(libSrc).match(JURY) || [])[0]);
for (const f of ['functions/api/pre-listings/[id]/then-now/index.js', 'functions/api/pre-listings/[id]/upgrades/index.js', 'functions/api/pre-listings/[id]/upgrades/[upgradeId].js', 'functions/api/pre-listings/[id]/then-now/[pairId].js']) {
  check(`${f}: no jury wording in its messages`, !JURY.test(userStrings(read(f))));
}
const tops = [...tnSrc.matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm)].map(m => m[1] || m[2]);
check('then-now.js: top-level names are loadThenNowInto or start with TN_/tn', tops.every(n => n === 'loadThenNowInto' || /^(TN_|tn)/.test(n)), tops.join());
check('then-now.js: the slider uses CSSOM (--split), never a style attribute', tnSrc.includes("style.setProperty('--split'") && !/\sstyle\s*=\s*["'`]/.test(tnSrc));

console.log = realLog;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
