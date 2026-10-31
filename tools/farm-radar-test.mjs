// Runs the real code for batch B3 (Farm Radar on-duty hours and the Monday agent scorecard) against an in-memory
// SQLite stand-in for D1. Emails are captured by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/farm-radar-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
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
const env = { DB, RESEND_API_KEY: 'test-key' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); };
const ctx = { env, request: new Request('https://amicohaus.com/x'), waitUntil() {} };
const call = async (handler, method, path, who, body, params = {}) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, json: type.includes('json') ? await res.json() : null, text: type.includes('json') ? null : await res.text() };
};
console.log = () => {};

const duty = await mod('functions/_lib/agentDuty.js');
const notifyLib = await mod('functions/_lib/marketplaceNotify.js');
const scorecard = await mod('functions/_lib/scorecard.js');
const dutyApi = await mod('functions/api/agents/duty.js');
const cardApi = await mod('functions/api/agents/scorecard.js');
const unsub = await mod('functions/api/agents/scorecard-unsubscribe.js');

// Today's Pacific weekday, so hours can be made "always off" or "always on" right now.
const today = duty.pacificParts().weekday;
const offDays = JSON.stringify([(today + 3) % 7]);
const allDays = JSON.stringify([0, 1, 2, 3, 4, 5, 6]);

for (const z of [['91913', 32.62, -116.99], ['91910', 32.637, -117.06]]) sqlite.prepare('INSERT INTO zip_codes (zip, lat, lng) VALUES (?, ?, ?)').run(...z);
// 1 homeowner, 2 agent off duty, 3 agent on duty, 4 agent no hours, 5 non-agent, 6 agent opted out
for (const id of [1, 2, 3, 4, 5, 6]) {
  sqlite.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)').run(id, `u${id}@example.test`, `User ${id}`);
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
}
const agent = (id, days, start, end, extra = '') => sqlite.prepare(`INSERT INTO agent_profiles (user_id, status, service_zips_json, notify_new_requests, duty_days_json, duty_start, duty_end${extra ? ', scorecard_opt_out' : ''}) VALUES (?, 'approved', '["91913"]', 1, ?, ?, ?${extra ? ', 1' : ''})`).run(id, days, start, end);
agent(2, offDays, '08:00', '09:00');
agent(3, allDays, '00:00', '23:59');
agent(4, null, null, null);
agent(6, null, null, null, 'optout');

// --- On-duty hours endpoint ---
let r = await call(dutyApi.onRequestPut, 'PUT', '/x', 5, { days: [1], start: '08:00', end: '17:00' });
check('only approved agents set on-duty hours', r.status === 403);
r = await call(dutyApi.onRequestPut, 'PUT', '/x', 4, { days: [1], start: '17:00', end: '08:00' });
check('the end has to be after the start', r.status === 400);
r = await call(dutyApi.onRequestGet, 'GET', '/x', 2);
check('an agent sees their hours and whether they are on duty now', r.status === 200 && r.json.onDutyNow === false && /Pacific/.test(r.json.description), JSON.stringify(r.json));

// --- New-request alerts: in-app right away for everyone; email waits for off-duty agents ---
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price) VALUES (10, 1, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000)").run();
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 10, '91913', [1]);
const inApp = sqlite.prepare("SELECT DISTINCT user_id FROM notifications WHERE body LIKE 'A new pre-listing%' ORDER BY user_id").all().map(x => x.user_id);
check('every agent gets the in-app alert at the same moment (on duty or not)', inApp.join() === '2,3,4,6', JSON.stringify(inApp));
check('agents on duty or without hours get the email now', sent.some(m => m.to === 'u3@example.test') && sent.some(m => m.to === 'u4@example.test'));
check("an off-duty agent's email waits", !sent.some(m => m.to === 'u2@example.test') && sqlite.prepare("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 2 AND sent_at IS NULL").get().n === 1);
const held = sqlite.prepare('SELECT deliver_after FROM held_emails WHERE user_id = 2').get();
check('...until the start of their next on-duty window', Date.parse(held.deliver_after) > Date.now() && duty.isOnDuty({ days: JSON.parse(offDays), start: '08:00', end: '09:00' }, Date.parse(held.deliver_after)), held.deliver_after);

// --- Held emails go out once their time comes, once ---
let n = await duty.runDueHeldEmails(ctx);
check('nothing goes out before its time', n === 0);
sqlite.prepare("UPDATE held_emails SET deliver_after = ? WHERE user_id = 2").run(new Date(Date.now() - 1000).toISOString());
const before = sent.length;
n = await duty.runDueHeldEmails(ctx);
check('a held email goes out when its time comes', n === 1 && sent.length === before + 1 && sent[sent.length - 1].to === 'u2@example.test');
check('...and only once', (await duty.runDueHeldEmails(ctx)) === 0);
// Clearing hours releases anything still waiting.
sqlite.prepare("INSERT INTO held_emails (user_id, kind, subject, text_body, deliver_after) VALUES (2, 'other', 's', 't', ?)").run(new Date(Date.now() + 86400000).toISOString());
r = await call(dutyApi.onRequestPut, 'PUT', '/x', 2, { clear: true });
check('clearing your hours sends what was waiting on the next run', r.status === 200 && r.json.duty === null && (await duty.runDueHeldEmails(ctx)) === 1);
sqlite.prepare("UPDATE agent_profiles SET duty_days_json = ?, duty_start = '08:00', duty_end = '09:00' WHERE user_id = 2").run(offDays);

// Several held alerts for one agent go out as one email; anything no longer relevant is dropped.
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price) VALUES (11, 1, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000), (12, 1, 'Chula Vista', 'CA', '91913', 'House', 3, 2, 800000)").run();
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 11, '91913', [1]);
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 12, '91913', [1]);
check('two alerts for an off-duty agent wait', sqlite.prepare("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 2 AND sent_at IS NULL AND kind = 'new_request'").get().n === 2);
// Changing the hours re-times what's waiting.
r = await call(dutyApi.onRequestPut, 'PUT', '/x', 2, { days: [(today + 4) % 7], start: '10:00', end: '11:00' });
const retimed = sqlite.prepare("SELECT deliver_after FROM held_emails WHERE user_id = 2 AND sent_at IS NULL LIMIT 1").get().deliver_after;
check('changing your hours moves waiting emails to the new on-duty time', duty.isOnDuty({ days: [(today + 4) % 7], start: '10:00', end: '11:00' }, Date.parse(retimed)), retimed);
sqlite.prepare("UPDATE held_emails SET deliver_after = ? WHERE user_id = 2 AND sent_at IS NULL").run(new Date(Date.now() - 1000).toISOString());
sent.length = 0;
await duty.runDueHeldEmails(ctx);
check('...and they arrive as ONE "while you were off duty" email', sent.length === 1 && sent[0].to === 'u2@example.test' && /2 updates from Amico Haus while you were off duty/.test(sent[0].subject) && (sent[0].text.match(/^- /gm) || []).length === 2, JSON.stringify(sent.map(m => m.subject)));
// A home that closed, or an agent who was suspended, gets nothing.
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 11, '91913', [1]);
sqlite.prepare("UPDATE pre_listings SET status = 'closed' WHERE id = 11").run();
sqlite.prepare("UPDATE held_emails SET deliver_after = ? WHERE user_id = 2 AND sent_at IS NULL").run(new Date(Date.now() - 1000).toISOString());
sent.length = 0;
await duty.runDueHeldEmails(ctx);
check("a held alert about a pre-listing that has since closed isn't sent", sent.length === 0);
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 12, '91913', [1]);
sqlite.prepare("UPDATE users SET status = 'suspended' WHERE id = 2").run();
sqlite.prepare("UPDATE held_emails SET deliver_after = ? WHERE user_id = 2 AND sent_at IS NULL").run(new Date(Date.now() - 1000).toISOString());
sent.length = 0;
await duty.runDueHeldEmails(ctx);
check("...nor one to an agent who has since been suspended", !sent.some(m => m.to === 'u2@example.test'));
sqlite.prepare("UPDATE users SET status = 'active' WHERE id = 2").run();
sqlite.prepare("UPDATE pre_listings SET status = 'open' WHERE id = 11").run();
// A failed send is retried.
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 12, '91913', [1]);
sqlite.prepare("UPDATE held_emails SET deliver_after = ? WHERE user_id = 2 AND sent_at IS NULL").run(new Date(Date.now() - 1000).toISOString());
const okFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{"message":"busy"}', { status: 429 });
await duty.runDueHeldEmails(ctx);
globalThis.fetch = okFetch;
check('a send that fails is put back for another try', sqlite.prepare("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 2 AND sent_at IS NULL AND attempts = 1").get().n === 1);
sent.length = 0;
await duty.runDueHeldEmails(ctx);
check('...and goes out on the next run', sent.length === 1);

// Daylight saving: the short spring-forward Sunday (2027-03-14) isn't skipped, and a start inside the missing hour moves to the first real minute.
const satNight = duty.pacificToUtcMs(2027, 3, 13, 23, 30);
check('Saturday night before spring-forward: a Sunday-only agent is next on duty that Sunday', new Date(duty.nextDutyStartMs({ days: [0], start: '08:00', end: '10:00' }, satNight)).toISOString() === '2027-03-14T15:00:00.000Z');
const gapStart = duty.nextDutyStartMs({ days: [0], start: '02:30', end: '05:00' }, satNight);
check('a start inside the missing 2-3am hour moves to 3:00am, the first real on-duty minute', new Date(gapStart).toISOString() === '2027-03-14T10:00:00.000Z', new Date(gapStart).toISOString());
const shortGap = duty.nextDutyStartMs({ days: [0], start: '02:30', end: '03:15' }, satNight);
check('...even when the window is short (never sent while off duty)', new Date(shortGap).toISOString() === '2027-03-14T10:00:00.000Z', new Date(shortGap).toISOString());

// A held interview request the homeowner canceled before it went out isn't sent.
sqlite.prepare("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status, slots_json) VALUES (12, 2, 'requested', '[]')").run();
await notifyLib.notifyInterviewRequested(ctx, 12, 2);
check('an interview request for an off-duty agent waits', sqlite.prepare("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 2 AND kind = 'interview' AND sent_at IS NULL").get().n === 1);
sqlite.prepare("UPDATE pre_listing_interviews SET status = 'canceled' WHERE pre_listing_id = 12 AND agent_user_id = 2").run();
sqlite.prepare("UPDATE held_emails SET deliver_after = ? WHERE user_id = 2 AND sent_at IS NULL").run(new Date(Date.now() - 1000).toISOString());
sent.length = 0;
await duty.runDueHeldEmails(ctx);
check("...and isn't sent once the homeowner canceled it", !sent.some(m => m.to === 'u2@example.test'));

// --- Homeowners see who's on duty for their ZIP ---
check('on-duty count: only agents on duty right now who serve the ZIP', (await duty.countAgentsOnDuty(DB, '91913')) === 1 && (await duty.countAgentsOnDuty(DB, '91910')) === 0);
const detail = await mod('functions/api/pre-listings/[id].js');
r = await call(detail.onRequestGet, 'GET', '/x', 1, null, { id: '10' });
check("the owner sees how many agents are on duty for their ZIP", r.json.preListing.agentsOnDuty === 1, JSON.stringify(r.json.preListing.agentsOnDuty));

// --- The Monday scorecard ---
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 10, 3, 'x', 2, 'pending')").run();
sqlite.prepare("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (10, 3, 'just_right')").run();
let card = await scorecard.buildScorecard(DB, 3);
check("the scorecard counts the agent's week (3 new homes nearby this week, 1 answered)", card.counts.proposals === 1 && card.counts.opinions === 1 && card.counts.newNearby === 3 && card.counts.answered === 1, JSON.stringify(card.counts));
card = await scorecard.buildScorecard(DB, 4);
check('...and points at open homes still waiting for them', card.counts.newNearby === 3 && card.counts.answered === 0 && /3 new homes near you are waiting/.test(card.nextStep), card.nextStep);
sqlite.prepare("UPDATE pre_listings SET status = 'closed' WHERE id = 12").run();
check('a home that has closed is no longer counted as waiting', /2 new homes near you are waiting/.test((await scorecard.buildScorecard(DB, 4)).nextStep));
sqlite.prepare("UPDATE pre_listings SET status = 'open' WHERE id = 12").run();
check('speed comparison only with enough proposals behind it', card.speed === null);
check('non-agents have no scorecard', (await scorecard.buildScorecard(DB, 5)) === null);
r = await call(cardApi.onRequestGet, 'GET', '/x', 3);
check('the dashboard shows the same week (never the email address)', r.status === 200 && r.json.scorecard.counts.proposals === 1 && !('email' in r.json.scorecard));

// Send window: Monday from 7am Pacific through Wednesday.
const pacific = (y, m, d, h) => duty.pacificToUtcMs(y, m, d, h, 0);
check('no scorecards before 7am Monday', scorecard.scorecardWeek(pacific(2026, 11, 2, 6)) === null);
check('Monday 8am is the week of that Monday', scorecard.scorecardWeek(pacific(2026, 11, 2, 8)) === '2026-11-02');
check('Wednesday still belongs to that week', scorecard.scorecardWeek(pacific(2026, 11, 4, 20)) === '2026-11-02');
check('Thursday is too late (skipped, not sent stale)', scorecard.scorecardWeek(pacific(2026, 11, 5, 9)) === null);

// A Monday 9am within a week from now, so this week's activity falls inside the 7-day window.
let mondayMs = Date.now();
while (!(duty.pacificParts(mondayMs).weekday === 1)) mondayMs += 86400000;
const mp = duty.pacificParts(mondayMs);
mondayMs = pacific(mp.year, mp.month, mp.day, 9);
if (mondayMs < Date.now()) mondayMs += 7 * 86400000;
sent.length = 0;
n = await scorecard.runDueScorecards(ctx, { nowMs: mondayMs, limit: 10 });
const toList = sent.map(m => m.to).sort();
check('Monday: agents with something to report get their scorecard (the opted-out one never does)', n === 3 && toList.join() === 'u3@example.test,u4@example.test', `${n} ${toList.join()}`);
check("...and an off-duty agent's scorecard waits for their hours like any other email", sqlite.prepare("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 2 AND sent_at IS NULL AND subject LIKE 'Your Amico Haus week%'").get().n === 1);
const mail = sent.find(m => m.to === 'u3@example.test');
check('the email has the week, one next step, an unsubscribe link and the broker line', /1 proposal sent/.test(mail.text) && /One next step:/.test(mail.text) && /scorecard-unsubscribe\?u=3&t=[0-9a-f]{32}/.test(mail.text) && /DRE #02257808/.test(mail.text));
check('...once per agent per week', (await scorecard.runDueScorecards(ctx, { nowMs: mondayMs, limit: 10 })) === 0);
sqlite.prepare("UPDATE agent_profiles SET scorecard_sent_week = NULL WHERE user_id = 4").run();
const goodFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 500 });
await scorecard.runDueScorecards(ctx, { nowMs: mondayMs, limit: 10 });
globalThis.fetch = goodFetch;
check("a scorecard that fails to send isn't marked sent, so it's retried", sqlite.prepare('SELECT scorecard_sent_week AS w FROM agent_profiles WHERE user_id = 4').get().w === null);
sent.length = 0;
check('...and the retry goes out', (await scorecard.runDueScorecards(ctx, { nowMs: mondayMs, limit: 10 })) === 1 && sent.some(m => m.to === 'u4@example.test'));

// --- Unsubscribe: the link shows a button; only the button turns it off ---
const token = mail.text.match(/t=([0-9a-f]{32})/)[1];
r = await call(unsub.onRequestGet, 'GET', `/x?u=3&t=${token}`, null);
check('opening the link (or a mail scanner opening it) changes nothing', /Stop the Monday email/.test(r.text) && sqlite.prepare('SELECT scorecard_opt_out AS o FROM agent_profiles WHERE user_id = 3').get().o === 0);
r = await call(unsub.onRequestPost, 'POST', `/x?u=3&t=${'0'.repeat(32)}`, null);
check('a wrong token does nothing', /didn't work/.test(r.text) && sqlite.prepare('SELECT scorecard_opt_out AS o FROM agent_profiles WHERE user_id = 3').get().o === 0);
r = await call(unsub.onRequestPost, 'POST', `/x?u=3&t=${token}`, null);
check('the button turns the Monday email off', /won't get the Monday scorecard/.test(r.text) && sqlite.prepare('SELECT scorecard_opt_out AS o FROM agent_profiles WHERE user_id = 3').get().o === 1);
r = await call(cardApi.onRequestPut, 'PUT', '/x', 3, { optOut: false });
check('...and the dashboard turns it back on', r.status === 200 && sqlite.prepare('SELECT scorecard_opt_out AS o FROM agent_profiles WHERE user_id = 3').get().o === 0);

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
