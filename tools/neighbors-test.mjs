// Nuanced ideas batch (migration_v47), the neighbors tools: watch areas (whole ZIP codes, open to any member), the
// head start on a trade listing and a pre-listing (hidden everywhere but the watchers' early looks; photos; the
// in-app notice; the job and the owner's "open now"), the member digest, and standing interest with home claims
// (who can post, who it reaches, what an owner sees, one reply, notices). Real handlers against an in-memory SQLite
// stand-in for D1 that counts statements. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/neighbors-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
const used = { n: 0, sql: [] };
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { used.n++; used.sql.push(sql); return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { used.n++; used.sql.push(sql); return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { used.n++; used.sql.push(sql); const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? stmt.all() : stmt.run()),
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
};
// LIVE: every tool on (the test flag). SHIP: the gate as it ships (watch areas live; head start and standing interest admin-only).
const LIVE = { DB, PHOTOS, RESEND_API_KEY: 'test-key', NUANCED_ALL_LIVE: '1' };
const SHIP = { DB, PHOTOS, RESEND_API_KEY: 'test-key' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0, passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
globalThis.fetch = async (url, opts) => { try { sent.push(JSON.parse(opts.body)); } catch { /* not an email */ } return new Response('{}', { status: 200 }); };
const call = async (handler, method, path, who, params = {}, body, env = LIVE) => {
  const request = new Request(`https://amicohaus.com${path}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => r.headers.get('Cache-Control') === 'private, no-store';
const counted = async (fn) => { used.n = 0; used.sql = []; const r = await fn(); return { r, n: used.n, sql: used.sql.slice() }; };
console.log = () => {};
const ago = (expr) => one(`SELECT datetime('now', ?) AS t`, expr).t;

// ---------------- People ----------------
// 1 owner A · 2 owner B · 3 a member who watches 91915 · 4 a member who watches nothing · 5 an admin (watches 91915)
// 6 an approved agent · 7 a watcher in a block with owner 1 · 8 a suspended watcher · 9 a demo watcher
// 10 a buyer · 11 a homeowner with a home claim · 12 an account with a pending agent application · 13 a second buyer
// 14 a demo owner · 15 a suspended buyer
const user = (id, { role = 'user', email = `u${id}@example.test`, status = 'active', name = `User ${id}` } = {}) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, email, name, role, status);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
for (const id of [1, 2, 3, 4, 6, 7, 10, 11, 12, 13]) user(id);
user(5, { role: 'admin' });
user(8, { status: 'suspended' });
user(9, { email: 'watcher@demo.amicohaus.local' });
user(14, { email: 'owner@demo.amicohaus.local' });
user(15, { status: 'suspended' });
run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (6, 'approved', '01234567', 'Test Realty'), (12, 'pending', '07654321', 'Other Realty')");
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 7)');
for (const z of ['91915', '91913', '91910', '91902']) run('INSERT INTO zip_codes (zip, lat, lng) VALUES (?, 32.6, -117.0)', z);
const watch = (uid, zip) => run('INSERT INTO watch_areas (user_id, zip) VALUES (?, ?)', uid, zip);
const L = (id, uid, { zip = '', status = 'active', until = null, type = 'Condo', hidden = null, rental = 0, buyerOnly = 0, created = null, desc = 'A bright home.' } = {}) => {
  run(`INSERT INTO listings (id, user_id, title, description, address, city, state, property_type, beds, baths, estimated_value, price_tier, zip, status, head_start_until, hidden_at, is_rental, is_buyer_only, created_at)
       VALUES (?, ?, ?, ?, '99 Secret St', 'Chula Vista', 'CA', ?, 3, 2, 700000, '600k-1m', ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    id, uid, `Home ${id}`, desc, type, zip, status, until, hidden, rental, buyerOnly, created);
  if (!rental) run(`INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (?, 'Chula Vista', 'Any', 0, 0, 0, 1000000)`, id);
};
const P = (id, uid, { zip = '91915', status = 'open', until = null, type = 'Townhouse', created = null } = {}) =>
  run(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address, status, head_start_until, created_at)
       VALUES (?, ?, ?, 'Chula Vista', 'CA', ?, ?, 3, 2, 800000, '12 Hidden Ct', ?, ?, COALESCE(?, datetime('now')))`, id, uid, `Pre ${id}`, zip, type, status, until, created);

// Rows the routes create get ids from 5001 up, clear of the fixed ids used below.
L(5000, 2); run('DELETE FROM listings WHERE id = 5000');
P(5000, 2); run('DELETE FROM pre_listings WHERE id = 5000');

const gate = await mod('functions/_lib/nuancedGate.js');
const wa = await mod('functions/_lib/watchAreas.js');
const si = await mod('functions/_lib/standingInterest.js');
const it = await mod('functions/_lib/ideaText.js');
const ht = await mod('functions/_lib/homeText.js');
const rl = await mod('functions/_lib/rateLimits.js');
const areasApi = await mod('functions/api/watch-areas/index.js');
const areaOne = await mod('functions/api/watch-areas/[id].js');
const earlyApi = await mod('functions/api/watch-areas/early.js');
const digestApi = await mod('functions/api/watch-areas/digest.js');
const headStartApi = await mod('functions/api/head-start/[kind]/[id].js');
const claimsApi = await mod('functions/api/home-claims/index.js');
const claimOne = await mod('functions/api/home-claims/[id].js');
const interestsApi = await mod('functions/api/standing-interests/index.js');
const interestOne = await mod('functions/api/standing-interests/[id].js');
const replyApi = await mod('functions/api/standing-interests/[id]/reply.js');
const photoApi = await mod('functions/api/photos/[id].js');
const src = (p) => readFileSync(`${root}/${p}`, 'utf8');
const clientSrc = src('neighbors.js');

// ================= 1. The launch gate on every route =================
check('gate (as shipped): watch areas are live; the head start and standing interest are admin-only',
  gate.NUANCED_TOOLS.watchAreas === true && gate.NUANCED_TOOLS.headStart === false && gate.NUANCED_TOOLS.standingOffer === false);
{
  const dark = [
    ['GET /api/watch-areas/early', earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', {}],
    ['DELETE /api/head-start/listing/1', headStartApi.onRequestDelete, 'DELETE', '/api/head-start/listing/1', { kind: 'listing', id: '1' }],
    ['GET /api/home-claims', claimsApi.onRequestGet, 'GET', '/api/home-claims', {}],
    ['POST /api/home-claims', claimsApi.onRequestPost, 'POST', '/api/home-claims', {}, { zip: '91915', ack: true }],
    ['DELETE /api/home-claims/1', claimOne.onRequestDelete, 'DELETE', '/api/home-claims/1', { id: '1' }],
    ['GET /api/standing-interests', interestsApi.onRequestGet, 'GET', '/api/standing-interests', {}],
    ['GET /api/standing-interests?for=owner', interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', {}],
    ['POST /api/standing-interests', interestsApi.onRequestPost, 'POST', '/api/standing-interests', {}, { target: { kind: 'area', zip: '91915' }, amount: 800000, ack: true }],
    ['PUT /api/standing-interests/1', interestOne.onRequestPut, 'PUT', '/api/standing-interests/1', { id: '1' }, { renew: true }],
    ['DELETE /api/standing-interests/1', interestOne.onRequestDelete, 'DELETE', '/api/standing-interests/1', { id: '1' }],
    ['POST /api/standing-interests/1/reply', replyApi.onRequestPost, 'POST', '/api/standing-interests/1/reply', { id: '1' }, { message: 'Hello' }],
  ];
  const before = one('SELECT (SELECT COUNT(*) FROM home_claims) + (SELECT COUNT(*) FROM standing_interests) AS n').n;
  const bad = [];
  for (const [label, handler, method, path, params, body] of dark) {
    const member = await call(handler, method, path, 4, params, body, SHIP);
    const visitor = await call(handler, method, path, null, params, body, SHIP);
    if (member.status !== 404 || member.json.error !== 'Not found.' || visitor.status !== 404) bad.push(`${label}: member ${member.status}, visitor ${visitor.status}`);
  }
  check('a dark tool: every head-start and standing-interest route answers 404 "Not found." to a member and to a visitor', bad.length === 0, bad.join(' | '));
  check('...and nothing was written', one('SELECT (SELECT COUNT(*) FROM home_claims) + (SELECT COUNT(*) FROM standing_interests) AS n').n === before);
  const adminOk = [];
  for (const [label, handler, method, path, params] of dark.filter(d => d[2] === 'GET')) {
    const r = await call(handler, method, path, 5, params, undefined, SHIP);
    if (r.status !== 200 || !noStore(r)) adminOk.push(`${label}: ${r.status}`);
  }
  check('...the same read routes work for an admin (200, private no-store)', adminOk.length === 0, adminOk.join(' | '));
  const live = [];
  for (const [label, handler, path] of [['GET /api/watch-areas', areasApi.onRequestGet, '/api/watch-areas'], ['GET /api/watch-areas/digest', digestApi.onRequestGet, '/api/watch-areas/digest']]) {
    const member = await call(handler, 'GET', path, 4, {}, undefined, SHIP);
    const visitor = await call(handler, 'GET', path, null, {}, undefined, SHIP);
    if (member.status !== 200 || !noStore(member) || visitor.status !== 401) live.push(`${label}: member ${member.status}, visitor ${visitor.status}`);
  }
  check('watch areas are live as shipped: 200 private no-store for a member, 401 signed out', live.length === 0, live.join(' | '));
}

// ================= 2. Watch areas =================
{
  const cols = q('PRAGMA table_info(watch_areas)').map(c => c.name);
  check('watch_areas holds only id, user_id, zip, label, created_at (no address, residency or proof column)', JSON.stringify(cols) === '["id","user_id","zip","label","created_at"]', cols.join());
  let c = await counted(() => call(areasApi.onRequestGet, 'GET', '/api/watch-areas', 3, {}, undefined, SHIP));
  check('GET /api/watch-areas: { areas: [], max: 3 }, 1 statement + the session', c.r.status === 200 && JSON.stringify(c.r.json) === '{"areas":[],"max":3}' && c.n === 2, `${c.n} ${c.r.text}`);
  c = await counted(() => call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91915', label: 'Near work', address: '1 Main St', resident: true, proof: 'x' }, SHIP));
  const row = one('SELECT * FROM watch_areas WHERE user_id = 3');
  check('POST /api/watch-areas: any member can watch a known ZIP; 201, private no-store, 2 statements + the session', c.r.status === 201 && noStore(c.r) && c.n === 3 && row.zip === '91915' && row.label === 'Near work', `${c.n} ${c.r.text}`);
  check('...only zip and label are read from the body (nothing about where the member lives is stored)', JSON.stringify(Object.keys(row).sort()) === '["created_at","id","label","user_id","zip"]'
    && !/body\.(?!zip\b|label\b)\w+/.test(src('functions/api/watch-areas/index.js')));
  let r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91915' }, SHIP);
  check('the same ZIP again: "You already watch that ZIP code."', r.status === 400 && r.json.error === 'You already watch that ZIP code.', r.text);
  r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '00000' }, SHIP);
  check('an unknown ZIP: "We don\'t know that ZIP code."', r.status === 400 && r.json.error === "We don't know that ZIP code.", r.text);
  r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '9191' }, SHIP);
  check('a ZIP that is not 5 digits is refused before anything is counted', r.status === 400 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 3 AND kind = 'watch_area_edit'").n === 3, r.text);
  r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91913', label: 'Near the school' }, SHIP);
  check('a label goes through the text checks (fair housing)', r.status === 400 && r.json.error === ht.STEERING_ERROR, r.text);
  r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91913', label: 'Great returns for investors' }, SHIP);
  check('...and the investment check; "Where we live" is just a name', r.status === 400 && r.json.error === it.INVEST_ERROR && it.ideaTextProblem('Where we live', { living: false }) === null, r.text);
  r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91913', label: 'x'.repeat(80) }, SHIP);
  check('a label is cut to 40 characters', r.status === 201 && one("SELECT label FROM watch_areas WHERE user_id = 3 AND zip = '91913'").label.length === 40, r.text);
  await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91910' }, SHIP);
  r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91902' }, SHIP);
  check('a 4th ZIP is refused (up to 3, Rudy 11.13)', r.status === 400 && r.json.error === wa.WATCH_MAX_ERROR && one('SELECT COUNT(*) AS n FROM watch_areas WHERE user_id = 3').n === 3, r.text);
  r = await call(areasApi.onRequestGet, 'GET', '/api/watch-areas', 3, {}, undefined, SHIP);
  check('GET lists them oldest first with id, zip, label only', r.json.areas.map(a => a.zip).join() === '91915,91913,91910' && JSON.stringify(Object.keys(r.json.areas[0])) === '["id","zip","label"]', r.text);
  const mine = one("SELECT id FROM watch_areas WHERE user_id = 3 AND zip = '91910'").id;
  r = await call(areaOne.onRequestDelete, 'DELETE', `/api/watch-areas/${mine}`, 4, { id: String(mine) }, undefined, SHIP);
  check("DELETE /api/watch-areas/:id: someone else's row is a 404 and stays", r.status === 404 && !!one('SELECT 1 AS x FROM watch_areas WHERE id = ?', mine));
  r = await call(areaOne.onRequestDelete, 'DELETE', `/api/watch-areas/${mine}`, 3, { id: String(mine) }, undefined, SHIP);
  check('...the member removes their own', r.status === 200 && !one('SELECT 1 AS x FROM watch_areas WHERE id = ?', mine));
  run("DELETE FROM watch_areas WHERE user_id = 3 AND zip = '91913'");
  // 10 edits a day: the claims so far (5 valid attempts) plus enough to reach the limit.
  run("DELETE FROM user_action_log WHERE kind = 'watch_area_edit'");
  for (let i = 0; i < 10; i++) run("INSERT INTO user_action_log (user_id, kind) VALUES (3, 'watch_area_edit')");
  r = await call(areasApi.onRequestPost, 'POST', '/api/watch-areas', 3, {}, { zip: '91902' }, SHIP);
  check('the 11th edit in a day is rate-limited (429 rate_limited); removing never counts', r.status === 429 && r.json.code === 'rate_limited' && !/claimUserAction/.test(src('functions/api/watch-areas/[id].js')), r.text);
  run("DELETE FROM user_action_log WHERE kind = 'watch_area_edit'");
  for (const [u, z] of [[5, '91915'], [7, '91915'], [8, '91915'], [9, '91915'], [10, '91913']]) watch(u, z);
}

// ================= 3. Copy: any member, any ZIP; whole ZIP codes; no distance or residency words =================
{
  check('the written lines', wa.WATCH_PRECISION_LINE === 'For now a watch area is a whole ZIP code.'
    && wa.WATCH_OPEN_LINE === "Anyone with an account can watch any ZIP code. You don't have to live there."
    && wa.HEAD_START_NO_AGREEMENT === "I haven't signed a listing agreement for this home."
    && wa.HEAD_START_AGENT_LINE === 'Working with an agent? Their MLS rules decide the timing: once a home with a listing agreement is marketed to the public, MLS rules generally give the agent one business day to put it on the MLS (the Clear Cooperation rule). Ask your agent before using a head start.'
    && wa.HEAD_START_AGENT_ERROR === 'A head start is for owners posting their own home before they hire an agent.');
  const BANNED = /resident|neighbors only|locals only|1 mile|radius|your neighborhood/i;
  const strings = (s) => [...s.matchAll(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g)].map(m => m[0]);
  const panelCopy = strings(clientSrc).join('\n');
  const cardCopy = wa.WATCH_CARD_LINES.join(' ');
  check('the panel and the card carry WATCH_OPEN_LINE and WATCH_PRECISION_LINE', clientSrc.includes(wa.WATCH_OPEN_LINE) && clientSrc.includes(wa.WATCH_PRECISION_LINE)
    && cardCopy.includes(wa.WATCH_OPEN_LINE) && cardCopy.includes(wa.WATCH_PRECISION_LINE));
  check('the card is the written copy', wa.WATCH_CARD_LINES[0] === "Watch up to 3 ZIP codes and see what's new there in one place. When an owner chooses a head start, members who watch that ZIP code see the home before everyone else.");
  check('no "resident", "neighbors only", "locals only", "1 mile", "radius" or "your neighborhood" in the panel, the card or the server libs\' strings',
    !BANNED.test(panelCopy) && !BANNED.test(cardCopy) && !BANNED.test(strings(src('functions/_lib/watchAreas.js')).join('\n')) && !BANNED.test(strings(src('functions/_lib/standingInterest.js')).join('\n')),
    (panelCopy.match(BANNED) || [])[0]);
  // If the idea-cards lib already has the "first" card, it must carry the same line.
  const cards = await mod('functions/_lib/ideaCards.js').catch(() => ({}));
  const first = Array.isArray(cards.IDEA_CARDS) ? cards.IDEA_CARDS.find(c => c.key === 'first') : null;
  check('ideaCards.js "first" card (when it exists) says anyone can watch any ZIP and has no banned word',
    !first || (JSON.stringify(first).includes(wa.WATCH_OPEN_LINE.replace(/"/g, '\\"')) && !BANNED.test(JSON.stringify(first))), first ? JSON.stringify(first) : '');
  check('the head-start form copy: the tick box, the three lengths, the no-agreement box, the help and the agent line',
    clientSrc.includes('Give members who watch my ZIP code a head start') && ["'24 hours'", "'3 days'", "'7 days'"].every(s => clientSrc.includes(s))
    && clientSrc.includes(wa.HEAD_START_NO_AGREEMENT) && clientSrc.includes(wa.HEAD_START_AGENT_LINE) && clientSrc.includes('How long')
    && clientSrc.includes('During the head start only members who watch your ZIP code see your home. ${NB_WATCH_OPEN_LINE} After it, your home opens to everyone by itself, and you can open it sooner.')
    && wa.HEAD_START_HELP === `During the head start only members who watch your ZIP code see your home. ${wa.WATCH_OPEN_LINE} After it, your home opens to everyone by itself, and you can open it sooner.`);
  check('the badge copy and its button', clientSrc.includes('Head start until ${nbTimeLabel(until)} Pacific time: only members who watch ZIP ${row.zip || \'\'} see it.') && clientSrc.includes('>Open to everyone now</button>'));
  check('the panel labels', ['<h2>Watch areas</h2>', '>ZIP code</label>', '>Name it (optional)</label>', '>Watch this ZIP code</button>', '<h3>Neighbors First</h3>', "What's new in your watch areas",
    '>Message the owner</button>', 'About your home in ZIP ${el.dataset.zip || \'\'} (Neighbors First): '].every(s => clientSrc.includes(s)));
}

// ================= 4. validateHeadStart and the time helpers =================
{
  const v = wa.validateHeadStart;
  const ok = { agentPosted: false, zip: '91915' };
  check('no hours (0, missing, {}, null) -> no head start, whatever else is sent', [v({}, ok), v({ hours: 0 }, ok), v(null, ok), v(undefined), v({ hours: '', noAgreement: true }, { agentPosted: true })].every(x => JSON.stringify(x) === '{"data":{"hours":0}}'));
  check('24, 72 and 168 hours pass with a ZIP and the box ticked', [24, 72, 168].every(h => JSON.stringify(v({ hours: h, noAgreement: true }, ok)) === `{"data":{"hours":${h}}}`) && v({ hours: '72', noAgreement: true }, ok).data.hours === 72);
  check('any other length is refused', !!v({ hours: 48, noAgreement: true }, ok).error && !!v({ hours: 1000, noAgreement: true }, ok).error && !!v({ hours: -24, noAgreement: true }, ok).error);
  check('agent-posted -> HEAD_START_AGENT_ERROR (before the ZIP and the box)', v({ hours: 24, noAgreement: true }, { agentPosted: true, zip: '91915' }).error === wa.HEAD_START_AGENT_ERROR && v({ hours: 24 }, { agentPosted: true }).error === wa.HEAD_START_AGENT_ERROR);
  check('no valid ZIP -> "Add your ZIP code to use a head start."', v({ hours: 24, noAgreement: true }, { zip: '' }).error === 'Add your ZIP code to use a head start.' && v({ hours: 24, noAgreement: true }, { zip: '9191' }).error === 'Add your ZIP code to use a head start.');
  check('the box unticked (or anything but true) -> the tick message', v({ hours: 24 }, ok).error === "Tick the box to confirm you haven't signed a listing agreement for this home." && !!v({ hours: 24, noAgreement: 'yes' }, ok).error && !!v({ hours: 24, noAgreement: 1 }, ok).error);
  const now = Date.UTC(2026, 10, 14, 20, 0, 0);
  check('headStartUntil: now + hours, as datetime(\'now\')-style text; null for a length that is not offered', wa.headStartUntil(24, now) === '2026-11-15 20:00:00' && wa.headStartUntil(168, now) === '2026-11-21 20:00:00' && wa.headStartUntil(0, now) === null && wa.headStartUntil(48, now) === null);
  check('inHeadStart: only while head_start_until is in the future', wa.inHeadStart({ head_start_until: '2026-11-15 20:00:00' }, now) === true && wa.inHeadStart({ head_start_until: '2026-11-14 20:00:00' }, now) === false
    && wa.inHeadStart({ head_start_until: null }, now) === false && wa.inHeadStart({}, now) === false && wa.inHeadStart(null, now) === false);
  check('headStartLabel: the Pacific day and time', wa.headStartLabel('2026-11-15 20:00:00') === 'Sun, Nov 15, 12:00 PM' && wa.headStartLabel('') === '', wa.headStartLabel('2026-11-15 20:00:00'));
  check('headStartTeaserSql(viewer): no head start, or ended, or the owner, or a watcher of the ZIP',
    wa.headStartTeaserSql('?1') === "(pre_listings.head_start_until IS NULL OR pre_listings.head_start_until <= datetime('now') OR pre_listings.user_id = ?1 OR EXISTS (SELECT 1 FROM watch_areas wa WHERE wa.user_id = ?1 AND wa.zip = pre_listings.zip))");
}

// ================= 5. Head start on a trade listing =================
const listingsApi = await mod('functions/api/listings/index.js');
const listingOne = await mod('functions/api/listings/[id].js');
const directory = await mod('functions/api/directory.js');
const matchesApi = await mod('functions/api/matches.js');
const searchApi = await mod('functions/api/search.js');
const sitemap = await mod('functions/sitemap.xml.js');
const listingPage = await mod('functions/listing/[id].js');
const trade = { title: 'Head start home', description: 'Sunny corner home.', city: 'Chula Vista', state: 'CA', neighborhood: 'Eastlake', propertyType: 'Condo', estimatedValue: 750000, beds: 2, baths: 2,
  locations: 'Chula Vista', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0, zip: '91915', ownerConfirmed: true };
L(100, 2, { zip: '91915' }); // an ordinary active listing of owner B in the same ZIP (a match candidate for owner A)
let hsId = null;
{
  let r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, headStart: { hours: 24, noAgreement: true } });
  hsId = r.json && r.json.id;
  const row = hsId ? one('SELECT status, head_start_until, zip FROM listings WHERE id = ?', hsId) : {};
  check('create with a head start: stored paused with head_start_until about 24 hours out, and the answer carries headStartUntil', r.status === 201 && row.status === 'paused' && row.zip === '91915'
    && row.head_start_until === r.json.headStartUntil && row.head_start_until > ago('+23 hours') && row.head_start_until <= ago('+24 hours'), `${r.status} ${r.text} ${JSON.stringify(row)}`);
  check('...no market event, no match alert and no saved-search alert yet; the watchers got the in-app notice',
    one("SELECT COUNT(*) AS n FROM market_events WHERE entity_kind = 'listing' AND entity_id = ?", hsId).n === 0
    && one("SELECT COUNT(*) AS n FROM notifications WHERE type IN ('match', 'saved_search')").n === 0
    && one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'nearby' AND user_id = 3").n === 1, JSON.stringify(q('SELECT user_id, type FROM notifications')));
  run("INSERT INTO listing_photos (id, listing_id, r2_key, content_type, position) VALUES (900, ?, 'listings/hs/a', 'image/jpeg', 0), (901, ?, 'listings/hs/b', 'image/jpeg', 1)", hsId, hsId);
  objects.set('listings/hs/a', new Uint8Array([1, 2, 3])); objects.set('listings/hs/b', new Uint8Array([4, 5, 6]));

  // Hidden everywhere a paused listing is hidden, for a watcher and a non-watcher alike.
  const has = (res) => JSON.stringify(res.json || res.text).includes(`"id":${hsId}`) || JSON.stringify(res.json || res.text).includes(`"listingId":${hsId}`) || String(res.text).includes(`/listing/${hsId}`);
  const leaks = [];
  for (const who of [3, 4, null]) {
    r = await call(directory.onRequestGet, 'GET', '/api/directory', who);
    if (r.status !== 200 || has(r)) leaks.push(`directory ${who}`);
    r = await call(listingPage.onRequestGet, 'GET', `/listing/${hsId}`, who, { id: String(hsId) });
    if (r.status !== 404) leaks.push(`listing page ${who}: ${r.status}`);
    r = await call(searchApi.onRequestGet, 'GET', '/api/search?q=Head%20start', who);
    if (has(r)) leaks.push(`search ${who}`);
    r = await call(listingOne.onRequestGet, 'GET', `/api/listings/${hsId}`, who, { id: String(hsId) });
    if (r.status === 200) leaks.push(`listing api ${who}`);
  }
  r = await call(sitemap.onRequestGet, 'GET', '/sitemap.xml', null);
  if (has(r)) leaks.push('sitemap');
  r = await call(matchesApi.onRequestGet, 'GET', '/api/matches', 2);
  if (has(r)) leaks.push('matches (owner B, who watches nothing)');
  watch(2, '91915');
  r = await call(matchesApi.onRequestGet, 'GET', '/api/matches', 2);
  if (has(r)) leaks.push('matches (owner B as a watcher)');
  run('DELETE FROM watch_areas WHERE user_id = 2');
  check('a head-start listing is absent from the directory, /listing/:id (404), the listing API, search, the sitemap and matches, for a watcher and a non-watcher alike', leaks.length === 0, leaks.join(' | '));

  // The one place it shows: the watchers' early looks.
  let c = await counted(() => call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 3));
  const card = (c.r.json.homes || []).find(h => h.id === hsId);
  check('GET /api/watch-areas/early: a watcher of the ZIP sees it; 1 statement + the session; private no-store', c.r.status === 200 && noStore(c.r) && !!card && c.n === 2, `${c.n} ${c.r.text}`);
  check('...the card: the directory fields, the description, the photo ids, when it ends, the owner; never the address',
    !!card && card.zip === '91915' && card.propertyType === 'Condo' && card.beds === 2 && card.estimatedValue === 750000 && card.description === 'Sunny corner home.'
    && JSON.stringify(card.photoIds) === '[900,901]' && card.headStartUntil === one('SELECT head_start_until AS u FROM listings WHERE id = ?', hsId).u
    && card.headStartLabel === `${wa.headStartLabel(card.headStartUntil)} Pacific time` && card.owner.id === 1 && card.owner.name === 'User 1'
    && JSON.stringify(card.wants) === '{"type":"Any","locations":"Chula Vista","priceMin":0,"priceMax":2000000}'
    && !/address|Secret St|99 /i.test(c.r.text), c.r.text);
  for (const [who, label] of [[4, 'a member who does not watch the ZIP'], [7, 'a watcher in a block with the owner'], [1, 'the owner (their own home is not an early look)'], [9, 'a demo watcher is fine, see below']]) {
    r = await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', who);
    if (who === 9) check('...a demo watcher sees a real owner\'s early look like anyone else', r.status === 200 && r.json.homes.some(h => h.id === hsId), r.text);
    else check(`...not for ${label}`, r.status === 200 && r.json.homes.length === 0, r.text);
  }
  r = await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', null);
  check('...401 signed out', r.status === 401);
  run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (13, 1)'); watch(13, '91915');
  r = await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 13);
  check('...a block the other way (the watcher blocked the owner) hides it too', r.json.homes.length === 0);
  run('DELETE FROM user_blocks WHERE blocker_id = 13'); run('DELETE FROM watch_areas WHERE user_id = 13');
  // Others that must stay out: buyer-only, a demo owner (for a real viewer), a suspended owner, an admin-hidden one, one whose head start is over, an ordinary paused listing.
  L(101, 2, { zip: '91915', status: 'paused', until: ago('+1 day'), buyerOnly: 1 });
  L(102, 14, { zip: '91915', status: 'paused', until: ago('+1 day') });
  L(103, 15, { zip: '91915', status: 'paused', until: ago('+1 day') });
  L(104, 2, { zip: '91915', status: 'paused', until: ago('+1 day'), hidden: ago('-1 hour') });
  L(105, 2, { zip: '91915', status: 'paused', until: ago('-1 minute') });
  L(106, 2, { zip: '91915', status: 'paused' });
  L(107, 2, { zip: '91913', status: 'paused', until: ago('+1 day'), desc: 'x'.repeat(900) });
  r = await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 3);
  check('early looks leave out buyer profiles, demo and suspended owners, admin-hidden listings, ended head starts, ordinary paused listings and other ZIPs',
    r.json.homes.map(h => h.id).join() === String(hsId), r.json.homes.map(h => h.id).join());
  r = await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 9);
  check('...a demo viewer also sees a demo owner\'s head start', r.json.homes.map(h => h.id).sort().join() === [hsId, 102].sort().join(), r.json.homes.map(h => h.id).join());
  r = await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 10);
  check('...the description is cut to 600 characters', r.json.homes.length === 1 && r.json.homes[0].id === 107 && r.json.homes[0].description.length === 600);
  check('...the route never reads listings.address', !/\baddress\b/.test(src('functions/api/watch-areas/early.js').replace(/^\s*\/\/.*$/gm, '')) &&!/l\.address|listings\.address/.test(src('functions/_lib/watchAreas.js')));

  // Photos.
  c = await counted(() => call(photoApi.onRequestGet, 'GET', '/api/photos/900', 3, { id: '900' }));
  check('photo of a head-start listing: 200 private no-store for a watcher of its ZIP; 2 statements + the session', c.r.status === 200 && noStore(c.r) && c.n === 3, `${c.r.status} ${c.n}`);
  const refused = [];
  for (const [who, label] of [[4, 'non-watcher'], [7, 'blocked watcher'], [null, 'signed out']]) {
    r = await call(photoApi.onRequestGet, 'GET', '/api/photos/900', who, { id: '900' });
    if (r.status !== 404) refused.push(`${label}: ${r.status}`);
  }
  check('...404 for a non-watcher, a blocked watcher and a signed-out visitor', refused.length === 0, refused.join(' | '));
  r = await call(photoApi.onRequestGet, 'GET', '/api/photos/900', 1, { id: '900' });
  const adminPhoto = await call(photoApi.onRequestGet, 'GET', '/api/photos/900', 5, { id: '900' }, undefined, SHIP);
  check('...the owner and an admin get it as always (private no-store)', r.status === 200 && noStore(r) && adminPhoto.status === 200 && noStore(adminPhoto));
  r = await call(photoApi.onRequestGet, 'GET', '/api/photos/900', 3, { id: '900' }, undefined, SHIP);
  check('...while the head start is admin-only, a member who watches the ZIP gets 404', r.status === 404);
  run("INSERT INTO listing_photos (id, listing_id, r2_key, content_type) VALUES (910, 104, 'listings/hs/a', 'image/jpeg'), (911, 106, 'listings/hs/a', 'image/jpeg'), (912, 100, 'listings/hs/a', 'image/jpeg'), (913, 105, 'listings/hs/a', 'image/jpeg')");
  const p104 = await call(photoApi.onRequestGet, 'GET', '/api/photos/910', 3, { id: '910' });
  const p106 = await call(photoApi.onRequestGet, 'GET', '/api/photos/911', 3, { id: '911' });
  const p105 = await call(photoApi.onRequestGet, 'GET', '/api/photos/913', 3, { id: '913' });
  check('...an admin-hidden, an ordinary paused and an ended-but-not-yet-opened listing stay 404 for a watcher', p104.status === 404 && p106.status === 404 && p105.status === 404, `${p104.status} ${p106.status} ${p105.status}`);
  c = await counted(() => call(photoApi.onRequestGet, 'GET', '/api/photos/912', null, { id: '912' }));
  check('...the public path is unchanged: an active listing\'s photo is public and cached, 1 statement', c.r.status === 200 && c.r.headers.get('Cache-Control') === 'public, max-age=31536000, immutable' && c.n === 1, `${c.n}`);

  // With the gate as shipped, a member's early looks and digest say nothing about it.
  r = await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 3, {}, undefined, SHIP);
  check('as shipped: a member gets 404 on the early looks; an admin who watches the ZIP sees the home', r.status === 404
    && (await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 5, {}, undefined, SHIP)).json.homes.some(h => h.id === hsId));
}

// ================= 6. The notice to watchers =================
{
  const mine = q("SELECT user_id, body, link, emailed_at FROM notifications WHERE type = 'nearby'");
  const until = one('SELECT head_start_until AS u FROM listings WHERE id = ?', hsId).u;
  check('create told the ZIP\'s watchers: the member and the admin; not the owner, the blocked, suspended or demo watcher, or anyone outside the ZIP',
    mine.map(n => n.user_id).sort().join() === '3,5', mine.map(n => n.user_id).join());
  check('...the body has the ZIP and the time and nothing else about the home; the link is /app#watch-areas; nothing was emailed',
    mine.every(n => n.body === `Neighbors First: a home in ZIP 91915 is open to members who watch that ZIP code before everyone else, until ${wa.headStartLabel(until)} Pacific time.`
      && n.link === '/app#watch-areas' && n.emailed_at === null) && sent.length === 0 && !/Condo|750|Head start home|User 1|Eastlake/.test(mine[0].body), JSON.stringify(mine[0]));
  check('...a pre-listing notice says "pre-listing"', wa.nearbyNoticeBody('pre_listing', '91913', '2026-11-15 20:00:00') === 'Neighbors First: a pre-listing in ZIP 91913 is open to members who watch that ZIP code before everyone else, until Sun, Nov 15, 12:00 PM Pacific time.');
  run("DELETE FROM notifications WHERE type = 'nearby'");
  const ctx = (env) => ({ env, request: new Request('https://amicohaus.com/x'), waitUntil() {} });
  let c = await counted(() => wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: hsId, ownerId: 1, zip: '91915', until }));
  check('notifyWatchers: ONE statement, an INSERT into notifications (never notifyAndMaybeEmail)', c.n === 1 && /^\s*INSERT INTO notifications/.test(c.sql[0]) && c.r === 2
    && !/notifyAndMaybeEmail|sendPush|email\.js|webpush/.test(src('functions/_lib/watchAreas.js')), `${c.n} ${c.r}`);
  await wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: hsId, ownerId: 1, zip: '91915', until });
  await wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: hsId, ownerId: 1, zip: '91915', until });
  const fourth = await wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: hsId, ownerId: 1, zip: '91915', until });
  check('a member with 3 "nearby" notices today gets no 4th', fourth === 0 && one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'nearby' AND user_id = 3").n === 3);
  run("UPDATE notifications SET created_at = datetime('now', '-2 days') WHERE type = 'nearby'");
  check('...and gets one again the next day', (await wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: hsId, ownerId: 1, zip: '91915', until })) === 2);
  run("DELETE FROM notifications WHERE type = 'nearby'");
  check('a suspended or demo OWNER notifies nobody', (await wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: 103, ownerId: 15, zip: '91915', until })) === 0
    && (await wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: 102, ownerId: 14, zip: '91915', until })) === 0);
  check('no ZIP, no end time or no owner: nothing is written and no statement runs', (await counted(() => wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: 1, ownerId: 1, zip: '', until }))).n === 0
    && (await wa.notifyWatchers(ctx(LIVE), { kind: 'listing', id: 1, ownerId: 1, zip: '91915', until: null })) === 0);
  const shipped = await wa.notifyWatchers(ctx(SHIP), { kind: 'listing', id: hsId, ownerId: 1, zip: '91915', until });
  check('as shipped (head start admin-only): only an admin who watches the ZIP is told, so no member gets a notice about a tool they can\'t open',
    shipped === 1 && q("SELECT user_id FROM notifications WHERE type = 'nearby'").map(n => n.user_id).join() === '5');
  run("DELETE FROM notifications WHERE type = 'nearby'");
}

// ================= 7. Opening: the job, the owner's "open now", an admin-hidden listing =================
{
  const ctx = { env: LIVE, request: new Request('https://amicohaus.com/x'), waitUntil() {} };
  run("UPDATE listings SET head_start_until = datetime('now', '+1 day') WHERE id = 105"); // back into its head start for now
  let c = await counted(() => wa.runDueHeadStarts(ctx));
  check('the job, nothing due: 1 statement and nothing changes', c.n === 1 && one('SELECT status FROM listings WHERE id = ?', hsId).status === 'paused');
  run("UPDATE listings SET head_start_until = datetime('now', '-1 minute') WHERE id = ?", hsId);
  await wa.runDueHeadStarts(ctx);
  const opened = one('SELECT status, head_start_until FROM listings WHERE id = ?', hsId);
  const events = () => one("SELECT COUNT(*) AS n FROM market_events WHERE entity_kind = 'listing' AND entity_id = ? AND event_type = 'new_listing'", hsId).n;
  check('the job, a head start that has ended: the listing is active with no head start', opened.status === 'active' && opened.head_start_until === null, JSON.stringify(opened));
  check('...and the create-time alerts ran once (the Market Pulse event exists now)', events() === 1, String(events()));
  await wa.runDueHeadStarts(ctx);
  const again = await wa.endHeadStart(ctx, hsId);
  check('...a second run, and endHeadStart again, change nothing and announce nothing', again === false && events() === 1);
  let r = await call(listingPage.onRequestGet, 'GET', `/listing/${hsId}`, null, { id: String(hsId) });
  check('...its page is public now, and it is no longer an early look', r.status === 200 && !(await call(earlyApi.onRequestGet, 'GET', '/api/watch-areas/early', 3)).json.homes.some(h => h.id === hsId));

  run("UPDATE listings SET head_start_until = datetime('now', '-1 minute') WHERE id = 104"); // hidden by an admin during its head start
  await wa.runDueHeadStarts(ctx);
  r = await call(headStartApi.onRequestDelete, 'DELETE', '/api/head-start/listing/104', 2, { kind: 'listing', id: '104' });
  check('a listing an admin paused during its head start never opens by itself, and the owner can\'t open it either',
    one('SELECT status FROM listings WHERE id = 104').status === 'paused' && r.status === 200 && r.json.opened === false);

  r = await call(headStartApi.onRequestDelete, 'DELETE', '/api/head-start/listing/105', 4, { kind: 'listing', id: '105' });
  check('DELETE /api/head-start/listing/:id by someone else: 404, nothing changes', r.status === 404 && one('SELECT status FROM listings WHERE id = 105').status === 'paused');
  c = await counted(() => call(headStartApi.onRequestDelete, 'DELETE', '/api/head-start/listing/105', 2, { kind: 'listing', id: '105' }));
  const l105 = one('SELECT status, head_start_until FROM listings WHERE id = 105');
  check('...by the owner ("Open to everyone now"): active at once, private no-store, the alerts run after the response', c.r.status === 200 && c.r.json.opened === true && noStore(c.r)
    && l105.status === 'active' && l105.head_start_until === null && one("SELECT COUNT(*) AS n FROM market_events WHERE entity_kind = 'listing' AND entity_id = 105").n === 1, c.r.text);
  r = await call(headStartApi.onRequestDelete, 'DELETE', '/api/head-start/listing/105', 2, { kind: 'listing', id: '105' });
  check('...a second tap is fine and announces nothing again', r.status === 200 && r.json.opened === false && one("SELECT COUNT(*) AS n FROM market_events WHERE entity_kind = 'listing' AND entity_id = 105").n === 1);
  r = await call(headStartApi.onRequestDelete, 'DELETE', '/api/head-start/condo/105', 2, { kind: 'condo', id: '105' });
  check('...an unknown kind is a 404', r.status === 404);
  {
    // Two head starts due at once: the job opens one a pass, oldest first (opening runs the create-time alerts, and
    // the jobs share D1's per-invocation statement limit with the request that started them).
    run("UPDATE listings SET status = 'paused', head_start_until = datetime('now', '-2 minutes') WHERE id = 105");
    run("UPDATE listings SET status = 'paused', head_start_until = datetime('now', '-1 minute') WHERE id = ?", hsId);
    await wa.runDueHeadStarts(ctx);
    const after1 = [one('SELECT status FROM listings WHERE id = 105').status, one('SELECT status FROM listings WHERE id = ?', hsId).status].join();
    await wa.runDueHeadStarts(ctx);
    const after2 = [one('SELECT status FROM listings WHERE id = 105').status, one('SELECT status FROM listings WHERE id = ?', hsId).status].join();
    check('two head starts due: one opens per pass, oldest first, and the next pass opens the other', after1 === 'active,paused' && after2 === 'active,active'
      && /hidden_at IS NULL ORDER BY head_start_until ASC LIMIT 1'/.test(src('functions/_lib/watchAreas.js')), `${after1} | ${after2}`);
  }
  check('endHeadStart only touches a listing that still has a head start and is not admin-hidden (one guarded UPDATE)',
    /UPDATE listings SET status = 'active', head_start_until = NULL, updated_at = datetime\('now'\)\s+WHERE id = \?1 AND head_start_until IS NOT NULL AND hidden_at IS NULL/.test(src('functions/_lib/watchAreas.js')));
  // The owner pausing or un-pausing through the listing API (P's route) keeps the same rules.
  run("UPDATE listings SET status = 'paused', head_start_until = datetime('now', '+1 day') WHERE id = 106");
  r = await call(listingOne.onRequestPut, 'PUT', '/api/listings/106', 2, { id: '106' }, { status: 'active' });
  const l106 = one('SELECT status, head_start_until FROM listings WHERE id = 106');
  check('PUT /api/listings/:id { status: "active" } on a head-start listing opens it through endHeadStart', l106.status === 'active' && l106.head_start_until === null, `${r.status} ${r.text} ${JSON.stringify(l106)}`);
}

// ================= 8. Head start refused (the create route) =================
{
  run("DELETE FROM user_action_log WHERE kind = 'head_start'");
  let r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 6, {}, { ...trade, title: 'Agent own', headStart: { hours: 24, noAgreement: true } });
  check('an approved agent posting: HEAD_START_AGENT_ERROR, nothing stored', r.status === 400 && r.json.error === wa.HEAD_START_AGENT_ERROR && !one("SELECT 1 AS x FROM listings WHERE title = 'Agent own'"), r.text);
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 6, {}, { ...trade, title: 'For a client', clientName: 'Jane Smith', headStart: { hours: 72, noAgreement: true } });
  check('a home posted for a client: HEAD_START_AGENT_ERROR', r.status === 400 && r.json.error === wa.HEAD_START_AGENT_ERROR, r.text);
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'No zip', zip: '', headStart: { hours: 24, noAgreement: true } });
  check('no ZIP: "Add your ZIP code to use a head start."', r.status === 400 && r.json.error === 'Add your ZIP code to use a head start.', r.text);
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Unticked', headStart: { hours: 24 } });
  check('the box unticked: refused', r.status === 400 && r.json.error === "Tick the box to confirm you haven't signed a listing agreement for this home." && !one("SELECT 1 AS x FROM listings WHERE title = 'Unticked'"), r.text);
  check('...none of those refusals used up a head start', one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'head_start'").n === 0);
  for (let i = 0; i < 3; i++) run("INSERT INTO user_action_log (user_id, kind) VALUES (1, 'head_start')");
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Fourth today', headStart: { hours: 24, noAgreement: true } });
  check('a 4th head start in a day is rate-limited', r.status === 429 && r.json.code === 'rate_limited' && !one("SELECT 1 AS x FROM listings WHERE title = 'Fourth today'"), r.text);
  run("DELETE FROM user_action_log WHERE kind = 'head_start'");
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Dark gate', headStart: { hours: 24, noAgreement: true } }, SHIP);
  const dark = one("SELECT status, head_start_until FROM listings WHERE title = 'Dark gate'");
  check('as shipped, a member\'s headStart field is ignored: the listing is created active with no head start', r.status === 201 && dark && dark.status === 'active' && dark.head_start_until === null, `${r.status} ${r.text}`);
  run("DELETE FROM listings WHERE title = 'Dark gate'");
  check('the client field for an agent-posted home is the MLS note alone', /if \(opts && opts\.agentPosted\) return `<div><p class="tiny field-hint">\$\{escapeHtml\(NB_HEAD_START_AGENT_LINE\)\}<\/p><\/div>`;/.test(clientSrc));
}

// ================= 9. Head start on a pre-listing: only the member teaser waits =================
const plIndex = await mod('functions/api/pre-listings/index.js');
{
  run("DELETE FROM notifications");
  const base = { title: 'Pre head start', city: 'Chula Vista', state: 'CA', zip: '91915', propertyType: 'Townhouse', beds: 3, baths: 2, askingPrice: '800000', ownerConfirmed: true };
  let r = await call(plIndex.onRequestPost, 'POST', '/api/pre-listings', 2, {}, { ...base, headStart: { hours: 72, noAgreement: true } });
  const plId = r.json && r.json.id;
  const row = plId ? one('SELECT status, head_start_until FROM pre_listings WHERE id = ?', plId) : {};
  check('create with a head start: the pre-listing is open as always, with head_start_until about 3 days out', r.status === 201 && row.status === 'open' && row.head_start_until > ago('+71 hours') && row.head_start_until <= ago('+72 hours'), `${r.status} ${r.text}`);
  check('...the watchers got the in-app notice ("a pre-listing in ZIP 91915")', q("SELECT user_id, body FROM notifications WHERE type = 'nearby'").map(n => n.user_id).sort().join() === '3,5,7'
    && one("SELECT body FROM notifications WHERE type = 'nearby' LIMIT 1").body.startsWith('Neighbors First: a pre-listing in ZIP 91915 is open to members who watch that ZIP code before everyone else, until '));
  check('...agents are told at create as today (the route still calls notifyAgentsNewRequest and the admin alert, whatever the head start)',
    /notifyAgentsNewRequest\(context, 'pre_listing'/.test(src('functions/api/pre-listings/index.js')) && /alertAdmin\(/.test(src('functions/api/pre-listings/index.js')));
  const sees = async (who, env = LIVE) => { const x = await call(plIndex.onRequestGet, 'GET', '/api/pre-listings', who, {}, undefined, env); return (x.json.preListings || []).find(p => p.id === plId) || null; };
  const t3 = await sees(3), t4 = await sees(4), t6 = await sees(6), t7 = await sees(7);
  check('browse: the teaser is absent for a member who does not watch the ZIP and present for one who does', t4 === null && !!t3 && t3.teaser === true, JSON.stringify({ t3, t4 }));
  check('...an approved agent sees the full card throughout', !!t6 && t6.teaser !== true && t6.title === 'Pre head start');
  run("UPDATE pre_listings SET head_start_until = datetime('now', '-1 minute') WHERE id = ?", plId);
  check('...after the time, the teaser is there for everyone (no job: compared at read time)', !!(await sees(4)));
  run("UPDATE pre_listings SET head_start_until = datetime('now', '+1 day') WHERE id = ?", plId);
  r = await call(headStartApi.onRequestDelete, 'DELETE', `/api/head-start/pre_listing/${plId}`, 4, { kind: 'pre_listing', id: String(plId) });
  check('DELETE /api/head-start/pre_listing/:id by someone else: 404', r.status === 404 && (await sees(4)) === null);
  r = await call(headStartApi.onRequestDelete, 'DELETE', `/api/head-start/pre_listing/${plId}`, 2, { kind: 'pre_listing', id: String(plId) });
  check('...by the owner: the teaser opens to every member now', r.status === 200 && noStore(r) && one('SELECT head_start_until AS u FROM pre_listings WHERE id = ?', plId).u === null && !!(await sees(4)));
  r = await call(plIndex.onRequestPost, 'POST', '/api/pre-listings', 6, {}, { ...base, title: 'Agent pre', headStart: { hours: 24, noAgreement: true } });
  check('an approved agent posting a pre-listing: HEAD_START_AGENT_ERROR', r.status === 400 && r.json.error === wa.HEAD_START_AGENT_ERROR, r.text);
  run("DELETE FROM notifications");
}

// ================= 10. The digest =================
{
  // Owner B's homes in 91915 and 91913; the viewer (3) watches 91915 only. Viewer's own rows, other ZIPs, old rows,
  // buyer profiles, rentals, bundled members, blocked, suspended and demo owners must all stay out.
  L(200, 2, { zip: '91915', type: 'Townhouse' });
  L(201, 2, { zip: '91902' });
  L(202, 3, { zip: '91915' });
  L(203, 2, { zip: '91915', created: ago('-20 days') });
  L(204, 2, { zip: '91915', buyerOnly: 1 });
  L(205, 14, { zip: '91915' });
  L(206, 15, { zip: '91915' });
  L(207, 2, { zip: '91915', status: 'paused', until: ago('+2 days'), type: 'Penthouse' });
  L(208, 2, { zip: '91915', rental: 1 });
  P(300, 2, { zip: '91915' });
  P(301, 2, { zip: '91915', status: 'closed' });
  P(302, 3, { zip: '91915' });
  P(303, 2, { zip: '91902' });
  let r = await call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', null);
  check('digest: 401 signed out', r.status === 401);
  let c = await counted(() => call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', 3));
  const sql = wa.watchDigestSql(LIVE, { id: 3, role: 'user' });
  const termCount = sql.split(/\n\s*UNION ALL\s+/i).length;
  check('digest: 200 private no-store, { areas, items, max }; 2 statements + the session with every live term', c.r.status === 200 && noStore(c.r) && c.n === 3
    && JSON.stringify(Object.keys(c.r.json)) === '["areas","items","max"]' && c.r.json.areas.map(a => a.zip).join() === '91915', `${c.n} ${c.r.text.slice(0, 300)}`);
  check(`digest SQL: built from the registry, ${termCount} term(s) for this viewer, never more than 5 in one statement (allUnionAll)`,
    termCount >= 3 && termCount <= wa.WATCH_DIGEST_TERMS.length && c.sql.filter(s => /UNION ALL/i.test(s)).every(s => (s.match(/\bUNION\b/gi) || []).length + 1 <= 5)
    && /allUnionAll\(db, sql, params, DIGEST_COLUMNS\)/.test(src('functions/_lib/watchAreas.js')));
  check('the registry: early_look, listing, pre_listing, open_for, deal_outline, in that order, each behind its own tool',
    wa.WATCH_DIGEST_TERMS.map(t => `${t.kind}:${t.tool}`).join() === 'early_look:headStart,listing:watchAreas,pre_listing:watchAreas,open_for:openFor,deal_outline:easementIdeas');
  const items = c.r.json.items;
  const ids = (kind) => items.filter(i => i.kind === kind).map(i => i.id).sort((a, b) => a - b).join();
  check('digest items: only from watched ZIPs, none of the viewer\'s own, no old, buyer-only, rental, demo, suspended or blocked rows',
    ids('listing') === [100, 105, 106, 200, hsId].sort((a, b) => a - b).join() && ids('early_look') === '207' && items.filter(i => i.kind === 'pre_listing').every(i => ![301, 302, 303].includes(i.id))
    && items.some(i => i.kind === 'pre_listing' && i.id === 300), JSON.stringify(items.map(i => [i.kind, i.id])));
  const early = items.find(i => i.kind === 'early_look');
  check('item text and links, built on the server', early.text === `Neighbors First: Penthouse in ZIP 91915, open to watchers until ${wa.headStartLabel(one('SELECT head_start_until AS u FROM listings WHERE id = 207').u)} Pacific time`
    && early.href === '/app#watch-areas'
    && items.find(i => i.kind === 'listing' && i.id === 200).text === 'New trade listing: Townhouse in ZIP 91915' && items.find(i => i.id === 200 && i.kind === 'listing').href === '/listing/200'
    && items.find(i => i.kind === 'pre_listing' && i.id === 300).text === 'New pre-listing: Townhouse in ZIP 91915' && items.find(i => i.kind === 'pre_listing' && i.id === 300).href === '/app#pre-listing-300', JSON.stringify(early));
  check('...no item has a price, a count, an adjective or anything but kind, id, zip, text, href, createdAt', items.every(i => !/\$|\d+ new|hot|popular|best|great|deal/i.test(i.text)
    && JSON.stringify(Object.keys(i)) === '["kind","id","zip","text","href","createdAt"]'), JSON.stringify(items.filter(i => /\$|\d+ new|hot|popular|best|great|deal/i.test(i.text))));
  check('...newest first', items.every((i, n) => n === 0 || String(items[n - 1].createdAt) >= String(i.createdAt)));
  r = await call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', 7);
  check('a watcher in a block with owner 1 gets none of owner 1\'s rows', r.json.items.every(i => !(i.kind === 'listing' && [hsId].includes(i.id))) && r.json.items.some(i => i.id === 200));
  r = await call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', 3, {}, undefined, SHIP);
  const shipSql = wa.watchDigestSql(SHIP, { id: 3, role: 'user' });
  check('as shipped: a dark tool\'s term is absent for a member (no early look, no Open For, no idea outline), present for an admin',
    !r.json.items.some(i => ['early_look', 'open_for', 'deal_outline'].includes(i.kind)) && !/'early_look'|'open_for'|'deal_outline'/.test(shipSql)
    && shipSql.split(/\n\s*UNION ALL\s+/i).length === 2 && /'early_look'/.test(wa.watchDigestSql(SHIP, { id: 5, role: 'admin' })), shipSql.slice(0, 200));
  c = await counted(() => call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', 4));
  check('a member who watches nothing: no items, 1 statement + the session', c.r.json.items.length === 0 && c.r.json.areas.length === 0 && c.n === 2);
  // The two terms the land-ideas libs add (when they are in place): same endpoint, same two statements.
  const ofLib = await mod('functions/_lib/openFor.js'), doLib = await mod('functions/_lib/dealOutlines.js');
  if (ofLib.openForDigestTermSql() && doLib.dealOutlineDigestTermSql()) {
    run("INSERT INTO open_for (id, user_id, property_kind, zip, city, uses_json) VALUES (1, 2, 'rural_land', '91915', 'Chula Vista', '[\"grazing\"]'), (2, 3, 'home', '91915', 'Chula Vista', '[\"garden\"]'), (3, 2, 'home', '91902', 'Bonita', '[\"garden\"]')");
    run("INSERT INTO deal_outlines (id, user_id, kind, use_key, zip, listed) VALUES (1, 2, 'space', 'rv_boat', '91915', 1), (2, 2, 'space', 'storage', '91915', 0), (3, 3, 'space', 'garden', '91915', 1)");
    c = await counted(() => call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', 3));
    const of = c.r.json.items.filter(i => i.kind === 'open_for'), ol = c.r.json.items.filter(i => i.kind === 'deal_outline');
    check('digest with all five terms: still 2 statements + the session (one compound SELECT of exactly 5 terms)', c.n === 3 && wa.watchDigestSql(LIVE, { id: 3, role: 'user' }).split(/\n\s*UNION ALL\s+/i).length === 5
      && c.sql.some(s => (s.match(/\bUNION ALL\b/g) || []).length === 4), `${c.n}`);
    check('...an Open For flag set and a listed idea outline in a watched ZIP show with the libs\' own labels and the #ideas link; private, unlisted and the viewer\'s own rows don\'t',
      of.length === 1 && of[0].id === 1 && of[0].text === `Open For: ${ofLib.openForDigestLabel('rural_land')} in ZIP 91915` && of[0].href === '/app#ideas'
      && ol.length === 1 && ol[0].id === 1 && ol[0].text === `Idea outline: ${doLib.dealOutlineDigestLabel('rv_boat')} in ZIP 91915` && ol[0].href === '/app#ideas'
      && ![...of, ...ol].some(i => /\$|\d+ new|hot|popular|best|great|deal/i.test(i.text)), JSON.stringify([...of, ...ol]));
    r = await call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', 3, {}, undefined, SHIP);
    check('...as shipped a member sees neither (both tools are admin-only)', !r.json.items.some(i => i.kind === 'open_for' || i.kind === 'deal_outline'));
    run('DELETE FROM open_for'); run('DELETE FROM deal_outlines');
  }
  // 45 new listings in the ZIP: each term is capped at 20, the list at 40.
  for (let i = 0; i < 45; i++) L(1000 + i, 2, { zip: '91915' });
  for (let i = 0; i < 25; i++) P(2000 + i, 2, { zip: '91915' });
  r = await call(digestApi.onRequestGet, 'GET', '/api/watch-areas/digest', 3);
  check('each term brings at most 20 rows and the list is capped at 40', r.json.items.length === 40 && r.json.items.filter(i => i.kind === 'listing').length <= 20 && r.json.items.filter(i => i.kind === 'pre_listing').length <= 20,
    `${r.json.items.length}`);
  run('DELETE FROM listings WHERE id BETWEEN 1000 AND 1999'); run('DELETE FROM pre_listings WHERE id BETWEEN 2000 AND 2999');
  check('pull only: the digest files send no email, push or notification', !/notifyAndMaybeEmail|sendPush|INSERT INTO notifications/.test(src('functions/api/watch-areas/digest.js')));
}

// ================= 11. Standing interest: posting =================
const interest = (who, body, env = LIVE) => call(interestsApi.onRequestPost, 'POST', '/api/standing-interests', who, {}, body, env);
const okBody = { target: { kind: 'area', zip: '91915' }, amount: 850000, propertyType: 'Condo', minBeds: 3, financing: 'either', timing: '6_months', ack: true };
{
  check('the written lines', si.STANDING_LABEL === 'Not an offer to purchase.'
    && si.STANDING_LINE === "Standing interest tells an owner what you'd consider. It isn't an offer, it doesn't bind you or the owner, and it is never shown publicly."
    && si.STANDING_ACK === "I understand this is not an offer to purchase and doesn't bind me or any owner."
    && si.STANDING_NOTICE === 'A member posted standing interest that reaches you: for your ZIP code, your street or your pre-listing. It is not an offer to purchase.'
    && si.STANDING_AGENT_ERROR === 'Standing interest is for buyers posting for themselves. Agents reach owners through price opinions and proposals.'
    && si.HOME_CLAIM_ACK === "I own a home on this street. I understand Amico Haus doesn't check this."
    && si.STANDING_DAYS === 90 && si.MAX_STANDING === 5 && si.MAX_HOME_CLAIMS === 2);
  const listingsLib = await mod('functions/_lib/listings.js');
  check('the home types are the trade listing types', JSON.stringify(si.STANDING_PROPERTY_TYPES) === JSON.stringify(listingsLib.PROPERTY_TYPES));
  const textCols = (t) => q(`PRAGMA table_info(${t})`).filter(c => c.type === 'TEXT').map(c => c.name);
  check('standing_interests has no free-text column (only fixed choices, dates and the street label)', JSON.stringify(textCols('standing_interests')) === '["target_kind","zip","street_key","street_label","property_type","financing","timing","status","expires_at","created_at","updated_at"]', textCols('standing_interests').join());

  // Homes the interest can reach in 91915: owner 1 has an active listing (hsId) there, owner 2 has listings and an open pre-listing (300).
  run("INSERT INTO home_claims (id, user_id, zip, street_key, street_label) VALUES (1, 11, '91915', 'la vida ct', 'La Vida Ct')");
  run("DELETE FROM notifications");
  const sentBefore = sent.length;
  let c = await counted(() => interest(10, { ...okBody, note: 'We are a young family and love your home', message: 'call me', name: 'Buyer Ten', userNote: 'x' }));
  const row = one('SELECT * FROM standing_interests WHERE user_id = 10');
  check('POST: 201, private no-store, 4 statements + the session (guard, claim, write, notice)', c.r.status === 201 && noStore(c.r) && c.n === 5 && !!row, `${c.n} ${c.r.text}`);
  check('...the row holds the terms and nothing else: unknown keys in the body are ignored', row.amount === 850000 && row.property_type === 'Condo' && row.min_beds === 3 && row.financing === 'either' && row.timing === '6_months'
    && row.target_kind === 'area' && row.zip === '91915' && row.street_key === '' && row.status === 'active' && !JSON.stringify(row).includes('young family') && !JSON.stringify(row).includes('call me'), JSON.stringify(row));
  check('...it runs 90 days', row.expires_at > ago('+89 days') && row.expires_at <= ago('+90 days'), row.expires_at);
  const told = q("SELECT user_id, body, link, emailed_at FROM notifications WHERE type = 'standing_interest'");
  check('a ZIP interest reaches claim, pre-listing and listing owners in that ZIP: one in-app notice each, never the poster',
    told.map(n => n.user_id).sort((a, b) => a - b).join() === '1,2,3,11' && told.every(n => n.body === si.STANDING_NOTICE && n.link === '/app#standing-interests' && n.emailed_at === null), JSON.stringify(told.map(n => n.user_id)));
  check('...the notice INSERT is one statement over 3 UNION terms, in-app only, and no admin alert exists in these files', c.sql.filter(s => /INSERT INTO notifications/.test(s)).length === 1
    && (c.sql.find(s => /INSERT INTO notifications/.test(s)).match(/\bUNION\b/g) || []).length === 2
    && ['functions/_lib/standingInterest.js', 'functions/api/standing-interests/index.js', 'functions/api/standing-interests/[id].js', 'functions/api/standing-interests/[id]/reply.js',
      'functions/api/home-claims/index.js', 'functions/api/home-claims/[id].js'].every(f => !/alertAdmin|adminAlerts|notifyAndMaybeEmail\(/.test(src(f))));
  check('...nothing was emailed', sent.length === sentBefore);

  // A second interest in the same ZIP the same day: owners already told today get no second notice.
  let r = await interest(13, { ...okBody, amount: 900000 });
  check('the owner notice is capped at 1 a day', r.status === 201 && one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'standing_interest'").n === 4);
  run("UPDATE notifications SET created_at = datetime('now', '-2 days') WHERE type = 'standing_interest'");

  // The same target again updates and renews the row; no second row, no new notice.
  run("UPDATE standing_interests SET expires_at = datetime('now', '+5 days') WHERE user_id = 10");
  r = await interest(10, { ...okBody, amount: 870000, financing: 'cash' });
  const rows10 = q('SELECT * FROM standing_interests WHERE user_id = 10');
  check('the same target again updates the row and renews it (no second row, no new notice)', r.status === 201 && r.json.renewed === true && rows10.length === 1 && rows10[0].amount === 870000 && rows10[0].financing === 'cash'
    && rows10[0].expires_at > ago('+89 days') && one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'standing_interest' AND created_at > datetime('now', '-1 day')").n === 0, r.text);

  // A street interest reaches only that street's claimers.
  r = await interest(10, { ...okBody, target: { kind: 'area', zip: '91915', street: 'La Vida Court' } });
  const street = one("SELECT street_key, street_label FROM standing_interests WHERE user_id = 10 AND street_key != ''");
  check('a street interest is stored by street name (label + key)', r.status === 201 && street.street_key === 'la vida ct' && street.street_label === 'La Vida Court', r.text);
  check('...and its notice reaches only that street\'s claimer', q("SELECT user_id FROM notifications WHERE type = 'standing_interest' AND created_at > datetime('now', '-1 day')").map(n => n.user_id).join() === '11');
  run("UPDATE notifications SET created_at = datetime('now', '-2 days') WHERE type = 'standing_interest'");

  // A pre-listing target.
  r = await interest(10, { ...okBody, target: { kind: 'pre_listing', id: 300 }, amount: 800000 });
  check('a pre-listing interest reaches that owner only', r.status === 201 && one("SELECT pre_listing_id AS p FROM standing_interests WHERE target_kind = 'pre_listing' AND user_id = 10").p === 300
    && q("SELECT user_id FROM notifications WHERE type = 'standing_interest' AND created_at > datetime('now', '-1 day')").map(n => n.user_id).join() === '2', r.text);
  P(310, 10); P(311, 2, { status: 'closed' }); P(312, 15); P(313, 14); P(314, 1); P(315, 2, { until: ago('+1 day'), zip: '91902' });
  const notThere = [];
  for (const [id, why] of [[310, 'own'], [311, 'not open'], [312, 'suspended owner'], [313, 'demo owner'], [999, 'missing'], [315, 'teaser held back by a head start the poster does not watch']]) {
    r = await interest(10, { ...okBody, target: { kind: 'pre_listing', id } });
    if (r.status !== 404 || r.json.error !== 'Home not found.') notThere.push(`${why}: ${r.status} ${r.text}`);
  }
  r = await interest(7, { ...okBody, target: { kind: 'pre_listing', id: 314 } });
  if (r.status !== 404 || r.json.error !== 'Home not found.') notThere.push(`blocked: ${r.status}`);
  check('a pre-listing the poster can\'t see (own, not open, suspended or demo owner, missing, blocked, or its teaser held back) -> 404 "Home not found."', notThere.length === 0, notThere.join(' | '));

  // Refusals.
  const bad = [];
  const expect = async (label, who, body, status, error) => { const x = await interest(who, body); if (x.status !== status || (error && x.json.error !== error)) bad.push(`${label}: ${x.status} ${x.text}`); };
  await expect('approved agent', 6, okBody, 403, si.STANDING_AGENT_ERROR);
  await expect('pending agent application', 12, okBody, 403, si.STANDING_AGENT_ERROR);
  await expect('ack missing', 13, { ...okBody, target: { kind: 'area', zip: '91913' }, ack: undefined }, 400, 'Tick the box to post your standing interest.');
  await expect('ack "yes"', 13, { ...okBody, target: { kind: 'area', zip: '91913' }, ack: 'yes' }, 400, 'Tick the box to post your standing interest.');
  await expect('amount too low', 13, { ...okBody, amount: 49999 }, 400, si.STANDING_AMOUNT_ERROR);
  await expect('amount too high', 13, { ...okBody, amount: 50000001 }, 400, si.STANDING_AMOUNT_ERROR);
  await expect('amount with cents', 13, { ...okBody, amount: 850000.5 }, 400, si.STANDING_AMOUNT_ERROR);
  await expect('unknown home type', 13, { ...okBody, propertyType: 'Castle' }, 400);
  await expect('beds 7', 13, { ...okBody, minBeds: 7 }, 400);
  await expect('financing "fha only"', 13, { ...okBody, financing: 'fha only' }, 400);
  await expect('timing "asap"', 13, { ...okBody, timing: 'asap' }, 400);
  await expect('unknown ZIP', 13, { ...okBody, target: { kind: 'area', zip: '00000' } }, 400, "We don't know that ZIP code.");
  await expect('bad ZIP', 13, { ...okBody, target: { kind: 'area', zip: '9191' } }, 400);
  await expect('no target', 13, { ...okBody, target: undefined }, 400);
  await expect('street with a house number', 13, { ...okBody, target: { kind: 'area', zip: '91915', street: '1218 La Vida Ct' } }, 400, it.HOUSE_NUMBER_ERROR);
  await expect('street with a number at the end', 13, { ...okBody, target: { kind: 'area', zip: '91915', street: 'La Vida Ct 1218' } }, 400, it.HOUSE_NUMBER_ERROR);
  await expect('street "near the school"', 13, { ...okBody, target: { kind: 'area', zip: '91915', street: 'near the school' } }, 400, ht.STEERING_ERROR);
  await expect('signed out', null, okBody, 401);
  check('refused: agents (any application status), no acknowledgment, an amount outside $50,000 to $50,000,000 or with cents, unknown choices, unknown ZIP, a house number, "near the school", signed out', bad.length === 0, bad.join(' | '));
  check('...the agent answer carries the code interest_not_for_agents', (await interest(6, okBody)).json.code === 'interest_not_for_agents');
  check('"5th Avenue" is a street name and passes', si.validateStreet('5th Avenue').key === '5th ave' && si.validateStreet('').key === '' && si.validateStreet('  Paseo   del Rey ').label === 'Paseo del Rey');

  // 5 at a time.
  run("DELETE FROM user_action_log WHERE kind = 'standing_interest'");
  for (const z of ['91913', '91910']) await interest(10, { ...okBody, target: { kind: 'area', zip: z } });
  const n10 = one("SELECT COUNT(*) AS n FROM standing_interests WHERE user_id = 10 AND status = 'active'").n;
  r = await interest(10, { ...okBody, target: { kind: 'area', zip: '91902' } });
  check('the 6th active interest is refused', n10 === 5 && r.status === 400 && r.json.error === si.STANDING_MAX_ERROR && one("SELECT COUNT(*) AS n FROM standing_interests WHERE user_id = 10").n === 5, `${n10} ${r.text}`);
  r = await interest(10, { ...okBody, amount: 880000 });
  check('...editing one of the five still works', r.status === 201 && one("SELECT amount FROM standing_interests WHERE user_id = 10 AND zip = '91915' AND street_key = ''").amount === 880000, r.text);
  run("DELETE FROM user_action_log WHERE kind = 'standing_interest'");
  for (let i = 0; i < 5; i++) run("INSERT INTO user_action_log (user_id, kind) VALUES (10, 'standing_interest')");
  r = await interest(10, { ...okBody, amount: 890000 });
  check('a 6th post in a day is rate-limited', r.status === 429 && r.json.code === 'rate_limited');
  run("DELETE FROM user_action_log WHERE kind = 'standing_interest'");
}

// ================= 12. Standing interest: the poster's own list, renew, withdraw =================
{
  let c = await counted(() => call(interestsApi.onRequestGet, 'GET', '/api/standing-interests', 10));
  const mine = c.r.json.interests;
  check('GET /api/standing-interests (mine): my five with target, terms, the line, the label and when each ends; 1 statement + the session', c.r.status === 200 && noStore(c.r) && c.n === 2 && mine.length === 5 && c.r.json.max === 5
    && mine.every(i => i.label === 'Not an offer to purchase.' && i.line.startsWith('About $') && !!i.expiresAt && i.expired === false), c.r.text.slice(0, 300));
  const zipOne = mine.find(i => i.target.kind === 'area' && i.target.zip === '91915' && !i.target.street);
  check('...the line reads "About $880,000 · Condo · 3+ bedrooms · cash or financed · within 6 months"', zipOne.line === 'About $880,000 · Condo · 3+ bedrooms · cash or financed · within 6 months', zipOne.line);
  const noticesBefore = one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'standing_interest'").n;
  check('standingLine: "Any home type", no bedrooms part at 0, the three financing and four timing wordings',
    si.standingLine({ amount: 1250000, property_type: 'Any', min_beds: 0, financing: 'either', timing: 'flexible' }) === 'About $1,250,000 · Any home type · cash or financed · flexible on timing'
    && si.standingLine({ amount: 500000, property_type: 'Condo', min_beds: 2, financing: 'financed', timing: '3_months' }) === 'About $500,000 · Condo · 2+ bedrooms · financed · within 3 months'
    && si.STANDING_TIMING['12_months'] === 'within 12 months' && si.STANDING_FINANCING.cash === 'cash');
  run("UPDATE standing_interests SET expires_at = datetime('now', '+3 days') WHERE id = ?", zipOne.id);
  let r = await call(interestOne.onRequestPut, 'PUT', `/api/standing-interests/${zipOne.id}`, 13, { id: String(zipOne.id) }, { renew: true });
  check('PUT { renew: true } on someone else\'s interest: 404', r.status === 404 && one('SELECT expires_at AS e FROM standing_interests WHERE id = ?', zipOne.id).e < ago('+4 days'));
  r = await call(interestOne.onRequestPut, 'PUT', `/api/standing-interests/${zipOne.id}`, 10, { id: String(zipOne.id) }, { renew: true });
  check('...on my own: another 90 days, and nobody is notified again', r.status === 200 && noStore(r) && one('SELECT expires_at AS e FROM standing_interests WHERE id = ?', zipOne.id).e > ago('+89 days')
    && one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'standing_interest'").n === noticesBefore, r.text);
  r = await call(interestOne.onRequestPut, 'PUT', `/api/standing-interests/${zipOne.id}`, 10, { id: String(zipOne.id) }, { amount: 1 });
  check('...PUT changes nothing but the end date', r.status === 400 && one('SELECT amount FROM standing_interests WHERE id = ?', zipOne.id).amount === 880000);
  const other = mine.find(i => i.target.zip === '91910');
  r = await call(interestOne.onRequestDelete, 'DELETE', `/api/standing-interests/${other.id}`, 13, { id: String(other.id) });
  check('DELETE on someone else\'s interest: 404', r.status === 404 && one('SELECT status FROM standing_interests WHERE id = ?', other.id).status === 'active');
  r = await call(interestOne.onRequestDelete, 'DELETE', `/api/standing-interests/${other.id}`, 10, { id: String(other.id) });
  check('...on my own: withdrawn (the row stays for the export, gone from the lists)', r.status === 200 && one('SELECT status FROM standing_interests WHERE id = ?', other.id).status === 'withdrawn'
    && !(await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests', 10)).json.interests.some(i => i.id === other.id));
}

// ================= 13. Standing interest: what an owner sees =================
{
  // Now active for buyer 10: ZIP 91915 ($880,000), street La Vida Ct in 91915, pre-listing 300, ZIP 91913. Buyer 13: ZIP 91915 ($900,000).
  const owner = (who, env = LIVE) => call(interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', who, {}, undefined, env);
  let c = await counted(() => owner(2));
  const list2 = c.r.json.interests;
  check('?for=owner, an owner with a pre-listing and listings in the ZIP: ONE statement + the session, private no-store', c.r.status === 200 && noStore(c.r) && c.n === 2, `${c.n}`);
  check('...they see the two ZIP interests and the one on their pre-listing; not the street one (they claimed no street) and not another ZIP',
    list2.map(i => i.reach).sort().join() === 'home,zip,zip' && list2.every(i => i.where === 'Your pre-listing' || i.where === 'ZIP 91915'), JSON.stringify(list2.map(i => [i.reach, i.where])));
  check('...each row has only the terms, how it reaches them, the label, when it was posted and canReply',
    list2.every(i => JSON.stringify(Object.keys(i)) === '["id","reach","where","amount","propertyType","minBeds","financing","timing","line","label","postedAt","canReply"]'), JSON.stringify(Object.keys(list2[0])));
  check('...never the member: no user_id, poster id, display name, email, profile link or text they typed',
    !/user_id|userId|poster|display_name|displayName|email|\/profile\/|User 10|User 13|u10@|u13@|La Vida/i.test(c.r.text), c.r.text.slice(0, 400));
  check('...STANDING_LABEL on every row, and the list is by time (newest first), not by amount',
    list2.every(i => i.label === 'Not an offer to purchase.') && list2.every((i, n) => n === 0 || String(list2[n - 1].postedAt) >= String(i.postedAt))
    && /ORDER BY si\.created_at DESC, si\.id DESC/.test(src('functions/_lib/standingInterest.js')) && !/ORDER BY[^`]*amount/i.test(src('functions/_lib/standingInterest.js')));
  // Highest-first would put 900,000 before 880,000; time order has buyer 10's renewed row where its posting time puts it.
  run("UPDATE standing_interests SET created_at = datetime('now', '-3 days') WHERE user_id = 13");
  const order = (await owner(2)).json.interests.filter(i => i.reach === 'zip').map(i => i.amount);
  check('...an older, higher interest sits below a newer, lower one', order.join() === '880000,900000', order.join());
  const list11 = (await owner(11)).json.interests;
  check('an owner who claimed that street sees the street interest ("Your street in ZIP 91915") and the ZIP ones', list11.map(i => i.reach).sort().join() === 'street,zip,zip'
    && list11.find(i => i.reach === 'street').where === 'Your street in ZIP 91915', JSON.stringify(list11.map(i => i.where)));
  const list1 = (await owner(1)).json.interests;
  check('an owner with an active trade listing in the ZIP sees the ZIP interests only', list1.length === 2 && list1.every(i => i.reach === 'zip'));
  check('a member it does not reach sees nothing (no home there), and so does the poster', (await owner(4)).json.interests.length === 0 && (await owner(10)).json.interests.every(i => i.amount === 900000));
  check('signed out: 401; nothing here is public', (await owner(null)).status === 401 && (await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests', null)).status === 401);
  // Agents never browse it, even with a home in the ZIP.
  L(400, 6, { zip: '91915' }); run("INSERT INTO home_claims (user_id, zip, street_key, street_label) VALUES (12, '91915', '', '')");
  check('an account with an agent profile (approved or pending) gets an empty list, even with a home in the ZIP', (await owner(6)).json.interests.length === 0 && (await owner(12)).json.interests.length === 0);
  run('DELETE FROM listings WHERE id = 400'); run('DELETE FROM home_claims WHERE user_id = 12');
  // Blocked, suspended, demo, expired, withdrawn.
  run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (13, 2)');
  check('a block either way hides the interest from that owner', (await owner(2)).json.interests.every(i => i.amount !== 900000) && (await owner(1)).json.interests.some(i => i.amount === 900000));
  run('DELETE FROM user_blocks WHERE blocker_id = 13');
  run("UPDATE users SET status = 'suspended' WHERE id = 13");
  check('a suspended poster\'s interest is gone', (await owner(1)).json.interests.every(i => i.amount !== 900000));
  run("UPDATE users SET status = 'active' WHERE id = 13");
  run("INSERT INTO standing_interests (user_id, target_kind, zip, amount, expires_at) VALUES (9, 'area', '91915', 999000, datetime('now', '+30 days'))");
  check('a demo poster\'s interest is never shown', (await owner(1)).json.interests.every(i => i.amount !== 999000));
  run("UPDATE standing_interests SET expires_at = datetime('now', '-1 minute') WHERE user_id = 13");
  check('an expired interest is gone', (await owner(1)).json.interests.every(i => i.amount !== 900000));
  run("UPDATE standing_interests SET expires_at = datetime('now', '+30 days'), status = 'withdrawn' WHERE user_id = 13");
  check('a withdrawn interest is gone', (await owner(1)).json.interests.every(i => i.amount !== 900000));
  run("UPDATE standing_interests SET status = 'active' WHERE user_id = 13");
  // The notice never goes to a blocked, suspended, demo or agent owner.
  run("DELETE FROM notifications"); run("DELETE FROM standing_interests WHERE user_id = 13");
  run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (2, 13)');
  L(401, 14, { zip: '91915' }); L(402, 15, { zip: '91915' }); L(403, 6, { zip: '91915' }); L(404, 4, { zip: '91915', rental: 1 }); L(405, 4, { zip: '91915', buyerOnly: 1 }); L(406, 4, { zip: '91915', status: 'paused' });
  let r = await interest(13, okBody);
  check('the notice reaches nobody blocked (2), suspended (15) or demo (14), no agent (6), and no owner of only a rental, a buyer profile or a paused listing (4)',
    r.status === 201 && q("SELECT user_id FROM notifications WHERE type = 'standing_interest'").map(n => n.user_id).sort((a, b) => a - b).join() === '1,3,10,11', JSON.stringify(q("SELECT user_id FROM notifications")));
  run('DELETE FROM user_blocks WHERE blocker_id = 2'); run('DELETE FROM listings WHERE id BETWEEN 401 AND 406');
  run("DELETE FROM notifications"); run("DELETE FROM standing_interests WHERE user_id = 13"); run("DELETE FROM user_action_log WHERE kind = 'standing_interest'");
  r = await interest(13, okBody, SHIP);
  check('as shipped: a member can\'t post (404)', r.status === 404);
  run("UPDATE users SET role = 'admin' WHERE id = 13");
  r = await interest(13, okBody, SHIP);
  check('as shipped: an admin can post, and only admin owners are told (no member hears about a tool they can\'t open)', r.status === 201 && one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'standing_interest'").n === 0, r.text);
  run("UPDATE users SET role = 'user' WHERE id = 13");
  run("DELETE FROM notifications");
}

// ================= 14. Replying =================
{
  const zip10 = one("SELECT id FROM standing_interests WHERE user_id = 10 AND target_kind = 'area' AND zip = '91915' AND street_key = ''").id;
  const street10 = one("SELECT id FROM standing_interests WHERE user_id = 10 AND street_key = 'la vida ct'").id;
  const pl10 = one("SELECT id FROM standing_interests WHERE user_id = 10 AND target_kind = 'pre_listing'").id;
  const other10 = one("SELECT id FROM standing_interests WHERE user_id = 10 AND zip = '91913'").id;
  const reply = (who, id, message, env = LIVE) => call(replyApi.onRequestPost, 'POST', `/api/standing-interests/${id}/reply`, who, { id: String(id) }, { message }, env);
  let r = await reply(4, zip10, 'Hello');
  check('a member the interest does not reach can\'t reply: 404, the same as an interest that isn\'t there', r.status === 404 && (await reply(1, 99999, 'Hello')).status === 404 && (await reply(1, other10, 'Hello')).status === 404);
  r = await reply(1, street10, 'Hello');
  check('a street interest can be answered only by an owner who claimed that street', r.status === 404);
  r = await reply(6, zip10, 'Hello');
  const pending = await reply(12, zip10, 'Hello');
  check('an agent can\'t reply: "Agents can\'t reply to standing interest."', r.status === 403 && r.json.error === "Agents can't reply to standing interest." && pending.status === 403, `${r.status} ${r.text}`);
  check('a reply is 1 to 1,000 characters', (await reply(1, zip10, '')).status === 400 && (await reply(1, zip10, '   ')).status === 400 && (await reply(1, zip10, 'x'.repeat(1001))).status === 400);
  r = await reply(1, zip10, 'We have kids in the school nearby, a perfect family home');
  check('a reply goes through the fair-housing text check', r.status === 400 && r.json.error === ht.STEERING_ERROR, r.text);
  check('...none of those refusals used up the one reply', one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'interest_reply'").n === 0);
  const c = await counted(() => reply(1, zip10, 'We could talk about a spring closing.'));
  const convo = one('SELECT id FROM conversations WHERE user_a_id = 1 AND user_b_id = 10');
  const msg = convo ? one('SELECT sender_id, body FROM messages WHERE conversation_id = ?', convo.id) : null;
  check('an owner it reaches replies: 201, private no-store; an ordinary message in a conversation with the member', c.r.status === 201 && noStore(c.r) && !!convo && c.r.json.conversationId === convo.id
    && msg.sender_id === 1 && msg.body === 'About your standing interest (ZIP 91915): We could talk about a spring closing.', `${c.r.status} ${c.r.text}`);
  check('...the member is told through the existing message path ("New message from User 1")', !!one("SELECT 1 AS x FROM notifications WHERE user_id = 10 AND body = 'New message from User 1' AND link = ?", `/app#messages-${convo.id}`));
  check(`...${c.n} statements with the session and the message notice (about 6 + the existing message notice)`, c.n <= 10, String(c.n));
  r = await reply(1, zip10, 'One more thing');
  check('a second reply by the same owner to the same interest is refused (429 rate_limited), and no second message is stored', r.status === 429 && r.json.code === 'rate_limited' && one('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?', convo.id).n === 1);
  check('...the owner\'s list now says canReply false for that interest only', (await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', 1)).json.interests.find(i => i.id === zip10).canReply === false
    && (await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', 2)).json.interests.find(i => i.id === zip10).canReply === true);
  r = await reply(11, street10, 'Our street is quiet in the evenings.');
  check('the street reply names the street the member typed', r.status === 201 && one('SELECT body FROM messages WHERE sender_id = 11').body === 'About your standing interest (La Vida Court, ZIP 91915): Our street is quiet in the evenings.', r.text);
  r = await reply(2, pl10, 'Happy to share more.');
  check('the pre-listing reply says "this pre-listing"', r.status === 201 && one('SELECT body FROM messages WHERE sender_id = 2').body === 'About your standing interest (this pre-listing): Happy to share more.');
  run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (10, 2)');
  r = await reply(2, zip10, 'Hello again');
  check('a blocked pair: 404, the same as "not there"', r.status === 404);
  run('DELETE FROM user_blocks WHERE blocker_id = 10');
  for (let i = 0; i < 10; i++) run("INSERT INTO user_action_log (user_id, kind, ref) VALUES (2, 'interest_reply', ?)", `standing_interest:x${i}`);
  r = await reply(2, zip10, 'Hello');
  check('the 11th reply in a day is rate-limited', r.status === 429);
  r = await reply(2, zip10, 'Hello', SHIP);
  check('as shipped: a member can\'t reply (404)', r.status === 404);
  check('the reply box copy: the display-name line and the offer note', clientSrc.includes('Replying shows the member your display name and starts a conversation in Messages.')
    && clientSrc.includes('Stick to price, terms and timing. Leave out personal details like family, religion, age or background.') && si.STANDING_REPLY_NAME_LINE === 'Replying shows the member your display name and starts a conversation in Messages.');
}

// ================= 15. Home claims =================
{
  const claim = (who, body, env = LIVE) => call(claimsApi.onRequestPost, 'POST', '/api/home-claims', who, {}, body, env);
  const cols = q('PRAGMA table_info(home_claims)').map(c => c.name);
  check('home_claims holds a ZIP and a street name only (no address, no house number, no "verified" column)', JSON.stringify(cols) === '["id","user_id","zip","street_key","street_label","created_at"]');
  let c = await counted(() => claim(4, { zip: '91913', street: 'Paseo del Rey', ack: true, address: '12 Paseo del Rey', verified: true }));
  const row = one('SELECT * FROM home_claims WHERE user_id = 4');
  check('POST /api/home-claims: 201, private no-store, 3 statements + the session; only the ZIP and the street name are kept', c.r.status === 201 && noStore(c.r) && c.n === 4
    && row.zip === '91913' && row.street_label === 'Paseo del Rey' && row.street_key === 'paseo del rey' && !JSON.stringify(row).includes('12 Paseo'), `${c.n} ${c.r.text}`);
  const bad = [];
  const expect = async (label, who, body, status, error) => { const x = await claim(who, body); if (x.status !== status || (error && x.json.error !== error)) bad.push(`${label}: ${x.status} ${x.text}`); };
  await expect('agent', 6, { zip: '91913', ack: true }, 403, 'Home claims are for homeowners.');
  await expect('pending agent', 12, { zip: '91913', ack: true }, 403, 'Home claims are for homeowners.');
  await expect('no ack', 4, { zip: '91915' }, 400, si.HOME_CLAIM_ACK_ERROR);
  await expect('unknown ZIP', 4, { zip: '00000', ack: true }, 400, "We don't know that ZIP code.");
  await expect('house number', 4, { zip: '91915', street: '1218 La Vida Ct', ack: true }, 400, it.HOUSE_NUMBER_ERROR);
  await expect('steering', 4, { zip: '91915', street: 'by the church', ack: true }, 400, ht.STEERING_ERROR);
  await expect('duplicate', 4, { zip: '91913', street: 'Paseo Del Rey.', ack: true }, 400, si.HOME_CLAIM_DUPLICATE_ERROR);
  await expect('signed out', null, { zip: '91915', ack: true }, 401);
  check('refused: agents, no acknowledgment, an unknown ZIP, a house number, a line about the area, the same street twice, signed out', bad.length === 0, bad.join(' | '));
  check('...a refusal before the write never uses up one of the 3 changes a month', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 4 AND kind = 'home_claim'").n === 1);
  let r = await claim(4, { zip: '91915', ack: true });
  check('a ZIP-only claim is fine (2 at most)', r.status === 201 && one('SELECT COUNT(*) AS n FROM home_claims WHERE user_id = 4').n === 2);
  r = await claim(4, { zip: '91910', ack: true });
  check('a 3rd claim is refused', r.status === 400 && r.json.error === si.HOME_CLAIM_MAX_ERROR && one('SELECT COUNT(*) AS n FROM home_claims WHERE user_id = 4').n === 2, r.text);
  r = await call(claimsApi.onRequestGet, 'GET', '/api/home-claims', 4);
  check('GET /api/home-claims: my own, { id, zip, street }, max 2', r.status === 200 && noStore(r) && r.json.max === 2 && r.json.claims.length === 2 && JSON.stringify(Object.keys(r.json.claims[0])) === '["id","zip","street"]', r.text);
  check('...a claim makes ZIP interest reach its owner', (await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', 4)).json.interests.some(i => i.reach === 'zip' && i.where === 'ZIP 91915'));
  const cid = r.json.claims[0].id;
  r = await call(claimOne.onRequestDelete, 'DELETE', `/api/home-claims/${cid}`, 11, { id: String(cid) });
  check('DELETE /api/home-claims/:id: someone else\'s is a 404', r.status === 404 && !!one('SELECT 1 AS x FROM home_claims WHERE id = ?', cid));
  r = await call(claimOne.onRequestDelete, 'DELETE', `/api/home-claims/${cid}`, 4, { id: String(cid) });
  check('...my own is removed', r.status === 200 && !one('SELECT 1 AS x FROM home_claims WHERE id = ?', cid));
  run("DELETE FROM user_action_log WHERE kind = 'home_claim'");
  for (let i = 0; i < 3; i++) run("INSERT INTO user_action_log (user_id, kind) VALUES (4, 'home_claim')");
  r = await claim(4, { zip: '91902', ack: true });
  check('a 4th claim change in 30 days is rate-limited', r.status === 429);
  const everywhere = ['functions/api/directory.js', 'functions/listing/[id].js', 'functions/profile/[id].js', 'functions/api/pre-listings/index.js', 'functions/api/pre-listings/[id].js', 'functions/api/matches.js', 'functions/api/search.js']
    .filter(f => /home_claims|standing_interests/.test(src(f)));
  check('a claim and an interest show on no page, card, profile or search (only these routes and the export read the tables)', everywhere.length === 0, everywhere.join());
  check('nothing here calls a claim verified or a claimed home', !/verified home|claimed home|Verified|verified owner/.test(clientSrc) && !/'[^']*\b(verified|claimed home)\b[^']*'/i.test(src('functions/_lib/standingInterest.js').replace(/^\s*\/\/.*$/gm, '')));
}

// ================= 16. Deleting an account or a home takes the rows with it =================
{
  const before = one('SELECT (SELECT COUNT(*) FROM standing_interests WHERE user_id = 10) AS si, (SELECT COUNT(*) FROM watch_areas WHERE user_id = 10) AS w').si;
  run('DELETE FROM pre_listings WHERE id = 300');
  check('deleting a pre-listing removes the interest posted on it', before >= 1 && !one("SELECT 1 AS x FROM standing_interests WHERE target_kind = 'pre_listing' AND pre_listing_id = 300"));
  run('DELETE FROM users WHERE id = 10');
  check('deleting an account removes its watch areas, standing interest and home claims',
    one('SELECT (SELECT COUNT(*) FROM standing_interests WHERE user_id = 10) + (SELECT COUNT(*) FROM watch_areas WHERE user_id = 10) + (SELECT COUNT(*) FROM home_claims WHERE user_id = 10) AS n').n === 0);
}

// ================= 17. The client script =================
{
  const code = clientSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('neighbors.js never reads the visitor\'s location', !/geolocation|getCurrentPosition|watchPosition/.test(code));
  const fetches = [...code.matchAll(/\bfetch\(/g)].length;
  const apiPaths = [...code.matchAll(/api(?:Get|Post|Put|Delete)\(\s*[`'"]([^`'"$]*)/g)].map(m => m[1]).concat([...code.matchAll(/nbGet\(\s*'([^']*)'/g)].map(m => m[1]));
  check('...and calls only this site\'s /api/ routes (no fetch of its own, no outside URL)', fetches === 0 && apiPaths.length >= 10 && apiPaths.every(p => p.startsWith('/api/')) && !/https?:\/\//.test(code), apiPaths.filter(p => !p.startsWith('/api/')).join());
  // Every ${...} put into markup is escaped, a number, a fixed option, or another builder's markup.
  const SAFE = /^(escapeHtml\(|Number\(|nb[A-Z]\w*\(|NB_HEAD_START_HOURS\.map|chips\b|form\b|photo\b|agree\b|items\b|rows\b|mine\b|where\b|data\b|k\b|h\b|label\b|id\b|parts\.join|options\.map|Object\.entries\(NB_TRIAL_CHECKLIST\)|attrs\b|inApp \?|isListing \?|oneId|t && t\.kind === 'pre_listing' \?|t\.status === 'canceled' \?|t\.longStay \?|i\.canReply \?|h\.description \?|h\.wants \?|chips \?|mine \?|rows \?|items \?|nbState\.early\.map|nbTrials\.map|nbToday\(\)|String\(v\) === String\(selected\))/;
  const markup = [...code.matchAll(/`(?:[^`\\]|\\.)*`/g)].map(m => m[0]).filter(s => /<\w/.test(s));
  const loose = [];
  for (const tpl of markup) {
    let depth = 0, start = -1;
    for (let i = 0; i < tpl.length; i++) {
      if (tpl[i] === '$' && tpl[i + 1] === '{' && depth === 0) { depth = 1; start = i + 2; i++; continue; }
      if (depth > 0 && tpl[i] === '{') depth++;
      if (depth > 0 && tpl[i] === '}') { depth--; if (depth === 0) { const expr = tpl.slice(start, i).trim(); if (!SAFE.test(expr)) loose.push(expr.slice(0, 60)); } }
    }
  }
  check('...no user text reaches innerHTML without escapeHtml (every value in markup is escaped, a number or fixed copy)', loose.length === 0, loose.join(' | '));
  check('...no inline style, inline handler or script tag in its markup', !/\sstyle=|\son[a-z]+=|<script/i.test(markup.join('\n')));
  check('...every label has for= and every listener is delegated with data-action="nb-..."', (code.match(/<label(?![^>]*\bfor=)/g) || []).length === 0
    && [...code.matchAll(/data-action="([^"$]+)"/g)].every(m => m[1].startsWith('nb-')) && (code.match(/addEventListener\(/g) || []).length === 3);
  check('...each part renders only when its tool is live (window.NUANCED)', /function nbLive\(tool\) \{ return !!\(window\.NUANCED && window\.NUANCED\[tool\] === true\); \}/.test(code)
    && /if \(!nbLive\('headStart'\)\) return '';/.test(code) && /if \(!nbLive\('standingOffer'\) \|\| !target\) return '';/.test(code) && /if \(!nbLive\('standingOffer'\)\) return '';/.test(code)
    && /if \(!nbLive\('testDrive'\) \|\|/.test(code) && /if \(nbLive\('standingOffer'\)\) parts\.push\(nbStandingHtml\(\)\);/.test(code));
  check('the standing-interest form copy', ['>Where</legend>', '>A ZIP code</label>', '>Street name (no house number)</label>', ">I'd consider about ($)</label>", '>Home type</label>', '>Bedrooms (at least)</label>',
    '>Cash or financed</label>', '>Timing</label>', '>Post standing interest</button>', "I'd consider about...</button>", '<h3>My home</h3>', 'Standing interest that reaches your home', '>Reply</button>']
    .every(s => clientSrc.includes(s)) && clientSrc.includes(si.STANDING_ACK) && clientSrc.includes(si.STANDING_LINE) && clientSrc.includes(si.HOME_CLAIM_ACK) && clientSrc.includes(`'${si.STANDING_LABEL}'`));
  check('...the form has no free-text field for standing interest (inputs: ZIP, street name, amount; the rest are fixed choices)', !/<textarea[^>]*id="nbInterest/.test(code)
    && [...code.matchAll(/id="(nbInterest\w+)"/g)].map(m => m[1]).sort().join() === 'nbInterestAmount,nbInterestForm,nbInterestStreet,nbInterestZip');
  check('...the owner link has no count in it', /function nbOwnerInterestsHtml\(\) \{\s+if \(!nbLive\('standingOffer'\)\) return '';\s+return '<p class="tiny"><a href="\/app#standing-interests" data-action="nb-go-interests">Standing interest that reaches your home<\/a><\/p>';/.test(clientSrc));
  check('no file of this role has a stray backspace character (a mangled \\b)', ['neighbors.js', 'functions/_lib/watchAreas.js', 'functions/_lib/standingInterest.js', 'functions/_lib/tradeTrials.js', 'functions/_lib/transactions.js',
    'functions/api/photos/[id].js', 'functions/api/watch-areas/index.js', 'functions/api/standing-interests/index.js', 'functions/api/standing-interests/[id]/reply.js'].every(f => !src(f).includes('\x08')));
  check('no file of this role mentions the people Amico Haus never mentions', ['neighbors.js', 'functions/_lib/watchAreas.js', 'functions/_lib/standingInterest.js', 'functions/_lib/tradeTrials.js', 'tools/neighbors-test.mjs']
    .every(f => !new RegExp(['McK' + 'elvey', 'Pat' + 'ti', '\\bJe' + 'ff\\b'].join('|'), 'i').test(src(f))));
}

// ================= 18. The client script, run: what it draws for each viewer =================
{
  const vm = await import('node:vm');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const boot = (tools, responses = {}) => {
    const els = new Map();
    const el = (id, more = {}) => { els.set(id, { id, innerHTML: '', value: '', checked: false, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, scrollIntoView() {}, ...more }); return els.get(id); };
    el('watchAreasPanel');
    const asked = [];
    const ctx = {
      window: { NUANCED: tools }, console, Date, Promise, Number, String, JSON, Object, Array, Math, RegExp, Map, Set,
      document: { getElementById: (id) => els.get(id) || null, addEventListener() {}, querySelectorAll: () => [], createElement: () => el('new') },
      escapeHtml: esc, toast() {}, currentUser: { id: 1 }, setTimeout: () => 1,
      apiGet: async (path) => { asked.push(path); if (!(path in responses)) throw new Error('no such route'); return responses[path]; },
      apiPost: async () => ({}), apiPut: async () => ({}), apiDelete: async () => ({}),
    };
    vm.createContext(ctx);
    vm.runInContext(clientSrc, ctx);
    return { ctx, els, el, asked };
  };
  const OFF = {};
  const SHIPPED = { watchAreas: true, headStart: false, standingOffer: false, testDrive: false };
  const ALL_ON = { watchAreas: true, headStart: true, standingOffer: true, testDrive: true };
  const future = one("SELECT datetime('now', '+1 day') AS t").t, past = one("SELECT datetime('now', '-1 day') AS t").t;
  const match = { a: { userId: 1, listingId: 10, owner: 'Me' }, b: { userId: 2, listingId: 20, owner: 'Ana <b>' }, scoreAWantsB: 80, scoreBWantsA: 80 };

  let page = boot(OFF);
  await page.ctx.loadWatchAreas();
  check('nothing live: the panel is empty, no route is called, and every mount returns nothing',
    page.els.get('watchAreasPanel').innerHTML === '' && page.asked.length === 0
    && page.ctx.nbHeadStartFieldHtml('lf', { kind: 'listing' }) === '' && page.ctx.nbHeadStartBadgeHtml({ id: 1, zip: '91915', head_start_until: future }) === ''
    && page.ctx.nbStandingInterestButtonHtml({ kind: 'pre_listing', id: 3 }) === '' && page.ctx.nbOwnerInterestsHtml() === '' && page.ctx.nbTradeTrialHtml(match) === ''
    && JSON.stringify(page.ctx.nbReadHeadStart('lf')) === '{}');

  const digest = { areas: [{ id: 1, zip: '91915', label: '<script>x</script>' }], max: 3, items: [
    { kind: 'listing', id: 200, zip: '91915', text: 'New trade listing: Townhouse in ZIP 91915', href: '/listing/200', createdAt: past },
    { kind: 'pre_listing', id: 300, zip: '91915', text: 'New pre-listing: Condo in ZIP 91915', href: '/app#pre-listing-300', createdAt: past }] };
  page = boot(SHIPPED, { '/api/watch-areas/digest': digest });
  await page.ctx.loadWatchAreas();
  let html = page.els.get('watchAreasPanel').innerHTML;
  check('as shipped, a member: one request (the digest), and the panel is watch areas + what\'s new only', page.asked.join() === '/api/watch-areas/digest'
    && html.includes('<h2>Watch areas</h2>') && html.includes(esc(wa.WATCH_OPEN_LINE)) && html.includes(esc(wa.WATCH_PRECISION_LINE)) && html.includes('What&#39;s new in your watch areas') === false
    && html.includes("What's new in your watch areas") && html.includes('>Watch this ZIP code</button>')
    && !/Standing interest|Neighbors First|My home|head start|Not an offer/i.test(html), html.slice(0, 300));
  check('...a label is escaped, the chip has Remove, an in-app link goes through the opener and a page link is a plain link',
    html.includes('91915 · &lt;script&gt;x&lt;/script&gt;') && !html.includes('<script>') && html.includes('data-action="nb-area-remove" data-id="1" aria-label="Remove ZIP 91915">Remove</button>')
    && html.includes('<a href="/listing/200">New trade listing: Townhouse in ZIP 91915</a>') && html.includes('<a href="/app#pre-listing-300" data-action="nb-open-link" data-link="/app#pre-listing-300">'), html.slice(0, 600));
  check('...and the dark mounts still return nothing for that member', page.ctx.nbHeadStartFieldHtml('lf', {}) === '' && page.ctx.nbStandingInterestButtonHtml({ kind: 'pre_listing', id: 3 }) === '' && page.ctx.nbTradeTrialHtml(match) === '');

  const full = boot(ALL_ON, {
    '/api/watch-areas/digest': { ...digest, areas: [{ id: 1, zip: '91915', label: '' }, { id: 2, zip: '91913', label: 'Work' }, { id: 3, zip: '91910', label: '' }] },
    '/api/watch-areas/early': { homes: [{ id: 7, title: 'Early <i>home</i>', city: 'Chula Vista', state: 'CA', zip: '91915', propertyType: 'Condo', beds: 2, baths: 2, sqft: 1200, estimatedValue: 750000, isRental: false,
      description: 'Bright & "sunny"', photoIds: [900], wants: { type: 'Any', locations: 'Bonita <or> Eastlake', priceMin: 0, priceMax: 2000000 }, headStartUntil: future, headStartLabel: 'Sun, Nov 15, 12:00 PM Pacific time', owner: { id: 9, name: 'Sam "O"' } }] },
    '/api/standing-interests': { max: 5, interests: [{ id: 31, target: { kind: 'area', zip: '91915', street: 'La <Vida> Ct' }, line: 'About $850,000 · Condo · cash or financed · flexible on timing', label: si.STANDING_LABEL, expiresAt: future, expired: false }] },
    '/api/standing-interests?for=owner': { interests: [
      { id: 41, reach: 'zip', where: 'ZIP 91915', line: 'About $900,000 · Any home type · cash · within 3 months', label: si.STANDING_LABEL, postedAt: past, canReply: true },
      { id: 42, reach: 'home', where: 'Your pre-listing', line: 'About $800,000 · Condo · 3+ bedrooms · financed · within 6 months', label: si.STANDING_LABEL, postedAt: past, canReply: false }] },
    '/api/home-claims': { max: 2, claims: [{ id: 5, zip: '91915', street: 'Paseo <del> Rey' }] },
  });
  await full.ctx.loadWatchAreas();
  html = full.els.get('watchAreasPanel').innerHTML;
  check('everything live: five requests, and the panel has every part in order', full.asked.sort().join() === '/api/home-claims,/api/standing-interests,/api/standing-interests?for=owner,/api/watch-areas/digest,/api/watch-areas/early'
    && ['<h2>Watch areas</h2>', '<h3>Neighbors First</h3>', "What's new in your watch areas", '>Standing interest</h2>', '<h3>My home</h3>', 'Standing interest that reaches your home</h3>'].every((s, i, all) => html.indexOf(s) > (i ? html.indexOf(all[i - 1]) : -1)), full.asked.join());
  check('...at 3 ZIP codes the add form gives way to a line', !html.includes('id="nbAreaZip"') && html.includes('You&#39;re watching 3 ZIP codes. Remove one to add another.'));
  check('...the early look: the owner\'s number with its label, when it ends, "Message the owner"; everything the owner typed is escaped',
    html.includes('Owner&#39;s estimated value (not an appraisal or list price): $750,000') && html.includes('Open to members who watch ZIP 91915 until Sun, Nov 15, 12:00 PM Pacific time.')
    && html.includes('Early &lt;i&gt;home&lt;/i&gt;') && html.includes('Bright &amp; &quot;sunny&quot;') && html.includes('Wants: Any in Bonita &lt;or&gt; Eastlake · $0–$2,000,000') && html.includes('data-name="Sam &quot;O&quot;" data-zip="91915">Message the owner</button>')
    && html.includes('src="/api/photos/900"') && !/<i>home|address/i.test(html));
  const labelCount = html.split(`<strong>${esc(si.STANDING_LABEL)}</strong>`).length - 1;
  check('...STANDING_LABEL is on every standing-interest row (mine and the ones that reach me)', labelCount === 3, String(labelCount));
  check('...an owner row shows where it reaches and the terms, with Reply only while they haven\'t replied; nothing names a member',
    html.includes('<strong>ZIP 91915</strong>') && html.includes('About $900,000 · Any home type · cash · within 3 months') && html.includes('data-action="nb-reply-open" data-id="41">Reply</button>')
    && !html.includes('data-id="42">Reply') && html.includes('You replied. The conversation is in Messages.') && html.includes(esc(si.STANDING_REPLY_NAME_LINE)) && !/\/profile\//.test(html));
  check('...the poster\'s own row and the home claim are escaped', html.includes('La &lt;Vida&gt; Ct, ZIP 91915') && html.includes('Paseo &lt;del&gt; Rey, ZIP 91915') && html.includes(esc(si.HOME_CLAIM_ACK)) && html.includes(esc(si.STANDING_ACK)) && html.includes(esc(si.STANDING_LINE)));
  check('...the standing-interest line sits above its button', html.indexOf(esc(si.STANDING_LINE)) < html.indexOf('>Post standing interest</button>') && html.indexOf(esc(si.STANDING_LINE)) > html.indexOf('id="nbInterestAck"'));
  check('...no inline style or handler in what was drawn', !/\sstyle=|\son[a-z]+=|<script/i.test(html));

  const field = full.ctx.nbHeadStartFieldHtml('lf', { kind: 'listing', agentPosted: false });
  check('the head-start field: the tick box, "How long" with the three lengths, the no-agreement box, the help and the agent line',
    field.includes('id="lfHeadStartOn"') && field.includes('Give members who watch my ZIP code a head start') && field.includes('<label for="lfHeadStartHours">How long</label>')
    && field.includes('<option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option>') && field.includes('id="lfHeadStartNoAgreement"')
    && field.includes(esc(wa.HEAD_START_NO_AGREEMENT)) && field.includes(esc(wa.HEAD_START_HELP)) && field.includes(esc(wa.HEAD_START_AGENT_LINE)), field);
  const agentField = full.ctx.nbHeadStartFieldHtml('lf', { kind: 'listing', agentPosted: true });
  check('...for an agent-posted home it is the agent line alone (no box to tick)', agentField === `<div><p class="tiny field-hint">${esc(wa.HEAD_START_AGENT_LINE)}</p></div>`);
  full.el('lfHeadStartOn', { checked: true }); full.el('lfHeadStartHours', { value: '72' }); full.el('lfHeadStartNoAgreement', { checked: true });
  check('nbReadHeadStart: { hours, noAgreement } when ticked, {} when not', JSON.stringify(full.ctx.nbReadHeadStart('lf')) === '{"hours":72,"noAgreement":true}' && JSON.stringify(full.ctx.nbReadHeadStart('plc')) === '{}'
    && JSON.stringify(wa.validateHeadStart(full.ctx.nbReadHeadStart('lf'), { zip: '91915' })) === '{"data":{"hours":72}}' && JSON.stringify(wa.validateHeadStart(full.ctx.nbReadHeadStart('plc'), {})) === '{"data":{"hours":0}}');
  const badgeL = full.ctx.nbHeadStartBadgeHtml({ id: 12, zip: '91915', head_start_until: '2099-11-15 20:00:00' });
  const badgeP = full.ctx.nbHeadStartBadgeHtml({ id: 34, zip: '91913', headStartUntil: '2099-11-15 20:00:00' });
  check('the owner\'s badge: "Head start until ... Pacific time: only members who watch ZIP ... see it." + "Open to everyone now", for a listing and for a pre-listing',
    badgeL.includes('Head start until Sun, Nov 15, 12:00 PM Pacific time: only members who watch ZIP 91915 see it.') && badgeL.includes('data-action="nb-end-head-start" data-kind="listing" data-id="12">Open to everyone now</button>')
    && badgeP.includes('only members who watch ZIP 91913 see it.') && badgeP.includes('data-kind="pre_listing" data-id="34"'), badgeL);
  check('...nothing once the head start is over or was never set', full.ctx.nbHeadStartBadgeHtml({ id: 12, zip: '91915', head_start_until: past }) === '' && full.ctx.nbHeadStartBadgeHtml({ id: 12, zip: '91915', head_start_until: null }) === ''
    && full.ctx.nbHeadStartBadgeHtml({ id: 34, headStartUntil: null }) === '' && full.ctx.nbHeadStartBadgeHtml(null) === '');
  check('the standing-interest button and the owner link', full.ctx.nbStandingInterestButtonHtml({ kind: 'pre_listing', id: 3 }) === '<button type="button" class="btn btn-ghost btn-sm" data-action="nb-interest-open" data-kind="pre_listing" data-id="3">I\'d consider about...</button>'
    && full.ctx.nbOwnerInterestsHtml() === '<p class="tiny"><a href="/app#standing-interests" data-action="nb-go-interests">Standing interest that reaches your home</a></p>');
  const trialBlock = full.ctx.nbTradeTrialHtml(match);
  check('the match-card block: a mutual match of mine gets the button, keyed by the pair; a buyer or rental match, or someone else\'s pair, gets nothing',
    trialBlock.includes('data-nb-pair="10-20" data-mine="10" data-other="20"') && trialBlock.includes(">Try each other's homes first</button>")
    && full.ctx.nbTradeTrialHtml({ ...match, isBuyerMatch: true }) === '' && full.ctx.nbTradeTrialHtml({ ...match, isRentalMatch: true }) === ''
    && full.ctx.nbTradeTrialHtml({ a: { userId: 5, listingId: 1 }, b: { userId: 6, listingId: 2 } }) === '', trialBlock);
}

// ================= 19. Review fixes: a held home stays held; ZIP changes are budgeted; agents can't keep an interest going =================
{
  const feedbackApi = await mod('functions/api/listings/[id]/feedback.js');
  const favoritesApi = await mod('functions/api/favorites.js');
  const hiddenApi = await mod('functions/api/hidden-listings.js');
  const openHousesApi = await mod('functions/api/listings/[id]/open-houses/index.js');
  const preOne = await mod('functions/api/pre-listings/[id].js');
  // 21 an owner · 22 a member who watches nothing · 23 a watcher of 91915 the owner blocked · 24 a buyer
  // 25 an owner with one trade listing and no home claim · 26 a watcher of 91915 · 28 a buyer who later applies as an agent
  for (const id of [21, 22, 23, 24, 25, 26, 28]) user(id);
  run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (21, 23)');
  watch(23, '91915'); watch(26, '91915');
  run("INSERT INTO market_pulse_alerts (user_id, label, city, state) VALUES (22, 'CV', 'Chula Vista', 'CA')");

  // ---- A home in its head start can't be saved or hidden, and never shows in Saved or Hidden.
  let r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 21, {}, { ...trade, headStart: { hours: 72, noAgreement: true } });
  const held = r.json && r.json.id;
  check('review: the held home is stored paused with a head start', r.status === 201 && one('SELECT status FROM listings WHERE id = ?', held).status === 'paused' && !!one('SELECT head_start_until AS u FROM listings WHERE id = ?', held).u);
  const thumbs = [];
  for (const who of [22, 23, 26]) {
    const up = await call(feedbackApi.onRequestPut, 'PUT', `/api/listings/${held}/feedback`, who, { id: String(held) }, { feedback: 'up' });
    const down = await call(feedbackApi.onRequestPut, 'PUT', `/api/listings/${held}/feedback`, who, { id: String(held) }, { feedback: 'down' });
    thumbs.push(up.status, down.status);
  }
  check('review: a non-watcher, a blocked watcher and a watcher all get 404 on thumbs up and thumbs down for a held home; nothing is stored',
    thumbs.every(s => s === 404) && one('SELECT COUNT(*) AS n FROM listing_feedback WHERE listing_id = ?', held).n === 0, thumbs.join());
  // Even with a row put there by hand, the two lists leave a held home out.
  run("INSERT INTO listing_feedback (user_id, listing_id, feedback) VALUES (22, ?, 'up'), (23, ?, 'down')", held, held);
  const fav = await call(favoritesApi.onRequestGet, 'GET', '/api/favorites', 22);
  const hid = await call(hiddenApi.onRequestGet, 'GET', '/api/hidden-listings', 23);
  check('review: /api/favorites and /api/hidden-listings never list a held home', fav.status === 200 && hid.status === 200
    && !fav.json.listings.some(l => l.id === held) && !hid.json.listings.some(l => l.id === held) && !JSON.stringify([fav.json, hid.json]).includes('Head start home'));
  run('DELETE FROM listing_feedback WHERE listing_id = ?', held);
  L(9302, 21, { zip: '91915' });
  r = await call(feedbackApi.onRequestPut, 'PUT', '/api/listings/9302/feedback', 22, { id: '9302' }, { feedback: 'up' });
  const favAfter = await call(favoritesApi.onRequestGet, 'GET', '/api/favorites', 22);
  check('review: a public listing is saved as before', r.status === 200 && favAfter.json.listings.some(l => l.id === 9302));

  // ---- The owner's price change and open house during the head start announce nothing.
  const eventsBefore = one('SELECT COUNT(*) AS n FROM market_events').n;
  const noticesBefore = one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = 22').n;
  r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${held}`, 21, { id: String(held) }, { ...trade, estimatedValue: 700000, action: 'edit' });
  const startsAt = new Date(Date.now() + 86400e3).toISOString(), endsAt = new Date(Date.now() + 86400e3 + 7200e3).toISOString();
  const oh = await call(openHousesApi.onRequestPost, 'POST', `/api/listings/${held}/open-houses`, 21, { id: String(held) }, { startsAt, endsAt });
  check('review: a lower price and a new open house during the head start write no market event and no notice; the home stays held',
    r.status === 200 && oh.status === 201 && one('SELECT COUNT(*) AS n FROM market_events').n === eventsBefore
    && one("SELECT COUNT(*) AS n FROM market_events WHERE entity_kind = 'listing' AND entity_id = ?", held).n === 0
    && one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = 22').n === noticesBefore
    && one('SELECT status FROM listings WHERE id = ?', held).status === 'paused' && one('SELECT estimated_value AS v FROM listings WHERE id = ?', held).v === 700000, `${r.status} ${oh.status} ${oh.text}`);
  const ohOwner = await call(openHousesApi.onRequestGet, 'GET', `/api/listings/${held}/open-houses`, 21, { id: String(held) });
  const ohOthers = [];
  for (const who of [null, 22, 23, 26]) ohOthers.push((await call(openHousesApi.onRequestGet, 'GET', `/api/listings/${held}/open-houses`, who, { id: String(held) })).json.openHouses.length);
  check('review: the held home\'s open house shows to its owner only (signed out, a non-watcher, a blocked watcher and a watcher get none)', ohOwner.json.openHouses.length === 1 && ohOthers.every(n => n === 0), ohOthers.join());
  r = await call(headStartApi.onRequestDelete, 'DELETE', `/api/head-start/listing/${held}`, 21, { kind: 'listing', id: String(held) });
  const opened = one('SELECT status, head_start_until AS u FROM listings WHERE id = ?', held);
  r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${held}`, 21, { id: String(held) }, { ...trade, estimatedValue: 690000, action: 'edit' });
  check('review: once the home is open, a lower price writes its price_drop event as before', opened.status === 'active' && opened.u === null && r.status === 200
    && one("SELECT COUNT(*) AS n FROM market_events WHERE entity_kind = 'listing' AND entity_id = ? AND event_type = 'price_drop'", held).n === 1);

  // ---- Moving a home to another ZIP counts toward the home-claim budget (3 in 30 days), so reach can't hop ZIP to ZIP.
  const amounts = { 91913: 811000, 91910: 812000, 91902: 813000, 91915: 814000 };
  for (const [zip, amount] of Object.entries(amounts)) await interest(24, { ...okBody, target: { kind: 'area', zip }, amount });
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 25, {}, { ...trade, title: 'Hopper' });
  const hop = r.json.id;
  const reachOf = async (env = LIVE) => ((await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', 25, {}, undefined, env)).json.interests || [])
    .filter(i => Object.values(amounts).includes(i.amount)).map(i => i.amount).sort().join();
  const hops = [];
  for (const zip of ['91913', '91910', '91902', '91915']) {
    const e = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${hop}`, 25, { id: String(hop) }, { ...trade, title: 'Hopper', zip, action: 'edit' });
    hops.push(`${zip}:${e.status}:${await reachOf()}`);
  }
  check('review: three ZIP changes go through (reach follows each), the 4th in 30 days is refused and reach doesn\'t move',
    hops.join(' ') === '91913:200:811000 91910:200:812000 91902:200:813000 91915:429:813000' && one('SELECT zip FROM listings WHERE id = ?', hop).zip === '91902'
    && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 25 AND kind = 'home_claim'").n === 3, hops.join(' '));
  r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${hop}`, 25, { id: String(hop) }, { ...trade, title: 'Hopper', zip: '91902', description: 'Same ZIP, new words.', action: 'edit' });
  const claim = await call(claimsApi.onRequestPost, 'POST', '/api/home-claims', 25, {}, { zip: '91910', ack: true });
  check('review: an edit that keeps the ZIP is not counted, and the budget is the home-claim budget (a claim is refused now too)', r.status === 200 && claim.status === 429
    && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 25 AND kind = 'home_claim'").n === 3 && one('SELECT COUNT(*) AS n FROM home_claims WHERE user_id = 25').n === 0, `${r.status} ${claim.status}`);
  P(9301, 25, { zip: '91902' });
  const preBody = { title: 'Pre 9301', city: 'Chula Vista', state: 'CA', propertyType: 'Townhouse', beds: 3, baths: 2, askingPrice: 800000 };
  r = await call(preOne.onRequestPut, 'PUT', '/api/pre-listings/9301', 25, { id: '9301' }, { ...preBody, zip: '91913' });
  const same = await call(preOne.onRequestPut, 'PUT', '/api/pre-listings/9301', 25, { id: '9301' }, { ...preBody, zip: '91902' });
  check('review: a pre-listing\'s ZIP change draws on the same budget (refused, ZIP unchanged); an edit that keeps the ZIP goes through', r.status === 429 && r.json.code === 'rate_limited'
    && same.status === 200 && one('SELECT zip FROM pre_listings WHERE id = 9301').zip === '91902', `${r.status} ${same.status} ${same.text}`);
  r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${hop}`, 25, { id: String(hop) }, { ...trade, title: 'Hopper', zip: '91915', action: 'edit' }, SHIP);
  check('review: while standing interest is admin-only, a member\'s ZIP edit works as it always did (nothing counted, nothing to read)', r.status === 200 && one('SELECT zip FROM listings WHERE id = ?', hop).zip === '91915'
    && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 25 AND kind = 'home_claim'").n === 3
    && (await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', 25, {}, undefined, SHIP)).status === 404);

  // ---- A poster who gets an agent profile afterwards: the interest reaches nobody, can't be answered and can't be renewed.
  r = await interest(28, { ...okBody, target: { kind: 'area', zip: '91915' }, amount: 777000 });
  const agentInterest = r.json && (r.json.id || (r.json.interest && r.json.interest.id)) || one('SELECT id FROM standing_interests WHERE user_id = 28').id;
  const sees = async () => ((await call(interestsApi.onRequestGet, 'GET', '/api/standing-interests?for=owner', 25)).json.interests || []).some(i => i.amount === 777000);
  const seenBefore = await sees();
  const expiresBefore = one('SELECT expires_at AS e FROM standing_interests WHERE id = ?', agentInterest).e;
  run("UPDATE standing_interests SET expires_at = datetime(expires_at, '-10 days') WHERE id = ?", agentInterest);
  const expiresShort = one('SELECT expires_at AS e FROM standing_interests WHERE id = ?', agentInterest).e;
  run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (28, 'pending', '09999928', 'Some Realty')");
  const seenAfter = await sees();
  const reply = await call(replyApi.onRequestPost, 'POST', `/api/standing-interests/${agentInterest}/reply`, 25, { id: String(agentInterest) }, { message: 'Tell me more about your timing.' });
  const renew = await call(interestOne.onRequestPut, 'PUT', `/api/standing-interests/${agentInterest}`, 28, { id: String(agentInterest) }, { renew: true });
  check('review: before the agent profile the owner sees the interest; after it, the owner doesn\'t, a reply answers 404 and no message is written',
    r.status === 201 && seenBefore === true && seenAfter === false && reply.status === 404
    && one('SELECT COUNT(*) AS n FROM messages WHERE sender_id = 25 AND body LIKE ?', '%Tell me more about your timing.%').n === 0, `${r.status} ${seenBefore} ${seenAfter} ${reply.status} ${expiresBefore}`);
  check('review: renewing it as an agent -> 403 interest_not_for_agents with STANDING_AGENT_ERROR, and the end date doesn\'t move',
    renew.status === 403 && renew.json.code === 'interest_not_for_agents' && renew.json.error === si.STANDING_AGENT_ERROR
    && one('SELECT expires_at AS e FROM standing_interests WHERE id = ?', agentInterest).e === expiresShort, `${renew.status} ${renew.text}`);
  run("DELETE FROM notifications WHERE type = 'standing_interest'");
  const told = await si.notifyStandingOwners(DB, LIVE, { userId: 28, zip: '91915', streetKey: '', preListingId: null });
  run("DELETE FROM agent_profiles WHERE user_id = 28");
  const toldPlain = await si.notifyStandingOwners(DB, LIVE, { userId: 28, zip: '91915', streetKey: '', preListingId: null });
  check('review: a poster with an agent profile tells no owner (the same call without the profile does)', told === 0 && toldPlain > 0, `${told} ${toldPlain}`);
  check('review: the notice makes no claim about the owner\'s home ("a home like yours" is gone)', !/like yours|your area/i.test(si.STANDING_NOTICE) && si.STANDING_NOTICE.endsWith('It is not an offer to purchase.'));
}

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
