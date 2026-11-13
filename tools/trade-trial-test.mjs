// Nuanced ideas batch (migration_v47), Test-Drive Trade: two owners of a mutual trade match record that both said yes
// to a short trial stay (tradeTrials.js, /api/trade-trials). The pair checks are the trade request's own
// (transactions.js verifyMutualPair); the site stores the pair, the dates, each side's ticked checklist and each
// yes: no money, no address, no document. Real handlers against an in-memory SQLite stand-in for D1. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/trade-trial-test.mjs <projectRoot>
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
// LIVE: every tool on (the test flag). SHIP: the gate as it ships (trial stays are admin-only).
const LIVE = { DB, RESEND_API_KEY: 'test-key', NUANCED_ALL_LIVE: '1' };
const SHIP = { DB, RESEND_API_KEY: 'test-key' };
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
const src = (p) => readFileSync(`${root}/${p}`, 'utf8');

// ---------------- People and homes ----------------
// 1 and 2: owners of a mutual trade match (listings 10 and 20). 3: a home that doesn't want theirs (30). 4: a buyer
// profile (40). 5: an admin with a home that matches owner 2's (50). 6: a rental (60). 7: a match for owner 1 (70) but
// in a block with them. 8: a bystander. 9: a second mutual match for owner 1 (90).
const user = (id, { role = 'user', email = `u${id}@example.test`, status = 'active', name = `User ${id}` } = {}) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, email, name, role, status);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
for (const id of [1, 2, 3, 4, 6, 7, 8, 9]) user(id);
user(5, { role: 'admin' });
const L = (id, uid, { rental = 0, buyerOnly = 0, priceMax = 1000000, status = 'active', type = 'Single Family Home', city = 'Chula Vista' } = {}) => {
  run(`INSERT INTO listings (id, user_id, title, address, city, state, property_type, beds, baths, estimated_value, price_tier, is_rental, is_buyer_only, status)
       VALUES (?, ?, ?, '77 Private Rd', ?, 'CA', ?, 3, 2, 700000, '600k-1m', ?, ?, ?)`, id, uid, `Home ${id}`, city, type, rental, buyerOnly, status);
  if (!rental) run(`INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (?, 'Chula Vista', 'Any', 0, 0, 0, ?)`, id, priceMax);
};
L(10, 1); L(20, 2, { type: 'Condo' }); L(30, 3, { priceMax: 100000 }); L(40, 4, { buyerOnly: 1 }); L(50, 5); L(60, 6, { rental: 1 }); L(70, 7); L(90, 9); L(11, 1, { status: 'paused' }); L(12, 1);
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (7, 1)');

const gate = await mod('functions/_lib/nuancedGate.js');
const tt = await mod('functions/_lib/tradeTrials.js');
const tx = await mod('functions/_lib/transactions.js');
const it = await mod('functions/_lib/ideaText.js');
const tm = await mod('functions/_lib/timingMatch.js');
const trialsApi = await mod('functions/api/trade-trials/index.js');
const trialOne = await mod('functions/api/trade-trials/[id].js');
const txIndex = await mod('functions/api/transactions/index.js');
const clientSrc = src('neighbors.js');

const today = tm.pacificToday();
const day = (n) => tm.addDays(today, n);
const ALL = Object.keys(tt.TRIAL_CHECKLIST);
const propose = (who, a, b, extra = {}, env = LIVE) => call(trialsApi.onRequestPost, 'POST', '/api/trade-trials', who, {}, { listingIdA: a, listingIdB: b, startDate: day(10), endDate: day(17), checklist: ALL, ...extra }, env);
const act = (who, id, body, env = LIVE) => call(trialOne.onRequestPost, 'POST', `/api/trade-trials/${id}`, who, { id: String(id) }, body, env);
const mine = async (who, env = LIVE) => (await call(trialsApi.onRequestGet, 'GET', '/api/trade-trials', who, {}, undefined, env));
const trialRow = (a, b) => one('SELECT * FROM trade_trials WHERE listing_a_id = ? AND listing_b_id = ?', Math.min(a, b), Math.max(a, b));

// ================= 1. The written copy =================
check('the written lines', tt.TRIAL_MAX_NIGHTS === 29 && tt.TRIAL_LONG_MAX_NIGHTS === 90
  && !/is an agreement|it's an agreement/i.test([tt.TRIAL_LINE, ...tt.TRIAL_CARD_LINES, tt.trialProposedNotice('A', '2027-03-01', '2027-03-05'), tt.trialAgreedNotice('A', '2027-03-01', '2027-03-05')].join(' '))
  && !/is an agreement|it's an agreement|Nothing is set/i.test(readFileSync(`${root}/neighbors.js`, 'utf8'))
  && tt.TRIAL_LINE === "A trial stay is between the two of you. Amico Haus only records that you both said yes, the dates and this checklist. That record isn't a contract, and Amico Haus doesn't provide one, handle money or share addresses."
  && tt.TRIAL_ADDRESS_LINE === "Addresses aren't shared here. Exchange them yourselves in Messages when you're both ready."
  && tt.TRIAL_LONG_LINE === 'A stay of 30 days or more can create a tenancy with tenant protections, and your lender, insurer, HOA and city may each have a say. Have an attorney write your agreement first.'
  && tt.TRIAL_LONG_ACK === "I understand a stay of 30 days or more can create a tenancy, and that we'll have an attorney write our agreement first.");
check('the six checklist lines, in order', JSON.stringify(tt.TRIAL_CHECKLIST) === JSON.stringify({
  insurance: "I've checked that my homeowner's insurance covers a guest staying in my home.",
  hoa: "I've checked my HOA's rules on guests and short stays.",
  city: "I've checked my city's rules on short stays (they can apply even when no money changes hands).",
  no_money: 'No money, deposit or fee goes through Amico Haus, and none is recorded here.',
  own_home: 'I stay responsible for my own home, mortgage, bills and belongings.',
  own_agreement: "We'll write down what we agree between ourselves. Amico Haus doesn't provide a contract.",
}));
check('the idea card (key trial) is the written copy', JSON.stringify(tt.TRIAL_CARD_LINES) === JSON.stringify([
  "Before you commit to a trade, the two of you can try staying in each other's homes for a short time. The default is up to 29 nights: you pick the dates and each tick a short checklist.",
  tt.TRIAL_LINE, `Longer stays are an option with one more note: ${tt.TRIAL_LONG_LINE}`]));
check('the client prints the same lines, the checklist and the HOA-and-city line', [tt.TRIAL_LINE, tt.TRIAL_ADDRESS_LINE, tt.TRIAL_LONG_LINE, tt.TRIAL_LONG_ACK, ...Object.values(tt.TRIAL_CHECKLIST), it.HOA_CITY_LINE].every(s => clientSrc.includes(s))
  && /const NB_TRIAL_CHECKLIST = \{\s+insurance:[^}]+hoa:[^}]+city:[^}]+no_money:[^}]+own_home:[^}]+own_agreement:[^}]+\};/.test(clientSrc));
check('the buttons and states', [">Try each other's homes first</button>", '>Suggest these dates</button>', '>Say yes</button>', '>Cancel the trial</button>', "'Longer than 29 nights'",
  '`Waiting for ${t.other.name}`', '`You both said yes: ${t.rangeLabel}`', "'Canceled'"].every(s => clientSrc.includes(s)));
check('the form: the note, the dates, the six lines, the address line, the longer toggle with its note and box, the HOA-and-city line under it',
  /function nbTrialFormHtml[\s\S]*?NB_TRIAL_LINE[\s\S]*?nbTrialStart-[\s\S]*?nbChecklistHtml\(key\)[\s\S]*?NB_TRIAL_ADDRESS_LINE[\s\S]*?Longer than 29 nights[\s\S]*?data-nb-long>[\s\S]*?NB_TRIAL_LONG_LINE[\s\S]*?NB_TRIAL_LONG_ACK[\s\S]*?Suggest these dates[\s\S]*?NB_HOA_CITY_LINE[\s\S]*?<\/form>/.test(clientSrc));

// ================= 2. The launch gate =================
check('gate (as shipped): trial stays are admin-only', gate.NUANCED_TOOLS.testDrive === false);
{
  const bad = [];
  for (const who of [1, null]) {
    for (const [label, r] of [['GET', await mine(who, SHIP)], ['POST', await propose(who, 10, 20, {}, SHIP)], ['POST :id', await act(who, 1, { action: 'cancel' }, SHIP)]]) {
      if (r.status !== 404 || r.json.error !== 'Not found.') bad.push(`${label} as ${who}: ${r.status}`);
    }
  }
  check('a dark tool: every trial route answers 404 "Not found." to a member and to a visitor, and nothing is written', bad.length === 0 && one('SELECT COUNT(*) AS n FROM trade_trials').n === 0, bad.join(' | '));
  const r = await mine(5, SHIP);
  check('...and works for an admin (200, private no-store)', r.status === 200 && noStore(r) && JSON.stringify(r.json) === '{"trials":[]}');
  check('signed out with the tool live: 401', (await mine(null)).status === 401 && (await propose(null, 10, 20)).status === 401 && (await act(null, 1, { action: 'cancel' })).status === 401);
}

// ================= 3. verifyMutualPair: the trade request's own checks =================
{
  const pairs = [
    ['a pair that is not a mutual match', 1, 10, 30, "These two listings aren't actually a mutual match."],
    ['a buyer profile', 1, 10, 40, 'Only a genuine reciprocal trade match can be opened to bid — buyer profiles and rentals have nothing reciprocal to close.'],
    ['a rental', 1, 10, 60, 'Only a genuine reciprocal trade match can be opened to bid — buyer profiles and rentals have nothing reciprocal to close.'],
    ['a blocked pair', 1, 10, 70, "These two listings aren't actually a mutual match."],
    ['two listings of the same owner', 1, 10, 12, "You can't open a transaction request against your own listing."],
    ['someone who owns neither', 8, 10, 20, 'You must own one of these two listings.'],
    ['a paused listing', 1, 11, 20, 'Both listings must be active.'],
    ['the same listing twice', 1, 10, 10, 'Pick two different listings.'],
    ['a missing listing', 1, 10, 999, 'Both listings must be active.'],
  ];
  const bad = [];
  for (const [label, who, a, b, error] of pairs) {
    const trial = await propose(who, a, b);
    const trade = await call(txIndex.onRequestPost, 'POST', '/api/transactions', who, {}, { listingIdA: a, listingIdB: b, note: '' });
    const lib = await tx.verifyMutualPair(DB, who, a, b);
    if (trial.status !== 400 || trial.json.error !== error || trade.status !== 400 || trade.json.error !== error || lib.error !== error) bad.push(`${label}: trial ${trial.status} ${trial.text} / trade ${trade.status} ${trade.text}`);
  }
  check('a non-match, a buyer profile, a rental, a blocked pair, own listings, a stranger, a paused or missing listing: the same answers as a trade request, word for word', bad.length === 0, bad.join(' | '));
  check('...and nothing is stored or counted for them', one('SELECT COUNT(*) AS n FROM trade_trials').n === 0 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'trade_trial'").n === 0);
  const c = await counted(() => tx.verifyMutualPair(DB, 2, 20, 10));
  check('verifyMutualPair on a real match: { lowId, highId, rowLow, rowHigh }, 2 statements', !c.r.error && c.r.lowId === 10 && c.r.highId === 20 && c.r.rowLow.user_id === 1 && c.r.rowHigh.user_id === 2 && c.n === 2, `${c.n} ${JSON.stringify(c.r).slice(0, 200)}`);
  const txSrc = src('functions/_lib/transactions.js');
  check('openTransactionRequest calls verifyMutualPair (one copy of the pair checks)', /export async function verifyMutualPair\(db, userId, listingId1, listingId2\)/.test(txSrc)
    && /export async function openTransactionRequest\([^)]*\) \{\s+const pair = await verifyMutualPair\(db, openedByUserId, listingId1, listingId2\);\s+if \(pair\.error\) return \{ error: pair\.error \};/.test(txSrc)
    && (txSrc.match(/aren't actually a mutual match/g) || []).length === 2 && (txSrc.match(/MATCH_THRESHOLD/g) || []).length === 3);
  const opened = await tx.openTransactionRequest(DB, 1, 10, 20, 'Let us trade');
  const again = await tx.openTransactionRequest(DB, 2, 20, 10, 'Yes');
  check('a trade request still opens and the partner asking for the same trade still confirms it', !opened.error && opened.isNew === true && opened.confirmedNow === false && again.id === opened.id && again.confirmedNow === true, JSON.stringify({ opened, again }));
  check('the trial route imports it from transactions.js', /import \{ verifyMutualPair \} from '..\/..\/_lib\/transactions.js';/.test(src('functions/api/trade-trials/index.js')));
}

// ================= 4. Dates and the checklist =================
{
  const now = Date.UTC(2026, 10, 14, 20, 0, 0); // Nov 14, 2026, noon Pacific
  const v = (startDate, endDate, longStayAck) => tt.validateTrialDates({ startDate, endDate, longStayAck }, now);
  check('1 to 29 nights from today to a year out', JSON.stringify(v('2026-11-14', '2026-11-15').data) === '{"startDate":"2026-11-14","endDate":"2026-11-15","nights":1,"longStay":0}'
    && v('2026-12-01', '2026-12-30').data.nights === 29 && v('2027-11-14', '2027-11-20').data.nights === 6);
  check('a start before today or more than a year out is refused', v('2026-11-13', '2026-11-20').error === tt.TRIAL_START_ERROR && v('2027-11-15', '2027-11-20').error === tt.TRIAL_START_ERROR);
  check('the end has to be after the start', v('2026-12-01', '2026-12-01').error === tt.TRIAL_ORDER_ERROR && v('2026-12-10', '2026-12-01').error === tt.TRIAL_ORDER_ERROR);
  check('30 nights without the long-stay box: "Trial stays here are up to 29 nights. Longer is an option: read the note and tick the box."',
    v('2026-12-01', '2026-12-31').error === 'Trial stays here are up to 29 nights. Longer is an option: read the note and tick the box.' && v('2026-12-01', '2026-12-31', 'yes').error === tt.TRIAL_LONG_ERROR);
  check('30 to 90 nights with the box: long_stay 1', JSON.stringify(v('2026-12-01', '2026-12-31', true).data) === '{"startDate":"2026-12-01","endDate":"2026-12-31","nights":30,"longStay":1}' && v('2026-12-01', '2027-03-01', true).data.nights === 90);
  check('more than 90 nights is refused, box or not', v('2026-12-01', '2027-03-02', true).error === tt.TRIAL_TOO_LONG_ERROR);
  check('anything that is not a real date is refused', [v('', ''), v('2026-02-30', '2026-03-05'), v('12/01/2026', '12/05/2026'), v(null, undefined), v('2026-12-01T00:00:00Z', '2026-12-05')].every(x => x.error === tt.TRIAL_DATES_ERROR));
  check('the checklist must hold every line (an array of keys, or key: true)', JSON.stringify(tt.validateTrialChecklist(ALL)) === JSON.stringify(ALL)
    && JSON.stringify(tt.validateTrialChecklist(Object.fromEntries(ALL.map(k => [k, true])))) === JSON.stringify(ALL)
    && tt.validateTrialChecklist(ALL.slice(1)) === null && tt.validateTrialChecklist({ ...Object.fromEntries(ALL.map(k => [k, true])), city: 'yes' }) === null
    && tt.validateTrialChecklist(null) === null && tt.validateTrialChecklist([]) === null && JSON.stringify(tt.validateTrialChecklist([...ALL, 'extra'])) === JSON.stringify(ALL));
  let r = await propose(1, 10, 20, { checklist: ALL.filter(k => k !== 'city') });
  check('an unticked line: "Tick every line to continue."', r.status === 400 && r.json.error === 'Tick every line to continue.', r.text);
  r = await propose(1, 10, 20, { startDate: day(5), endDate: day(35) });
  check('30 nights without the long-stay box is refused by the route', r.status === 400 && r.json.error === tt.TRIAL_LONG_ERROR, r.text);
  r = await propose(1, 10, 20, { startDate: day(-1), endDate: day(3) });
  check('a start date in the past is refused by the route', r.status === 400 && r.json.error === tt.TRIAL_START_ERROR, r.text);
  check('...none of those stored or counted anything', one('SELECT COUNT(*) AS n FROM trade_trials').n === 0 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'trade_trial'").n === 0);
}

// ================= 5. Suggesting dates, saying yes =================
let id = null;
{
  const cols = q('PRAGMA table_info(trade_trials)').map(c => c.name);
  check('trade_trials has no money, address, document or free-text column', !cols.some(c => /amount|deposit|fee|price|rent|money|address|note|rules|document|signature/i.test(c)), cols.join());
  const c = await counted(() => propose(1, 10, 20));
  id = c.r.json && c.r.json.id;
  const row = trialRow(10, 20);
  check('POST /api/trade-trials: 201, private no-store, at most 7 statements + the session', c.r.status === 201 && noStore(c.r) && c.r.json.status === 'proposed' && c.n <= 8, `${c.n} ${c.r.text}`);
  check('...a new row is "proposed" with the proposer\'s checklist and yes, and nothing for the other side', row.status === 'proposed' && row.user_a_id === 1 && row.user_b_id === 2 && row.proposed_by_user_id === 1
    && row.start_date === day(10) && row.end_date === day(17) && row.nights === 7 && row.long_stay === 0 && row.checklist_a_json === JSON.stringify(ALL) && row.checklist_b_json === '[]'
    && !!row.a_agreed_at && row.b_agreed_at === null, JSON.stringify(row));
  const label = tm.windowLabel(day(10), day(17));
  const n = q("SELECT user_id, type, body, link, emailed_at FROM notifications WHERE type = 'trade_trial'");
  check('...the partner gets one in-app notice (never an email)', n.length === 1 && n[0].user_id === 2 && n[0].emailed_at === null && n[0].link === `/app#trade-trial-${id}`
    && n[0].body === `User 1 suggested a trial stay for your trade match, ${label}. Nothing is recorded as a yes until you both say yes.` && sent.length === 0, JSON.stringify(n));
  check('...in ONE statement, written in the lib (never notifyAndMaybeEmail, a push or an admin alert)', c.sql.filter(s => /INSERT INTO notifications/.test(s)).length === 1
    && ['functions/_lib/tradeTrials.js', 'functions/api/trade-trials/index.js', 'functions/api/trade-trials/[id].js'].every(f => !/notifyAndMaybeEmail|sendPush|alertAdmin|email\.js/.test(src(f))));

  const c1 = await counted(() => mine(1));
  const m1 = c1.r.json.trials[0], m2 = (await mine(2)).json.trials[0];
  check('GET /api/trade-trials: ONE statement + the session, private no-store', c1.r.status === 200 && noStore(c1.r) && c1.n === 2 && c1.r.json.trials.length === 1, String(c1.n));
  check('...the proposer\'s view', m1.id === id && m1.myListingId === 10 && m1.otherListingId === 20 && m1.other.id === 2 && m1.other.name === 'User 2' && m1.otherHome === 'Condo in Chula Vista, CA'
    && m1.startDate === day(10) && m1.endDate === day(17) && m1.nights === 7 && m1.longStay === false && m1.iAgreed === true && m1.theyAgreed === false && m1.status === 'proposed' && m1.proposedByMe === true
    && m1.rangeLabel === label, JSON.stringify(m1));
  check('...the partner\'s view is the mirror image', m2.myListingId === 20 && m2.otherListingId === 10 && m2.other.id === 1 && m2.otherHome === 'Single Family Home in Chula Vista, CA' && m2.iAgreed === false && m2.theyAgreed === true && m2.proposedByMe === false);
  check('...exactly these fields, and never an address or the other side\'s checklist', JSON.stringify(Object.keys(m1)) === '["id","myListingId","otherListingId","other","otherHome","startDate","endDate","rangeLabel","nights","longStay","iAgreed","theyAgreed","status","proposedByMe"]'
    && !/address|Private Rd|checklist/i.test(c1.r.text));
  check('...a bystander sees nothing, and a trial that isn\'t theirs is a 404', (await mine(8)).json.trials.length === 0 && (await act(8, id, { action: 'agree', checklist: ALL })).status === 404 && (await act(8, id, { action: 'cancel' })).status === 404
    && (await act(1, 99999, { action: 'cancel' })).status === 404);

  let r = await act(1, id, { action: 'agree', checklist: ALL });
  check('the owner who suggested the dates can\'t say yes for the other one', r.status === 400 && r.json.error === tt.TRIAL_PARTNER_ONLY_ERROR && trialRow(10, 20).status === 'proposed', r.text);
  r = await act(2, id, { action: 'agree', checklist: ALL.slice(0, 5) });
  check('the other owner needs every line ticked too', r.status === 400 && r.json.error === 'Tick every line to continue.' && trialRow(10, 20).b_agreed_at === null);
  r = await act(2, id, { action: 'maybe' });
  check('an unknown action is refused', r.status === 400);
  const c2 = await counted(() => act(2, id, { action: 'agree', checklist: ALL }));
  const agreed = trialRow(10, 20);
  check('the other owner says yes: "agreed", their checklist and time stored; 3 statements + the session', c2.r.status === 200 && noStore(c2.r) && c2.r.json.status === 'agreed' && agreed.status === 'agreed'
    && !!agreed.b_agreed_at && agreed.checklist_b_json === JSON.stringify(ALL) && c2.n === 4, `${c2.n} ${c2.r.text}`);
  check('...the proposer is told: "User 2 said yes to the trial stay, ... This record isn\'t a contract: write down what you agree between yourselves."',
    !!one("SELECT 1 AS x FROM notifications WHERE user_id = 1 AND type = 'trade_trial' AND body = ? AND link = ? AND emailed_at IS NULL", `User 2 said yes to the trial stay, ${label}. This record isn't a contract: write down what you agree between yourselves.`, `/app#trade-trial-${id}`));
  const both = (await mine(1)).json.trials[0];
  check('...both see "agreed"', both.status === 'agreed' && both.iAgreed && both.theyAgreed);
  r = await act(2, id, { action: 'agree', checklist: ALL });
  check('saying yes again changes nothing and tells nobody', r.status === 200 && one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND type = 'trade_trial'").n === 1);
}

// ================= 6. Changing the dates, the same dates from the other side, canceling, starting over =================
{
  const before = one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND type = 'trade_trial'").n;
  let r = await propose(2, 20, 10, { startDate: day(20), endDate: day(24) });
  let row = trialRow(10, 20);
  check('proposing different dates on an agreed trial replaces the dates and clears the OTHER side\'s yes', r.status === 201 && r.json.id === id && r.json.status === 'proposed' && row.status === 'proposed'
    && row.start_date === day(20) && row.end_date === day(24) && row.nights === 4 && row.proposed_by_user_id === 2 && row.a_agreed_at === null && row.checklist_a_json === '[]' && !!row.b_agreed_at, JSON.stringify(row));
  check('...still one row for the pair, and the partner hears about the new dates', one('SELECT COUNT(*) AS n FROM trade_trials').n === 1
    && one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND type = 'trade_trial'").n === before + 1
    && !!one("SELECT 1 AS x FROM notifications WHERE user_id = 1 AND body = ?", `User 2 suggested a trial stay for your trade match, ${tm.windowLabel(day(20), day(24))}. Nothing is recorded as a yes until you both say yes.`));
  r = await propose(2, 20, 10, { startDate: day(20), endDate: day(24) });
  check('sending the same dates again is quiet (no new notice, no change)', r.status === 201 && r.json.status === 'proposed' && one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND type = 'trade_trial'").n === before + 1);
  r = await propose(1, 10, 20, { startDate: day(20), endDate: day(24) });
  row = trialRow(10, 20);
  check('the other owner suggesting the SAME dates counts as their yes', r.status === 201 && r.json.status === 'agreed' && row.status === 'agreed' && !!row.a_agreed_at && !!row.b_agreed_at && row.proposed_by_user_id === 2
    && !!one("SELECT 1 AS x FROM notifications WHERE user_id = 2 AND body = ?", `User 1 said yes to the trial stay, ${tm.windowLabel(day(20), day(24))}. This record isn't a contract: write down what you agree between yourselves.`), JSON.stringify(row));

  r = await act(1, id, { action: 'cancel' });
  row = trialRow(10, 20);
  check('either owner can cancel, any time: "canceled", who canceled, and the partner is told', r.status === 200 && r.json.status === 'canceled' && row.status === 'canceled' && row.canceled_by_user_id === 1
    && !!one("SELECT 1 AS x FROM notifications WHERE user_id = 2 AND type = 'trade_trial' AND body = 'User 1 canceled the trial stay for your trade match.'"), JSON.stringify(row));
  const cancels = one("SELECT COUNT(*) AS n FROM notifications WHERE body LIKE '%canceled the trial stay%'").n;
  r = await act(2, id, { action: 'cancel' });
  check('...canceling again is fine and tells nobody', r.status === 200 && one("SELECT COUNT(*) AS n FROM notifications WHERE body LIKE '%canceled the trial stay%'").n === cancels && trialRow(10, 20).canceled_by_user_id === 1);
  r = await act(2, id, { action: 'agree', checklist: ALL });
  check('a canceled trial can\'t be agreed to', r.status === 400 && r.json.error === tt.TRIAL_CANCELED_ERROR);
  check('...it still shows to both as "canceled"', (await mine(1)).json.trials[0].status === 'canceled' && (await mine(2)).json.trials[0].status === 'canceled');
  run("DELETE FROM user_action_log WHERE kind = 'trade_trial'");
  r = await propose(2, 10, 20, { startDate: day(20), endDate: day(24) });
  row = trialRow(10, 20);
  check('proposing on a canceled trial starts over (even with the same dates): proposed by this owner, the other side cleared', r.status === 201 && r.json.id === id && row.status === 'proposed' && row.proposed_by_user_id === 2
    && row.a_agreed_at === null && row.checklist_a_json === '[]' && !!row.b_agreed_at && row.canceled_by_user_id === null, JSON.stringify(row));
  r = await act(1, id, { action: 'cancel' });
  check('the other owner cancels this time', r.status === 200 && trialRow(10, 20).canceled_by_user_id === 1);
}

// ================= 7. A longer stay =================
{
  run("DELETE FROM user_action_log WHERE kind = 'trade_trial'");
  let r = await propose(1, 10, 20, { startDate: day(30), endDate: day(75), longStayAck: true });
  let row = trialRow(10, 20);
  check('30 to 90 nights with the long-stay box: stored with long_stay = 1', r.status === 201 && row.nights === 45 && row.long_stay === 1 && row.status === 'proposed', JSON.stringify(row));
  r = await act(2, id, { action: 'agree', checklist: ALL });
  check('...the other owner must tick the long-stay box as well', r.status === 400 && r.json.error === tt.TRIAL_LONG_ERROR && trialRow(10, 20).status === 'proposed');
  r = await act(2, id, { action: 'agree', checklist: ALL, longStayAck: true });
  check('...and with it, both said yes', r.status === 200 && trialRow(10, 20).status === 'agreed' && (await mine(2)).json.trials[0].longStay === true);
  run("UPDATE trade_trials SET status = 'proposed', b_agreed_at = NULL, start_date = ?, end_date = ?, nights = 3, long_stay = 0 WHERE id = ?", day(-5), day(-2), id);
  r = await act(2, id, { action: 'agree', checklist: ALL });
  check('dates that have passed can\'t be agreed to', r.status === 400 && r.json.error === tt.TRIAL_PAST_ERROR);
  run("UPDATE trade_trials SET start_date = ?, end_date = ?, nights = 7 WHERE id = ?", day(10), day(17), id);
}

// ================= 8. A block, a suspension, a listing that is no longer active =================
{
  run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (2, 1)');
  let r = await act(2, id, { action: 'agree', checklist: ALL });
  check('a block either way hides the trial from both, and "agree" answers 404', (await mine(1)).json.trials.length === 0 && (await mine(2)).json.trials.length === 0 && r.status === 404
    && (await act(1, id, { action: 'cancel' })).status === 404 && trialRow(10, 20).status === 'proposed');
  r = await propose(1, 10, 20);
  check('...and a new proposal gets the non-match answer (never "blocked")', r.status === 400 && r.json.error === "These two listings aren't actually a mutual match.");
  run('DELETE FROM user_blocks WHERE blocker_id = 2');
  check('...unblocking brings it back', (await mine(1)).json.trials.length === 1);
  run("UPDATE users SET status = 'suspended' WHERE id = 2");
  check('a suspended owner: the trial disappears for the other owner, and "agree" answers 404', (await mine(1)).json.trials.length === 0 && (await act(1, id, { action: 'cancel' })).status === 404);
  run("UPDATE users SET status = 'active' WHERE id = 2");
  run("UPDATE listings SET status = 'paused' WHERE id = 20");
  check('a paused listing: the trial disappears for both', (await mine(1)).json.trials.length === 0 && (await mine(2)).json.trials.length === 0 && (await act(2, id, { action: 'agree', checklist: ALL })).status === 404);
  run("UPDATE listings SET status = 'active' WHERE id = 20");
  check('...and comes back when the listing is active again', (await mine(2)).json.trials.length === 1);
}

// ================= 9. Limits =================
{
  run("DELETE FROM user_action_log WHERE kind = 'trade_trial'");
  const tries = [];
  for (let i = 0; i < 4; i++) tries.push((await propose(1, 10, 20, { startDate: day(40 + i), endDate: day(45 + i) })).status);
  check('3 proposals a week per pair; the 4th is rate-limited', tries.join() === '201,201,201,429', tries.join());
  check('...the limit is on the pair (ref pair:<low>-<high>), not on the person: another match still works',
    one("SELECT ref FROM user_action_log WHERE kind = 'trade_trial' LIMIT 1").ref === 'pair:10-20' && (await propose(1, 10, 90)).status === 201);
  check('...and the other owner of the pair has their own count', (await propose(2, 20, 10, { startDate: day(50), endDate: day(52) })).status === 201);
  run("DELETE FROM user_action_log WHERE kind = 'trade_trial'");
  for (let i = 0; i < 5; i++) run("INSERT INTO user_action_log (user_id, kind, ref) VALUES (1, 'trade_trial', ?)", `pair:x-${i}`);
  check('5 proposals a day per person; the 6th is rate-limited', (await propose(1, 10, 90, { startDate: day(60), endDate: day(62) })).status === 429);
  run("DELETE FROM user_action_log WHERE kind = 'trade_trial'");
  run("DELETE FROM notifications WHERE type = 'trade_trial'");
  for (let i = 0; i < 10; i++) run("INSERT INTO notifications (user_id, type, body) VALUES (9, 'trade_trial', 'x')");
  await propose(1, 10, 90, { startDate: day(61), endDate: day(63) });
  check('a member gets at most 10 trial notices a day', one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 9 AND type = 'trade_trial'").n === 10 && tt.TRIAL_NOTICES_PER_DAY === 10);
}

// ================= 10. As shipped: an admin's trial never reaches a member who can't open it =================
{
  run("DELETE FROM notifications"); run("DELETE FROM user_action_log WHERE kind = 'trade_trial'");
  let r = await propose(5, 50, 20, {}, SHIP);
  check('as shipped: an admin can suggest dates on their own match', r.status === 201 && !!trialRow(20, 50), r.text);
  check('...the member partner gets no notice about a tool they can\'t open, and their routes still answer 404', one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'trade_trial'").n === 0 && (await mine(2, SHIP)).status === 404
    && (await act(2, r.json.id, { action: 'agree', checklist: ALL }, SHIP)).status === 404);
  check('...the admin sees it', (await mine(5, SHIP)).json.trials.some(t => t.otherListingId === 20));
  r = await act(5, r.json.id, { action: 'cancel' }, SHIP);
  check('...and can cancel it', r.status === 200 && one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'trade_trial'").n === 0);
}

// ================= 11. Deleting a listing or an account removes the trial =================
{
  check('(setup) trials exist for 10-20, 10-90 and 20-50', one('SELECT COUNT(*) AS n FROM trade_trials').n === 3);
  run('DELETE FROM listings WHERE id = 90');
  check('deleting a listing removes its trial (cascade)', !trialRow(10, 90) && one('SELECT COUNT(*) AS n FROM trade_trials').n === 2);
  run("UPDATE trade_trials SET canceled_by_user_id = 2 WHERE listing_a_id = 10 AND listing_b_id = 20");
  run('DELETE FROM users WHERE id = 2');
  check('deleting an account removes its trials, even one it canceled (canceled_by_user_id has no foreign key)', one('SELECT COUNT(*) AS n FROM trade_trials').n === 0);
  const fks = q('PRAGMA foreign_key_list(trade_trials)');
  check('every foreign key on trade_trials cascades', fks.length === 5 && fks.every(f => f.on_delete === 'CASCADE'), JSON.stringify(fks.map(f => [f.from, f.on_delete])));
}

// ================= 12. The client =================
{
  const code = clientSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('the match-card block: mutual matches only, only when the tool is live, keyed by the pair', /function nbTradeTrialHtml\(match\) \{\s+if \(!nbLive\('testDrive'\) \|\| !match \|\| match\.isBuyerMatch \|\| match\.isRentalMatch \|\| !match\.a \|\| !match\.b\) return '';/.test(code)
    && /data-nb-pair="\$\{nbPairKey\(mine\.listingId, other\.listingId\)\}"/.test(code));
  check('the trial calls: list, suggest, say yes, cancel', ["nbGet('/api/trade-trials'", "apiPost('/api/trade-trials', {", "{ action: 'agree', checklist: nbReadChecklist(form), longStayAck:", "{ action: 'cancel' }"].every(s => code.includes(s)));
  check('the client never sends or shows an address, an amount or a note for a trial', !/address|deposit|amount/i.test(code.slice(code.indexOf('function nbPairKey'), code.indexOf('function nbReadChecklist')).replace(/NB_TRIAL_ADDRESS_LINE/g, '')));
  check('nbOpenTradeTrial(id) loads the list and scrolls to that trial', /async function nbOpenTradeTrial\(id\) \{\s+if \(!nbLive\('testDrive'\)\) return;\s+await nbLoadTrials\(\);/.test(code));
  // Run it: the list at the top of the Matches tab, as each owner sees it.
  const vm = await import('node:vm');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const boot = (tools, trials) => {
    const els = new Map();
    const make = (id) => ({ id, innerHTML: '', dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, scrollIntoView() { this.scrolled = true; } });
    const list = make('');
    const matches = make('matchesList');
    matches.parentNode = { insertBefore(node) { els.set(node.id, node); } };
    els.set('matchesList', matches);
    const asked = [], toasts = [], scrolled = [];
    // A drawn trial is found by its id once the list's markup holds it.
    const drawn = (id) => (/^nbTrial-\d+$/.test(id) && String((els.get('nbTrialsList') || {}).innerHTML || '').includes(`id="${id}"`) ? { scrollIntoView() { scrolled.push(id); } } : null);
    const ctx = {
      window: { NUANCED: tools }, console, Date, Promise, Number, String, JSON, Object, Array, Math, RegExp, Map, Set,
      document: { getElementById: (id) => els.get(id) || drawn(id), addEventListener() {}, querySelectorAll: () => [], createElement: () => list },
      escapeHtml: esc, toast: (m) => toasts.push(m), currentUser: { id: 1 }, setTimeout: () => 1,
      apiGet: async (path) => { asked.push(path); return { trials }; },
      apiPost: async () => ({}), apiPut: async () => ({}), apiDelete: async () => ({}),
    };
    vm.createContext(ctx);
    vm.runInContext(clientSrc, ctx);
    return { ctx, els, asked, toasts, scrolled };
  };
  const base ={ myListingId: 10, otherListingId: 20, other: { id: 2, name: 'Ana <b>' }, otherHome: 'Condo in Bonita, CA', startDate: day(10), endDate: day(17), rangeLabel: 'Mar 1 – Mar 8, 2027', nights: 7, longStay: false };
  const trials = [
    { ...base, id: 1, iAgreed: true, theyAgreed: false, status: 'proposed', proposedByMe: true },
    { ...base, id: 2, otherListingId: 30, iAgreed: false, theyAgreed: true, status: 'proposed', proposedByMe: false, longStay: true, nights: 45 },
    { ...base, id: 3, otherListingId: 40, iAgreed: true, theyAgreed: true, status: 'agreed', proposedByMe: true },
    { ...base, id: 4, otherListingId: 50, iAgreed: true, theyAgreed: false, status: 'canceled', proposedByMe: true },
  ];
  const page = boot({ testDrive: true }, trials);
  await page.ctx.nbOpenTradeTrial(2);
  const html = (page.els.get('nbTrialsList') || {}).innerHTML || '';
  const item = (n) => html.slice(html.indexOf(`id="nbTrial-${n}"`), n === 4 ? html.length : html.indexOf(`id="nbTrial-${n + 1}"`));
  check('nbOpenTradeTrial: one request, the list is drawn above the matches and the trial is scrolled to', page.asked.join() === '/api/trade-trials' && html.startsWith('<h3>Trial stays</h3>')
    && [1, 2, 3, 4].every(n => html.includes(`id="nbTrial-${n}"`)) && page.toasts.length === 0 && page.scrolled.join() === 'nbTrial-2', `${page.asked.join()} ${page.toasts.join()} ${page.scrolled.join()}`);
  check('...the four states: "Waiting for ...", "... suggested ...", "You both said yes: ...", "Canceled"; names are escaped',
    item(1).includes('<p>Waiting for Ana &lt;b&gt;</p>') && item(2).includes('<p>Ana &lt;b&gt; suggested Mar 1 – Mar 8, 2027</p>') && item(3).includes('<p>You both said yes: Mar 1 – Mar 8, 2027</p>')
    && item(4).includes('<p>Canceled</p>') && !html.includes('<b>') && html.includes('Trial stay with Ana &lt;b&gt;') && html.includes('Condo in Bonita, CA · 7 nights'), item(2).slice(0, 400));
  check('...only the owner who still has to answer gets "Say yes", with the note, the six lines, the address line and the HOA-and-city line',
    !item(1).includes('>Say yes</button>') && item(2).includes('>Say yes</button>') && !item(3).includes('>Say yes</button>') && !item(4).includes('>Say yes</button>')
    && [tt.TRIAL_LINE, tt.TRIAL_ADDRESS_LINE, it.HOA_CITY_LINE, ...Object.values(tt.TRIAL_CHECKLIST)].every(s => item(2).includes(esc(s)))
    && (item(2).split('data-nb-check="').length - 1) === 12);
  check('...a longer stay shows the tenancy note and its own box before "Say yes"', item(2).includes(esc(tt.TRIAL_LONG_LINE)) && item(2).includes(esc(tt.TRIAL_LONG_ACK))
    && item(2).indexOf(esc(tt.TRIAL_LONG_ACK)) < item(2).indexOf('>Say yes</button>') && item(2).includes('45 nights'));
  check('...every trial that isn\'t canceled can be canceled; a canceled one offers new dates', [1, 2, 3].every(n => item(n).includes(`data-action="nb-trial-cancel" data-id="${n}">Cancel the trial</button>`))
    && !item(4).includes('nb-trial-cancel') && item(4).includes('<summary>Suggest new dates</summary>') && item(1).includes('<summary>Suggest other dates</summary>'));
  check('...the suggest form: dates, the six lines, the longer toggle with its hidden note, "Suggest these dates"',
    item(1).includes('data-nb-form="trial" data-a="10" data-b="20" data-key="t1"') && item(1).includes('id="nbTrialStart-t1"') && item(1).includes(`value="${day(10)}"`)
    && item(1).includes('data-action="nb-trial-long-toggle"') && item(1).includes('<div class="hidden" data-nb-long>') && item(1).includes('>Suggest these dates</button>') && !item(4).includes(`value="${day(10)}"`));
  check('...nothing drawn has an address, an amount, an inline style or an inline handler', !/Private Rd|\$\d|\sstyle=|\son[a-z]+=|<script/i.test(html));
  const gone = boot({ testDrive: true }, []);
  await gone.ctx.nbOpenTradeTrial(9);
  check('a trial that is no longer there: a plain line, nothing drawn', gone.toasts.join() === 'That trial stay is no longer available.' && ((gone.els.get('nbTrialsList') || {}).innerHTML || '') === '');
  const dark = boot({ testDrive: false }, trials);
  await dark.ctx.nbOpenTradeTrial(2);
  check('with the tool dark for the viewer: no request, nothing drawn', dark.asked.length === 0 && !dark.els.get('nbTrialsList') && dark.ctx.nbTradeTrialHtml({ a: { userId: 1, listingId: 10 }, b: { userId: 2, listingId: 20 } }) === '');
  check('no stray backspace character in the trial files', ['functions/_lib/tradeTrials.js', 'functions/api/trade-trials/index.js', 'functions/api/trade-trials/[id].js', 'tools/trade-trial-test.mjs'].every(f => !src(f).includes('\x08')));
}

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
