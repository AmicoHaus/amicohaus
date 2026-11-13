// Nuanced ideas batch (migration_v47), the shared parts: the launch gate (nuancedGate.js, GET /api/nuanced-tools), the
// text checks (ideaText.js), the eight new rate-limit kinds and their pruning, the data export (still 46 statements,
// only the person's own rows), the two lazy-job hooks, the migration's invariants on schema.sql, and the names every
// builder relies on (server libs, client scripts, hook lines). In-memory SQLite stand-in for D1. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/nuanced-lib-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const schemaSql = readFileSync(`${root}/schema.sql`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec(schemaSql);
// D1 stand-in that counts statements: used.n (every statement) and batchSizes (one entry per batch).
const used = { n: 0 };
const batchSizes = [];
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { used.n++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { used.n++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { used.n++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => { used.n++; return /^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : (() => { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; })(); },
    };
    return stmt;
  },
  batch: async (stmts) => { batchSizes.push(stmts.length); const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0, passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
globalThis.fetch = async () => new Response('{}', { status: 200 });
const call = async (handler, method, path, who, env = { DB }) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: who ? { Cookie: `ah_session=t${who}` } : {} });
  const pending = [];
  const res = await handler({ request, env, params: {}, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
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
const logged = [];
console.log = (...a) => { logged.push(a.join(' ')); };

// People: 1 owner A, 2 owner B, 3 a plain member, 5 an admin.
const user = (id, role = 'user') => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, `u${id}@example.test`, `User ${id}`, role, 'active');
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
user(1); user(2); user(3); user(5, 'admin');

// ================= 1. The launch gate =================
const gate = await mod('functions/_lib/nuancedGate.js');
const LIVE = ['runCosts', 'willItFit', 'signalMap', 'termsWishlist', 'sellAndStay', 'watchAreas'];
const DARK = ['areaContext', 'fccCoverage', 'headStart', 'easementIdeas', 'openFor', 'standingOffer', 'stepDown', 'ownerCarry', 'testDrive'];
const ALL = [...LIVE, ...DARK];
const member = { id: 3, role: 'user' };
const admin = { id: 5, role: 'admin' };
check('gate: exactly the 15 tool names, in the written order', JSON.stringify(Object.keys(gate.NUANCED_TOOLS)) === JSON.stringify(ALL), JSON.stringify(Object.keys(gate.NUANCED_TOOLS)));
check('gate (Rudy 11.13): the six live tools are true, the nine others false', LIVE.every(k => gate.NUANCED_TOOLS[k] === true) && DARK.every(k => gate.NUANCED_TOOLS[k] === false));
check('gate: a dark tool is off for a signed-out visitor and for a member, on for an admin',
  DARK.every(k => gate.toolLive({}, k, null) === false && gate.toolLive({}, k, member) === false && gate.toolLive({}, k, admin) === true));
check('gate: toolLive(env, "easementIdeas") with no user argument is false', gate.toolLive({}, 'easementIdeas') === false && gate.toolLive(undefined, 'easementIdeas') === false);
check('gate: the six live tools are on for a signed-out visitor', LIVE.every(k => gate.toolLive({}, k, null) === true && gate.toolLive(null, k) === true));
check('gate: an unknown name is false for everyone, even an admin or with the test flag',
  gate.toolLive({}, 'nope', admin) === false && gate.toolLive({ NUANCED_ALL_LIVE: '1' }, 'nope', admin) === false
  && gate.toolLive({}, 'toString', admin) === false && gate.toolLive({}, 'constructor', admin) === false && gate.toolLive({}, '', admin) === false);
check('gate: NUANCED_ALL_LIVE = "1" turns every tool on for everyone', ALL.every(k => gate.toolLive({ NUANCED_ALL_LIVE: '1' }, k, null) === true));
check('gate: only the exact string "1" does (true, 1, "true", "0" do not)',
  [true, 1, 'true', '0', ''].every(v => gate.toolLive({ NUANCED_ALL_LIVE: v }, 'easementIdeas', member) === false));
check('gate: an agent, a suspended-looking row or a made-up role is not an admin',
  gate.toolLive({}, 'stepDown', { id: 9, role: 'agent' }) === false && gate.toolLive({}, 'stepDown', { id: 9, role: 'Admin' }) === false && gate.toolLive({}, 'stepDown', {}) === false);
const lt = gate.liveTools({}, null);
check('liveTools: one true/false per tool name', JSON.stringify(Object.keys(lt)) === JSON.stringify(ALL) && Object.values(lt).every(v => v === true || v === false)
  && JSON.stringify(gate.liveTools({}, admin)) === JSON.stringify(Object.fromEntries(ALL.map(k => [k, true]))));
check('nuancedGate.js never reads the database or the request', !/\bDB\b|prepare\(|request/.test(readFileSync(`${root}/functions/_lib/nuancedGate.js`, 'utf8').replace(/^\s*\/\/.*$/gm, '')));

const toolsApi = await mod('functions/api/nuanced-tools.js');
used.n = 0;
let r = await call(toolsApi.onRequestGet, 'GET', '/api/nuanced-tools', null);
check('GET /api/nuanced-tools signed out: 200, private no-store, exactly the 15 names, no statement', r.status === 200 && noStore(r)
  && JSON.stringify(Object.keys(r.json)) === '["tools"]' && JSON.stringify(Object.keys(r.json.tools)) === JSON.stringify(ALL) && used.n === 0, `${used.n} ${JSON.stringify(r.json)}`);
check('GET /api/nuanced-tools signed out: the live six true, every dark tool false', LIVE.every(k => r.json.tools[k] === true) && DARK.every(k => r.json.tools[k] === false));
used.n = 0;
r = await call(toolsApi.onRequestGet, 'GET', '/api/nuanced-tools', 3);
check('GET /api/nuanced-tools as a member: the same answer, 1 statement (the session)', noStore(r) && DARK.every(k => r.json.tools[k] === false) && LIVE.every(k => r.json.tools[k] === true) && used.n === 1, String(used.n));
r = await call(toolsApi.onRequestGet, 'GET', '/api/nuanced-tools', 5);
check('GET /api/nuanced-tools as an admin: every tool true', noStore(r) && ALL.every(k => r.json.tools[k] === true));
r = await call(toolsApi.onRequestGet, 'GET', '/api/nuanced-tools', null, { DB, NUANCED_ALL_LIVE: '1' });
check('GET /api/nuanced-tools with the test flag: every tool true, signed out', noStore(r) && ALL.every(k => r.json.tools[k] === true));

// ================= 2. ideaText.js =================
const it = await mod('functions/_lib/ideaText.js');
const ht = await mod('functions/_lib/homeText.js');
const passes = ['RV pad along the east fence, about 12 by 40 feet', 'Side yard strip behind the gate, gravel', 'Storage in the detached garage, month to month',
  'Garden beds near the living room window', 'Space for one boat on a trailer, no overnight stays', 'Flat gravel pad, 240V outlet nearby', 'Only weekdays, mornings',
  'Shared driveway to reach the back lot', 'Great for a boat or a trailer', 'Good for a small RV', 'No dogs on the pad', 'Shared with the neighbors next door',
  'Next to the great family room', 'Behind a good single family home', '', null, undefined];
check('ideaText: plain text about the space and the use passes', passes.every(s => it.ideaTextProblem(s) === null), passes.filter(s => it.ideaTextProblem(s) !== null).join(' | '));
const refuses = [
  ['Great passive income for an investor', it.INVEST_ERROR], ['8% return guaranteed', it.INVEST_ERROR], ['Selling shares to investors', it.INVEST_ERROR],
  ['Steady cash flow', it.INVEST_ERROR], ['Ingreso pasivo cada mes', it.INVEST_ERROR], ['Buen rendimiento', it.INVEST_ERROR],
  ['Someone could live in the RV', it.LIVING_ERROR], ['Room for rent in back', it.LIVING_ERROR], ['Tenant wanted for the pad', it.LIVING_ERROR],
  ['Para vivir en el remolque', it.LIVING_ERROR], ['A place for sleeping', it.LIVING_ERROR],
  ['This is a binding contract', it.LEGAL_WORD_ERROR], ['Approved by the city already', it.LEGAL_WORD_ERROR], ['Easement deed ready to sign', it.LEGAL_WORD_ERROR],
  ['Uso garantizado', it.LEGAL_WORD_ERROR], ['Pre-approved pad', it.LEGAL_WORD_ERROR],
  ['Looking for a Christian couple', it.PERSON_ERROR], ['Prefer a senior neighbor', it.PERSON_ERROR], ['No students', it.PERSON_ERROR],
  // The kind of person in any word order (review fix): after the noun, "for a ...", and the set phrases.
  ['Women only, local residents preferred', it.PERSON_ERROR], ['English speakers welcome, seniors preferred', it.PERSON_ERROR], ['Perfect for a family', it.PERSON_ERROR],
  ['Great for a retired couple', it.PERSON_ERROR], ['Veterans welcome', it.PERSON_ERROR], ['No Section 8', it.PERSON_ERROR], ['Must be employed', it.PERSON_ERROR],
  ['Quiet neighbors wanted', it.PERSON_ERROR], ['For someone from the neighborhood', it.PERSON_ERROR], ['Local residents only', it.PERSON_ERROR],
  ['Near the school, safe area', ht.STEERING_ERROR], ['1218 La Vida Ct side yard', ht.ADDRESS_ERROR], ['Gate code 1234', ht.CODE_ERROR],
];
const wrong = refuses.filter(([s, want]) => it.ideaTextProblem(s) !== want);
check('ideaText: investment, living, legal-word, person, steering, address and code text is refused with its own message', wrong.length === 0, wrong.map(([s]) => `${s} -> ${it.ideaTextProblem(s)}`).join(' | '));
check('ideaText: a question to the attorney may say "live" (living: false), and is still checked for the rest',
  it.ideaTextProblem('Can my neighbor live there later?', { living: false }) === null && it.ideaTextProblem('Can my neighbor live there later?') === it.LIVING_ERROR
  && it.ideaTextProblem('Can an investor live there later?', { living: false }) === it.INVEST_ERROR);
check('ideaText: the four messages are the written ones',
  it.INVEST_ERROR === 'Leave out returns, yields, income promises, shares and investors. Describe the space and the use: one owner, one buyer or user.'
  && it.LIVING_ERROR === "This tool isn't for a place to live. No one may live in the space; a home or room for rent belongs in a rental listing."
  && it.LEGAL_WORD_ERROR === 'Leave legal words out (binding, guaranteed, approved, contract, deed). This is an idea in your own words; an attorney writes the real document.'
  && it.PERSON_ERROR === 'Describe the space and the use, not the kind of person you want.');
check('HOA_CITY_LINE is exactly as written', it.HOA_CITY_LINE === "Check your HOA rules and your city's rules first.");
check('validZip: five digits only', it.validZip('91915') && it.validZip(91915) && !it.validZip('9191') && !it.validZip('919150') && !it.validZip('91915-1234') && !it.validZip('9191a') && !it.validZip('') && !it.validZip(null));
check('streetKey: a street name folded, lowercased, suffix shortened', it.streetKey('La Vida Court') === 'la vida ct' && it.streetKey('  Paseo  del Rey ') === 'paseo del rey'
  && it.streetKey('5th Avenue') === '5th ave' && it.streetKey('Cañón Drive.') === 'canon dr' && it.streetKey('') === '' && it.streetKey(null) === '');
check('hasHouseNumber: "1218 La Vida Ct" yes, "5th Avenue" and "La Vida Ct" no', it.hasHouseNumber('1218 La Vida Ct') === true && it.hasHouseNumber(' 12 Elm') === true
  && it.hasHouseNumber('5th Avenue') === false && it.hasHouseNumber('La Vida Ct') === false && it.hasHouseNumber('') === false);
check('HOUSE_NUMBER_ERROR is as written', it.HOUSE_NUMBER_ERROR === 'Leave the house number out: a street name is enough.');
const itSrc = readFileSync(`${root}/functions/_lib/ideaText.js`, 'utf8');
check('ideaText.js has no stray backspace character (a mangled \\b)', !itSrc.includes('\x08') && (itSrc.match(/\\b/g) || []).length >= 28);

// ================= 3. Rate limits =================
const rl = await mod('functions/_lib/rateLimits.js');
const DAY = 1440;
const wantNew = {
  watch_area_edit: [[10, DAY, false]], head_start: [[3, DAY, false]], home_claim: [[3, 30 * DAY, false]],
  standing_interest: [[5, DAY, false], [15, 30 * DAY, false]],
  interest_reply: [[10, DAY, false], [1, 90 * DAY, true]],
  trade_trial: [[5, DAY, false], [3, 7 * DAY, true]],
  idea_post: [[20, DAY, false]], step_down_edit: [[6, DAY, false]],
};
const kindsNow = Object.keys(rl.USER_LIMITS);
const afterReport = kindsNow.slice(kindsNow.indexOf('report') + 1);
check('the eight new kinds come right after report, in the written order, and nothing follows them', JSON.stringify(afterReport) === JSON.stringify(Object.keys(wantNew)), JSON.stringify(afterReport));
check('the eight new kinds have the written numbers', Object.entries(wantNew).every(([k, w]) => JSON.stringify((rl.USER_LIMITS[k] || []).map(x => [x.max, x.minutes, !!x.perRef])) === JSON.stringify(w)));
const claimMany = async (kind, uid, n, ref = null) => { let ok = 0; for (let i = 0; i < n; i++) if (await rl.claimUserAction(DB, kind, uid, ref)) ok++; return ok; };
check('watch_area_edit: 10 a day, then refused', await claimMany('watch_area_edit', 3, 12) === 10);
check('head_start: 3 a day', await claimMany('head_start', 3, 5) === 3);
check('home_claim: 3 in 30 days', await claimMany('home_claim', 3, 5) === 3);
check('step_down_edit: 6 a day', await claimMany('step_down_edit', 3, 8) === 6);
check('idea_post: 20 a day', await claimMany('idea_post', 3, 22) === 20);
check('standing_interest: 5 a day', await claimMany('standing_interest', 3, 7) === 5);
run("UPDATE user_action_log SET created_at = datetime('now', '-2 days') WHERE kind = 'standing_interest'");
check('standing_interest: 15 in 30 days (5 two days ago + 5 today, then 5 more a day later, then refused)', await claimMany('standing_interest', 3, 7) === 5
  && (run("UPDATE user_action_log SET created_at = datetime('now', '-26 hours') WHERE kind = 'standing_interest' AND created_at > datetime('now', '-1 day')"), true)
  && await claimMany('standing_interest', 3, 7) === 5
  && (run("UPDATE user_action_log SET created_at = datetime('now', '-27 hours') WHERE kind = 'standing_interest' AND created_at > datetime('now', '-1 day')"), true)
  && await claimMany('standing_interest', 3, 3) === 0);
check('interest_reply: one per standing interest in 90 days, other interests still open', await claimMany('interest_reply', 1, 3, 'standing_interest:7') === 1 && await claimMany('interest_reply', 1, 2, 'standing_interest:8') === 1);
run("UPDATE user_action_log SET created_at = datetime('now', '-89 days') WHERE kind = 'interest_reply' AND ref = 'standing_interest:7'");
check('interest_reply: still refused on day 89, allowed again after 90', await claimMany('interest_reply', 1, 1, 'standing_interest:7') === 0
  && (run("UPDATE user_action_log SET created_at = datetime('now', '-91 days') WHERE kind = 'interest_reply' AND ref = 'standing_interest:7'"), true)
  && await claimMany('interest_reply', 1, 1, 'standing_interest:7') === 1);
check('trade_trial: 3 per pair in 7 days, 5 a day across pairs', await claimMany('trade_trial', 2, 5, 'pair:1-2') === 3 && await claimMany('trade_trial', 2, 5, 'pair:1-9') === 2);
// Pruning: each kind keeps its rows for its longest window.
run('DELETE FROM user_action_log');
const logRow = (kind, days) => run("INSERT INTO user_action_log (user_id, kind, ref, created_at) VALUES (1, ?, ?, datetime('now', ?))", kind, `${kind}:${days}`, `-${days} days`);
logRow('interest_reply', 60); logRow('interest_reply', 100); logRow('watch_area_edit', 3); logRow('watch_area_edit', 1);
logRow('home_claim', 20); logRow('home_claim', 40); logRow('standing_interest', 29); logRow('standing_interest', 31);
logRow('trade_trial', 6); logRow('trade_trial', 8); logRow('head_start', 3); logRow('idea_post', 3); logRow('step_down_edit', 3);
await rl.pruneActionLogs(DB);
const leftLog = q('SELECT ref FROM user_action_log ORDER BY ref').map(x => x.ref);
check('prune keeps an interest_reply row that is 60 days old and removes one that is 100 days old', leftLog.includes('interest_reply:60') && !leftLog.includes('interest_reply:100'), leftLog.join());
check('prune removes a watch_area_edit row that is 3 days old and keeps one from yesterday', !leftLog.includes('watch_area_edit:3') && leftLog.includes('watch_area_edit:1'), leftLog.join());
check('prune: home_claim and standing_interest keep 30 days, trade_trial 7, the day-long kinds 2',
  JSON.stringify(leftLog) === JSON.stringify(['home_claim:20', 'interest_reply:60', 'standing_interest:29', 'trade_trial:6', 'watch_area_edit:1']), leftLog.join());
run('DELETE FROM user_action_log');

// ================= 4. Data export =================
const L = (id, uid) => run("INSERT INTO listings (id, user_id, city, state, property_type, estimated_value, price_tier, zip, terms_wishlist_json, owner_carry, run_costs_json) VALUES (?, ?, 'Chula Vista', 'CA', 'Condo', 700000, '600k-1m', '91915', '[\"quick_close\"]', 1, '{\"bills\":{\"electric\":120}}')", id, uid);
L(11, 1); L(12, 2);
run("INSERT INTO pre_listings (id, user_id, city, state, property_type, asking_price, zip) VALUES (21, 2, 'Chula Vista', 'CA', 'Condo', 600000, '91915')");
run("INSERT INTO saved_searches (user_id, locations, deal_flags) VALUES (1, 'Chula Vista', 3)");
run("INSERT INTO watch_areas (user_id, zip, label) VALUES (1, '91915', 'Mine A'), (1, '91913', ''), (2, '91902', 'Theirs B')");
run("INSERT INTO home_claims (user_id, zip, street_key, street_label) VALUES (1, '91915', 'la vida ct', 'La Vida Ct'), (2, '91902', 'bonita rd', 'Bonita Rd')");
run("INSERT INTO standing_interests (id, user_id, target_kind, zip, street_key, street_label, amount, expires_at) VALUES (31, 1, 'area', '91902', 'bonita rd', 'Bonita Rd', 800000, datetime('now', '+90 days'))");
run("INSERT INTO standing_interests (id, user_id, target_kind, pre_listing_id, amount, financing, expires_at) VALUES (32, 1, 'pre_listing', 21, 610000, 'cash', datetime('now', '+90 days'))");
run("INSERT INTO standing_interests (id, user_id, target_kind, zip, amount, expires_at) VALUES (33, 2, 'area', '91915', 999999, datetime('now', '+90 days'))");
run("INSERT INTO deal_outlines (id, user_id, kind, use_key, use_note, area_note, sketch_json, ask_amount, ask_per, questions_json, zip, city, listed) VALUES (41, 1, 'space', 'rv_pad', 'Mine: RV pad', 'East fence', '{\"w\":12}', 150, 'month', '[\"q1\"]', '91915', 'Chula Vista', 1)");
run("INSERT INTO deal_outlines (id, user_id, kind, use_note) VALUES (42, 2, 'access', 'Theirs: shared driveway')");
run("INSERT INTO open_for (id, user_id, property_kind, zip, city, uses_json, facts_json) VALUES (51, 1, 'home', '91915', 'Chula Vista', '[\"garden\"]', '{\"fenced\":\"yes\"}')");
run("INSERT INTO open_for (id, user_id, property_kind, zip, uses_json) VALUES (52, 2, 'vacant_lot', '91902', '[\"theirs_filming\"]')");
// Two trials: 11 x 12 (user 1 is side A) and, with the sides the other way round, 12 x 13 (user 1 is side B).
L(13, 1);
run("INSERT INTO trade_trials (id, listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights, checklist_a_json, checklist_b_json, a_agreed_at, b_agreed_at, status) VALUES (61, 11, 12, 1, 2, 1, '2027-01-10', '2027-01-24', 14, '[\"mine_a\"]', '[\"theirs_b\"]', '2026-11-01 10:00:00', '2026-11-02 11:00:00', 'agreed')");
run("INSERT INTO trade_trials (id, listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights, checklist_a_json, checklist_b_json, a_agreed_at) VALUES (62, 12, 13, 2, 1, 2, '2027-02-10', '2027-02-17', 7, '[\"theirs_a2\"]', '[\"mine_b2\"]', '2026-11-03 09:00:00')");
user(4);
L(14, 3); L(15, 4);
run("INSERT INTO trade_trials (id, listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights, checklist_a_json) VALUES (63, 14, 15, 3, 4, 3, '2027-03-01', '2027-03-05', 4, '[\"strangers\"]')");

const exportApi = await mod('functions/api/account/export.js');
batchSizes.length = 0; used.n = 0;
r = await call(exportApi.onRequestGet, 'GET', '/api/account/export', 1);
let ex = r.json;
check('export: 200, private no-store, ONE batch of exactly 46 statements (+ the session)', r.status === 200 && noStore(r) && batchSizes.length === 1 && batchSizes[0] === 46 && used.n === 47, `${JSON.stringify(batchSizes)} ${used.n}`);
const IDEA_KEYS = ['watchAreas', 'homeClaims', 'standingInterests', 'dealOutlines', 'openFor', 'tradeTrials'];
check('export: nuancedIdeas has exactly the six keys, each an array', ex && ex.nuancedIdeas && JSON.stringify(Object.keys(ex.nuancedIdeas)) === JSON.stringify(IDEA_KEYS) && IDEA_KEYS.every(k => Array.isArray(ex.nuancedIdeas[k])), JSON.stringify(ex && ex.nuancedIdeas).slice(0, 300));
const ni = ex.nuancedIdeas;
check('export: openHouses has no nuanced_ideas row and keeps its own (the hosted row)', Array.isArray(ex.openHouses) && !ex.openHouses.some(x => x.kind === 'nuanced_ideas') && ex.openHouses.some(x => x.kind === 'hosted'), JSON.stringify(ex.openHouses.map(x => x.kind)));
check('export: my watch areas only (zip, label, created_at)', ni.watchAreas.length === 2 && ni.watchAreas.map(w => w.zip).sort().join() === '91913,91915' && JSON.stringify(Object.keys(ni.watchAreas[0])) === '["zip","label","created_at"]');
check('export: my home claim only, as zip + street name', ni.homeClaims.length === 1 && ni.homeClaims[0].zip === '91915' && ni.homeClaims[0].street === 'La Vida Ct' && !('street_key' in ni.homeClaims[0]));
check('export: my two standing interests with their terms, not the one that reached my ZIP', ni.standingInterests.length === 2 && ni.standingInterests.map(s => s.id).sort().join() === '31,32'
  && ni.standingInterests.find(s => s.id === 32).pre_listing_id === 21 && ni.standingInterests.find(s => s.id === 32).financing === 'cash' && ni.standingInterests.find(s => s.id === 31).amount === 800000
  && ni.standingInterests.find(s => s.id === 31).street === 'Bonita Rd');
const o41 = ni.dealOutlines[0] || {};
check('export: my idea outline only, with ask and area nested', ni.dealOutlines.length === 1 && o41.id === 41 && o41.use_note === 'Mine: RV pad' && JSON.stringify(o41.ask) === '{"amount":150,"per":"month"}'
  && JSON.stringify(o41.area) === '{"zip":"91915","city":"Chula Vista","state":"CA"}' && o41.listed === 1 && o41.sketch_json === '{"w":12}' && o41.questions_json === '["q1"]' && o41.term_option === 'month_to_month', JSON.stringify(o41));
check('export: my Open For flags only', ni.openFor.length === 1 && ni.openFor[0].id === 51 && ni.openFor[0].uses_json === '["garden"]' && ni.openFor[0].facts_json === '{"fenced":"yes"}');
const t61 = ni.tradeTrials.find(t => t.id === 61) || {}, t62 = ni.tradeTrials.find(t => t.id === 62) || {};
check('export: my two trial stays, my side of each (as side A and as side B)', ni.tradeTrials.length === 2
  && t61.my_listing_id === 11 && t61.other_listing_id === 12 && t61.my_checklist_json === '["mine_a"]' && t61.my_agreed_at === '2026-11-01 10:00:00' && t61.status === 'agreed' && t61.nights === 14
  && t62.my_listing_id === 13 && t62.other_listing_id === 12 && t62.my_checklist_json === '["mine_b2"]' && t62.my_agreed_at === null && t62.start_date === '2027-02-10', JSON.stringify(ni.tradeTrials));
check("export: nothing of anyone else's (their watch area, claim, interest, outline, flags, their checklist or their yes)",
  !/Theirs|theirs_|999999|Bonita Rd"\s*,\s*"created_at|strangers|91902",\s*"label|2026-11-02 11:00:00|2026-11-03 09:00:00/.test(r.text), (r.text.match(/Theirs[^"]*|theirs_[^"\\]*|999999|strangers/g) || []).join());
check('export: the new listing columns and deal_flags ride on SELECT *', ex.listings.some(l => l.id === 11 && l.zip === '91915' && l.terms_wishlist_json === '["quick_close"]' && l.owner_carry === 1 && l.run_costs_json === '{"bills":{"electric":120}}'
  && l.step_down_json === '{}' && l.head_start_until === null) && ex.savedSearches[0].deal_flags === 3);
// Someone with nothing: six empty arrays, the same 46.
batchSizes.length = 0;
r = await call(exportApi.onRequestGet, 'GET', '/api/account/export', 5);
check('export for someone with none of it: six empty arrays, still 46 statements', batchSizes.length === 1 && batchSizes[0] === 46 && JSON.stringify(r.json.nuancedIdeas) === JSON.stringify(Object.fromEntries(IDEA_KEYS.map(k => [k, []])))
  && !r.json.openHouses.some(x => x.kind === 'nuanced_ideas'), JSON.stringify(r.json.nuancedIdeas));
r = await call(exportApi.onRequestGet, 'GET', '/api/account/export', null);
check('export signed out: 401', r.status === 401);
// D1 limits node:sqlite doesn't enforce: 32 arguments per SQL function (16 json_object pairs), 5 compound terms.
const exportSrc = readFileSync(`${root}/functions/api/account/export.js`, 'utf8');
const argCounts = [];
for (let at = exportSrc.indexOf('json_object('); at !== -1; at = exportSrc.indexOf('json_object(', at + 1)) {
  let depth = 0, args = 1, inStr = false, i = at + 'json_object'.length;
  for (; i < exportSrc.length; i++) {
    const c = exportSrc[i];
    if (inStr) { if (c === "'") inStr = false; continue; }
    if (c === "'") inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) break; }
    else if (c === ',' && depth === 1) args++;
  }
  argCounts.push(args);
}
check('export SQL: every json_object( has an even number of arguments, at most 32 (16 pairs)', argCounts.length >= 20 && argCounts.every(n => n % 2 === 0 && n <= 32), JSON.stringify(argCounts));
check('export SQL: the widest json_object is the idea outline at 14 pairs', Math.max(...argCounts) === 28, String(Math.max(...argCounts)));
const literals = exportSrc.match(/`[^`]*`|'(?:[^'\\\n]|\\.)*'/g) || [];
const termCounts = literals.map(t => (t.match(/\bUNION\b/gi) || []).length + 1);
check('export SQL: every compound SELECT has at most 5 terms, and openHouses has exactly 5', termCounts.every(n => n <= 5)
  && ((literals.find(t => t.includes("'nuanced_ideas'")) || '').match(/\bUNION\b/gi) || []).length === 4, JSON.stringify(termCounts.filter(n => n > 1)));
check('export SQL: every bound parameter is ?1 or ?2 (far under 100)', (exportSrc.match(/\?\d+/g) || []).every(p => p === '?1' || p === '?2'));

// ================= 5. Lazy-job hooks =================
const mwSrc = readFileSync(`${root}/functions/api/_middleware.js`, 'utf8');
const jobList = (/for \(const job of \[([^\]]+)\]\)/.exec(mwSrc) || [])[1] || '';
const jobs = jobList.split(',').map(s => s.trim());
check('middleware: head starts then price schedules run after the seller report and before the trash purge',
  jobs.indexOf('runDueHeadStarts') === jobs.indexOf('runDueSellerReports') + 1 && jobs.indexOf('runDueStepDowns') === jobs.indexOf('runDueHeadStarts') + 1
  && jobs.indexOf('runPurgeExpiredTrash') === jobs.indexOf('runDueStepDowns') + 1 && jobs.at(-1) === 'runPruneActionLogs' && jobs.length === 11, jobList);
check('middleware: the two jobs come from watchAreas.js and stepDown.js; the export is still skipped',
  mwSrc.includes("import { runDueHeadStarts } from '../_lib/watchAreas.js';") && mwSrc.includes("import { runDueStepDowns } from '../_lib/stepDown.js';") && mwSrc.includes("pathname === '/api/account/export'"));
const mw = await mod('functions/api/_middleware.js');
logged.length = 0;
{
  const pending = [];
  const res = await mw.onRequest({ request: new Request('https://amicohaus.com/api/nuanced-tools'), env: { DB }, params: {}, waitUntil(p) { pending.push(p); }, next: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) });
  await Promise.all(pending);
  check('middleware: a due-jobs pass runs clean with the new jobs in the list', res.status === 200 && pending.length === 1 && !logged.some(l => l.includes('[due jobs failed]')), logged.join(' | '));
}

// ================= 6. Migration invariants (on schema.sql) =================
const mig = readFileSync(`${root}/migration_v47.sql`, 'utf8');
const stmts = mig.replace(/^\s*--.*$/gm, '').split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
const adds = stmts.filter(s => s.startsWith('ALTER TABLE'));
const creates = stmts.filter(s => s.startsWith('CREATE'));
check('migration_v47.sql: 39 statements = 18 ADD COLUMN + 6 CREATE TABLE IF NOT EXISTS + 15 CREATE INDEX IF NOT EXISTS, nothing else',
  stmts.length === 39 && adds.length === 18 && stmts.filter(s => s.startsWith('CREATE TABLE IF NOT EXISTS ')).length === 6 && stmts.filter(s => s.startsWith('CREATE INDEX IF NOT EXISTS ')).length === 15
  && adds.every(s => /^ALTER TABLE \w+ ADD COLUMN /.test(s)));
check('migration_v47.sql: every NOT NULL ADD COLUMN has a constant default; none has an expression default, REFERENCES, UNIQUE or PRIMARY KEY',
  adds.every(s => (!/NOT NULL/.test(s) || /DEFAULT ('[^']*'|-?\d+)\s*$/.test(s)) && !/DEFAULT \(|REFERENCES|UNIQUE|PRIMARY KEY/.test(s)));
const tableSql = (t) => (one("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", t) || {}).sql || '';
const missing = adds.filter(s => { const m = /^ALTER TABLE (\w+) ADD COLUMN (.+)$/.exec(s); return !tableSql(m[1]).includes(`\n  ${m[2]},\n`); });
check('schema.sql: every ADD COLUMN of the migration is written the same way in its table', missing.length === 0, missing.join(' | '));
const norm = (s) => s.replace(/\s+/g, ' ').replace('IF NOT EXISTS ', '');
const schemaObjects = new Set(q("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").map(x => norm(x.sql)));
check('schema.sql: every CREATE TABLE and CREATE INDEX of the migration is there word for word', creates.every(s => schemaObjects.has(norm(s))), creates.filter(s => !schemaObjects.has(norm(s))).map(s => s.slice(0, 50)).join(' | '));
const before = q("SELECT COUNT(*) AS n FROM sqlite_master")[0].n;
let rerunOk = true;
try { sqlite.exec(creates.join(';\n')); } catch { rerunOk = false; }
check('the CREATE statements can run again on schema.sql and add nothing', rerunOk && q("SELECT COUNT(*) AS n FROM sqlite_master")[0].n === before);
const tableNames = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(t => t.name);
const colCount = (t) => q(`PRAGMA table_info(${t})`).length;
const totalCols = tableNames.reduce((n, t) => n + colCount(t), 0);
const indexCount = one("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").n;
check('schema.sql: 101 tables, 973 columns, 131 indexes', tableNames.length === 101 && totalCols === 973 && indexCount === 131, `${tableNames.length} / ${totalCols} / ${indexCount}`);
check('D1: no table over 100 columns (listings 48, pre_listings 57)', tableNames.every(t => colCount(t) <= 100) && colCount('listings') === 48 && colCount('pre_listings') === 57, `${colCount('listings')} / ${colCount('pre_listings')}`);
const NEW_TABLES = ['watch_areas', 'home_claims', 'standing_interests', 'trade_trials', 'deal_outlines', 'open_for'];
check('every new table has a users foreign key and every foreign key is ON DELETE CASCADE', NEW_TABLES.every(t => { const fks = q(`PRAGMA foreign_key_list(${t})`); return fks.some(f => f.table === 'users') && fks.every(f => f.on_delete === 'CASCADE'); }));
check('trade_trials.canceled_by_user_id has no foreign key (it must not block an account deletion)', !q('PRAGMA foreign_key_list(trade_trials)').some(f => f.from === 'canceled_by_user_id'));
const partial = q("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN ('idx_listings_head_start', 'idx_listings_step_next', 'idx_standing_interests_pre_listing')");
check('3 partial indexes (head start, next step, pre-listing interest)', partial.length === 3 && partial.every(i => /WHERE \w+ IS NOT NULL$/.test(i.sql)));
// Row rules, on a fresh copy.
{
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON');
  d.exec(schemaSql);
  const refusesSql = (sql) => { try { d.exec(sql); return false; } catch { return true; } };
  d.exec("INSERT INTO users (email, display_name) VALUES ('a@x.test','A'), ('b@x.test','B')");
  d.exec("INSERT INTO listings (user_id, city, state, property_type, estimated_value, price_tier) VALUES (1,'Chula Vista','CA','Single Family Home',800000,'600k-1m'), (2,'Bonita','CA','Condo',700000,'600k-1m')");
  d.exec("INSERT INTO pre_listings (user_id, city, state, property_type, asking_price, zip) VALUES (1,'Chula Vista','CA','Condo',600000,'91915')");
  const l = d.prepare('SELECT zip, head_start_until, step_down_json, step_next_at, terms_wishlist_json, owner_carry, assumable, run_costs_json, fit_json, signal_json FROM listings WHERE id = 1').get();
  check('listings defaults', JSON.stringify(l) === JSON.stringify({ zip: '', head_start_until: null, step_down_json: '{}', step_next_at: null, terms_wishlist_json: '[]', owner_carry: 0, assumable: 0, run_costs_json: '{}', fit_json: '{}', signal_json: '{}' }), JSON.stringify(l));
  const p = d.prepare('SELECT head_start_until, terms_wishlist_json, owner_carry, assumable, run_costs_json, fit_json, signal_json, stay_after_days FROM pre_listings WHERE id = 1').get();
  check('pre_listings defaults (stay_after_days from v44 is still there: Sell and Stay adds no field)', JSON.stringify(p) === JSON.stringify({ head_start_until: null, terms_wishlist_json: '[]', owner_carry: 0, assumable: 0, run_costs_json: '{}', fit_json: '{}', signal_json: '{}', stay_after_days: 0 }), JSON.stringify(p));
  d.exec("INSERT INTO saved_searches (user_id, locations) VALUES (1, 'Chula Vista')");
  check('saved_searches.deal_flags default 0', d.prepare('SELECT deal_flags FROM saved_searches').get().deal_flags === 0);
  d.exec("INSERT INTO watch_areas (user_id, zip) VALUES (1, '91915')");
  check('watch_areas: one row per person per ZIP', refusesSql("INSERT INTO watch_areas (user_id, zip) VALUES (1, '91915')") && !refusesSql("INSERT INTO watch_areas (user_id, zip) VALUES (2, '91915')"));
  d.exec("INSERT INTO home_claims (user_id, zip, street_key) VALUES (1, '91915', 'la vida ct')");
  check('home_claims: one row per person per ZIP and street', refusesSql("INSERT INTO home_claims (user_id, zip, street_key) VALUES (1, '91915', 'la vida ct')") && !refusesSql("INSERT INTO home_claims (user_id, zip, street_key) VALUES (1, '91915', '')"));
  check('standing_interests: amount > 0, a known target, financing and timing', refusesSql("INSERT INTO standing_interests (user_id, target_kind, zip, amount, expires_at) VALUES (2,'area','91915',0,'2027-01-01 00:00:00')")
    && refusesSql("INSERT INTO standing_interests (user_id, target_kind, zip, amount, expires_at) VALUES (2,'home','91915',500000,'2027-01-01 00:00:00')")
    && refusesSql("INSERT INTO standing_interests (user_id, target_kind, zip, amount, financing, expires_at) VALUES (2,'area','91915',500000,'gift','2027-01-01 00:00:00')")
    && refusesSql("INSERT INTO standing_interests (user_id, target_kind, zip, amount, timing, expires_at) VALUES (2,'area','91915',500000,'soon','2027-01-01 00:00:00')"));
  d.exec("INSERT INTO standing_interests (user_id, target_kind, pre_listing_id, amount, expires_at) VALUES (2,'pre_listing',1,650000,'2027-01-01 00:00:00')");
  check('deal_outlines: kind, term and ask unit from the fixed lists; starts on month_to_month, unlisted', refusesSql("INSERT INTO deal_outlines (user_id, kind) VALUES (1,'timeshare')")
    && refusesSql("INSERT INTO deal_outlines (user_id, kind, term_option) VALUES (1,'space','forever')") && refusesSql("INSERT INTO deal_outlines (user_id, kind, ask_per) VALUES (1,'space','week')")
    && (d.exec("INSERT INTO deal_outlines (user_id, kind) VALUES (1,'space')"), true)
    && JSON.stringify(d.prepare('SELECT term_option, listed, status, ask_amount FROM deal_outlines').get()) === '{"term_option":"month_to_month","listed":0,"status":"active","ask_amount":null}');
  check('open_for: property_kind and status from the fixed lists', refusesSql("INSERT INTO open_for (user_id, property_kind) VALUES (1,'mine')") && refusesSql("INSERT INTO open_for (user_id, status) VALUES (1,'closed')") && (d.exec('INSERT INTO open_for (user_id) VALUES (1)'), true));
  check('trade_trials: nights 1-90, one row per listing pair', refusesSql("INSERT INTO trade_trials (listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights) VALUES (1,2,1,2,1,'2027-01-10','2027-05-10',120)")
    && refusesSql("INSERT INTO trade_trials (listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights) VALUES (1,2,1,2,1,'2027-01-10','2027-01-10',0)")
    && (d.exec("INSERT INTO trade_trials (listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights) VALUES (1,2,1,2,1,'2027-01-10','2027-01-24',14)"), true)
    && refusesSql("INSERT INTO trade_trials (listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights) VALUES (1,2,1,2,2,'2027-02-10','2027-02-24',14)"));
  d.exec("UPDATE trade_trials SET status = 'canceled', canceled_by_user_id = 2");
  d.exec('DELETE FROM users WHERE id = 2');
  const left2 = ['standing_interests', 'trade_trials'].map(t => d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  check('deleting user 2 (who canceled the trial) removes their standing interest and the trial they were in', left2.every(n => n === 0), JSON.stringify(left2));
  d.exec('DELETE FROM users WHERE id = 1');
  const left = NEW_TABLES.map(t => d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  check('deleting user 1 leaves no row in any new table', left.every(n => n === 0), JSON.stringify(left));
}

// ================= 7. The names every builder relies on =================
const fnNames = (m, names) => names.filter(n => typeof m[n] !== 'function');
const hd = await mod('functions/_lib/homeData.js');
check('homeData.js: HOME_DATA_KINDS and its four functions', JSON.stringify(hd.HOME_DATA_KINDS) === '{"listing":"listings","pre_listing":"pre_listings"}'
  && fnNames(hd, ['validateHomeData', 'homeDataFromRow', 'homeDataLines', 'homeDataBlocksHtml']).length === 0);
const ltm = await mod('functions/_lib/listingTerms.js');
check('listingTerms.js: its five functions', fnNames(ltm, ['validateListingTerms', 'listingTermsFromRow', 'creditTermsProblem', 'termsBlocksHtml', 'sellStayBadge']).length === 0);
const sd = await mod('functions/_lib/stepDown.js');
check('stepDown.js: its seven functions', fnNames(sd, ['validateStepDown', 'stepDownFromRow', 'stepDownState', 'stepNextAt', 'stepDownBlockHtml', 'shownPrice', 'runDueStepDowns']).length === 0);
const wa = await mod('functions/_lib/watchAreas.js');
check('watchAreas.js: up to 3 ZIP codes (Rudy 11.13), head starts of 24 hours, 3 days or 7 days, and its seven functions', wa.MAX_WATCH_AREAS === 3 && JSON.stringify(wa.HEAD_START_HOURS) === '[24,72,168]'
  && fnNames(wa, ['validateHeadStart', 'headStartUntil', 'inHeadStart', 'headStartTeaserSql', 'notifyWatchers', 'endHeadStart', 'runDueHeadStarts']).length === 0);
const dout = await mod('functions/_lib/dealOutlines.js');
const ofor = await mod('functions/_lib/openFor.js');
check('dealOutlines.js and openFor.js: their digest terms are SQL text', typeof dout.dealOutlineDigestTermSql() === 'string' && typeof ofor.openForDigestTermSql() === 'string');
for (const f of ['standingInterest', 'tradeTrials', 'ideaCards']) {
  let ok = true;
  try { await mod(`functions/_lib/${f}.js`); } catch { ok = false; }
  check(`${f}.js loads`, ok);
}
const listingsLib = await mod('functions/_lib/listings.js');
check('listings.js: announceNewListing(context, listingId)', typeof listingsLib.announceNewListing === 'function');
// The listing page carries the imports its builder wires (and still loads).
const pageSrc = readFileSync(`${root}/functions/listing/[id].js`, 'utf8');
check('listing page: imports from homeData.js, listingTerms.js, stepDown.js and nuancedGate.js',
  /import \{[^}]*\bhomeDataBlocksHtml\b[^}]*\} from '\.\.\/_lib\/homeData\.js';/.test(pageSrc) && /import \{[^}]*\btermsBlocksHtml\b[^}]*\} from '\.\.\/_lib\/listingTerms\.js';/.test(pageSrc)
  && /import \{[^}]*\bstepDownBlockHtml\b[^}]*\bshownPrice\b[^}]*\} from '\.\.\/_lib\/stepDown\.js';/.test(pageSrc) && /import \{[^}]*\bliveTools\b[^}]*\} from '\.\.\/_lib\/nuancedGate\.js';/.test(pageSrc));
let pageLoads = true;
try { await mod('functions/listing/[id].js'); } catch (e) { pageLoads = false; logged.push(String(e)); }
check('listing page: the module loads', pageLoads, logged.at(-1));
// Client scripts: each declares its top-level names, and app.html loads them in order before main.js.
const CLIENT = {
  'listing-terms.js': ['ltFieldsHtml', 'ltRead', 'ltSave', 'ltDetailHtml', 'ltStepDownPanelHtml', 'ltSavedSearchFieldsHtml', 'ltReadSavedSearch', 'ltSavedSearchLabel', 'ltSellStayBadgeHtml', 'ltPreListingFilterHtml', 'ltPreListingFilterParams'],
  'neighbors.js': ['nbHeadStartFieldHtml', 'nbReadHeadStart', 'nbHeadStartBadgeHtml', 'loadWatchAreas', 'nbStandingInterestButtonHtml', 'nbOwnerInterestsHtml', 'nbTradeTrialHtml', 'nbOpenTradeTrial'],
  'ideas.js': ['loadIdeasTab', 'ideaCardLinkHtml'],
};
const PREFIX = { 'listing-terms.js': /^(LT_|lt)/, 'neighbors.js': /^(NB_|nb)/, 'ideas.js': /^(IDEA_|idea)/ };
for (const [file, names] of Object.entries(CLIENT)) {
  const src = existsSync(`${root}/${file}`) ? readFileSync(`${root}/${file}`, 'utf8') : '';
  const lacking = names.filter(n => !new RegExp(`^(?:(?:async )?function ${n}\\(|(?:const|let|var) ${n}\\b)`, 'm').test(src));
  check(`${file}: declares ${names.length} top-level functions by the agreed names`, src !== '' && lacking.length === 0, lacking.join());
  const topLevel = [...src.matchAll(/^(?:async )?function (\w+)|^(?:const|let|var) (\w+)/gm)].map(m => m[1] || m[2]);
  const stray = topLevel.filter(n => !names.includes(n) && !PREFIX[file].test(n));
  check(`${file}: every other top-level name carries the file's prefix`, stray.length === 0, stray.join());
}
const app = readFileSync(`${root}/app.html`, 'utf8');
check('app.html: listing-terms.js, neighbors.js, ideas.js after open-house-plan.js and before main.js, in that order',
  ['open-house-plan.js', 'listing-terms.js', 'neighbors.js', 'ideas.js', 'main.js'].map(n => app.indexOf(`<script src="${n}"></script>`)).every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1])));
check('app.html: the Ideas tab button right after Saved, and its panel with #ideasRoot', /<button class="tab" data-tab="saved">Saved<\/button>\s*<button class="tab" data-tab="ideas">Ideas<\/button>/.test(app)
  && app.includes('<section id="tab-ideas" class="tab-panel"><h1>Ideas</h1><div id="ideasRoot"></div></section>'));
check('app.html: #watchAreasPanel right after #openHousePlan in the Saved tab', /<div id="openHousePlan"><\/div>\s*<div id="watchAreasPanel"><\/div>/.test(app)
  && app.indexOf('id="watchAreasPanel"') > app.indexOf('id="tab-saved"') && app.indexOf('id="watchAreasPanel"') < app.indexOf('id="tab-ideas"'));
// Jury rule: nothing in the shared files names the people Amico Haus never mentions.
const shared = ['functions/_lib/nuancedGate.js', 'functions/_lib/ideaText.js', 'functions/api/nuanced-tools.js', 'listing-terms.js', 'neighbors.js', 'ideas.js',
  'functions/_lib/homeData.js', 'functions/_lib/listingTerms.js', 'functions/_lib/stepDown.js', 'functions/_lib/watchAreas.js', 'functions/_lib/standingInterest.js',
  'functions/_lib/tradeTrials.js', 'functions/_lib/dealOutlines.js', 'functions/_lib/openFor.js', 'functions/_lib/ideaCards.js', 'migration_v47.sql'];
check('the shared files and the migration never mention McKelvey, Patti or Jeff', shared.every(f => !/McKelvey|Patti|\bJeff\b/i.test(readFileSync(`${root}/${f}`, 'utf8'))));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
