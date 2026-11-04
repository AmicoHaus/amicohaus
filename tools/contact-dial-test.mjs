// Runs the real code for "You're in Control" (batch R3-1a): the contact dial (open / weekly / quiet) on messages,
// held weekly messages and the Sunday delivery, quiet hours for email and push, the per-person email cap, the agent
// identity line in message and price-opinion alerts, /api/contact-settings and the duty-hours re-timing. Uses an
// in-memory SQLite stand-in for D1; emails and pushes are captured by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/contact-dial-test.mjs <projectRoot>
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
// A real P-256 key so web push runs end to end (into the stubbed fetch).
const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const env = {
  DB, RESEND_API_KEY: 'test-key',
  VAPID_PRIVATE_KEY_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', vapid.privateKey)), VAPID_PUBLIC_KEY: 'test-public-key', VAPID_SUBJECT: 'mailto:test@example.test',
};
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; else passed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
const pushes = [];
let emailStatus = 200;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://push.test/')) { pushes.push(String(url)); return new Response('', { status: 201 }); }
  if (emailStatus !== 200) return new Response('{"message":"down"}', { status: emailStatus });
  sent.push(JSON.parse(opts.body));
  return new Response('{}', { status: 200 });
};
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

const policy = await mod('functions/_lib/contactPolicy.js');
const duty = await mod('functions/_lib/agentDuty.js');
const notifyLib = await mod('functions/_lib/marketplaceNotify.js');
const matchNotify = await mod('functions/_lib/matchNotify.js');
const decisionNight = await mod('functions/_lib/decisionNight.js');
const convos = await mod('functions/api/conversations/index.js');
const thread = await mod('functions/api/conversations/[id]/messages.js');
const settings = await mod('functions/api/contact-settings.js');
const dutyApi = await mod('functions/api/agents/duty.js');
const matchesApi = await mod('functions/api/matches.js');

// ---------- people ----------
const people = {
  1: ['Olive Owner', 'weekly'], 2: ['Ana Agent'], 3: ['Ben Broker'], 4: ['Nora Buyer'], 5: ['Pat Pending'], 6: ['Dee Admin'],
  7: ['Quinn Quiet', 'quiet'], 8: ['Eli One'], 9: ['Eva Two'], 10: ['Ezra Three'], 11: ['Emma Four'], 12: ['Evan Five'], 13: ['Erin Six'],
  14: ['Owen Two', 'weekly'], 15: ['Opal Three', 'weekly'], 16: ['Cap Person'], 17: ['Every Person'], 18: ['Demo Person'], 19: ['Sus Person'],
  20: ['Quiet Hours Owner'], 21: ['Duty Agent'], 22: ['Quiet Agent'], 23: ['Settings Person'], 24: ['Phone Person'], 25: ['Eve Seven'],
  26: ['Open Owner'], 27: ['Fail Person'], 28: ['Held Cap Person'],
  29: ['Race Person'], 30: ['Race Weekly', 'weekly'], 31: ['Empty Weekly', 'weekly'], 32: ['Empty Open'], 33: ['Share Weekly', 'weekly'],
  34: ['Switch Weekly', 'weekly'], 35: ['Clock Owner'],
};
for (const [id, [name, mode]] of Object.entries(people)) {
  const email = Number(id) === 18 ? 'demo18@demo.amicohaus.local' : `u${id}@example.test`;
  sqlite.prepare("INSERT INTO users (id, email, display_name, contact_mode, role, status, email_frequency, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(Number(id), email, name, mode || 'open', Number(id) === 6 ? 'admin' : 'user', Number(id) === 19 ? 'suspended' : 'active', Number(id) === 17 ? 'every' : 'capped', Number(id) === 24 ? '619-555-0101' : null);
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, Number(id));
}
const agent = (id, license, brokerage, status = 'approved') => sqlite.prepare("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, service_zips_json, notify_new_requests) VALUES (?, ?, ?, ?, '[\"91913\"]', 1)").run(id, status, license, brokerage);
agent(2, '01234567', 'Pacific Realty');
agent(3, '02345678', '');
agent(5, '03456789', 'Pending Homes', 'pending');
agent(6, '04567890', 'Admin Realty');
for (const id of [8, 9, 10, 11, 12, 13, 25]) agent(id, `0900000${id % 10}`, 'Exempt Realty');
agent(21, '05678901', 'Duty Realty');
agent(22, '06789012', 'Quiet Realty');
for (const id of [1, 7, 26, 14, 15]) sqlite.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, 'k', 'a')").run(id, `https://push.test/u${id}`);

// Pacific "HH:MM" around now, so quiet hours can cover now (or not) whenever this runs.
const pNow = duty.pacificParts();
const nowMin = pNow.hour * 60 + pNow.minute;
const hhmm = (mins) => { const m = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const QUIET_NOW = [hhmm(nowMin - 120), hhmm(nowMin + 120)];
const QUIET_LATER = [hhmm(nowMin + 180), hhmm(nowMin + 300)];
const setQuiet = (id, [s, e]) => sqlite.prepare('UPDATE users SET quiet_start = ?, quiet_end = ? WHERE id = ?').run(s, e, id);
const notes = (uid) => sqlite.prepare('SELECT id, body, link, emailed_at FROM notifications WHERE user_id = ? ORDER BY id').all(uid);
const mailsTo = (id) => sent.filter(m => m.to === `u${id}@example.test`);
const held = (id, kind) => sqlite.prepare(`SELECT * FROM held_emails WHERE user_id = ? AND sent_at IS NULL${kind ? ' AND kind = ?' : ''} ORDER BY id`).all(...(kind ? [id, kind] : [id]));
const past = () => policy.sqlUtc(Date.now() - 1000);

// ---------- next Sunday 9am Pacific ----------
const P = (y, m, d, h, mi = 0) => duty.pacificToUtcMs(y, m, d, h, mi);
check('weekly delivery: Saturday before the fall-back Sunday -> that Sunday 9am PST', policy.nextWeeklyDeliveryUtc(P(2026, 10, 31, 12)) === '2026-11-01 17:00:00', policy.nextWeeklyDeliveryUtc(P(2026, 10, 31, 12)));
check('...Sunday 8:59am -> the same morning', policy.nextWeeklyDeliveryUtc(P(2026, 11, 1, 8, 59)) === '2026-11-01 17:00:00');
check('...Sunday 9:00am exactly -> the next Sunday (strictly after now)', policy.nextWeeklyDeliveryUtc(P(2026, 11, 1, 9, 0)) === '2026-11-08 17:00:00', policy.nextWeeklyDeliveryUtc(P(2026, 11, 1, 9, 0)));
check('...Saturday before spring-forward -> Sunday 9am PDT', policy.nextWeeklyDeliveryUtc(P(2027, 3, 13, 20)) === '2027-03-14 16:00:00', policy.nextWeeklyDeliveryUtc(P(2027, 3, 13, 20)));
check('...a summer Wednesday -> that Sunday', policy.nextWeeklyDeliveryUtc(P(2026, 7, 15, 10)) === '2026-07-19 16:00:00');
const sqlNow = sqlite.prepare("SELECT datetime('now') AS t").get().t;
check("...in the same text format as datetime('now') (and the same clock)", /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(policy.nextWeeklyDeliveryUtc()) && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(sqlNow)
  && Math.abs(Date.parse(policy.sqlUtc().replace(' ', 'T') + 'Z') - Date.parse(sqlNow.replace(' ', 'T') + 'Z')) <= 2000, `${policy.sqlUtc()} vs ${sqlNow}`);

// ---------- quiet-hours windows (incl. crossing midnight and DST) ----------
check('no quiet hours, a bad time, or start == end -> no window', policy.quietHoursWindow({}) === null && policy.quietHoursWindow({ quiet_start: '25:00', quiet_end: '08:00' }) === null && policy.quietHoursWindow({ quiet_start: '08:00', quiet_end: '08:00' }) === null);
const night = { quiet_start: '21:00', quiet_end: '08:00' };
check('21:00-08:00: quiet at 23:00, 07:59 and 21:00; not at 08:00 or 20:59',
  policy.isQuietNow(night, P(2026, 7, 15, 23)) && policy.isQuietNow(night, P(2026, 7, 16, 7, 59)) && policy.isQuietNow(night, P(2026, 7, 15, 21))
  && !policy.isQuietNow(night, P(2026, 7, 16, 8)) && !policy.isQuietNow(night, P(2026, 7, 15, 20, 59)));
const early = { quiet_start: '01:00', quiet_end: '06:00' };
check('01:00-06:00 (the OK-to-email window crosses midnight): quiet 01:00-05:59 only',
  !policy.isQuietNow(early, P(2026, 7, 16, 0, 59)) && policy.isQuietNow(early, P(2026, 7, 16, 1)) && policy.isQuietNow(early, P(2026, 7, 16, 5, 59)) && !policy.isQuietNow(early, P(2026, 7, 16, 6)) && !policy.isQuietNow(early, P(2026, 7, 16, 23)));
const satNight = P(2027, 3, 13, 23, 30);
check('DST: quiet 21:00-08:00 on the spring-forward night ends 8am PDT', new Date(duty.nextDutyStartMs(policy.quietHoursWindow(night), satNight)).toISOString() === '2027-03-14T15:00:00.000Z', new Date(duty.nextDutyStartMs(policy.quietHoursWindow(night), satNight)).toISOString());
check('DST: quiet 01:00-06:00 at 1:30am PDT on the fall-back night ends 6am PST', new Date(duty.nextDutyStartMs(policy.quietHoursWindow(early), Date.parse('2026-11-01T08:30:00Z'))).toISOString() === '2026-11-01T14:00:00.000Z');
check('...and still quiet during the repeated 1:30am PST hour', policy.isQuietNow(early, Date.parse('2026-11-01T09:30:00Z')) && new Date(duty.nextDutyStartMs(policy.quietHoursWindow(early), Date.parse('2026-11-01T09:30:00Z'))).toISOString() === '2026-11-01T14:00:00.000Z');
const gap = { quiet_start: '01:00', quiet_end: '02:30' }; // ends inside the missing spring-forward hour
check('DST: quiet hours ending inside the missing 2-3am hour end at 3:00am', new Date(duty.nextDutyStartMs(policy.quietHoursWindow(gap), P(2027, 3, 14, 1, 30))).toISOString() === '2027-03-14T10:00:00.000Z', new Date(duty.nextDutyStartMs(policy.quietHoursWindow(gap), P(2027, 3, 14, 1, 30))).toISOString());
// Existing same-day duty windows behave as before; a day-bound window crossing midnight belongs to its start day.
const mon = { days: [1], start: '08:00', end: '17:00' };
check('same-day duty hours unchanged (Mon 10:00 on; Mon 18:00, Tue 10:00 off)', duty.isOnDuty(mon, P(2026, 11, 2, 10)) && !duty.isOnDuty(mon, P(2026, 11, 2, 18)) && !duty.isOnDuty(mon, P(2026, 11, 3, 10)));
const monLate = { days: [1], start: '22:00', end: '02:00' };
check('a Monday 22:00-02:00 window: on Mon 23:00 and Tue 01:00; off Tue 23:00 and Mon 01:00',
  duty.isOnDuty(monLate, P(2026, 11, 2, 23)) && duty.isOnDuty(monLate, P(2026, 11, 3, 1)) && !duty.isOnDuty(monLate, P(2026, 11, 3, 23)) && !duty.isOnDuty(monLate, P(2026, 11, 2, 1)));
check('...and its next start from Tuesday 3am is next Monday 22:00', new Date(duty.nextDutyStartMs(monLate, P(2026, 11, 3, 3))).toISOString() === new Date(P(2026, 11, 9, 22)).toISOString());
check('agents still cannot save overnight duty hours', !!duty.validateDutyHours({ days: [1], start: '22:00', end: '02:00' }).error);

// ---------- contactDecision: every mode x sender x exemption ----------
const plQ = (id, status = 'open') => sqlite.prepare("INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, status) VALUES (?, 7, 'Quiet home', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, ?)").run(id, status);
plQ(100); plQ(101, 'awarded');
sqlite.prepare("INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price) VALUES (200, 1, 'Olive home', 'Chula Vista', 'CA', '91913', 'House', 3, 2, 800000)").run();
const convo = (a, b) => { const [x, y] = a < b ? [a, b] : [b, a]; sqlite.prepare('INSERT OR IGNORE INTO conversations (user_a_id, user_b_id) VALUES (?, ?)').run(x, y); return sqlite.prepare('SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ?').get(x, y).id; };
// E1 (8): the homeowner messaged them first. E2 (9): shared contact info. E3 (10): hired on another of her homes.
// E4 (11): she invited them. E5 (12): interview scheduled. E6 (13): RSVP'd to a preview that ended yesterday.
sqlite.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, 7, ?)').run(convo(7, 8), 'Hi Eli');
sqlite.prepare('INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (100, 7, 9)').run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, status) VALUES ('pre_listing', 101, 10, 'accepted')").run();
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 100, 11, 7)").run();
sqlite.prepare("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status) VALUES (100, 12, 'scheduled')").run();
const preview = (plId, endsAgoMs) => Number(sqlite.prepare('INSERT INTO pre_listing_previews (pre_listing_id, starts_at, ends_at) VALUES (?, ?, ?)').run(plId, new Date(Date.now() - endsAgoMs - 3600000).toISOString(), new Date(Date.now() - endsAgoMs).toISOString()).lastInsertRowid);
sqlite.prepare('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (?, 13)').run(preview(100, 86400000));
// E7 (25): only things that DON'T count: a finished interview, a pending proposal, an RSVP to a preview that ended 3
// days ago, a message the agent sent, and an invite/share from a different homeowner.
sqlite.prepare("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status) VALUES (100, 25, 'done')").run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, status) VALUES ('pre_listing', 100, 25, 'pending')").run();
sqlite.prepare('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (?, 25)').run(preview(100, 3 * 86400000));
sqlite.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, 25, ?)').run(convo(7, 25), 'Old hello from Eve');
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 200, 25, 1)").run();
sqlite.prepare('INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (200, 1, 25)').run();

let d = await policy.contactDecision(DB, 4, 7);
check('quiet: a non-agent (buyer) can still message', d.allow && !d.appliesToSender && d.mode === 'quiet' && d.code === null);
d = await policy.contactDecision(DB, 6, 7);
check('quiet: an admin with an agent profile is refused like every agent (Fair Play)', !d.allow && d.appliesToSender && d.code === 'contact_quiet' && d.error === policy.CONTACT_QUIET_ERROR);
d = await policy.contactDecision(DB, 5, 7);
check('quiet: a pending agent applicant is covered too', !d.allow && d.code === 'contact_quiet');
check('quiet copy is the spec text', policy.CONTACT_QUIET_ERROR === "This homeowner has chosen Quiet mode, so they hear from agents through price opinions and proposals. Send one of those and they'll see it right away.");
const exemptNames = { 8: 'she messaged them first', 9: 'she shared her contact info', 10: 'hired on another of her homes', 11: 'she invited them', 12: 'an interview is scheduled', 13: 'RSVP to a preview that ended yesterday' };
for (const [id, why] of Object.entries(exemptNames)) {
  d = await policy.contactDecision(DB, Number(id), 7);
  check(`quiet: exempt when ${why}`, d.allow && d.exempt && d.code === null && (await policy.isExemptPair(DB, Number(id), 7)) === true, JSON.stringify(d));
}
d = await policy.contactDecision(DB, 25, 7);
check("quiet: not exempt for a done interview, a pending proposal, a 3-day-old preview, the agent's own message, or another owner's invite/share", !d.allow && !d.exempt && d.code === 'contact_quiet' && (await policy.isExemptPair(DB, 25, 7)) === false);
sqlite.prepare("UPDATE pre_listing_interviews SET status = 'requested' WHERE agent_user_id = 25").run();
check('...a requested interview does count', (await policy.isExemptPair(DB, 25, 7)) === true);
sqlite.prepare("UPDATE pre_listing_interviews SET status = 'done' WHERE agent_user_id = 25").run();
check('the preview grace runs out 2 days after it ended', (await policy.isExemptPair(DB, 13, 7, { nowMs: Date.now() + 2 * 86400000 })) === false);
check('an open-mode person: allowed, nothing held', (d = await policy.contactDecision(DB, 2, 26)) && d.allow && d.mode === 'open' && d.holdUntil === null);
d = await policy.contactDecision(DB, 2, 1);
check('weekly: held until next Sunday 9am Pacific', d.allow && d.mode === 'weekly' && d.holdUntil === policy.nextWeeklyDeliveryUtc(), JSON.stringify(d));
check('weekly: an exempt agent is never held', !(await policy.contactDecision(DB, 25, 1)).holdUntil && (await policy.contactDecision(DB, 25, 1)).exempt);
check('weekly: a non-agent is never held', (await policy.contactDecision(DB, 4, 1)).holdUntil === null);

// ---------- weekly mode end to end ----------
// Matches (for the "gone quiet" read path): Olive and Ana have a mutual trade match from 10 days ago.
sqlite.prepare("INSERT INTO listings (id, user_id, city, state, property_type, beds, baths, estimated_value, price_tier, created_at) VALUES (501, 1, 'San Diego', 'CA', 'Condo', 2, 2, 600000, '600k-1m', datetime('now', '-10 days')), (502, 2, 'Chula Vista', 'CA', 'House', 3, 2, 800000, '600k-1m', datetime('now', '-10 days'))").run();
sqlite.prepare("INSERT INTO desired_criteria (listing_id, locations, property_type, price_min, price_max) VALUES (501, 'Chula Vista', 'House', 700000, 900000), (502, 'San Diego', 'Condo', 500000, 700000)").run();
const goneQuiet = async (who) => { const r = await call(matchesApi.onRequestGet, 'GET', '/x', who); const m = (r.json.matches || [])[0]; return m ? m.goneQuiet : 'no match'; };
check('(setup) a 10-day-old match nobody has messaged has gone quiet', (await goneQuiet(1)) === true && (await goneQuiet(2)) === true);

sent.length = 0; pushes.length = 0;
let r = await call(convos.onRequestPost, 'POST', '/x', 2, { userId: 1 });
const K1 = r.json.id;
check('weekly: an agent can open a thread', r.status === 200 && K1 > 0);
const expectHold = policy.nextWeeklyDeliveryUtc();
r = await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Hello from Ana' }, { id: String(K1) });
check('weekly: the message is accepted and held for Sunday', r.status === 201 && r.json.held === true && r.json.deliverAfter === expectHold && r.json.id > 0, JSON.stringify(r.json));
check('...stored with deliver_after in datetime(now) format', sqlite.prepare('SELECT deliver_after FROM messages WHERE id = ?').get(r.json.id).deliver_after === expectHold);
check('...and nobody is told yet: no alert, no email, no push', notes(1).length === 0 && mailsTo(1).length === 0 && !pushes.includes('https://push.test/u1'), JSON.stringify({ n: notes(1), p: pushes }));
r = await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Second try' }, { id: String(K1) });
check('weekly: a second message while one waits is refused (weekly_limit, spec copy)', r.status === 400 && r.json.code === 'weekly_limit' && r.json.error === "Your message for this week is already on its way. It will be delivered Sunday morning, together with other agents' messages.", JSON.stringify(r.json));
check('...and not stored', sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(K1).n === 1);
const K2 = (await call(convos.onRequestPost, 'POST', '/x', 3, { userId: 1 })).json.id;
r = await call(thread.onRequestPost, 'POST', '/x', 3, { body: 'Hi from Ben' }, { id: String(K2) });
check('weekly: the limit is per agent (another agent can send one)', r.status === 201 && r.json.held === true);

r = await call(convos.onRequestGet, 'GET', '/x', 1);
check('held: the recipient\'s conversation list leaves out threads with only waiting messages', r.status === 200 && !r.json.conversations.some(c => c.id === K1 || c.id === K2) && !JSON.stringify(r.json).includes('Hello from Ana'), JSON.stringify(r.json));
r = await call(thread.onRequestGet, 'GET', '/x', 1, null, { id: String(K1) });
check('held: the thread shows the recipient nothing yet', r.status === 200 && r.json.messages.length === 0 && !JSON.stringify(r.json).includes('Hello from Ana'));
check('...and opening it does not mark the waiting message read', sqlite.prepare('SELECT read_at FROM messages WHERE conversation_id = ?').get(K1).read_at === null);
check("...while the header shows the agent's DRE identity (and 'open' for the homeowner's own sending)", JSON.stringify(r.json.other) === JSON.stringify({ id: 2, displayName: 'Ana Agent', agent: { licenseNumber: '01234567', brokerageName: 'Pacific Realty' }, deliveryMode: 'open' }), JSON.stringify(r.json.other));
r = await call(thread.onRequestGet, 'GET', '/x', 2, null, { id: String(K1) });
check('held: the sender sees their own message with deliverAfter', r.json.messages.length === 1 && r.json.messages[0].deliverAfter === expectHold && r.json.messages[0].body === 'Hello from Ana' && 'sender_id' in r.json.messages[0] && 'created_at' in r.json.messages[0], JSON.stringify(r.json.messages));
check("...and the homeowner's mode as it applies to them (weekly), no agent identity for a homeowner", r.json.other.deliveryMode === 'weekly' && r.json.other.agent === null && r.json.other.displayName === 'Olive Owner');
r = await call(convos.onRequestGet, 'GET', '/x', 2);
const aRow = r.json.conversations.find(c => c.id === K1);
check("held: the sender's own list shows it as the last message", aRow && aRow.last_message === 'Hello from Ana' && aRow.unread_count === 0 && aRow.otherAgent === null && aRow.other_name === 'Olive Owner', JSON.stringify(aRow));
check("held: the match still looks 'gone quiet' to the homeowner, not to the agent who wrote", (await goneQuiet(1)) === true && (await goneQuiet(2)) === false);

// Sunday comes.
sqlite.prepare('UPDATE messages SET deliver_after = ? WHERE conversation_id IN (?, ?)').run(past(), K1, K2);
r = await call(convos.onRequestGet, 'GET', '/x', 1);
const oRow1 = r.json.conversations.find(c => c.id === K1);
const oRow2 = r.json.conversations.find(c => c.id === K2);
check('delivered: both threads appear for the homeowner, unread, with the message preview', oRow1 && oRow2 && oRow1.unread_count === 1 && oRow2.unread_count === 1 && oRow1.last_message === 'Hello from Ana', JSON.stringify(r.json.conversations));
check('...with otherAgent identity per row (no missing-part dots)', JSON.stringify(oRow1.otherAgent) === JSON.stringify({ licenseNumber: '01234567', brokerageName: 'Pacific Realty' }) && JSON.stringify(oRow2.otherAgent) === JSON.stringify({ licenseNumber: '02345678', brokerageName: '' }));
r = await call(thread.onRequestGet, 'GET', '/x', 2, null, { id: String(K1) });
check("...and the sender's deliverAfter clears once it's delivered", r.json.messages[0].deliverAfter === null);
sent.length = 0;
let n = await policy.runDueWeeklyMessages(ctx);
const weekly1 = notes(1).filter(x => /weekly agent messages/.test(x.body));
check('release: 2 messages released', n === 2, String(n));
check('release: ONE in-app alert for the homeowner, spec copy and link', weekly1.length === 1 && weekly1[0].body === 'Your weekly agent messages are here: 2 new messages from 2 agents.' && weekly1[0].link === '/app#messages', JSON.stringify(weekly1));
check('release: one email, spec subject, counted for the cap', mailsTo(1).length === 1 && mailsTo(1)[0].subject === 'Your weekly agent messages on Amico Haus' && !!weekly1[0].emailed_at);
check('release: nothing is released twice', (await policy.runDueWeeklyMessages(ctx)) === 0 && notes(1).filter(x => /weekly agent messages/.test(x.body)).length === 1);
r = await call(thread.onRequestGet, 'GET', '/x', 1, null, { id: String(K1) });
check('delivered: the homeowner reads it (and it is marked read)', r.json.messages.length === 1 && sqlite.prepare('SELECT read_at FROM messages WHERE conversation_id = ?').get(K1).read_at !== null);
check("delivered: the match no longer looks 'gone quiet' to the homeowner", (await goneQuiet(1)) === false);
r = await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Week two' }, { id: String(K1) });
check('a new week: the agent can send one more (held again)', r.status === 201 && r.json.held === true);
r = await call(convos.onRequestGet, 'GET', '/x', 1);
check('held in a thread with delivered messages: the list preview and unread count leave it out', (() => { const c = r.json.conversations.find(x => x.id === K1); return c && c.last_message === 'Hello from Ana' && c.unread_count === 0; })(), JSON.stringify(r.json.conversations.find(x => x.id === K1)));
r = await call(thread.onRequestGet, 'GET', '/x', 1, null, { id: String(K1) });
check('...and so does the thread', r.json.messages.length === 1 && !JSON.stringify(r.json).includes('Week two'));
// Backlog: two of the same agent's messages both came due before the job ran -> one alert that counts both.
sqlite.prepare("UPDATE messages SET deliver_after = ? WHERE body = 'Week two'").run(past());
r = await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Week three' }, { id: String(K1) });
sqlite.prepare("UPDATE messages SET deliver_after = ? WHERE body = 'Week three'").run(past());
await policy.runDueWeeklyMessages(ctx);
check('release copy: "2 new messages from 1 agent."', notes(1).at(-1).body === 'Your weekly agent messages are here: 2 new messages from 1 agent.', notes(1).at(-1).body);
await call(thread.onRequestPost, 'POST', '/x', 3, { body: 'Ben again' }, { id: String(K2) });
sqlite.prepare("UPDATE messages SET deliver_after = ? WHERE body = 'Ben again'").run(past());
await policy.runDueWeeklyMessages(ctx);
check('release copy: "1 new message from 1 agent."', notes(1).at(-1).body === 'Your weekly agent messages are here: 1 new message from 1 agent.', notes(1).at(-1).body);

// Weekly delivery email during quiet hours waits (in-app lands now).
setQuiet(14, QUIET_NOW);
const K14 = (await call(convos.onRequestPost, 'POST', '/x', 2, { userId: 14 })).json.id;
await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Hi Owen' }, { id: String(K14) });
sqlite.prepare('UPDATE messages SET deliver_after = ? WHERE conversation_id = ?').run(past(), K14);
sent.length = 0; pushes.length = 0;
await policy.runDueWeeklyMessages(ctx);
const w14 = held(14, 'weekly_messages');
check('release in quiet hours: in-app alert now, email held as weekly_messages until quiet hours end', notes(14).length === 1 && mailsTo(14).length === 0 && w14.length === 1 && Date.parse(w14[0].deliver_after) > Date.now() && duty.isOnDuty(policy.quietHoursWindow({ quiet_start: QUIET_NOW[0], quiet_end: QUIET_NOW[1] }), Date.parse(w14[0].deliver_after)) && !!notes(14)[0].emailed_at, JSON.stringify(w14));
check('...and no push', !pushes.includes('https://push.test/u14'));
sqlite.prepare('UPDATE held_emails SET deliver_after = ? WHERE user_id = 14').run(new Date(Date.now() - 1000).toISOString());
await duty.runDueHeldEmails(ctx);
check('...it goes out when quiet hours end', mailsTo(14).length === 1 && mailsTo(14)[0].subject === 'Your weekly agent messages on Amico Haus');

// Writing back makes the pair exempt and brings the waiting message in right away.
const K15 = (await call(convos.onRequestPost, 'POST', '/x', 2, { userId: 15 })).json.id;
await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Hi Opal' }, { id: String(K15) });
r = await call(convos.onRequestPost, 'POST', '/x', 15, { userId: 2 });
check('the homeowner can open the same thread herself', r.json.id === K15);
r = await call(thread.onRequestPost, 'POST', '/x', 15, { body: 'Hi Ana, tell me more' }, { id: String(K15) });
check("the homeowner's own message is never held", r.status === 201 && r.json.held === false && r.json.deliverAfter === null);
r = await call(thread.onRequestGet, 'GET', '/x', 15, null, { id: String(K15) });
check("...and the agent's waiting message arrives right away", r.json.messages.map(m => m.body).join('|') === 'Hi Opal|Hi Ana, tell me more', JSON.stringify(r.json.messages));
await policy.runDueWeeklyMessages(ctx);
check('...without a weekly alert later', !notes(15).some(x => /weekly agent messages/.test(x.body)));
r = await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Happy to help' }, { id: String(K15) });
check('the agent is now exempt: delivered at once, alert with the DRE identity line', r.json.held === false && notes(15).at(-1).body === 'New message from Ana Agent (DRE #01234567, Pacific Realty)', JSON.stringify(notes(15).at(-1)));
// A sender blocked since (or suspended) is released but not announced.
const K315 = (await call(convos.onRequestPost, 'POST', '/x', 3, { userId: 15 })).json.id;
r = await call(thread.onRequestPost, 'POST', '/x', 3, { body: 'Hi Opal, Ben here' }, { id: String(K315) });
sqlite.prepare('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (15, 3)').run();
sqlite.prepare('UPDATE messages SET deliver_after = ? WHERE conversation_id = ?').run(past(), K315);
n = await policy.runDueWeeklyMessages(ctx);
check('release: a message from someone blocked since is released but not announced', r.json.held === true && n === 1 && !notes(15).some(x => /weekly agent messages/.test(x.body)));
sqlite.prepare('DELETE FROM user_blocks WHERE blocker_id = 15').run();

// ---------- quiet mode end to end ----------
r = await call(convos.onRequestPost, 'POST', '/x', 6, { userId: 7 });
check('quiet: an agent cannot open a new thread (403 contact_quiet, spec copy)', r.status === 403 && r.json.code === 'contact_quiet' && r.json.error === policy.CONTACT_QUIET_ERROR && !sqlite.prepare('SELECT 1 FROM conversations WHERE user_a_id = 6 AND user_b_id = 7').get());
r = await call(convos.onRequestPost, 'POST', '/x', 4, { userId: 7 });
check('quiet: a buyer can', r.status === 200 && r.json.id > 0);
const K725 = convo(7, 25);
r = await call(convos.onRequestPost, 'POST', '/x', 25, { userId: 7 });
check('quiet: an existing thread still opens (to read)', r.status === 200 && r.json.id === K725);
const before725 = sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(K725).n;
r = await call(thread.onRequestPost, 'POST', '/x', 25, { body: 'Can I come by?' }, { id: String(K725) });
check('quiet: but sending is refused, nothing stored', r.status === 403 && r.json.code === 'contact_quiet' && sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(K725).n === before725);
r = await call(thread.onRequestGet, 'GET', '/x', 25, null, { id: String(K725) });
check("quiet: the agent's thread view says so (deliveryMode quiet)", r.json.other.deliveryMode === 'quiet');
r = await call(thread.onRequestPost, 'POST', '/x', 8, { body: 'Thanks Quinn!' }, { id: String(convo(7, 8)) });
check('quiet: an exempt agent (she wrote first) gets through, with an alert', r.status === 201 && r.json.held === false && notes(7).at(-1).body === 'New message from Eli One (DRE #09000008, Exempt Realty)', JSON.stringify(notes(7).at(-1)));

// ---------- open mode: identity line, push, quiet-hours push skip ----------
sent.length = 0; pushes.length = 0;
const K26a = (await call(convos.onRequestPost, 'POST', '/x', 2, { userId: 26 })).json.id;
r = await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Hello' }, { id: String(K26a) });
check('open: delivered now with held:false', r.status === 201 && r.json.held === false && r.json.deliverAfter === null);
check('open: alert + email body carry the identity line', notes(26).at(-1).body === 'New message from Ana Agent (DRE #01234567, Pacific Realty)' && mailsTo(26).length === 1 && mailsTo(26)[0].text.startsWith('New message from Ana Agent (DRE #01234567, Pacific Realty)'), JSON.stringify(mailsTo(26)));
check('open: and a push', pushes.includes('https://push.test/u26'));
await call(thread.onRequestPost, 'POST', '/x', 3, { body: 'Hi' }, { id: String((await call(convos.onRequestPost, 'POST', '/x', 3, { userId: 26 })).json.id) });
check('a missing brokerage leaves out its part', notes(26).at(-1).body === 'New message from Ben Broker (DRE #02345678)', notes(26).at(-1).body);
await call(thread.onRequestPost, 'POST', '/x', 4, { body: 'Hi' }, { id: String((await call(convos.onRequestPost, 'POST', '/x', 4, { userId: 26 })).json.id) });
check('a non-agent sender: just the name', notes(26).at(-1).body === 'New message from Nora Buyer');
setQuiet(26, QUIET_NOW);
sent.length = 0; pushes.length = 0;
await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Late note' }, { id: String(K26a) });
check('quiet hours: no push, the email waits as owner_alert, the in-app alert lands now', pushes.length === 0 && mailsTo(26).length === 0 && held(26, 'owner_alert').length === 1 && notes(26).at(-1).body.startsWith('New message from Ana'), JSON.stringify({ pushes, held: held(26) }));
setQuiet(26, [null, null]);

// Identity pieces, price opinions and contact shares.
check('identityLine format', policy.identityLine({ name: 'Ana', licenseNumber: '01234567', brokerageName: 'Pacific Realty' }) === 'Ana · DRE #01234567 · Pacific Realty' && policy.identityLine({ name: 'Ana', licenseNumber: '', brokerageName: 'Pacific Realty' }) === 'Ana · Pacific Realty' && policy.identityLine({ name: 'Ana', licenseNumber: '7', brokerageName: '' }) === 'Ana · DRE #7');
sent.length = 0;
await notifyLib.notifyNewPriceOpinion(ctx, 26, 2, 100);
check('new price opinion: identity line body, pre-listing link, email', notes(26).at(-1).body === 'Ana Agent · DRE #01234567 · Pacific Realty shared a price opinion on your home.' && notes(26).at(-1).link === '/app#pre-listing-100' && mailsTo(26).length === 1, JSON.stringify(notes(26).at(-1)));
await notifyLib.notifyContactShared(ctx, 2, 'Quinn Quiet', 100, 'Sunny condo');
check('contact shared: the agent is told in-app and by email', notes(2).at(-1).body === 'Quinn Quiet shared their contact info with you for Sunny condo.' && notes(2).at(-1).link === '/app#pre-listing-100' && mailsTo(2).length === 1);

// ---------- the email cap is per person ----------
sent.length = 0;
for (let i = 1; i <= 10; i++) await notifyLib.notifyNewMessage(ctx, 16, `Sender ${i}`, 999);
check('cap: 10 different alerts -> 10 in-app rows but only 8 emails', notes(16).length === 10 && mailsTo(16).length === 8, `${notes(16).length} / ${mailsTo(16).length}`);
check('cap: emailed_at marks exactly the 8 that were emailed', notes(16).filter(x => x.emailed_at).length === 8 && !notes(16)[8].emailed_at && !notes(16)[9].emailed_at);
await notifyLib.notifyNewVote(ctx, 200, 16, 2, 'too_high');
check('cap: a different kind of alert is capped too (one budget per person)', mailsTo(16).length === 8);
sqlite.prepare("UPDATE notifications SET emailed_at = datetime('now', '-25 hours') WHERE user_id = 16").run();
await notifyLib.notifyNewMessage(ctx, 16, 'Next day', 999);
check('cap: emails older than a day stop counting', mailsTo(16).length === 9);
for (let i = 1; i <= 10; i++) await notifyLib.notifyNewMessage(ctx, 17, `Sender ${i}`, 999);
check("'every' frequency: no cap", mailsTo(17).length === 10);
setQuiet(28, QUIET_NOW);
for (let i = 1; i <= 9; i++) await notifyLib.notifyNewMessage(ctx, 28, `Sender ${i}`, 999);
check('cap: held emails count (8 held during quiet hours, the 9th not even held)', held(28, 'owner_alert').length === 8 && notes(28).filter(x => x.emailed_at).length === 8 && mailsTo(28).length === 0, `${held(28).length}`);
await notifyLib.notifyNewMessage(ctx, 18, 'Someone', 999);
await notifyLib.notifyNewMessage(ctx, 19, 'Someone', 999);
check('demo and suspended accounts: in-app row only, never an email', notes(18).length === 1 && notes(19).length === 1 && !notes(18)[0].emailed_at && !notes(19)[0].emailed_at && !sent.some(m => /demo18|u19@/.test(m.to)));
emailStatus = 500;
await notifyLib.notifyNewMessage(ctx, 27, 'Someone', 999);
emailStatus = 200;
check("a failed send doesn't count against the cap", notes(27).length === 1 && !notes(27)[0].emailed_at);
// Match emails keep their own cap but mark emailed_at too.
sent.length = 0;
await matchNotify.notifyNewMatches(ctx, 502);
const matchNote = sqlite.prepare("SELECT emailed_at FROM notifications WHERE user_id = 1 AND type = 'match' ORDER BY id DESC").get();
check('a match email marks its notification row emailed_at', mailsTo(1).some(m => /match/i.test(m.subject)) && matchNote && !!matchNote.emailed_at, JSON.stringify(matchNote));

// ---------- quiet hours on owner alerts, combined owner wording ----------
setQuiet(20, QUIET_NOW);
sent.length = 0;
await notifyLib.notifyNewVote(ctx, 200, 20, 2, 'too_high');
await notifyLib.notifyNewVote(ctx, 200, 20, 3, 'just_right');
const h20 = held(20, 'owner_alert');
check('quiet hours: owner alerts land in-app now, emails held as owner_alert until the quiet hours end', notes(20).length === 2 && mailsTo(20).length === 0 && h20.length === 2 && h20.every(h => Date.parse(h.deliver_after) > Date.now() && h.ref === null), JSON.stringify(h20));
sqlite.prepare("UPDATE pre_listings SET status = 'closed' WHERE id = 200").run();
sqlite.prepare('UPDATE held_emails SET deliver_after = ? WHERE user_id = 20').run(new Date(Date.now() - 1000).toISOString());
await duty.runDueHeldEmails(ctx);
check("...then go out as ONE email with the owner wording (even though the home closed meanwhile)", mailsTo(20).length === 1 && mailsTo(20)[0].subject === '2 updates from Amico Haus' && mailsTo(20)[0].text.startsWith("Here's what came in during your quiet hours:\n") && (mailsTo(20)[0].text.match(/^- /gm) || []).length === 2, JSON.stringify(mailsTo(20)));
sqlite.prepare("UPDATE pre_listings SET status = 'open' WHERE id = 200").run();
await notifyLib.notifyNewVote(ctx, 200, 20, 2, 'too_low');
sqlite.prepare("UPDATE users SET status = 'suspended' WHERE id = 20").run();
sqlite.prepare('UPDATE held_emails SET deliver_after = ? WHERE user_id = 20 AND sent_at IS NULL').run(new Date(Date.now() - 1000).toISOString());
sent.length = 0;
await duty.runDueHeldEmails(ctx);
check('a held owner alert for someone since suspended is dropped', mailsTo(20).length === 0);
sqlite.prepare("UPDATE users SET status = 'active' WHERE id = 20").run();

// Agents: duty hours win when set; quiet hours apply when they aren't.
const today = duty.pacificParts().weekday;
sqlite.prepare("UPDATE agent_profiles SET duty_days_json = ?, duty_start = '08:00', duty_end = '09:00' WHERE user_id = 21").run(JSON.stringify([(today + 3) % 7]));
setQuiet(21, QUIET_NOW);
setQuiet(22, QUIET_NOW);
sent.length = 0;
await notifyLib.notifyNewMessage(ctx, 21, 'Someone', 999);
check('an agent with duty hours: a personal alert goes now (quiet hours not used)', mailsTo(21).length === 1);
await notifyLib.notifyInterviewRequested(ctx, 100, 21);
check('...an agent alert waits for their duty hours (kind interview)', held(21, 'interview').length === 1 && duty.isOnDuty({ days: [(today + 3) % 7], start: '08:00', end: '09:00' }, Date.parse(held(21, 'interview')[0].deliver_after)));
await notifyLib.notifyInterviewRequested(ctx, 100, 22);
await notifyLib.notifyNewMessage(ctx, 22, 'Someone', 999);
check('an agent without duty hours: their quiet hours hold both agent and personal alerts', mailsTo(22).length === 0 && held(22, 'interview').length === 1 && held(22, 'owner_alert').length === 1);

// ---------- /api/agents/duty only re-times agent kinds ----------
const farFuture = new Date(Date.now() + 30 * 86400000).toISOString();
sqlite.prepare("INSERT INTO held_emails (user_id, kind, subject, text_body, deliver_after) VALUES (21, 'owner_alert', 's', 'owner text', ?), (21, 'weekly_messages', 's', 'weekly text', ?)").run(farFuture, farFuture);
const newDays = [(today + 4) % 7];
r = await call(dutyApi.onRequestPut, 'PUT', '/x', 21, { days: newDays, start: '10:00', end: '11:00' });
const iv21 = held(21, 'interview')[0].deliver_after;
check('duty hours change: the agent alert moves to the new on-duty time', r.status === 200 && duty.isOnDuty({ days: newDays, start: '10:00', end: '11:00' }, Date.parse(iv21)), iv21);
check('...personal alerts and the weekly delivery are left alone', held(21, 'owner_alert')[0].deliver_after === farFuture && held(21, 'weekly_messages')[0].deliver_after === farFuture);
r = await call(dutyApi.onRequestPut, 'PUT', '/x', 21, { clear: true });
check('clearing duty hours: agent alerts follow quiet hours now (still waiting, until they end)', r.status === 200 && Date.parse(held(21, 'interview')[0].deliver_after) > Date.now() && !policy.isQuietNow({ quiet_start: QUIET_NOW[0], quiet_end: QUIET_NOW[1] }, Date.parse(held(21, 'interview')[0].deliver_after)) && held(21, 'owner_alert')[0].deliver_after === farFuture);

// ---------- /api/contact-settings ----------
r = await call(settings.onRequestGet, 'GET', '/x', null);
check('settings: signed out GET -> 401', r.status === 401);
r = await call(settings.onRequestPut, 'PUT', '/x', null, { contactMode: 'quiet' });
check('settings: signed out PUT -> 401', r.status === 401);
r = await call(settings.onRequestGet, 'GET', '/x', 23);
check('settings: defaults', JSON.stringify(r.json) === JSON.stringify({ contactMode: 'open', quietStart: null, quietEnd: null, phonePublic: false, hasPhone: false }), JSON.stringify(r.json));
const bad = async (b) => (await call(settings.onRequestPut, 'PUT', '/x', 23, b)).status;
check('settings: rejects a bad mode, half a pair, bad times, start == end, a non-boolean, an empty body',
  (await bad({ contactMode: 'loud' })) === 400 && (await bad({ quietStart: '21:00' })) === 400 && (await bad({ quietStart: '21:00', quietEnd: '' })) === 400
  && (await bad({ quietStart: '24:00', quietEnd: '08:00' })) === 400 && (await bad({ quietStart: '7:00', quietEnd: '08:00' })) === 400 && (await bad({ quietStart: '21:00', quietEnd: '21:00' })) === 400
  && (await bad({ phonePublic: 'yes' })) === 400 && (await bad({})) === 400);
check('settings: phone can only go public once there is one', (await bad({ phonePublic: true })) === 400);
r = await call(settings.onRequestPut, 'PUT', '/x', 23, { contactMode: 'weekly', quietStart: '21:00', quietEnd: '08:00' });
check('settings: saves mode + overnight quiet hours', r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ contactMode: 'weekly', quietStart: '21:00', quietEnd: '08:00', phonePublic: false, hasPhone: false }) && sqlite.prepare('SELECT contact_mode, quiet_start, quiet_end FROM users WHERE id = 23').get().quiet_start === '21:00', JSON.stringify(r.json));
r = await call(settings.onRequestPut, 'PUT', '/x', 23, { quietStart: '', quietEnd: '' });
check("settings: '' clears quiet hours (mode kept)", r.json.quietStart === null && r.json.quietEnd === null && r.json.contactMode === 'weekly');
await call(settings.onRequestPut, 'PUT', '/x', 23, { quietStart: '22:00', quietEnd: '06:00' });
r = await call(settings.onRequestPut, 'PUT', '/x', 23, { quietStart: null, quietEnd: null });
check('settings: null clears them too', r.json.quietStart === null && sqlite.prepare('SELECT quiet_start FROM users WHERE id = 23').get().quiet_start === null);
r = await call(settings.onRequestPut, 'PUT', '/x', 24, { phonePublic: true });
check('settings: with a phone on file it can go public', r.status === 200 && r.json.phonePublic === true && r.json.hasPhone === true && sqlite.prepare('SELECT phone_public FROM users WHERE id = 24').get().phone_public === 1);
r = await call(settings.onRequestPut, 'PUT', '/x', 24, { phonePublic: false });
check('...and back to private', r.json.phonePublic === false);
// Re-timing: person 28 has 8 owner alerts held for the current quiet hours.
r = await call(settings.onRequestPut, 'PUT', '/x', 28, { quietStart: QUIET_LATER[0], quietEnd: QUIET_LATER[1] });
check('settings: moving quiet hours away from now releases waiting alerts on the next run', r.status === 200 && held(28, 'owner_alert').every(h => Date.parse(h.deliver_after) <= Date.now()));
r = await call(settings.onRequestPut, 'PUT', '/x', 28, { quietStart: QUIET_NOW[0], quietEnd: QUIET_NOW[1] });
check('...and moving them over now holds them until the new end', held(28, 'owner_alert').every(h => Date.parse(h.deliver_after) > Date.now() && duty.isOnDuty(policy.quietHoursWindow({ quiet_start: QUIET_NOW[0], quiet_end: QUIET_NOW[1] }), Date.parse(h.deliver_after))));
sqlite.prepare("UPDATE agent_profiles SET duty_days_json = ?, duty_start = '08:00', duty_end = '09:00' WHERE user_id = 21").run(JSON.stringify(newDays));
const iv21Before = held(21, 'interview')[0].deliver_after;
r = await call(settings.onRequestPut, 'PUT', '/x', 21, { quietStart: '', quietEnd: '' });
check("settings: an agent with duty hours: quiet-hours changes re-time personal kinds only", held(21, 'interview')[0].deliver_after === iv21Before && Date.parse(held(21, 'owner_alert')[0].deliver_after) <= Date.now() && Date.parse(held(21, 'weekly_messages')[0].deliver_after) <= Date.now());

// ---------- the thread keeps the NEWEST 500 ----------
const K500 = convo(4, 26);
sqlite.prepare('DELETE FROM messages WHERE conversation_id = ?').run(K500);
const ins = sqlite.prepare("INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, 4, ?, datetime('now', ?))");
for (let i = 1; i <= 510; i++) ins.run(K500, `m${i}`, `-${600 - i} minutes`);
r = await call(thread.onRequestGet, 'GET', '/x', 26, null, { id: String(K500) });
check('long thread: the newest 500, oldest first', r.json.messages.length === 500 && r.json.messages[0].body === 'm11' && r.json.messages[499].body === 'm510', `${r.json.messages.length} ${r.json.messages[0] && r.json.messages[0].body} ${r.json.messages.at(-1) && r.json.messages.at(-1).body}`);

// ---------- recipient lookups elsewhere ----------
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, proposals_due_at) VALUES (300, 19, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, ?), (301, 18, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, ?)").run(new Date(Date.now() - 60000).toISOString(), new Date(Date.now() - 60000).toISOString());
sent.length = 0;
await decisionNight.runDueDecisionNights(ctx);
check('Decision Night: suspended and demo owners get the in-app alert, no email', notes(19).some(x => /Decision Night/.test(x.body)) && notes(18).some(x => /Decision Night/.test(x.body)) && sent.length === 0);
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, proposals_paused) VALUES (400, 26, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, 0), (401, 26, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, 1)").run();
const reqNotes = (id) => sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE link = ?").get(`/app#pre-listing-${id}`).n;
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 400, null, [26]);
await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 401, null, [26]);
check('new-request alerts: an open home pings agents, a paused one pings nobody', reqNotes(400) > 0 && reqNotes(401) === 0, `${reqNotes(400)} ${reqNotes(401)}`);

// ---------- the email cap holds when alerts arrive at the same moment ----------
for (let i = 0; i < 7; i++) sqlite.prepare("INSERT INTO notifications (user_id, type, body, link, emailed_at) VALUES (29, 'marketplace', ?, '/app', datetime('now'))").run(`earlier ${i}`);
sent.length = 0;
await Promise.all([2, 3, 6, 21, 22].map((agentId, i) => notifyLib.notifyNewMessage(ctx, 29, `Sender ${i}`, 900 + i, agentId)));
check('cap race: 5 alerts at once for someone with 7 emails today -> 5 in-app rows, exactly 1 more email (8 in all)',
  notes(29).length === 12 && mailsTo(29).length === 1 && notes(29).filter(x => x.emailed_at).length === 8, `${notes(29).length} rows, ${mailsTo(29).length} emails, ${notes(29).filter(x => x.emailed_at).length} marked`);

// ---------- Weekly: a double send can't queue two held messages ----------
const K330 = (await call(convos.onRequestPost, 'POST', '/x', 3, { userId: 30 })).json.id;
const [d1, d2] = await Promise.all([1, 2].map(() => call(thread.onRequestPost, 'POST', '/x', 3, { body: 'Hi there (double click)' }, { id: String(K330) })));
const okSends = [d1, d2].filter(x => x.status === 201 && x.json.held === true);
const limited = [d1, d2].filter(x => x.status === 400 && x.json.code === 'weekly_limit' && x.json.error === policy.WEEKLY_LIMIT_ERROR);
check('weekly race: two sends at once -> one held message, the other refused with weekly_limit', okSends.length === 1 && limited.length === 1
  && sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(K330).n === 1, JSON.stringify([d1, d2].map(x => [x.status, x.json])));

// ---------- an empty thread an agent opened isn't in a Weekly/Quiet person's list ----------
const K231 = (await call(convos.onRequestPost, 'POST', '/x', 2, { userId: 31 })).json.id;
r = await call(convos.onRequestGet, 'GET', '/x', 31);
check('empty thread: an agent who tapped Message is not in a Weekly person\'s list yet', r.status === 200 && !r.json.conversations.some(c => c.id === K231) && !JSON.stringify(r.json).includes('Ana Agent'), JSON.stringify(r.json));
r = await call(convos.onRequestGet, 'GET', '/x', 2);
check('...while the agent still sees the thread they opened', r.json.conversations.some(c => c.id === K231));
const K431 = (await call(convos.onRequestPost, 'POST', '/x', 4, { userId: 31 })).json.id;
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 9999, 3, 31)").run();
const K331 = (await call(convos.onRequestPost, 'POST', '/x', 3, { userId: 31 })).json.id;
r = await call(convos.onRequestGet, 'GET', '/x', 31);
check('...a buyer\'s empty thread and one from an agent she invited (exempt) are listed as before', r.json.conversations.some(c => c.id === K431) && r.json.conversations.some(c => c.id === K331) && !r.json.conversations.some(c => c.id === K231), JSON.stringify(r.json.conversations.map(c => c.id)));
const K232 = (await call(convos.onRequestPost, 'POST', '/x', 2, { userId: 32 })).json.id;
r = await call(convos.onRequestGet, 'GET', '/x', 32);
check('...and an Open person sees an agent\'s empty thread as before', r.json.conversations.some(c => c.id === K232));

// ---------- sharing contact info with an agent brings their waiting message in now ----------
const shares = await mod('functions/api/pre-listings/[id]/contact-shares/index.js');
sqlite.prepare("INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price) VALUES (600, 33, 'Share Home', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000)").run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, commission_pct) VALUES ('pre_listing', 600, 9, 2.5)").run();
const K933 = (await call(convos.onRequestPost, 'POST', '/x', 9, { userId: 33 })).json.id;
const K1033 = (await call(convos.onRequestPost, 'POST', '/x', 10, { userId: 33 })).json.id;
r = await call(thread.onRequestPost, 'POST', '/x', 9, { body: 'Eva here, happy to help' }, { id: String(K933) });
const r10 = await call(thread.onRequestPost, 'POST', '/x', 10, { body: 'Ezra here' }, { id: String(K1033) });
check('(setup) two agents each have a message waiting for Sunday', r.json.held === true && r10.json.held === true);
r = await call(shares.onRequestPost, 'POST', '/x', 33, { agentId: 9 }, { id: '600' });
check('the owner shares her contact info with one of them', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
r = await call(thread.onRequestGet, 'GET', '/x', 33, null, { id: String(K933) });
check("...that agent's waiting message arrives right away", r.json.messages.map(m => m.body).join('|') === 'Eva here, happy to help', JSON.stringify(r.json.messages));
check('...marked released, so the weekly delivery won\'t count it', !!sqlite.prepare('SELECT released_at FROM messages WHERE conversation_id = ?').get(K933).released_at);
r = await call(thread.onRequestGet, 'GET', '/x', 33, null, { id: String(K1033) });
check("...while the other agent's message still waits for Sunday", r.json.messages.length === 0 && !sqlite.prepare('SELECT released_at FROM messages WHERE conversation_id = ?').get(K1033).released_at);
sqlite.prepare('UPDATE messages SET deliver_after = ? WHERE conversation_id = ?').run(past(), K1033);
await policy.runDueWeeklyMessages(ctx);
const w33 = notes(33).filter(x => /weekly agent messages/.test(x.body));
check('...and Sunday announces only that one: "1 new message from 1 agent."', w33.length === 1 && w33[0].body === 'Your weekly agent messages are here: 1 new message from 1 agent.', JSON.stringify(w33));

// ---------- switching to Open brings every waiting message in now ----------
const K234 = (await call(convos.onRequestPost, 'POST', '/x', 2, { userId: 34 })).json.id;
const K334 = (await call(convos.onRequestPost, 'POST', '/x', 3, { userId: 34 })).json.id;
await call(thread.onRequestPost, 'POST', '/x', 2, { body: 'Hello from Ana (34)' }, { id: String(K234) });
await call(thread.onRequestPost, 'POST', '/x', 3, { body: 'Hello from Ben (34)' }, { id: String(K334) });
r = await call(convos.onRequestGet, 'GET', '/x', 34);
check('(setup) Weekly: nothing shows yet', !r.json.conversations.some(c => c.id === K234 || c.id === K334));
r = await call(settings.onRequestPut, 'PUT', '/x', 34, { contactMode: 'open' });
check('switching to Open saves', r.status === 200 && r.json.contactMode === 'open');
r = await call(convos.onRequestGet, 'GET', '/x', 34);
const c234 = r.json.conversations.find(c => c.id === K234);
const c334 = r.json.conversations.find(c => c.id === K334);
check('...and both waiting messages are there right away, unread', c234 && c334 && c234.unread_count === 1 && c334.last_message === 'Hello from Ben (34)', JSON.stringify(r.json.conversations));
check('...marked released', sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id IN (?, ?) AND released_at IS NOT NULL').get(K234, K334).n === 2);
await policy.runDueWeeklyMessages(ctx);
check('...so no weekly alert counts them later', !notes(34).some(x => /weekly agent messages/.test(x.body)));
r = await call(settings.onRequestPut, 'PUT', '/x', 30, { contactMode: 'quiet' });
check('switching Weekly -> Quiet does not release anything', r.status === 200 && !sqlite.prepare('SELECT released_at FROM messages WHERE conversation_id = ?').get(K330).released_at);
check('...the waiting message keeps waiting instead of arriving on Sunday', sqlite.prepare('SELECT deliver_after FROM messages WHERE conversation_id = ?').get(K330).deliver_after === policy.HELD_WHILE_QUIET);
await policy.runDueWeeklyMessages(ctx);
r = await call(thread.onRequestGet, 'GET', '/x', 30, null, { id: String(K330) });
check("...so Sunday's delivery neither shows nor announces it while Quiet is on", r.json.messages.length === 0 && !sqlite.prepare('SELECT released_at FROM messages WHERE conversation_id = ?').get(K330).released_at);
r = await call(settings.onRequestPut, 'PUT', '/x', 30, { contactMode: 'weekly' });
const backToWeekly = sqlite.prepare('SELECT deliver_after FROM messages WHERE conversation_id = ?').get(K330).deliver_after;
check('switching Quiet -> Weekly puts it on the next Sunday delivery', r.status === 200 && backToWeekly === policy.nextWeeklyDeliveryUtc(Date.now()), backToWeekly);
r = await call(settings.onRequestPut, 'PUT', '/x', 30, { contactMode: 'quiet' });
r = await call(settings.onRequestPut, 'PUT', '/x', 30, { contactMode: 'open' });
r = await call(thread.onRequestGet, 'GET', '/x', 30, null, { id: String(K330) });
check('switching Quiet -> Open brings it in right away', r.json.messages.length === 1 && !!sqlite.prepare('SELECT released_at FROM messages WHERE conversation_id = ?').get(K330).released_at, JSON.stringify(r.json.messages));

// ---------- times in alerts are Pacific (Workers run on UTC) ----------
const at10amPst = '2026-11-03T18:00:00.000Z'; // 10:00 AM Pacific (PST)
await notifyLib.notifyNewShowingRequest(ctx, 700, 35, 2, at10amPst);
check('showing request alert: the time is Pacific', /requested a showing for Nov 3, 2026,? 10:00\sAM\./.test(notes(35).at(-1).body), notes(35).at(-1).body);
await notifyLib.notifyShowingDecision(ctx, 700, 35, true, at10amPst);
check('showing decision alert: the time is Pacific', /Your showing request for Nov 3, 2026,? 10:00\sAM was accepted!/.test(notes(35).at(-1).body), notes(35).at(-1).body);
await notifyLib.notifyOpenHouseScheduled(ctx, '/listing/1', [35], '2026-07-04T17:30:00.000Z'); // 10:30 AM PDT
check('open house alert: the time is Pacific (daylight time too)', /open house was scheduled for Jul 4, 2026,? 10:30\sAM on a listing you saved/.test(notes(35).at(-1).body), notes(35).at(-1).body);

// ---------- ZIP lookups never go past D1's 100 bound parameters ----------
const geo = await mod('functions/_lib/geo.js');
const zips = Array.from({ length: 150 }, (_, i) => String(92000 + i));
for (const z of zips) sqlite.prepare('INSERT OR IGNORE INTO zip_codes (zip, lat, lng) VALUES (?, 32.64, -117.0)').run(z);
sqlite.prepare("INSERT OR IGNORE INTO zip_codes (zip, lat, lng) VALUES ('91913', 32.64, -117.0)").run();
const realPrepare = DB.prepare;
let maxBind = 0;
DB.prepare = (sql) => {
  const st = realPrepare(sql);
  const bind = st.bind;
  st.bind = (...a) => { maxBind = Math.max(maxBind, a.length); if (a.length > 100) throw new Error('D1: too many SQL variables'); return bind(...a); };
  return st;
};
try {
  const coords = await geo.lookupZipCoords(DB, [...zips, 92000, 'bad', null]);
  check('lookupZipCoords: 150 ZIPs in one lookup, one bound parameter', coords.size === 150 && coords.has('92000') && maxBind <= 100, `${coords.size} found, ${maxBind} params`);
  for (let i = 0; i < 35; i++) {
    const id = 1000 + i;
    sqlite.prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)").run(id, `zipagent${i}@example.test`, `Zip Agent ${i}`);
    sqlite.prepare("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, service_zips_json, notify_new_requests) VALUES (?, 'approved', '01010101', 'Zip Realty', ?, 1)")
      .run(id, JSON.stringify(zips.slice((i * 4) % 150, (i * 4) % 150 + 4)));
  }
  sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price) VALUES (402, 26, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000)").run();
  await notifyLib.notifyAgentsNewRequest(ctx, 'pre_listing', 402, '91913', [26]);
  const zipNotified = sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE link = '/app#pre-listing-402' AND user_id >= 1000").get().n;
  check('new-request alerts: 35 agents covering 140 ZIPs are all pinged (no statement over 100 parameters)', zipNotified === 35 && maxBind <= 100, `${zipNotified} pinged, max ${maxBind} params`);
} finally { DB.prepare = realPrepare; }

// ---------- the You're in Control panel (main.js), run on its own with a stand-in DOM ----------
{
  const mainSrc = readFileSync(`${root}/main.js`, 'utf8');
  const from = mainSrc.indexOf('// Saves one change and redraws');
  const chunk = mainSrc.slice(from, mainSrc.indexOf("// The homeowner's own proposal comparison", from));
  let focused = null;
  const putCalls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const panel = { listeners: {}, elements: [], addEventListener(t, f) { this.listeners[t] = f; }, contains(el) { return this.elements.includes(el); }, querySelectorAll() { return this.elements; } };
  const el = (props) => ({ name: '', id: '', disabled: false, checked: false, focus() { focused = this; }, ...props });
  const renderFake = (s) => {
    panel.elements = ['open', 'weekly', 'quiet'].map(v => el({ name: 'controlContactMode', value: v, checked: v === s.contactMode }));
    panel.elements.push(el({ id: 'phonePublicToggle', checked: !!s.phonePublic }));
  };
  const fakeDocument = {
    get activeElement() { return focused; },
    getElementById: (id) => (id === 'controlPanel' ? panel : id === 'plContactDial' ? { addEventListener() {}, dataset: {} } : null),
    querySelector: (sel) => (/controlContactMode.*:checked/.test(sel) ? panel.elements.find(e => e.name === 'controlContactMode' && e.checked)
      : panel.elements.find(e => e.id && sel.endsWith(`#${e.id}`)) || null),
  };
  const ui = new Function('document', 'apiPut', 'toast', 'renderFake', 'CONTACT_MODE_LABELS', 'CONTACT_MODE_SAVED', 'quietHoursLabel', `
    let contactSettings = { contactMode: 'open', phonePublic: false, hasPhone: true };
    function currentContactMode() { return contactSettings.contactMode; }
    function renderControlPanel() { renderFake(contactSettings); }
    function renderPostFormDial() {}
    ${chunk}
    renderControlPanel();
    return { wireControlPanel, settings: () => contactSettings };`)(
    fakeDocument,
    async (url, changes) => {
      putCalls.push({ changes, radiosEnabled: panel.elements.filter(e => e.name === 'controlContactMode').every(e => !e.disabled), phoneDisabled: panel.elements.find(e => e.id === 'phonePublicToggle').disabled });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(res => setTimeout(res, 20));
      inFlight--;
      return { contactMode: changes.contactMode || ui0().contactMode, phonePublic: 'phonePublic' in changes ? changes.phonePublic : ui0().phonePublic, hasPhone: true };
    },
    () => {}, renderFake, { open: 'Open', weekly: 'Weekly', quiet: 'Quiet' }, { open: 'Saved.', weekly: 'Saved.', quiet: 'Saved.' }, () => '');
  const ui0 = () => ui.settings();
  ui.wireControlPanel();
  // A keyboard user on "Open" presses Down twice: each step checks the next radio, moves focus to it and fires change.
  const step = (value) => {
    for (const e of panel.elements) if (e.name === 'controlContactMode') e.checked = e.value === value;
    focused = panel.elements.find(e => e.name === 'controlContactMode' && e.value === value);
    panel.listeners.change({ target: focused });
  };
  focused = panel.elements[0];
  step('weekly');
  step('quiet');
  await new Promise(res => setTimeout(res, 700));
  check('dial: arrowing Open -> Weekly -> Quiet saves once, for Quiet', putCalls.length === 1 && putCalls[0].changes.contactMode === 'quiet' && ui0().contactMode === 'quiet', JSON.stringify(putCalls));
  check('...the dial radios stay enabled while it saves (other controls wait)', putCalls[0] && putCalls[0].radiosEnabled && putCalls[0].phoneDisabled);
  check('...and focus is back on the saved choice after the redraw', focused && focused.name === 'controlContactMode' && focused.value === 'quiet' && panel.elements.includes(focused));
  step('weekly');
  step('quiet');
  await new Promise(res => setTimeout(res, 700));
  check('dial: landing back on the saved choice sends nothing', putCalls.length === 1);
  focused = panel.elements.find(e => e.id === 'phonePublicToggle');
  focused.checked = true;
  panel.listeners.change({ target: focused });
  await new Promise(res => setTimeout(res, 100));
  check('phone checkbox: saved, and focus comes back to the redrawn checkbox', putCalls.length === 2 && putCalls[1].changes.phonePublic === true && focused && focused.id === 'phonePublicToggle' && panel.elements.includes(focused), JSON.stringify(putCalls[1]));
  // A dial choice, then the phone box inside the dial's wait, then another dial choice while those save: the saves
  // go one at a time, in order, so none undoes another (the server writes every setting back from what it read).
  step('weekly');
  await new Promise(res => setTimeout(res, 440));
  focused = panel.elements.find(e => e.id === 'phonePublicToggle');
  focused.checked = false;
  panel.listeners.change({ target: focused }); // still saving when the dial's wait ends
  await new Promise(res => setTimeout(res, 700));
  step('open');
  await new Promise(res => setTimeout(res, 700));
  const lastThree = putCalls.slice(2).map(c => c.changes);
  check('control panel: saves never overlap, and run in the order they were made', maxInFlight === 1 && JSON.stringify(lastThree) === JSON.stringify([{ phonePublic: false }, { contactMode: 'weekly' }, { contactMode: 'open' }]) && ui0().contactMode === 'open' && ui0().phonePublic === false, `max in flight ${maxInFlight}, ${JSON.stringify(lastThree)}`);
  // The message composer ignores a second submit while one is on its way (the server also refuses a second held one).
  const formHandler = mainSrc.slice(mainSrc.indexOf("document.getElementById('messageForm').addEventListener('submit'"), mainSrc.indexOf("const notifBtn = document.getElementById('notifBtn')"));
  check('composer: one send at a time (re-entry guard, Send disabled until the request settles)', /if \(messageSending\) return;/.test(formHandler) && /sendBtn\.disabled = true/.test(formHandler) && /finally \{[\s\S]*messageSending = false/.test(formHandler));
}

console.log = realLog;
console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nall ${passed} passed`);
process.exit(failed ? 1 : 0);
