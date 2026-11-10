// Runs the real code for 3-tap visit feedback (owner tools batch) against an in-memory SQLite stand-in for D1: which
// visits can take feedback (accepted showings that happened, broker previews that ended, the last 14 days, open homes,
// no blocks, active people), the preset-only answers, the 48-hour edit window, the owner's cards (agent identity, no
// counts or averages), the in-app owner alert, the in-app prompt job (once per visit, at most 3 statements), the jury
// scans, and the client renderers in a stubbed browser. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/visit-feedback-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const read = (f) => readFileSync(`${root}/${f}`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON;');
sqlite.exec(read('schema.sql'));
let statements = 0;
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { statements++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { statements++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { statements++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? stmt.all() : stmt.run()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const env = { DB, EMAIL_DEV_LOG: '1' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
globalThis.fetch = async () => new Response('{}', { status: 200 });
const call = async (handler, method, who, params = {}, body) => {
  const request = new Request('https://amicohaus.com/api/x', {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: type.includes('json') && text ? JSON.parse(text) : null };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => /private/.test(r.headers.get('Cache-Control') || '') && /no-store/.test(r.headers.get('Cache-Control') || '');
console.log = () => {};

const user = (id, extra = {}) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)',
    id, extra.email ?? `u${id}@example.test`, extra.name ?? `User ${id}`, extra.role ?? 'user', extra.status ?? 'active');
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
const agent = (id, status = 'approved') => run('INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, ?, ?, ?)', id, status, `0${id}000000`.slice(0, 8), `Realty ${id}`);
const home = (id, owner, extra = {}) => run(
  `INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address, status)
   VALUES (?, ?, 'Home', 'Chula Vista', 'CA', '91913', 'Single Family Home', 3, 2, ?, '1218 La Vida Ct', ?)`, id, owner, extra.price ?? 750000, extra.status ?? 'open');
const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const showing = (id, homeId, agentId, offsetMs, status = 'accepted') =>
  run('INSERT INTO pre_listing_showings (id, pre_listing_id, agent_user_id, proposed_at, status) VALUES (?, ?, ?, ?, ?)', id, homeId, agentId, iso(Date.now() + offsetMs), status);
const preview = (id, homeId, startOffset, endOffset) =>
  run('INSERT INTO pre_listing_previews (id, pre_listing_id, starts_at, ends_at) VALUES (?, ?, ?, ?)', id, homeId, iso(Date.now() + startOffset), iso(Date.now() + endOffset));
const rsvp = (previewId, agentId) => run('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (?, ?)', previewId, agentId);

const lib = await mod('functions/_lib/visitFeedback.js');
const api = await mod('functions/api/pre-listings/[id]/visit-feedback.js');

// People: 1 owner (home 10 open, home 40 posted without a price), 2 approved agent, 3 approved agent the owner
// blocked, 4 approved agent who blocked the owner, 5 admin (no agent profile), 6 admin + approved agent (the
// operator), 7 member, 8 demo agent, 9 pending agent, 11 suspended owner (home 20), 12 owner of awarded home 30.
for (const id of [1, 3, 4, 7, 9, 12]) user(id);
user(2, { name: 'Alice Agent' });
user(5, { role: 'admin' }); user(6, { role: 'admin', name: 'Rudy Operator' });
user(8, { email: 'agent8@demo.amicohaus.local' }); user(11, { status: 'suspended' });
for (const id of [2, 3, 4, 6, 8]) agent(id);
agent(9, 'pending');
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 3)');
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (4, 1)');
home(10, 1); home(40, 1, { price: 0 }); home(20, 11); home(30, 12, { status: 'awarded' });

showing(101, 10, 2, -1 * H);          // accepted, 1 hour ago: yes
showing(102, 10, 2, 1 * H);           // accepted, in 1 hour: no
showing(103, 10, 2, -15 * 24 * H);    // accepted, 15 days ago: no
showing(104, 10, 2, -2 * H, 'pending');
showing(105, 10, 2, -3 * H, 'declined');
showing(106, 10, 3, -1 * H);          // blocked by the owner
showing(107, 10, 4, -1 * H);          // blocked the owner
showing(108, 20, 2, -1 * H);          // suspended owner
showing(109, 30, 2, -1 * H);          // awarded home
showing(110, 10, 6, -1 * H);          // the operator
showing(111, 10, 8, -1 * H);          // demo agent
showing(112, 40, 2, -1 * H);          // price-open home
preview(201, 10, -3 * H, -1 * H); rsvp(201, 2);   // ended: yes
preview(202, 10, -1 * H, 1 * H); rsvp(202, 2);    // still running: no

// ---- 1. Eligibility ----
const el2 = await lib.eligibleVisitsFor(DB, 10, 2);
check('agent 2: the accepted showing an hour ago and the preview that ended are open for feedback (newest first)',
  el2.map(v => `${v.visitKind}:${v.visitId}`).join() === 'showing:101,preview:201', JSON.stringify(el2));
check('visitAt is the showing time / the preview start (ISO)', el2[0].visitAt === one('SELECT proposed_at AS t FROM pre_listing_showings WHERE id = 101').t && el2[1].visitAt === one('SELECT starts_at AS t FROM pre_listing_previews WHERE id = 201').t);
check('an agent the owner blocked has no visits', (await lib.eligibleVisitsFor(DB, 10, 3)).length === 0);
check('an agent who blocked the owner has no visits', (await lib.eligibleVisitsFor(DB, 10, 4)).length === 0);
check("a suspended owner's home takes no feedback", (await lib.eligibleVisitsFor(DB, 20, 2)).length === 0);
check('an awarded home takes no feedback', (await lib.eligibleVisitsFor(DB, 30, 2)).length === 0);
check('the operator account is an agent like any other here', (await lib.eligibleVisitsFor(DB, 10, 6)).length === 1);
run("UPDATE pre_listings SET status = 'closed' WHERE id = 30");
check('a closed home takes no feedback', (await lib.eligibleVisitsFor(DB, 30, 2)).length === 0);
run("UPDATE pre_listings SET status = 'awarded' WHERE id = 30");

// ---- 2. The prompt job (before anyone answers) ----
statements = 0;
let n = await lib.runDueVisitFeedbackPrompts({ env });
const used = statements;
const prompts = q('SELECT user_id, link, body, emailed_at FROM notifications WHERE body = ? ORDER BY user_id, link', lib.VISIT_PROMPT_BODY);
check('the prompt goes once per agent per home (two visits to one home = one prompt), to approved agents only',
  n === 3 && prompts.map(p => `${p.user_id}${p.link}`).join() === '2/app#pre-listing-10,2/app#pre-listing-40,6/app#pre-listing-10', `${n} ${JSON.stringify(prompts)}`);
check('the prompt skips demo agents, blocked pairs, suspended owners and awarded homes', !prompts.some(p => [3, 4, 8].includes(p.user_id) || /-(20|30)$/.test(p.link)));
check('the prompt job uses at most 3 statements', used <= 3, String(used));
check('prompts are in-app only (no email, nothing held)', prompts.every(p => p.emailed_at === null) && one('SELECT COUNT(*) AS n FROM held_emails').n === 0);
check('the link is the plain app link the router knows', prompts.every(p => /^\/app#pre-listing-\d+$/.test(p.link)));
check('each visit is claimed (feedback_asked_at set)', one('SELECT feedback_asked_at AS t FROM pre_listing_showings WHERE id = 101').t && one('SELECT feedback_asked_at AS t FROM pre_listing_preview_rsvps WHERE preview_id = 201').t
  && !one('SELECT feedback_asked_at AS t FROM pre_listing_showings WHERE id = 102').t && !one('SELECT feedback_asked_at AS t FROM pre_listing_showings WHERE id = 111').t);
statements = 0;
n = await lib.runDueVisitFeedbackPrompts({ env });
check('a second run sends nothing (each visit once)', n === 0 && q('SELECT id FROM notifications WHERE body = ?', lib.VISIT_PROMPT_BODY).length === 3);
check('...and with nothing to claim it stops after 2 statements', statements === 2, String(statements));

// ---- 3. GET as the agent ----
const P10 = { id: '10' };
let r = await call(api.onRequestGet, 'GET', 2, P10);
check('agent GET: eligible visits and their own answers (none yet), private no-store', r.status === 200 && r.json.eligible.length === 2 && r.json.mine.length === 0 && r.json.priceOpen === false && noStore(r), r.text);
r = await call(api.onRequestGet, 'GET', 9, P10);
check('a pending (not approved) agent gets agents_only 403', r.status === 403 && r.json.code === 'agents_only', r.text);
r = await call(api.onRequestGet, 'GET', 7, P10);
check('a member gets agents_only 403', r.status === 403 && r.json.code === 'agents_only');
r = await call(api.onRequestGet, 'GET', 5, P10);
check('an admin who is not an agent gets 403 "Only the homeowner sees visit feedback."', r.status === 403 && r.json.error === 'Only the homeowner sees visit feedback.', r.text);
r = await call(api.onRequestGet, 'GET', 6, P10);
check('the admin who is also an approved agent is treated as an agent (Fair Play)', r.status === 200 && Array.isArray(r.json.eligible) && !('feedback' in r.json));
r = await call(api.onRequestGet, 'GET', 3, P10);
check('a blocked agent gets 404', r.status === 404);
r = await call(api.onRequestGet, 'GET', null, P10);
check('signed out: 401', r.status === 401);
r = await call(api.onRequestGet, 'GET', 1, { id: '999' });
check('a missing home: 404', r.status === 404);

// ---- 4. PUT ----
r = await call(api.onRequestPut, 'PUT', 2, P10, { visitKind: 'showing', visitId: 101, price: 'high', condition: 'touch_ups', topPrep: 'paint_inside', comment: 'The neighbors are loud', note: 'x', priceOpinion: 900000 });
check('the agent saves three taps (200, editableUntil about 48 hours out, private no-store)', r.status === 200 && r.json.ok === true && Math.abs(Date.parse(r.json.editableUntil) - (Date.now() + 48 * H)) < 5 * 60000 && noStore(r), r.text);
const cols = q('PRAGMA table_info(pre_listing_visit_feedback)').map(c => c.name);
check('the table has no free-text column (comment/note are never stored)', !cols.some(c => /comment|note|text|message/.test(c)), cols.join());
let row = one("SELECT * FROM pre_listing_visit_feedback WHERE visit_kind = 'showing' AND visit_id = 101");
check('only the preset answers are stored, with the asking price at the time', row.price === 'high' && row.condition === 'touch_ups' && row.top_prep === 'paint_inside' && row.asking_price_at === 750000 && row.skipped === 0 && row.visit_at === el2[0].visitAt && row.pre_listing_id === 10, JSON.stringify(row));
let alerts = q("SELECT body, emailed_at FROM notifications WHERE user_id = 1");
check('the owner gets one in-app alert with the DRE identity and no answers', alerts.length === 1 && /^Alice Agent · DRE #02000000 · Realty 2 shared quick feedback from their visit\.$/.test(alerts[0].body) && alerts[0].emailed_at === null, JSON.stringify(alerts));
check('...and no email is held or sent for it', one("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 1").n === 0);
r = await call(api.onRequestPut, 'PUT', 2, P10, { visitKind: 'showing', visitId: 101, price: 'about_right', condition: 'ready', topPrep: 'none' });
check('changing the answers keeps one row (upsert)', r.status === 200 && q("SELECT id FROM pre_listing_visit_feedback WHERE visit_id = 101").length === 1 && one('SELECT price, top_prep FROM pre_listing_visit_feedback WHERE visit_id = 101').top_prep === 'none');
check('...and does not alert the owner again', q('SELECT id FROM notifications WHERE user_id = 1').length === 1);
r = await call(api.onRequestPut, 'PUT', 2, P10, { visitKind: 'preview', visitId: 201, skipped: true, price: 'low', condition: 'ready', topPrep: 'staging' });
row = one("SELECT * FROM pre_listing_visit_feedback WHERE visit_kind = 'preview' AND visit_id = 201");
check('"I didn\'t make it" stores no answers', r.status === 200 && row.skipped === 1 && row.price === null && row.condition === null && row.top_prep === null && row.asking_price_at === null, JSON.stringify(row));
check('...and alerts nobody', q('SELECT id FROM notifications WHERE user_id = 1').length === 1);
r = await call(api.onRequestPut, 'PUT', 2, { id: '40' }, { visitKind: 'showing', visitId: 112, price: 'high', condition: 'ready', topPrep: 'declutter' });
row = one('SELECT price, asking_price_at FROM pre_listing_visit_feedback WHERE visit_id = 112');
check('a home posted without a price: the price tap is stored as NULL', r.status === 200 && row.price === null && row.asking_price_at === null, JSON.stringify(row));
r = await call(api.onRequestGet, 'GET', 2, { id: '40' });
check('...and the agent GET says the price is open', r.json.priceOpen === true);
for (const [label, body] of [
  ['no price on a priced home', { condition: 'ready', topPrep: 'none' }],
  ['a made-up price answer', { price: '$800k', condition: 'ready', topPrep: 'none' }],
  ['no condition', { price: 'high', topPrep: 'none' }],
  ['a made-up prep item', { price: 'high', condition: 'ready', topPrep: 'new_kitchen' }],
  ['no prep item', { price: 'high', condition: 'ready' }],
]) {
  r = await call(api.onRequestPut, 'PUT', 6, P10, { visitKind: 'showing', visitId: 110, ...body });
  check(`400 for ${label}`, r.status === 400 && noStore(r), r.text);
}
for (const [label, who, params, body] of [
  ['a showing still to come', 2, P10, { visitKind: 'showing', visitId: 102 }],
  ['a showing 15 days ago', 2, P10, { visitKind: 'showing', visitId: 103 }],
  ['a pending showing', 2, P10, { visitKind: 'showing', visitId: 104 }],
  ['a declined showing', 2, P10, { visitKind: 'showing', visitId: 105 }],
  ['a preview still running', 2, P10, { visitKind: 'preview', visitId: 202 }],
  ["someone else's showing", 2, P10, { visitKind: 'showing', visitId: 110 }],
  ['an agent the owner blocked', 3, P10, { visitKind: 'showing', visitId: 106 }],
  ['an agent who blocked the owner', 4, P10, { visitKind: 'showing', visitId: 107 }],
  ["a suspended owner's home", 2, { id: '20' }, { visitKind: 'showing', visitId: 108 }],
  ['an awarded home', 2, { id: '30' }, { visitKind: 'showing', visitId: 109 }],
]) {
  r = await call(api.onRequestPut, 'PUT', who, params, { price: 'high', condition: 'ready', topPrep: 'none', ...body });
  check(`404 not_eligible: ${label}`, r.status === 404 && r.json.code === 'not_eligible' && r.json.error === "That visit isn't open for feedback.", r.text);
}
r = await call(api.onRequestPut, 'PUT', 1, P10, { visitKind: 'showing', visitId: 101, price: 'high', condition: 'ready', topPrep: 'none' });
check('the owner cannot leave visit feedback (403)', r.status === 403);
r = await call(api.onRequestPut, 'PUT', 9, P10, { visitKind: 'showing', visitId: 101, price: 'high', condition: 'ready', topPrep: 'none' });
check('a pending agent cannot (403)', r.status === 403);
r = await call(api.onRequestPut, 'PUT', 5, P10, { visitKind: 'showing', visitId: 101, price: 'high', condition: 'ready', topPrep: 'none' });
check('an admin who is not an agent cannot (403)', r.status === 403);
r = await call(api.onRequestPut, 'PUT', 2, P10, { visitKind: 'tour', visitId: 101 });
check('a bad visit kind is a 400', r.status === 400);
run("UPDATE pre_listing_visit_feedback SET created_at = datetime('now', '-49 hours') WHERE visit_id = 101");
r = await call(api.onRequestPut, 'PUT', 2, P10, { visitKind: 'showing', visitId: 101, price: 'low', condition: 'ready', topPrep: 'none' });
check('after 48 hours the answers are locked (409 locked)', r.status === 409 && r.json.code === 'locked' && r.json.error === 'Feedback for this visit can no longer be changed.' && one('SELECT price FROM pre_listing_visit_feedback WHERE visit_id = 101').price === 'about_right', r.text);
r = await call(api.onRequestGet, 'GET', 2, P10);
const m101 = r.json.mine.find(m => m.visitId === 101);
check('the agent sees their own answers with editableUntil in the past once locked', m101 && Date.parse(m101.editableUntil) < Date.now() && m101.price === 'about_right' && r.json.mine.every(m => !('agentUserId' in m)), JSON.stringify(r.json.mine));
run("UPDATE pre_listing_visit_feedback SET created_at = datetime('now') WHERE visit_id = 101");

// The operator answers too.
r = await call(api.onRequestPut, 'PUT', 6, P10, { visitKind: 'showing', visitId: 110, price: 'low', condition: 'needs_work', topPrep: 'small_repairs' });
check('the operator account saves like any agent', r.status === 200);
r = await call(api.onRequestGet, 'GET', 6, P10);
check("an agent sees only their own answers, never another agent's", r.json.mine.length === 1 && r.json.mine[0].visitId === 110, JSON.stringify(r.json.mine));
// A stored answer from the blocked agent (made before the block) stays stored but out of the owner's cards.
run("INSERT INTO pre_listing_visit_feedback (pre_listing_id, agent_user_id, visit_kind, visit_id, visit_at, price, asking_price_at, condition, top_prep) VALUES (10, 3, 'showing', 106, ?, 'high', 750000, 'ready', 'none')", iso(Date.now() - H));

// ---- 5. GET as the owner ----
r = await call(api.onRequestGet, 'GET', 1, P10);
const cards = r.json && r.json.feedback;
check("owner GET: answered cards only (not the skipped preview), newest first, private no-store",
  r.status === 200 && noStore(r) && cards.length === 2 && cards.every(c => c.visitKind === 'showing') && cards[0].agent.name === 'Rudy Operator', r.text);
const alice = cards.find(c => c.agent.name === 'Alice Agent');
check("each card carries the agent's DRE identity, the visit and the three answers",
  alice && alice.agent.licenseNumber === '02000000' && alice.agent.brokerageName === 'Realty 2' && alice.agent.isOperator === false
  && alice.price === 'about_right' && alice.condition === 'ready' && alice.topPrep === 'none' && alice.aboutEarlierPrice === false && alice.visitAt === el2[0].visitAt, JSON.stringify(alice));
check('the operator card says so (isOperator)', cards[0].agent.isOperator === true);
check("the blocked agent's stored answer is left out of the owner's cards", !cards.some(c => c.agent.name === 'User 3'));
check('no counts, totals or averages anywhere in the answer', !/"(counts?|totals?|average|avg|mean|median|tally)"/i.test(r.text), r.text);
check('the exact key set on a card', Object.keys(alice).sort().join() === 'aboutEarlierPrice,agent,condition,createdAt,id,price,topPrep,visitAt,visitKind', Object.keys(alice).join());
run('UPDATE pre_listings SET asking_price = 799000 WHERE id = 10');
r = await call(api.onRequestGet, 'GET', 1, P10);
check('after the owner changes the price, the answer says it was about the earlier price', r.json.feedback.every(c => c.aboutEarlierPrice === true));
run('UPDATE pre_listings SET asking_price = 750000 WHERE id = 10');
r = await call(api.onRequestGet, 'GET', 1, { id: '40' });
check('a price-open card has no price and no "earlier price" flag', r.json.feedback.length === 1 && r.json.feedback[0].price === null && r.json.feedback[0].aboutEarlierPrice === false);

// ---- 6. Account delete cascade and the export rows (I's ownerTools statement) ----
const exportApi = await mod('functions/api/account/export.js');
r = await call(exportApi.onRequestGet, 'GET', 1, {});
const ownerTools = (r.json && (r.json.ownerTools || (r.json.data && r.json.data.ownerTools))) || [];
check('export: the owner gets the feedback agents left on their homes (kind visit_feedback_received)', ownerTools.filter(t => t.kind === 'visit_feedback_received').length >= 3, r.text.slice(0, 300));
r = await call(exportApi.onRequestGet, 'GET', 2, {});
const given = ((r.json && (r.json.ownerTools || (r.json.data && r.json.data.ownerTools))) || []).filter(t => t.kind === 'visit_feedback_given');
check('export: the agent gets the feedback they left (kind visit_feedback_given)', given.length === 3, JSON.stringify(given).slice(0, 300));
run('DELETE FROM users WHERE id = 6');
check("deleting an agent's account deletes their answers", one('SELECT COUNT(*) AS n FROM pre_listing_visit_feedback WHERE agent_user_id = 6').n === 0);
run('DELETE FROM pre_listings WHERE id = 40');
check('deleting a pre-listing deletes its answers', one('SELECT COUNT(*) AS n FROM pre_listing_visit_feedback WHERE pre_listing_id = 40').n === 0);

// ---- 7. Jury scans (source) ----
for (const f of ['functions/_lib/scorecard.js', 'functions/_lib/agentDirectory.js', 'functions/_lib/brag.js', 'functions/profile/[id].js', 'tools/amico-growth-report.js']) {
  check(`visit feedback never appears in ${f}`, !existsSync(`${root}/${f}`) || !/visit_feedback|visitFeedback|VisitFeedback/.test(read(f)));
}
const libSrc = read('functions/_lib/visitFeedback.js');
const apiSrc = read('functions/api/pre-listings/[id]/visit-feedback.js');
check('the server never averages, sums or ranks the answers', !/\b(AVG|SUM|MEDIAN)\s*\(|ORDER BY[^`]*price/i.test(libSrc + apiSrc));
check('the answers never reach the alert (notifyVisitFeedback takes no answers)', /notifyVisitFeedback\(context, home\.id, home\.user_id, user\.id\)/.test(apiSrc));
const notifySrc = read('functions/_lib/marketplaceNotify.js');
const nvf = notifySrc.slice(notifySrc.indexOf('export async function notifyVisitFeedback'));
check('notifyVisitFeedback is in-app only (no email path)', !/notifyAndMaybeEmail|sendEmail|sendOrHoldEmail/.test(nvf.slice(0, nvf.indexOf('\n}') + 2)));
check('the prompt job sends no email or push', !/sendEmail|sendOrHoldEmail|sendPush/.test(libSrc));

// ---- 8. Client renderers (stubbed browser) ----
const noop = () => {};
const sandbox = {
  console, URLSearchParams, setTimeout, clearTimeout, atob, btoa, Notification: {}, navigator: { userAgent: 'node' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop, style: {}, dataset: {} }), body: { classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop }, readyState: 'complete', documentElement: { classList: { add: noop, remove: noop, toggle: noop }, setAttribute: noop, dataset: {} }, referrer: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
for (const f of ['client.js', 'seller-prep.js', 'visit-feedback.js']) vm.runInContext(read(f), sandbox, { filename: f });
const ownerHtml = vm.runInContext(`visitOwnerPanelHtml(${JSON.stringify({ open: true, feedback: [
  { id: 1, agent: { name: 'Alice Agent', licenseNumber: '02000000', brokerageName: 'Realty 2', isOperator: false }, visitKind: 'showing', visitAt: '2026-11-04T18:00:00.000Z', price: 'high', aboutEarlierPrice: true, condition: 'touch_ups', topPrep: 'paint_inside', createdAt: '2026-11-04 20:00:00' },
  { id: 2, agent: { name: 'Rudy Operator', licenseNumber: '02257808', brokerageName: 'CB West', isOperator: true }, visitKind: 'preview', visitAt: '2026-11-03T18:00:00.000Z', price: null, aboutEarlierPrice: false, condition: 'ready', topPrep: 'none', createdAt: '2026-11-03 20:00:00' },
] })})`, sandbox);
check('owner panel: heading and the "not an appraisal" line', ownerHtml.includes('<h3>Visit feedback</h3>') && ownerHtml.includes('Quick answers from agents after their visits, on Amico Haus only. Opinions about the home, not an appraisal.'));
check('owner panel: identity line, "After the <date> showing / broker preview", never "Visited"', ownerHtml.includes('Alice Agent · DRE #02000000 · Realty 2') && ownerHtml.includes('After the Nov 4 showing') && ownerHtml.includes('After the Nov 3 broker preview') && !/Visited/i.test(ownerHtml), ownerHtml);
check('owner panel: the answers in words', ownerHtml.includes('Asking price: Feels high (about your earlier price)') && ownerHtml.includes('Condition: A few touch-ups') && ownerHtml.includes('Would help most: Fresh paint inside') && ownerHtml.includes('Would help most: Nothing needed'));
check('owner panel: the operator line', ownerHtml.includes('Rudy Operator · DRE #02257808 · CB West (platform operator: runs Amico Haus)'));
check('owner panel: no price line when there was no price tap', (ownerHtml.match(/Asking price:/g) || []).length === 1);
check('owner panel: empty while open', vm.runInContext('visitOwnerPanelHtml({ open: true, feedback: [] })', sandbox).includes('No visit feedback yet. After an accepted showing or a broker preview, visiting agents can leave three quick taps here.'));
check('owner panel: nothing at all when not open and empty', vm.runInContext('visitOwnerPanelHtml({ open: false, feedback: [] })', sandbox) === '');
const agentHtml = vm.runInContext(`visitAgentPanelHtml(${JSON.stringify({ open: true, priceOpen: false, eligible: [{ visitKind: 'showing', visitId: 101, visitAt: '2026-11-04T18:00:00.000Z' }, { visitKind: 'preview', visitId: 201, visitAt: '2026-11-03T18:00:00.000Z' }], mine: [{ visitKind: 'showing', visitId: 101, skipped: false, price: 'high', condition: 'ready', topPrep: 'staging', editableUntil: new Date(Date.now() + 3600000).toISOString() }] })})`, sandbox);
check('agent panel: heading, privacy line and the price question', agentHtml.includes('<h3>Quick feedback for the homeowner</h3>') && agentHtml.includes('About the home, from your visit on Nov 4. The homeowner sees your answers with your name and DRE number. Nothing here is public.') && agentHtml.includes("The asking price, now that you've seen it"));
check('agent panel: taps carry aria-pressed (saved answer pressed)', /data-group="price" data-value="high" aria-pressed="true"/.test(agentHtml) && /data-group="condition" data-value="ready" aria-pressed="true"/.test(agentHtml) && /aria-pressed="false"/.test(agentHtml));
check('agent panel: the prep select has a label tied to it, with "Nothing needed"', agentHtml.includes('<label for="vfTopPrep-showing-101">One thing that would help most</label><select id="vfTopPrep-showing-101">') && agentHtml.includes('<option value="none">Nothing needed</option>') && agentHtml.includes('<option value="staging" selected>'));
check('agent panel: the two buttons and the 48-hour line', agentHtml.includes('Send to the homeowner') && agentHtml.includes("I didn't make it") && agentHtml.includes('Sent. You can change your answers for 48 hours.'));
check('agent panel: no free-text box anywhere', !/<textarea|type="text"/.test(agentHtml));
const openHtml = vm.runInContext(`visitAgentPanelHtml(${JSON.stringify({ priceOpen: true, eligible: [{ visitKind: 'showing', visitId: 112, visitAt: '2026-11-04T18:00:00.000Z' }], mine: [] })})`, sandbox);
check('agent panel: a price-open home offers a price opinion instead of the price taps', openHtml.includes('This home was posted without a price. You can share a price opinion instead.') && !/data-group="price"/.test(openHtml));
check('agent panel: nothing when no visit is open', vm.runInContext('visitAgentPanelHtml({ eligible: [], mine: [] })', sandbox) === '');
const clientSrc = read('visit-feedback.js');
const clientCode = clientSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // the copy and code, not the comments
check('visit-feedback.js: no inline style or handler, no "verified", no averages or win rates', !/\sstyle\s*=|\son[a-z]+\s*=\s*["'`]/i.test(clientCode) && !/verified|average|win rate/i.test(clientCode));
check('visit-feedback.js: the "not an appraisal" line is in the copy', clientSrc.includes('not an appraisal'));
const tops = [...clientSrc.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1] || m[2]);
check('visit-feedback.js: every top-level name is loadVisitFeedbackInto or starts with visit/VISIT_', tops.every(nm => nm === 'loadVisitFeedbackInto' || /^(visit|VISIT_)/.test(nm)), tops.join());

console.log = realLog;
console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
