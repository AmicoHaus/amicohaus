// Runs the real handlers for the Ready Meter (batch R3-1b) against an in-memory SQLite stand-in for D1: the Pacific
// week key and nudge window, the owner-only weekly check-in and settings (PUT /ready), "What agents see" on the detail
// GET (facts always, the listing-ready count, target MONTH and band only when the owner shares), the in-app weekly
// nudge job, the admin totals (20+ homeowners only, no slices), the data export and the delete cascade, and the
// client renderers in a stubbed browser. Emails and fetches are counted by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/ready-meter-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const read = (f) => readFileSync(`${root}/${f}`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON;');
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
};
const env = { DB, PHOTOS, EMAIL_DEV_LOG: '1' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
let fetches = 0;
globalThis.fetch = async () => { fetches++; return new Response('{}', { status: 200 }); };
const call = async (handler, method, path, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${path}`, {
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
  run('INSERT INTO users (id, email, display_name, role, status, email_confirmation_pending) VALUES (?, ?, ?, ?, ?, ?)',
    id, extra.email ?? `u${id}@example.test`, `User ${id}`, extra.role ?? 'user', extra.status ?? 'active', extra.pending ?? 0);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
const agent = (id) => run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', ?, 'Test Realty')", id, `0${id}000000`.slice(0, 8));
const home = (id, owner, extra = {}) => run(
  `INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address, status, listing_ready_json, target_list_date, created_at)
   VALUES (?, ?, 'Home', 'Chula Vista', 'CA', '91913', 'Single Family Home', 3, 2, 750000, '1 Hidden Ave', ?, ?, ?, ?)`,
  id, owner, extra.status ?? 'open', extra.listingReady ?? '[]', extra.target ?? null, extra.createdAt ?? '2026-10-01 00:00:00');

const lib = await mod('functions/_lib/readyMeter.js');
const agentDuty = await mod('functions/_lib/agentDuty.js');
const readyApi = await mod('functions/api/pre-listings/[id]/ready.js');
const detail = await mod('functions/api/pre-listings/[id].js');
const adminApi = await mod('functions/api/admin/ready-meter.js');
const exportApi = await mod('functions/api/account/export.js');
const at = (y, mo, d, h, mi) => agentDuty.pacificToUtcMs(y, mo, d, h, mi);

// ---- 1. Pacific week key, the nudge window, bands and topics ----
check('Sunday belongs to the week that began the Monday before', lib.pacificWeekKey(at(2026, 11, 8, 10, 0)) === '2026-11-02', lib.pacificWeekKey(at(2026, 11, 8, 10, 0)));
check('Monday just after midnight starts its own week', lib.pacificWeekKey(at(2026, 11, 2, 0, 30)) === '2026-11-02');
check('the Sunday daylight saving ends', lib.pacificWeekKey(at(2026, 11, 1, 12, 0)) === '2026-10-26', lib.pacificWeekKey(at(2026, 11, 1, 12, 0)));
check('the Sunday daylight saving starts', lib.pacificWeekKey(at(2027, 3, 14, 12, 0)) === '2027-03-08', lib.pacificWeekKey(at(2027, 3, 14, 12, 0)));
check('the Monday after daylight saving starts', lib.pacificWeekKey(at(2027, 3, 15, 8, 0)) === '2027-03-15');
check('no nudge Thursday before 10am', lib.readyNudgeWeek(at(2026, 11, 5, 9, 59)) === null);
check('nudges from Thursday 10am', lib.readyNudgeWeek(at(2026, 11, 5, 10, 0)) === '2026-11-02');
check('nudges through Saturday night', lib.readyNudgeWeek(at(2026, 11, 7, 23, 59)) === '2026-11-02');
check('no nudge on Sunday or Wednesday', lib.readyNudgeWeek(at(2026, 11, 8, 12, 0)) === null && lib.readyNudgeWeek(at(2026, 11, 4, 12, 0)) === null);
check('bands: 1-2 exploring, 3-4 getting close, 5 ready', [1, 2, 3, 4, 5].map(lib.bandFor).join() === 'exploring,exploring,getting_close,getting_close,ready');
check('topics are exactly the five about the home and the process', Object.keys(lib.READY_TOPICS).join() === 'timing,money,where_next,house_ready,picking_agent');
const LIFE = /\b(health|ill|sick|divorce|death|died|funeral|baby|pregnan\w*|jobs?|school|retire\w*|family|kids|age|language|religio\w*|disab\w*|marri\w*)\b/i;
check('no topic key or label is about a life event', !Object.entries(lib.READY_TOPICS).some(([k, v]) => LIFE.test(k.replace(/_/g, ' ')) || LIFE.test(v)));
check('bands are the owner\'s words, never "verified"', JSON.stringify(lib.READY_BANDS) === '{"exploring":"Exploring","getting_close":"Getting close","ready":"Ready"}');

// People: 1 owner, 2 approved agent, 3 approved agent the owner blocked, 4 plain member, 5 admin (no agent profile),
// 6 admin with an approved agent profile (the operator), 7 another homeowner.
for (const id of [1, 2, 3, 4, 7]) user(id);
user(5, { role: 'admin' }); user(6, { role: 'admin' });
agent(2); agent(3); agent(6);
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 3)');
home(10, 1, { listingReady: '["payoff","keys","bogus"]', target: '2027-03-17' });
home(11, 1, { status: 'awarded' });
home(13, 1, { status: 'closed' });
home(12, 7);
run("INSERT INTO service_bids (request_type, request_id, agent_user_id, commission_pct, status) VALUES ('pre_listing', 11, 2, 2.5, 'accepted')");
run('UPDATE pre_listings SET awarded_bid_id = (SELECT id FROM service_bids WHERE request_id = 11) WHERE id = 11');
for (let i = 0; i < 3; i++) run("INSERT INTO pre_listing_photos (pre_listing_id, r2_key, content_type, position) VALUES (10, ?, 'image/jpeg', ?)", `k${i}`, i);
const P10 = { id: '10' };

// ---- 2. Detail GET before any check-in ----
let r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
const rm0 = r.json.preListing.readyMeter;
check('owner: a check-in is due on an open home, with the settings off', r.status === 200 && rm0 && rm0.due === true && rm0.latest === null && rm0.shareReadiness === false && rm0.remindersOff === false && rm0.weekKey === lib.pacificWeekKey(), JSON.stringify(rm0));
const ownerAv = r.json.preListing.agentView;
check('owner: "What agents see" has the always-on facts only', ownerAv && ownerAv.photoCount === 3 && ownerAv.hasVideo === false && ownerAv.hasUpcomingPreview === false && ownerAv.proposalsDueAt === null && ownerAv.shared === false
  && !('checklistDone' in ownerAv) && !('targetListMonth' in ownerAv) && !('band' in ownerAv), JSON.stringify(ownerAv));

// ---- 3. PUT /ready ----
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { readiness: 3, topic: 'house_ready' });
check('the owner checks in', r.status === 200 && r.json.readyMeter.latest.readiness === 3 && r.json.readyMeter.latest.topic === 'house_ready' && r.json.readyMeter.due === false && r.json.readyMeter.latest.fresh === true, JSON.stringify(r.json));
check('the check-in answer is private: no-store', noStore(r));
check('the answer carries the owner\'s "What agents see" too', r.json.agentView && r.json.agentView.photoCount === 3 && r.json.agentView.shared === false);
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { readiness: 4, topic: 'picking_agent' });
const rows10 = q('SELECT readiness, topic FROM pre_listing_checkins WHERE pre_listing_id = 10');
check('a second answer the same week replaces the first', r.status === 200 && rows10.length === 1 && rows10[0].readiness === 4 && rows10[0].topic === 'picking_agent', JSON.stringify(rows10));
for (const bad of [0, 6, 3.5, 'x', '3', null]) {
  r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { readiness: bad, topic: 'money' });
  check(`readiness ${JSON.stringify(bad)} is refused`, r.status === 400 && r.json.error === 'Pick how ready you feel, from 1 to 5.', JSON.stringify(r.json));
}
for (const bad of ['health', 'divorce', 'family', '', 'TIMING']) {
  r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { readiness: 3, topic: bad });
  check(`topic "${bad}" is refused`, r.status === 400 && r.json.error === "Pick what's on your mind.", JSON.stringify(r.json));
}
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { readiness: 3 });
check('a check-in without a topic is refused', r.status === 400 && r.json.error === "Pick what's on your mind.");
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { topic: 'money' });
check('a check-in without a readiness is refused', r.status === 400 && r.json.error === 'Pick how ready you feel, from 1 to 5.');
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, {});
check('an empty body: "Nothing to save."', r.status === 400 && r.json.error === 'Nothing to save.');
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { shareReadiness: 'yes', remindersOff: 1 });
check('settings must be true or false', r.status === 400 && r.json.error === 'Nothing to save.');
check('refused answers saved nothing', JSON.stringify(q('SELECT readiness, topic FROM pre_listing_checkins WHERE pre_listing_id = 10')) === JSON.stringify(rows10));
for (const [who, label] of [[2, 'an approved agent'], [7, 'another homeowner'], [5, 'an admin'], [6, 'the admin who is also an agent'], [4, 'a plain member']]) {
  r = await call(readyApi.onRequestPut, 'PUT', '/x', who, P10, { readiness: 1, topic: 'timing' });
  check(`${label} can't check in for the owner (403)`, r.status === 403, String(r.status));
  r = await call(readyApi.onRequestPut, 'PUT', '/x', who, P10, { shareReadiness: true });
  check(`${label} can't change the owner's settings (403)`, r.status === 403, String(r.status));
}
r = await call(readyApi.onRequestPut, 'PUT', '/x', null, P10, { readiness: 1, topic: 'timing' });
check('signed out: 401', r.status === 401);
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, { id: '999' }, { readiness: 1, topic: 'timing' });
check('no such home: 404', r.status === 404 && r.json.error === 'Pre-listing not found.');
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, { id: '13' }, { readiness: 2, topic: 'timing' });
check('a closed home takes no check-in (not_open)', r.status === 400 && r.json.code === 'not_open' && r.json.error === 'Weekly check-ins are for open pre-listings.', JSON.stringify(r.json));
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, { id: '13' }, { readiness: 2, topic: 'timing', shareReadiness: true });
check('a refused check-in saves the settings sent with it neither', r.status === 400 && one('SELECT share_readiness AS s FROM pre_listings WHERE id = 13').s === 0);
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, { id: '13' }, { shareReadiness: true, remindersOff: true });
const s13 = one('SELECT share_readiness, ready_reminders_off FROM pre_listings WHERE id = 13');
check('...but a closed home\'s settings still save', r.status === 200 && s13.share_readiness === 1 && s13.ready_reminders_off === 1 && r.json.agentView === null && r.json.readyMeter.due === false, JSON.stringify(r.json));
run('UPDATE pre_listings SET ready_nudges_unanswered = 2 WHERE id = 10');
await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { readiness: 4, topic: 'picking_agent' });
check('a check-in resets the unanswered nudge count', one('SELECT ready_nudges_unanswered AS n FROM pre_listings WHERE id = 10').n === 0);
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { remindersOff: true });
check('the owner stops weekly reminders', r.status === 200 && r.json.readyMeter.remindersOff === true && one('SELECT ready_reminders_off AS v FROM pre_listings WHERE id = 10').v === 1);
run('UPDATE pre_listings SET ready_nudges_unanswered = 3 WHERE id = 10');
r = await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { remindersOff: false });
const s10 = one('SELECT ready_reminders_off AS off, ready_nudges_unanswered AS n FROM pre_listings WHERE id = 10');
check('turning reminders back on starts the count again', r.status === 200 && s10.off === 0 && s10.n === 0 && r.json.readyMeter.remindersOff === false, JSON.stringify(s10));
check('no rate-limit rows are written', one('SELECT COUNT(*) AS n FROM user_action_log').n === 0);
check('nothing notifies anyone on a check-in', one('SELECT COUNT(*) AS n FROM notifications').n === 0 && fetches === 0);

// ---- 4. Detail GET: what agents see ----
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
check('owner: after the check-in nothing is due, and the latest answer is fresh', r.json.preListing.readyMeter.due === false && r.json.preListing.readyMeter.latest.readiness === 4 && r.json.preListing.readyMeter.latest.fresh === true);
r = await call(detail.onRequestGet, 'GET', '/x', 2, P10);
let av = r.json.preListing.agentView;
check('agent: the always-on facts, shared false', r.status === 200 && av && av.photoCount === 3 && av.hasVideo === false && av.hasUpcomingPreview === false && av.proposalsDueAt === null && av.shared === false, JSON.stringify(av));
check('agent: no count, month or band keys without sharing', ['checklistDone', 'checklistTotal', 'targetListMonth', 'band', 'bandAsOf'].every(k => !(k in av)), JSON.stringify(av));
check('agent: never the check-in itself', !/readyMeter|readiness|"topic"|remindersOff|picking_agent/.test(r.text), r.text.match(/readyMeter|readiness|"topic"|remindersOff|picking_agent/));
check('agent: the target date and checklist stay owner-only (seller-prep rule)', r.json.preListing.listingReady === undefined && r.json.preListing.targetListDate === undefined);
check('agent: no target month or day without sharing', !r.text.includes('2027-03'));

await call(readyApi.onRequestPut, 'PUT', '/x', 1, P10, { shareReadiness: true });
const future = new Date(Date.now() + 48 * 3600000).toISOString();
run('INSERT INTO pre_listing_previews (pre_listing_id, starts_at, ends_at) VALUES (10, ?, ?)', future, new Date(Date.now() + 50 * 3600000).toISOString());
run("UPDATE pre_listings SET video_r2_key = 'video/abcdefgh12345678', proposals_due_at = ? WHERE id = 10", future);
r = await call(detail.onRequestGet, 'GET', '/x', 2, P10);
av = r.json.preListing.agentView;
const wk = lib.pacificWeekKey();
check('shared: the band from a fresh check-in, as of its week', av.shared === true && av.band === 'getting_close' && av.bandAsOf === wk, JSON.stringify(av));
check('shared: the listing-ready count (unknown keys dropped)', av.checklistDone === 2 && av.checklistTotal === 9, JSON.stringify(av));
check('shared: the target list MONTH only, never the day', av.targetListMonth === '2027-03' && r.text.includes('2027-03') && !r.text.includes('2027-03-17') && !r.text.includes('"17"'));
check('shared: video, upcoming preview and Decision Night show', av.hasVideo === true && av.hasUpcomingPreview === true && av.proposalsDueAt === future);
check('shared: still never the number picked or the topic', !/readyMeter|readiness|"topic"|remindersOff|picking_agent/.test(r.text));
check('agentView never mentions disclosures', !Object.keys(av).some(k => /disclos/i.test(k)));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
check('the owner gets exactly what agents see', JSON.stringify(r.json.preListing.agentView) === JSON.stringify(av), `${JSON.stringify(r.json.preListing.agentView)} / ${JSON.stringify(av)}`);
run("UPDATE pre_listing_checkins SET updated_at = datetime('now', '-31 days') WHERE pre_listing_id = 10");
r = await call(detail.onRequestGet, 'GET', '/x', 2, P10);
check('a stale check-in (31 days) shows no band', r.json.preListing.agentView.band === null && r.json.preListing.agentView.bandAsOf === null);
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
check('owner: the stale answer is not fresh (and the tools keep the default order)', r.json.preListing.readyMeter.latest.fresh === false);
run("UPDATE pre_listing_checkins SET updated_at = datetime('now') WHERE pre_listing_id = 10");
home(14, 1); run('UPDATE pre_listings SET share_readiness = 1 WHERE id = 14');
r = await call(detail.onRequestGet, 'GET', '/x', 2, { id: '14' });
check('shared with no check-in: no band, month not picked', r.json.preListing.agentView.band === null && r.json.preListing.agentView.targetListMonth === null && r.json.preListing.agentView.checklistDone === 0);
r = await call(detail.onRequestGet, 'GET', '/x', 6, P10);
check('the admin who is also an agent gets exactly the agent shape, no readyMeter', r.status === 200 && JSON.stringify(r.json.preListing.agentView) === JSON.stringify(av) && r.json.preListing.readyMeter === undefined && !/readiness|"topic"/.test(r.text));
r = await call(detail.onRequestGet, 'GET', '/x', 5, P10);
check('a plain admin gets neither', r.status === 200 && r.json.preListing.agentView === undefined && r.json.preListing.readyMeter === undefined && !/readiness|"topic"/.test(r.text));
r = await call(detail.onRequestGet, 'GET', '/x', 3, P10);
check('a blocked agent: 404', r.status === 404);
r = await call(detail.onRequestGet, 'GET', '/x', 4, P10);
check('a plain member: 403 agents_only', r.status === 403 && r.json.code === 'agents_only');
r = await call(detail.onRequestGet, 'GET', '/x', 2, { id: '11' });
check('an awarded home: no agentView for the hired agent', r.status === 200 && r.json.preListing.agentView === undefined);
r = await call(detail.onRequestGet, 'GET', '/x', 1, { id: '11' });
check('an awarded home: the owner keeps readyMeter (nothing due), no agentView', r.json.preListing.readyMeter && r.json.preListing.readyMeter.due === false && r.json.preListing.agentView === undefined);
check('the detail is no-store', noStore(r));

// ---- 5. Export, then the delete cascade ----
r = await call(exportApi.onRequestGet, 'GET', '/api/account/export', 1);
check("the owner's export has their check-ins", r.status === 200 && r.json.readyCheckIns.length === 1 && r.json.readyCheckIns[0].pre_listing_id === 10 && r.json.readyCheckIns[0].topic === 'picking_agent', JSON.stringify(r.json && r.json.readyCheckIns));
r = await call(exportApi.onRequestGet, 'GET', '/api/account/export', 2);
check("an agent's export has none of them", r.status === 200 && r.json.readyCheckIns.length === 0 && !r.text.includes('picking_agent'));
home(15, 1);
await call(readyApi.onRequestPut, 'PUT', '/x', 1, { id: '15' }, { readiness: 2, topic: 'timing' });
const before15 = one('SELECT COUNT(*) AS n FROM pre_listing_checkins WHERE pre_listing_id = 15').n;
r = await call(detail.onRequestDelete, 'DELETE', '/x', 1, { id: '15' });
check('deleting the pre-listing removes its check-ins', before15 === 1 && r.status === 200 && one('SELECT COUNT(*) AS n FROM pre_listing_checkins WHERE pre_listing_id = 15').n === 0, `${before15} ${r.status} ${r.text}`);

// ---- 6. The weekly nudge job ----
const mw = read('functions/api/_middleware.js');
check('_middleware runs the nudge right after the scorecards', /runDueScorecards, runDueReadyNudges, runPurgeExpiredTrash/.test(mw) && mw.includes("import { runDueReadyNudges } from '../_lib/readyMeter.js';"));
check('_middleware skips the jobs on the data export', mw.includes("if (new URL(context.request.url).pathname === '/api/account/export') return;"));
run('UPDATE pre_listings SET ready_reminders_off = 1'); // the homes above stay out of the job's counts
const nudgeOwners = { 40: {}, 41: {}, 42: {}, 43: {}, 44: { email: 'x44@demo.amicohaus.local' }, 45: { status: 'suspended' }, 46: {}, 47: {}, 48: {}, 49: {} };
for (const [h, extra] of Object.entries(nudgeOwners)) user(100 + Number(h), extra);
home(40, 140); home(41, 141); home(42, 142, { status: 'closed' }); home(43, 143, { status: 'awarded' }); home(44, 144); home(45, 145);
home(46, 146, { createdAt: '2026-11-09 00:00:00' }); home(47, 147); home(48, 148); home(49, 149);
run('UPDATE pre_listings SET ready_reminders_off = 1 WHERE id = 41');
run('UPDATE pre_listings SET ready_nudges_unanswered = 3 WHERE id = 48');
run("INSERT INTO pre_listing_checkins (pre_listing_id, week_key, readiness, topic) VALUES (47, '2026-11-09', 3, 'timing')");
const jobCtx = { env };
const notesBefore = one('SELECT COUNT(*) AS n FROM notifications').n;
check('outside Thursday-Saturday: nothing (Wednesday)', await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 11, 12, 0) }) === 0);
check('outside Thursday-Saturday: nothing (Thursday 9:59am)', await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 12, 9, 59) }) === 0);
check('outside Thursday-Saturday: nothing (Sunday)', await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 15, 12, 0) }) === 0);
check('outside the window nothing is claimed', one('SELECT COUNT(*) AS n FROM pre_listings WHERE ready_nudge_week IS NOT NULL').n === 0 && one('SELECT COUNT(*) AS n FROM notifications').n === notesBefore);
let n = await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 12, 11, 0) });
const nudged = q("SELECT user_id, type, body, link FROM notifications WHERE body LIKE 'Weekly check-in%' ORDER BY user_id");
const BODY = "Weekly check-in: how ready do you feel this week? It's two taps, and your answers stay private.";
check('Thursday 11am: the two eligible homes are nudged', n === 2 && nudged.map(x => x.user_id).join() === '140,149', `${n} ${JSON.stringify(nudged)}`);
check('the nudge: exact body, in-app type, link to the home', nudged.every(x => x.body === BODY && x.type === 'marketplace') && nudged[0].link === '/app#pre-listing-40' && nudged[1].link === '/app#pre-listing-49', JSON.stringify(nudged));
check('the nudge never says "only you see"', !/only you see/i.test(BODY));
check('skipped: reminders off, closed, awarded, demo, suspended, new, checked in, 3 unanswered',
  [41, 42, 43, 44, 45, 46, 47, 48].every(h => one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', 100 + h).n === 0));
check('the claim is recorded for the week', one('SELECT ready_nudge_week AS w, ready_nudges_unanswered AS u FROM pre_listings WHERE id = 40').w === '2026-11-09' && one('SELECT ready_nudges_unanswered AS u FROM pre_listings WHERE id = 40').u === 1);
n = await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 14, 23, 0) });
check('a second run the same week sends nothing', n === 0 && one("SELECT COUNT(*) AS n FROM notifications WHERE body LIKE 'Weekly check-in%'").n === 2);
check('the limit is respected', await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 19, 11, 0), limit: 1 }) === 1);
await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 19, 12, 0) });
// Homes 46 (now a week old) and 47 (checked in only the first week) join from week 2.
const nudgesTo = (uid) => one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND body LIKE 'Weekly check-in%'", uid).n;
check('week 2: the home posted 3 days before week 1 and the one checked in only in week 1 now get nudged', nudgesTo(146) === 1 && nudgesTo(147) === 1);
await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 11, 26, 11, 0) });
check('week 3: still nudged (3 unanswered now)', nudgesTo(140) === 3 && nudgesTo(149) === 3 && one('SELECT ready_nudges_unanswered AS u FROM pre_listings WHERE id = 40').u === 3);
n = await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 12, 3, 11, 0) });
check('after 3 unanswered nudges in a row: none (the later homes get their third)', n === 2 && nudgesTo(140) === 3 && nudgesTo(149) === 3 && nudgesTo(146) === 3 && nudgesTo(147) === 3, String(n));
check('a fifth week: nobody', await lib.runDueReadyNudges(jobCtx, { nowMs: at(2026, 12, 10, 11, 0) }) === 0);
check('the nudge sends no email and makes no fetch', one('SELECT COUNT(*) AS n FROM held_emails').n === 0 && fetches === 0);

// ---- 7. Admin totals ----
run('DELETE FROM pre_listing_checkins');
const ownerWithCheckIn = (uid, hid, readiness, topic, extra = {}, ago = 0) => {
  user(uid, extra); home(hid, uid);
  run("INSERT INTO pre_listing_checkins (pre_listing_id, week_key, readiness, topic, updated_at) VALUES (?, ?, ?, ?, datetime('now', ?))", hid, `2026-${String(uid).slice(-2)}`, readiness, topic, `-${ago} days`);
};
const topics = Object.keys(lib.READY_TOPICS);
for (let i = 0; i < 19; i++) ownerWithCheckIn(200 + i, 300 + i, (i % 5) + 1, topics[i % 5], {}, 1);
// Owner 200 answered three weeks running: only the latest counts.
run("INSERT INTO pre_listing_checkins (pre_listing_id, week_key, readiness, topic, updated_at) VALUES (300, '2026-a', 1, 'timing', datetime('now', '-20 days'))");
run("INSERT INTO pre_listing_checkins (pre_listing_id, week_key, readiness, topic, updated_at) VALUES (300, '2026-b', 2, 'money', datetime('now', '-13 days'))");
ownerWithCheckIn(230, 330, 5, 'money', { email: 'x230@demo.amicohaus.local' });
ownerWithCheckIn(231, 331, 5, 'money', { role: 'admin' });
ownerWithCheckIn(232, 332, 5, 'money', { email: 'x232@resend.dev' });
ownerWithCheckIn(233, 333, 5, 'money', { pending: 1 });
ownerWithCheckIn(234, 334, 5, 'money', {}, 100);
ownerWithCheckIn(235, 335, 5, 'money', { status: 'suspended' });
r = await call(adminApi.onRequestGet, 'GET', '/x', null);
check('admin totals: 401 signed out', r.status === 401);
r = await call(adminApi.onRequestGet, 'GET', '/x', 2);
check('admin totals: 403 for an agent', r.status === 403 && r.json.error === 'Admin only.');
r = await call(adminApi.onRequestGet, 'GET', '/x', 5);
check('19 real homeowners: no totals yet', r.status === 200 && r.json.owners === 19 && r.json.totals === null && r.json.minShown === 20 && r.json.windowDays === 90, JSON.stringify(r.json));
ownerWithCheckIn(219, 319, 3, 'house_ready', {}, 2);
r = await call(adminApi.onRequestGet, 'GET', '/x', 5);
const t = r.json.totals;
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
check('20 real homeowners: totals that add up to 20', r.json.owners === 20 && t && sum(t.readiness) === 20 && sum(t.band) === 20 && sum(t.topic) === 20, JSON.stringify(r.json));
check('totals keys: readiness 1-5, the three bands, the five topics', Object.keys(t.readiness).join() === '1,2,3,4,5' && Object.keys(t.band).join() === 'exploring,getting_close,ready' && Object.keys(t.topic).join() === topics.join());
check('only the latest answer per homeowner counts (demo, admin, test, pending, old and suspended left out)', t.readiness['1'] === 4 && t.topic.timing === 4, JSON.stringify(t));
check('admin totals never carry a ZIP, city, home, person or email', !/zip|city|preListing|userId|email|week/i.test(r.text), r.text);
check('admin totals are no-store', noStore(r));

// ---- 8. Client renderers (client.js + ready-meter.js in a stubbed browser) ----
const noop = () => {};
const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, setAttribute: noop, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null });
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
try { for (const f of ['client.js', 'ready-meter.js']) vm.runInContext(read(f), sandbox, { filename: f }); } catch (e) { loaded = false; realLog(e); }
check('client.js + ready-meter.js load together', loaded);
vm.runInContext('this.__r = { readyToolOrder, ownerToolsHtml, readyCheckInHtml, agentViewStripHtml, agentViewOwnerPanelHtml, READY_TOPIC_LABELS };', sandbox);
const c = sandbox.__r;
const DEFAULT = 'video,opinions,agent_view,address,edit,disclosures,listing_ready,timing,previews,interviews,showings,decision_night,proposals';
check('tool order: money puts proposals and opinions first', c.readyToolOrder('money').slice(0, 2).join() === 'proposals,opinions' && c.readyToolOrder('money').length === 13);
check('tool order: unknown or missing topic = the default', c.readyToolOrder('nope').join() === DEFAULT && c.readyToolOrder(null).join() === DEFAULT && c.readyToolOrder('constructor').join() === DEFAULT);
check('tool order: every topic keeps all 13 once, and "edit" is never promoted', topics.every(k => { const o = c.readyToolOrder(k); return o.length === 13 && new Set(o).size === 13 && o[0] !== 'edit' && o.indexOf('edit') >= o.indexOf('address'); }));
check('tool order: the exact promotions', c.readyToolOrder('timing').slice(0, 3).join() === 'timing,listing_ready,decision_night' && c.readyToolOrder('where_next').slice(0, 2).join() === 'timing,proposals'
  && c.readyToolOrder('house_ready').slice(0, 5).join() === 'listing_ready,video,opinions,previews,disclosures' && c.readyToolOrder('picking_agent').slice(0, 3).join() === 'proposals,interviews,decision_night');
check('client topic labels match the server', JSON.stringify(c.READY_TOPIC_LABELS) === JSON.stringify(lib.READY_TOPICS));
const tools = c.ownerToolsHtml({ video: '<p>V</p>', opinions: '', proposals: '<p>P</p>' }, { latest: { topic: 'money', fresh: true } });
check('owner tools: empty segments skipped, the rest wrapped by data-tool in the topic order', tools === '<div id="ownerTools"><div class="owner-tool" data-tool="proposals"><p>P</p></div><div class="owner-tool" data-tool="video"><p>V</p></div></div>', tools);
const staleTools = c.ownerToolsHtml({ video: '<p>V</p>', proposals: '<p>P</p>' }, { latest: { topic: 'money', fresh: false } });
check('owner tools: a stale answer keeps the default order', staleTools.indexOf('data-tool="video"') < staleTools.indexOf('data-tool="proposals"'));
const rmBase = { weekKey: '2026-11-02', due: true, latest: null, shareReadiness: false, remindersOff: false };
const card = c.readyCheckInHtml({ id: 10, status: 'open', readyMeter: rmBase });
check('check-in card: 5 numbers and 5 topics, nothing pressed', (card.match(/data-rm-action="pick-readiness"/g) || []).length === 5 && (card.match(/data-rm-action="pick-topic"/g) || []).length === 5 && !card.includes('aria-pressed="true"'));
check('check-in card: private line when not shared', card.includes('Two taps. Only you see your answers.') && card.includes('Stop weekly reminders'));
const sharedCard = c.readyCheckInHtml({ id: 10, status: 'open', readyMeter: { ...rmBase, shareReadiness: true, remindersOff: true } });
check('check-in card when shared: never "Only you see your answers", says "never the number you pick"', !sharedCard.includes('Only you see your answers') && sharedCard.includes('never the number you pick') && sharedCard.includes('Turn weekly reminders back on'));
const compact = c.readyCheckInHtml({ id: 10, status: 'open', readyMeter: { ...rmBase, due: false, latest: { readiness: 4, topic: 'house_ready', weekKey: '2026-11-02', fresh: true } } });
check('answered this week: the compact line with Change', compact.includes('ready-compact') && compact.includes('4 of 5 · Getting the house ready') && compact.includes('data-rm-action="change-checkin"'), compact);
check('no check-in card on a closed home or without readyMeter', c.readyCheckInHtml({ id: 10, status: 'closed', readyMeter: rmBase }) === '' && c.readyCheckInHtml({ id: 10, status: 'open' }) === '');
const avPlain = { photoCount: 3, hasVideo: false, hasUpcomingPreview: false, proposalsDueAt: null, shared: false };
const strip = c.agentViewStripHtml(avPlain);
check('agent strip without sharing: no "Owner says", no checklist', strip.includes("From the owner's dashboard") && strip.includes('No Decision Night set') && !strip.includes('Owner says') && !/checklist/i.test(strip), strip);
check('no strip without agentView', c.agentViewStripHtml(null) === '');
const avShared = { photoCount: 8, hasVideo: true, hasUpcomingPreview: true, proposalsDueAt: '2026-11-21T03:00:00.000Z', shared: true, checklistDone: 2, checklistTotal: 9, targetListMonth: '2027-03', band: 'getting_close', bandAsOf: '2026-11-02' };
const strip2 = c.agentViewStripHtml(avShared);
check('agent strip when shared: count, month, band in the owner\'s words', strip2.includes('2 of 9 done') && strip2.includes('March 2027') && strip2.includes('Owner says') && strip2.includes('Getting close (week of Nov 2)') && strip2.includes('Nov 20, 7:00 PM') && strip2.includes("owner's own words"), strip2);
const panel = c.agentViewOwnerPanelHtml({ id: 10, status: 'open', agentView: avPlain });
check('owner panel: "What agents see", the hidden note, the share toggle with a label', panel.includes('<summary>What agents see</summary>') && panel.includes('Hidden from agents until you share') && /<label[^>]*for="shareReadinessToggle"/.test(panel) && !panel.includes(' checked'));
check('owner panel tips: plain pointers for what\'s missing', panel.includes('Add photos (up to 8)') && panel.includes('Add a walkthrough video') && panel.includes('Open a broker preview window') && panel.includes('Set a Decision Night') && !panel.includes('Pick a target list date'));
const panel2 = c.agentViewOwnerPanelHtml({ id: 10, status: 'open', agentView: { ...avShared, targetListMonth: null } });
check('owner panel when shared: "You said", checked, checklist + target tips', panel2.includes('You said') && panel2.includes(' checked') && panel2.includes('Pick a target list date') && panel2.includes('Tick off your listing-ready checklist') && !panel2.includes('Add photos') && !panel2.includes('Hidden from agents'));
check('no owner panel without agentView', c.agentViewOwnerPanelHtml({ id: 10 }) === '');
const allHtml = [card, sharedCard, compact, strip, strip2, panel, panel2].join('');
check('no Ready Meter HTML mentions a lender or Point Mortgage', !/lender|Point Mortgage/i.test(allHtml));
check('no tip claims a result', !/more proposals|sell faster|get more|higher price|verified|score/i.test(allHtml));
const src = read('ready-meter.js');
check('ready-meter.js: no inline style or on*= handler', !/\sstyle\s*=\s*["'`]/i.test(src) && !/\son(click|change|input|submit|load)\s*=\s*["'`]/i.test(src));
check('ready-meter.js: every <label> has for=', !/<label(?![^>]*\bfor=)[^>]*>/.test(src));
const topLevel = [...src.matchAll(/^(?:async\s+)?function\s+(\w+)|^(?:const|let|var|class)\s+(\w+)/gm)].map(m => m[1] || m[2]);
const API = ['readyToolOrder', 'ownerToolsHtml', 'readyCheckInHtml', 'agentViewStripHtml', 'agentViewOwnerPanelHtml'];
check('ready-meter.js: top-level names are the 5 API functions or ready/READY_ prefixed', topLevel.every(nm => API.includes(nm) || /^(ready|READY_)/.test(nm)), topLevel.join());
const admin = read('admin-seed.html') + read('page-admin-seed.js');
check('admin page: the totals section and loader', admin.includes('<h2>Ready Meter totals</h2>') && admin.includes('id="readyMeterTotals"') && admin.includes('loadReadyMeterTotals();') && admin.includes('Totals show once'));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
