// Runs the real handlers for batch L1 abuse controls (per-person rate limits and two-way blocks) against an
// in-memory SQLite stand-in for D1: every limit (allowed, then 429 rate_limited), per-target windows, the one-statement
// claim under concurrency, every block write path (404 to the agent, 400 to the owner), every owner-facing read filter,
// the block side effects, shared contact / phone suppressed, notifications skipped, unblock bringing proposals and
// opinions back, the prune job, reports, the first-RSVP and invite re-notify rules, and the offer-alert wording.
// Emails are captured by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/abuse-test.mjs <projectRoot>
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
const objects = new Map();
const PHOTOS = {
  put: async (key, body) => { objects.set(key, body); },
  get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
  head: async (key) => (objects.has(key) ? { size: 1 } : null),
  delete: async (key) => { objects.delete(key); },
};
const env = { DB, PHOTOS, RESEND_API_KEY: 'test-key' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
globalThis.fetch = async (url, opts) => { try { sent.push(JSON.parse(opts.body)); } catch { /* not an email */ } return new Response('{}', { status: 200 }); };
const ctx = { env, request: new Request('https://amicohaus.com/x'), waitUntil() {} };
const call = async (handler, method, path, who, params = {}, body, headers = {}) => {
  const isForm = body instanceof FormData;
  const request = new Request(`https://amicohaus.com${path}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, json: type.includes('json') ? await res.json() : null };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const lastNote = (uid) => one('SELECT body, link FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', uid);
const notes = (uid, like = '%') => q('SELECT body, link FROM notifications WHERE user_id = ? AND body LIKE ? ORDER BY id', uid, like);
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
const ago = (minutes) => `-${minutes} minutes`;
const logRows = (uid, kind, n, minutesAgo, ref = null) => {
  for (let i = 0; i < n; i++) run("INSERT INTO user_action_log (user_id, kind, ref, created_at) VALUES (?, ?, ?, datetime('now', ?))", uid, kind, ref, ago(minutesAgo));
};
const is429 = (r) => r.status === 429 && r.json && r.json.code === 'rate_limited'
  && r.json.error === "You're doing that a lot right now. Please take a short break and try again later.";
console.log = () => {};

// People: 1 owner A (phone), 2 agent G, 3 agent H, 4 plain user C, 5 admin, 6 agent K, 7 owner B, 8 agent R (limits),
// 9 approved agent whose account is suspended, 20-29 plain users (conversation targets), 30 plain user (limits).
const user = (id, extra = {}) => {
  run('INSERT INTO users (id, email, display_name, phone, role, status) VALUES (?, ?, ?, ?, ?, ?)', id, `u${id}@example.test`, `User ${id}`,
    extra.phone ?? null, extra.role ?? 'user', extra.status ?? 'active');
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
user(1, { phone: '619-555-0101' });
for (const id of [2, 3, 4, 6, 7, 8, 30]) user(id);
user(5, { role: 'admin' });
user(9, { status: 'suspended' });
for (let id = 20; id <= 29; id++) user(id);
const agent = (id, lic, brok) => run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', ?, ?)", id, lic, brok);
agent(2, '01234567', 'Pacific Realty'); agent(3, '07654321', 'Bay Homes'); agent(6, '02222222', 'Coast Homes'); agent(8, '04444444', 'Rate Realty'); agent(9, '05555555', 'Gone Realty');
const home = (id, owner, price, address = '') => run(
  `INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address)
   VALUES (?, ?, 'Home', 'Chula Vista', 'CA', '91913', 'Single Family Home', 3, 2, ?, ?)`, id, owner, price, address);
home(10, 1, 750000, '456 Hidden Ave'); home(12, 7, 650000, '9 Other St'); home(14, 7, 700000); home(15, 7, 700000); home(16, 7, 700000);

const rl = await mod('functions/_lib/rateLimits.js');
const blocksLib = await mod('functions/_lib/blocks.js');
const blocksApi = await mod('functions/api/blocks/index.js');
const unblockApi = await mod('functions/api/blocks/[userId].js');
const convos = await mod('functions/api/conversations/index.js');
const thread = await mod('functions/api/conversations/[id]/messages.js');
const bids = await mod('functions/api/pre-listings/[id]/bids/index.js');
const bid = await mod('functions/api/pre-listings/[id]/bids/[bidId].js');
const votes = await mod('functions/api/pre-listings/[id]/votes/index.js');
const deck = await mod('functions/api/pre-listings/[id]/votes/deck.js');
const showings = await mod('functions/api/pre-listings/[id]/showings/index.js');
const showing = await mod('functions/api/pre-listings/[id]/showings/[showingId].js');
const previews = await mod('functions/api/pre-listings/[id]/previews/index.js');
const preview = await mod('functions/api/pre-listings/[id]/previews/[previewId].js');
const interviews = await mod('functions/api/pre-listings/[id]/interviews/index.js');
const interview = await mod('functions/api/pre-listings/[id]/interviews/[agentId].js');
const invites = await mod('functions/api/pre-listings/[id]/invites.js');
const shares = await mod('functions/api/pre-listings/[id]/contact-shares/index.js');
const pitch = await mod('functions/api/pre-listings/[id]/pitch-video.js');
const reports = await mod('functions/api/reports/index.js');
const market = await mod('functions/_lib/marketplace.js');
const dn = await mod('functions/_lib/decisionNight.js');
const pl = await mod('functions/_lib/preListings.js');
const showLib = await mod('functions/_lib/showings.js');
const sellerPrep = await mod('functions/_lib/sellerPrep.js');
const invitesLib = await mod('functions/_lib/agentInvites.js');
const addressViews = await mod('functions/_lib/addressViews.js');
const auth = await mod('functions/_lib/auth.js');
const notify = await mod('functions/_lib/marketplaceNotify.js');
const P10 = { id: '10' };
const P12 = { id: '12' };

// ================= Rate limits: the helper =================
const want = {
  conversation_new: [[5, 10, false], [20, 1440, false]],
  message: [[20, 10, false], [200, 1440, false], [30, 60, true]],
  proposal: [[10, 60, false], [30, 1440, false], [5, 1440, true]],
  price_vote: [[15, 60, false], [60, 1440, false], [6, 1440, true]],
  showing_request: [[10, 1440, false], [3, 10080, true]],
  preview_rsvp: [[20, 1440, false]], agent_invite: [[20, 1440, false]], saved_search: [[20, 1440, false]], timing_edit: [[10, 1440, false]], photo_sweep: [[40, 60, false], [120, 1440, false]], report: [[10, 1440, false]],
};
const got = Object.fromEntries(Object.entries(rl.USER_LIMITS).map(([k, ws]) => [k, ws.map(w => [w.max, w.minutes, !!w.perRef])]));
check('USER_LIMITS matches the spec table exactly', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
let threw = false;
try { await rl.claimUserAction(DB, 'no_such_kind', 30); } catch { threw = true; }
check('an unknown kind throws (a programming error, never a silent allow)', threw);
const r429 = rl.rateLimited();
check('rateLimited() is a 429 with code rate_limited and the friendly message', r429.status === 429 && is429({ status: 429, json: await r429.json() }));

let okCount = 0;
for (let i = 0; i < 6; i++) if (await rl.claimUserAction(DB, 'conversation_new', 30)) okCount++;
check('conversation_new: 5 in 10 minutes, then refused', okCount === 5);
check('...a refused claim records nothing', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 30 AND kind = 'conversation_new'").n === 5);
run("UPDATE user_action_log SET created_at = datetime('now', '-30 minutes') WHERE user_id = 30");
logRows(30, 'conversation_new', 14, 60);
check('...after 10 minutes the short window clears (19 today)', await rl.claimUserAction(DB, 'conversation_new', 30));
check('...and the day window (20) holds', !(await rl.claimUserAction(DB, 'conversation_new', 30)));
check('...another person is unaffected', await rl.claimUserAction(DB, 'conversation_new', 4));
run('DELETE FROM user_action_log');

logRows(30, 'message', 30, 20, 'conversation:1');
check('message per-thread window: 30 in an hour in one thread is the cap', !(await rl.claimUserAction(DB, 'message', 30, 'conversation:1')));
check('...a different thread is still fine', await rl.claimUserAction(DB, 'message', 30, 'conversation:2'));
logRows(30, 'showing_request', 3, 5 * 1440, 'pre_listing:10');
check('showing_request per-home window is 7 days (3 requests 5 days ago still count)', !(await rl.claimUserAction(DB, 'showing_request', 30, 'pre_listing:10')));
check('...another home is fine', await rl.claimUserAction(DB, 'showing_request', 30, 'pre_listing:12'));
run('DELETE FROM user_action_log');

const burst = await Promise.all(Array.from({ length: 30 }, () => rl.claimUserAction(DB, 'message', 30, 'conversation:9')));
check('one-statement claim under concurrency: 30 at once -> exactly 20 allowed', burst.filter(Boolean).length === 20 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 30 AND kind = 'message'").n === 20,
  `${burst.filter(Boolean).length} allowed`);
run('DELETE FROM user_action_log');

// ================= Rate limits: every channel =================
// New conversations (opening an existing thread is free).
let r;
for (let i = 0; i < 5; i++) r = await call(convos.onRequestPost, 'POST', '/x', 30, {}, { userId: 20 + i });
check('conversations: 5 new threads go through', r.status === 200 && one('SELECT COUNT(*) AS n FROM conversations WHERE user_a_id = 20 OR user_b_id = 30').n >= 5, JSON.stringify(r));
r = await call(convos.onRequestPost, 'POST', '/x', 30, {}, { userId: 26 });
check('...the 6th new one in 10 minutes is a 429 rate_limited', is429(r), JSON.stringify(r));
const K30 = (await call(convos.onRequestPost, 'POST', '/x', 30, {}, { userId: 20 })).json;
check('...reopening an existing thread still works (not counted)', K30 && K30.id > 0, JSON.stringify(K30));

// Messages: 20 per 10 minutes.
const KC = K30.id;
let statuses = [];
for (let i = 0; i < 21; i++) statuses.push((await call(thread.onRequestPost, 'POST', '/x', 30, { id: String(KC) }, { body: `hi ${i}` })).status);
check('messages: 20 in 10 minutes go through', statuses.slice(0, 20).every(s => s === 201), statuses.join(','));
r = await call(thread.onRequestPost, 'POST', '/x', 30, { id: String(KC) }, { body: 'one more' });
check('...then 429 rate_limited, and nothing more is stored', is429(r) && one('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?', KC).n === 20, JSON.stringify(r));
r = await call(thread.onRequestPost, 'POST', '/x', 30, { id: String(KC) }, { body: '' });
check('...an empty message is still a 400 (checked before the limit)', r.status === 400);
run('DELETE FROM user_action_log');
logRows(30, 'message', 29, 20, `conversation:${KC}`);
r = await call(thread.onRequestPost, 'POST', '/x', 30, { id: String(KC) }, { body: 'thirtieth this hour' });
const r2 = await call(thread.onRequestPost, 'POST', '/x', 30, { id: String(KC) }, { body: 'thirty-first' });
check('messages: the 30th in an hour in one thread goes, the 31st is 429', r.status === 201 && is429(r2), `${r.status} ${r2.status}`);
run('DELETE FROM user_action_log');

// Proposals: 5 sends/edits per home per day.
const bidBody = { message: 'Happy to help you sell.', commissionPct: 2.5 };
statuses = [];
for (let i = 0; i < 5; i++) statuses.push((await call(bids.onRequestPost, 'POST', '/x', 8, P10, { ...bidBody, message: `Version ${i}` })).status);
r = await call(bids.onRequestPost, 'POST', '/x', 8, P10, bidBody);
check('proposals: 5 sends/edits on one home go through, the 6th is 429', statuses.every(s => s === 201) && is429(r), `${statuses} ${r.status}`);
check('...and the 6th changed nothing', one("SELECT message FROM service_bids WHERE request_id = 10 AND agent_user_id = 8").message === 'Version 4');
run('DELETE FROM user_action_log');
r = await call(bids.onRequestPost, 'POST', '/x', 8, P10, { commissionPct: 2 });
check('...an invalid proposal is a 400 and uses up nothing', r.status === 400 && one('SELECT COUNT(*) AS n FROM user_action_log').n === 0, JSON.stringify(r));
logRows(8, 'proposal', 10, 30, 'pre_listing:99');
r = await call(bids.onRequestPost, 'POST', '/x', 8, P12, bidBody);
check('...10 proposals in an hour across homes is the cap', is429(r));
run('DELETE FROM user_action_log');

// Price votes and opinions (and deck uploads): 6 per home per day.
statuses = [];
for (const v of ['too_high', 'too_low', 'just_right', 'too_high', 'too_low', 'just_right']) statuses.push((await call(votes.onRequestPost, 'POST', '/x', 8, P10, { vote: v })).status);
r = await call(votes.onRequestPost, 'POST', '/x', 8, P10, { vote: 'too_high' });
check('price votes: 6 on one home go through, the 7th is 429', statuses.every(s => s === 200) && is429(r), `${statuses} ${r.status}`);
check('...and the 7th changed nothing', one('SELECT vote FROM pre_listing_price_votes WHERE pre_listing_id = 10 AND agent_user_id = 8').vote === 'just_right');
const deckForm = () => { const f = new FormData(); f.append('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'pitch.pdf', { type: 'application/pdf' })); return f; };
r = await call(deck.onRequestPost, 'POST', '/x', 8, P10, deckForm());
check('...a presentation upload counts toward the same limit (429)', is429(r), JSON.stringify(r));
run('DELETE FROM user_action_log');
r = await call(deck.onRequestPost, 'POST', '/x', 8, P10, deckForm());
check('...and goes through once under it', r.status === 201, JSON.stringify(r));
r = await call(votes.onRequestPost, 'POST', '/x', 8, P10, { vote: 'nonsense' });
check('...an invalid vote is a 400 and uses up nothing', r.status === 400 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'price_vote'").n === 1);
run('DELETE FROM user_action_log');

// Showing requests: 3 per home per 7 days (request, cancel, request again...).
statuses = [];
for (let i = 0; i < 3; i++) {
  r = await call(showings.onRequestPost, 'POST', '/x', 8, P12, { proposedAt: future(48 + i) });
  statuses.push(r.status);
  if (r.json && r.json.id) await call(showing.onRequestPut, 'PUT', '/x', 8, { id: '12', showingId: String(r.json.id) }, { action: 'cancel' });
}
r = await call(showings.onRequestPost, 'POST', '/x', 8, P12, { proposedAt: future(60) });
check('showing requests: 3 on one home go through, a 4th within 7 days is 429', statuses.every(s => s === 201) && is429(r), `${statuses} ${r.status}`);
logRows(8, 'showing_request', 10, 60, 'pre_listing:98');
r = await call(showings.onRequestPost, 'POST', '/x', 8, { id: '14' }, { proposedAt: future(60) });
check('...10 a day across homes is the cap', is429(r));
run('DELETE FROM user_action_log');

// Broker preview RSVPs: 20 a day; the owner hears about an agent's first RSVP to a window only.
run("INSERT INTO pre_listing_previews (id, pre_listing_id, starts_at, ends_at) VALUES (70, 12, ?, ?)", future(30), future(32));
const PV70 = { id: '12', previewId: '70' };
const rsvpNotes = () => notes(7, "%RSVP'd to your broker preview%").length;
r = await call(preview.onRequestPut, 'PUT', '/x', 8, PV70, { going: true });
check('RSVP: an agent RSVPs and the owner is told once', r.status === 200 && r.json.going === true && rsvpNotes() === 1, `${r.status} ${rsvpNotes()}`);
await call(preview.onRequestPut, 'PUT', '/x', 8, PV70, { going: false });
r = await call(preview.onRequestPut, 'PUT', '/x', 8, PV70, { going: true });
check('...taking it back and RSVPing again does not ping the owner again', r.status === 200 && rsvpNotes() === 1, String(rsvpNotes()));
const before = one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'preview_rsvp'").n;
r = await call(preview.onRequestPut, 'PUT', '/x', 8, PV70, { going: true });
check('...RSVPing while already going is a no-op (not counted)', r.status === 200 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE kind = 'preview_rsvp'").n === before);
await call(preview.onRequestPut, 'PUT', '/x', 8, PV70, { going: false });
logRows(8, 'preview_rsvp', 20, 60);
r = await call(preview.onRequestPut, 'PUT', '/x', 8, PV70, { going: true });
check('...20 RSVPs a day is the cap (429)', is429(r), JSON.stringify(r));
r = await call(preview.onRequestPut, 'PUT', '/x', 8, PV70, { going: false });
check('...taking an RSVP back is never limited', r.status === 200);
run('DELETE FROM user_action_log');

// Agent invites: 20 a day; a declined invite stays declined; no re-ping within 30 days.
const inviteNotes = (agentId, homeId) => q("SELECT body FROM notifications WHERE user_id = ? AND link = ? AND body LIKE '%invited you to bid directly.'", agentId, `/app#pre-listing-${homeId}`).length;
r = await call(invites.onRequestPost, 'POST', '/x', 7, P12, { agentUserId: 6, message: 'Please take a look.' });
check('invites: the owner invites an agent and the agent is told', r.status === 201 && inviteNotes(6, 12) === 1, JSON.stringify(r));
r = await call(invites.onRequestPost, 'POST', '/x', 7, P12, { agentUserId: 6, message: 'Following up.' });
check('...inviting again within 30 days updates the note but does not ping again', r.status === 201 && inviteNotes(6, 12) === 1
  && one("SELECT message FROM agent_invites WHERE request_id = 12 AND agent_user_id = 6").message === 'Following up.');
run("UPDATE notifications SET created_at = datetime('now', '-31 days') WHERE user_id = 6");
await call(invites.onRequestPost, 'POST', '/x', 7, P12, { agentUserId: 6, message: 'A month later.' });
check('...after 30 days a new invite pings again', inviteNotes(6, 12) === 2);
const inv = one("SELECT id FROM agent_invites WHERE request_id = 12 AND agent_user_id = 6");
await invitesLib.declineInvite(DB, inv.id, 6);
run("UPDATE notifications SET created_at = datetime('now', '-31 days') WHERE user_id = 6");
r = await call(invites.onRequestPost, 'POST', '/x', 7, P12, { agentUserId: 6, message: 'Pretty please.' });
check('...a declined invite is never put back to pending', r.status === 201 && one("SELECT status FROM agent_invites WHERE id = ?", inv.id).status === 'declined');
check('...and the agent who declined is not pinged again', inviteNotes(6, 12) === 2);
logRows(7, 'agent_invite', 20, 60);
r = await call(invites.onRequestPost, 'POST', '/x', 7, P12, { agentUserId: 8 });
check('...20 invites a day is the cap (429)', is429(r), JSON.stringify(r));
run('DELETE FROM user_action_log');
r = await call(invites.onRequestPost, 'POST', '/x', 4, P12, { agentUserId: 8 });
check("...someone else's home is still refused, and uses up nothing", r.status === 400 && one('SELECT COUNT(*) AS n FROM user_action_log').n === 0, JSON.stringify(r));
r = await call(invites.onRequestPost, 'POST', '/x', 7, P12, { agentUserId: 4 });
check('...so is inviting someone who is not an approved agent', r.status === 400 && one('SELECT COUNT(*) AS n FROM user_action_log').n === 0, JSON.stringify(r));

// Reports: 10 a day; presets; a duplicate open report is ignored; a missing target is a 404.
run("INSERT INTO posts (id, user_id, body) VALUES (500, 7, 'A post')");
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'user', targetId: 2, preset: 'Rules problem', reason: 'Asked me to pay a fee upfront.' });
check('reports: "Rules problem" on an agent (targetType user) with details', r.status === 201
  && one("SELECT reason FROM reports WHERE reporter_id = 4 AND target_type = 'user' AND target_id = 2").reason === 'Rules problem: Asked me to pay a fee upfront.', JSON.stringify(r));
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'user', targetId: 2, preset: 'Rules problem' });
check('...a second open report from the same person on the same agent is ignored', r.status === 200 && r.json.alreadyReported === true
  && one("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = 4 AND target_id = 2").n === 1);
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'post', targetId: 500, preset: 'Fair housing concern' });
check('..."Fair housing concern" works on its own', r.status === 201 && one("SELECT reason FROM reports WHERE target_type = 'post' AND target_id = 500").reason === 'Fair housing concern');
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'post', targetId: 501, reason: 'spam' });
check('...a target that does not exist is a 404', r.status === 404);
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'user', targetId: 2, preset: 'Bad agent' });
check('...an unknown preset is a 400', r.status === 400);
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'user', targetId: 4, reason: 'me' });
check("...you can't report yourself", r.status === 400);
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'listing', targetId: 1, reason: '' });
check('...no reason at all is still a 400', r.status === 400);
run("UPDATE reports SET status = 'resolved' WHERE reporter_id = 4 AND target_id = 2");
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'user', targetId: 2, reason: 'It happened again.' });
check('...once the first is resolved, a new report goes in', r.status === 201 && one("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = 4 AND target_id = 2").n === 2);
run('DELETE FROM user_action_log');
logRows(4, 'report', 10, 60);
r = await call(reports.onRequestPost, 'POST', '/x', 4, {}, { targetType: 'user', targetId: 3, reason: 'x' });
check('...10 reports a day is the cap (429)', is429(r));
run('DELETE FROM user_action_log');
check('saved_search: the helper allows 20 a day for B3 (21st refused)', await (async () => {
  let n = 0; for (let i = 0; i < 21; i++) if (await rl.claimUserAction(DB, 'saved_search', 30)) n++; return n === 20;
})());
run('DELETE FROM user_action_log');

// ================= Prune job =================
logRows(30, 'message', 2, 3 * 1440);
logRows(30, 'message', 1, 1440 - 5);
logRows(30, 'showing_request', 1, 3 * 1440, 'pre_listing:1');
logRows(30, 'showing_request', 1, 8 * 1440, 'pre_listing:1');
logRows(30, 'retired_kind', 1, 3 * 1440);
run("INSERT INTO login_attempts (kind, ip, created_at) VALUES ('login', '1.1.1.1', datetime('now', '-3 days')), ('login', '1.1.1.1', datetime('now', '-1 day', '+5 minutes'))");
const mw = await mod('functions/api/_middleware.js');
const mwPending = [];
const mwRes = await mw.onRequest({ request: new Request('https://amicohaus.com/api/x'), env, params: {}, waitUntil(p) { mwPending.push(p); }, next: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) });
await Promise.all(mwPending);
const left = q('SELECT kind, created_at FROM user_action_log WHERE user_id = 30 ORDER BY kind');
check('prune (from the lazy jobs): rows older than 2 days go, newer stay', mwRes.status === 200 && left.filter(x => x.kind === 'message').length === 1, JSON.stringify(left));
check('...a 7-day window keeps its rows (3 days old stays, 8 days old goes)', left.filter(x => x.kind === 'showing_request').length === 1);
check('...a kind no longer in use goes after 2 days', !left.some(x => x.kind === 'retired_kind'));
check('...old login_attempts rows go too', one('SELECT COUNT(*) AS n FROM login_attempts').n === 1);
run('DELETE FROM user_action_log');

// ================= Blocks =================
// Seed: on home 10 (owner 1) agents 2, 3, 6 (and suspended 9) each have a proposal and a vote; 2, 3, 6 opinions.
run('DELETE FROM service_bids'); run('DELETE FROM pre_listing_price_votes'); run('DELETE FROM pre_listing_price_opinions');
for (const a of [2, 3, 6, 9]) run("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 10, ?, 'Pick me', 2.5, 'pending')", a);
run("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 12, 3, 'Pick me', 2.5, 'pending')");
for (const [a, v] of [[2, 'too_high'], [3, 'just_right'], [6, 'too_low'], [9, 'too_high']]) run('INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (10, ?, ?)', a, v);
for (const [a, p, prep] of [[2, 800000, '["paint_inside"]'], [3, 760000, '["paint_inside"]'], [6, 740000, '["declutter"]']]) {
  run('INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, prep_json) VALUES (10, ?, ?, ?)', a, p, prep);
}
run("INSERT INTO pre_listing_showings (id, pre_listing_id, agent_user_id, proposed_at, status) VALUES (801, 10, 2, ?, 'pending'), (802, 10, 2, ?, 'accepted'), (803, 10, 3, ?, 'pending'), (804, 10, 9, ?, 'pending')",
  future(50), future(51), future(52), future(53));
run("INSERT INTO pre_listing_previews (id, pre_listing_id, starts_at, ends_at) VALUES (71, 10, ?, ?), (72, 10, ?, ?)", future(30), future(32), future(-30), future(-28));
run('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (71, 2), (72, 2), (71, 3)');
run("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, format, slots_json, status) VALUES (10, 2, 'video', ?, 'requested'), (10, 3, 'video', ?, 'scheduled')",
  JSON.stringify([future(70)]), JSON.stringify([future(71)]));
run("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id, status) VALUES ('pre_listing', 10, 2, 1, 'pending'), ('pre_listing', 10, 6, 1, 'pending')");
run('INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (10, 1, 2), (10, 1, 3)');
const K12 = (await call(convos.onRequestPost, 'POST', '/x', 2, {}, { userId: 1 })).json.id;
await call(thread.onRequestPost, 'POST', '/x', 2, { id: String(K12) }, { body: 'Hi, I sent a proposal.' });

const bidIds = async (homeId) => (await market.fetchBids(DB, 'pre_listing', homeId)).map(b => b.agentUserId).sort().join(',');
check('(baseline) the owner sees proposals from 2, 3, 6 (not the suspended agent)', await bidIds(10) === '2,3,6', await bidIds(10));
let tally = await pl.getVoteTally(DB, 10);
check("(baseline) the vote tally leaves out the suspended agent's vote (the missing active filter)", tally.total === 3 && tally.too_high === 1, JSON.stringify(tally));
let ops = await pl.fetchPriceOpinions(DB, 10);
check('(baseline) price opinions from 3 agents make a range', ops.opinions.length === 3 && ops.summary && ops.summary.count === 3, JSON.stringify(ops.summary));
const notesBefore2 = notes(2).length;

r = await call(blocksApi.onRequestPost, 'POST', '/api/blocks', 1, {}, { userId: 2 });
check('the owner blocks agent 2', r.status === 201 && one('SELECT 1 AS y FROM user_blocks WHERE blocker_id = 1 AND blocked_id = 2'));
// Side effects.
check('side effect: shared contact info with that agent is gone (the other share stays)', !one('SELECT 1 FROM contact_shares WHERE agent_id = 2') && one('SELECT 1 AS y FROM contact_shares WHERE agent_id = 3'));
check("side effect: their RSVP to the upcoming preview is gone, the past one's history stays, others untouched",
  !one('SELECT 1 FROM pre_listing_preview_rsvps WHERE preview_id = 71 AND agent_user_id = 2') && one('SELECT 1 AS y FROM pre_listing_preview_rsvps WHERE preview_id = 72 AND agent_user_id = 2')
  && one('SELECT 1 AS y FROM pre_listing_preview_rsvps WHERE preview_id = 71 AND agent_user_id = 3'));
check('side effect: their pending showing is canceled (an accepted one and other agents are untouched)',
  one('SELECT status FROM pre_listing_showings WHERE id = 801').status === 'canceled' && one('SELECT status FROM pre_listing_showings WHERE id = 802').status === 'accepted'
  && one('SELECT status FROM pre_listing_showings WHERE id = 803').status === 'pending');
check('side effect: their requested interview is canceled (agent 3 keeps theirs)',
  one('SELECT status FROM pre_listing_interviews WHERE agent_user_id = 2').status === 'canceled' && one('SELECT status FROM pre_listing_interviews WHERE agent_user_id = 3').status === 'scheduled');
check('side effect: their pending invite is declined (agent 6 keeps theirs)',
  one('SELECT status FROM agent_invites WHERE request_id = 10 AND agent_user_id = 2').status === 'declined' && one('SELECT status FROM agent_invites WHERE request_id = 10 AND agent_user_id = 6').status === 'pending');
check('their proposal, vote and opinion stay stored', one("SELECT COUNT(*) AS n FROM service_bids WHERE request_id = 10 AND agent_user_id = 2").n === 1
  && one('SELECT 1 AS y FROM pre_listing_price_votes WHERE agent_user_id = 2') && one('SELECT 1 AS y FROM pre_listing_price_opinions WHERE agent_user_id = 2'));
check('nobody is told about the block', notes(2).length === notesBefore2);

// Write paths for the blocked agent: all look like the home isn't there.
const NF = (x) => x.status === 404 && x.json && x.json.error === 'Pre-listing not found.';
r = await call(bids.onRequestPost, 'POST', '/x', 2, P10, bidBody);
check('blocked agent: sending a proposal is a 404 "Pre-listing not found."', NF(r), JSON.stringify(r));
r = await call(pitch.onRequestPut, 'PUT', '/x', 2, P10, undefined, { 'Content-Type': 'video/mp4' });
check('blocked agent: adding a pitch reel is a 404', NF(r), JSON.stringify(r));
r = await call(votes.onRequestPost, 'POST', '/x', 2, P10, { vote: 'too_low' });
check('blocked agent: a price vote is a 404', NF(r) && one('SELECT vote FROM pre_listing_price_votes WHERE agent_user_id = 2').vote === 'too_high', JSON.stringify(r));
r = await call(deck.onRequestPost, 'POST', '/x', 2, P10, deckForm());
check('blocked agent: a presentation upload is a 404', NF(r), JSON.stringify(r));
r = await call(showings.onRequestPost, 'POST', '/x', 2, P10, { proposedAt: future(60) });
check('blocked agent: a showing request is a 404', NF(r), JSON.stringify(r));
r = await call(preview.onRequestPut, 'PUT', '/x', 2, { id: '10', previewId: '71' }, { going: true });
check('blocked agent: a preview RSVP is a 404', NF(r) && !one('SELECT 1 FROM pre_listing_preview_rsvps WHERE preview_id = 71 AND agent_user_id = 2'), JSON.stringify(r));
r = await call(interview.onRequestPut, 'PUT', '/x', 2, { id: '10', agentId: '2' }, { chosenSlot: JSON.parse(one('SELECT slots_json FROM pre_listing_interviews WHERE agent_user_id = 2').slots_json)[0] });
check('blocked agent: picking an interview time is a 404', NF(r), JSON.stringify(r));
// Reads for the blocked agent.
r = await call(votes.onRequestGet, 'GET', '/x', 2, P10);
check('blocked agent: the vote tally is a 404', NF(r), JSON.stringify(r));
r = await call(showings.onRequestGet, 'GET', '/x', 2, P10);
check('blocked agent: their showing list is a 404', NF(r));
r = await call(previews.onRequestGet, 'GET', '/x', 2, P10);
check('blocked agent: previews (and the address) are a 404', NF(r) && r.json.address === undefined);
r = await call(interviews.onRequestGet, 'GET', '/x', 2, P10);
check('blocked agent: interviews are a 404', NF(r));
// The owner's write paths toward the blocked agent.
const bid2 = one("SELECT id FROM service_bids WHERE request_id = 10 AND agent_user_id = 2").id;
r = await call(bid.onRequestPut, 'PUT', '/x', 1, { id: '10', bidId: String(bid2) }, { action: 'accept' });
check('owner: accepting a blocked agent\'s proposal is a 400 "Unblock this agent first."', r.status === 400 && r.json.error === 'Unblock this agent first.'
  && one('SELECT status FROM pre_listings WHERE id = 10').status === 'open', JSON.stringify(r));
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P10, { agentUserId: 2, format: 'video', slots: [future(80)] });
check('owner: asking a blocked agent for an interview is refused (unblock first)', r.status === 400 && r.json.error === 'Unblock this agent first.', JSON.stringify(r));
r = await call(invites.onRequestPost, 'POST', '/x', 1, P10, { agentUserId: 2 });
check('owner: inviting a blocked agent is refused (unblock first)', r.status === 400 && r.json.error === 'Unblock this agent first.', JSON.stringify(r));
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 2 });
check('owner: sharing contact info with a blocked agent is refused (unblock first)', r.status === 400 && r.json.error === 'Unblock this agent first.' && !one('SELECT 1 FROM contact_shares WHERE agent_id = 2'), JSON.stringify(r));
// The owner's lists leave the blocked agent out.
check('owner lists: proposals (fetchBids) leave agent 2 out', await bidIds(10) === '3,6', await bidIds(10));
check('owner lists: the sealed proposal count leaves agent 2 out', await dn.countSealedProposals(DB, 10) === 2);
tally = await pl.getVoteTally(DB, 10);
check('owner lists: the vote tally leaves agent 2 out', tally.total === 2 && tally.too_high === 0 && tally.just_right === 1 && tally.too_low === 1, JSON.stringify(tally));
ops = await pl.fetchPriceOpinions(DB, 10);
check('owner lists: price opinions (both queries) leave agent 2 out, and the range drops below 3', ops.opinions.map(o => o.agentUserId).sort().join() === '3,6' && ops.summary === null, JSON.stringify(ops));
check('...and so do the "fix before you list" counts', JSON.stringify(ops.prepSummary.map(p => [p.key, p.count])) === JSON.stringify([['declutter', 1], ['paint_inside', 1]]), JSON.stringify(ops.prepSummary));
const shows = await showLib.fetchShowings(DB, 10, {});
check('owner lists: showings leave agent 2 and the suspended agent out', shows.map(s => s.id).join() === '803', JSON.stringify(shows.map(s => s.id)));
r = await call(interviews.onRequestGet, 'GET', '/x', 1, P10);
check('owner lists: interviews leave agent 2 out', r.json.interviews.map(i => i.agentUserId).join() === '3', JSON.stringify(r.json));
r = await call(previews.onRequestGet, 'GET', '/x', 1, P10);
check('owner lists: the preview RSVP list leaves agent 2 out', r.json.previews.find(p => p.id === 71).agents.map(a => a.agentUserId).join() === '3', JSON.stringify(r.json.previews));
const invs = await invitesLib.fetchInvitesForRequest(DB, 'pre_listing', 10);
check('owner lists: invites leave agent 2 out', invs.map(i => i.agentUserId).join() === '6', JSON.stringify(invs));
check('owner lists: finalists leave a blocked agent out', await (async () => {
  run("UPDATE service_bids SET owner_pick = 'shortlist' WHERE request_id = 10 AND agent_user_id IN (2, 3)");
  const f = await dn.fetchFinalists(DB, 10, 0);
  return f.map(x => x.agentUserId).join() === '3';
})());
r = await call(votes.onRequestGet, 'GET', '/x', 1, P10);
check('votes GET: the owner gets the full (filtered) tally', r.status === 200 && r.json.votes.total === 2 && r.json.votes.sealed === undefined, JSON.stringify(r.json));
r = await call(votes.onRequestGet, 'GET', '/x', 5, P10);
check('votes GET: an admin gets the full tally', r.status === 200 && r.json.votes.too_low === 1, JSON.stringify(r.json));
r = await call(votes.onRequestGet, 'GET', '/x', 3, P10);
check('votes GET: an agent who voted gets the full tally', r.status === 200 && r.json.votes.just_right === 1);
r = await call(votes.onRequestGet, 'GET', '/x', 8, P12);
check('votes GET: an agent who has not voted gets it sealed', r.status === 200 && r.json.votes.sealed === true && r.json.votes.too_high === undefined, JSON.stringify(r.json));
r = await call(votes.onRequestGet, 'GET', '/x', 4, P10);
check('votes GET: a homeowner or buyer gets 403 agents_only (no tally)', r.status === 403 && r.json.code === 'agents_only' && !r.json.votes, JSON.stringify(r));
run("UPDATE pre_listings SET status = 'awarded' WHERE id = 14");
r = await call(votes.onRequestGet, 'GET', '/x', 8, { id: '14' });
const r14 = await call(votes.onRequestGet, 'GET', '/x', 3, { id: '14' });
check('votes GET: a home that is no longer open is 404 to an agent who never took part', r.status === 404 && r14.status === 404);
run("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (14, 8, 'too_high')");
r = await call(votes.onRequestGet, 'GET', '/x', 8, { id: '14' });
check('...but open to one who did', r.status === 200 && r.json.votes.too_high === 1, JSON.stringify(r));

// Notifications skip the blocked agent.
r = await call(previews.onRequestPost, 'POST', '/x', 1, P10, { startsAt: future(96), endsAt: future(98) });
const previewNote = (a) => notes(a, 'A homeowner opened a broker preview%').length;
check('a new preview tells engaged agents but not the blocked one', r.status === 201 && previewNote(3) === 1 && previewNote(6) === 1 && previewNote(2) === 0, `${previewNote(3)} ${previewNote(6)} ${previewNote(2)}`);
await notify.notifyAgentsNewRequest(ctx, 'pre_listing', 10, null, [1]);
const newReq = (a) => notes(a, 'A new pre-listing opened for proposals near you.').length;
check('the new-request alert leaves out the agent the owner blocked (looked up inside)', newReq(3) === 1 && newReq(6) === 1 && newReq(8) === 1 && newReq(2) === 0, `${newReq(2)} ${newReq(3)}`);
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (6, 7)');
await notify.notifyAgentsNewRequest(ctx, 'pre_listing', 12, null, [7]);
check('...and an agent who blocked that owner', notes(6, 'A new pre-listing opened%').length === 1 && notes(3, 'A new pre-listing opened%').length === 2);
run('DELETE FROM user_blocks WHERE blocker_id = 6');

// Conversations.
r = await call(convos.onRequestGet, 'GET', '/x', 1);
check('conversations: the blocker\'s list marks the thread blockedByMe', r.json.conversations.find(c => c.other_user_id === 2).blockedByMe === true, JSON.stringify(r.json));
r = await call(convos.onRequestGet, 'GET', '/x', 2);
check("...the blocked person's list never says they were blocked", r.json.conversations.find(c => c.other_user_id === 1).blockedByMe === false);
r = await call(thread.onRequestGet, 'GET', '/x', 1, { id: String(K12) });
const r2b = await call(thread.onRequestGet, 'GET', '/x', 2, { id: String(K12) });
check('thread: other.blockedByMe is true for the blocker, false for the blocked person', r.json.other.blockedByMe === true && r2b.json.other.blockedByMe === false);
r = await call(thread.onRequestPost, 'POST', '/x', 1, { id: String(K12) }, { body: 'hello?' });
check('sending to someone you blocked: 403 "Unblock {name} to send a message."', r.status === 403 && r.json.error === 'Unblock User 2 to send a message.' && r.json.code === 'blocked_by_me', JSON.stringify(r));
r = await call(thread.onRequestPost, 'POST', '/x', 2, { id: String(K12) }, { body: 'hello?' });
check('...and the blocked person still gets the plain refusal', r.status === 403 && r.json.error === 'You cannot message this user.', JSON.stringify(r));
r = await call(convos.onRequestPost, 'POST', '/x', 1, {}, { userId: 2 });
check('...opening the existing thread still works for the blocker (read-only, with Unblock)', r.status === 200 && r.json.id === K12);
await call(blocksApi.onRequestPost, 'POST', '/api/blocks', 1, {}, { userId: 4 });
r = await call(convos.onRequestPost, 'POST', '/x', 1, {}, { userId: 4 });
check('...a new thread with someone you blocked is a 403 "Unblock {name} to send a message."', r.status === 403 && r.json.error === 'Unblock User 4 to send a message.', JSON.stringify(r));

// GET / DELETE /api/blocks.
r = await call(blocksApi.onRequestGet, 'GET', '/api/blocks', 1);
const b2 = r.json.blocked.find(b => b.blocked_id === 2);
const b4 = r.json.blocked.find(b => b.blocked_id === 4);
check('GET /api/blocks: createdAt, and the DRE number + brokerage for an agent', b2 && b2.createdAt && b2.licenseNumber === '01234567' && b2.brokerageName === 'Pacific Realty' && b2.display_name === 'User 2', JSON.stringify(r.json));
check('...null license fields for someone who is not an agent', b4 && b4.licenseNumber === null && b4.brokerageName === null && b4.createdAt);
r = await call(blocksApi.onRequestPost, 'POST', '/api/blocks', 1, {}, { userId: 1 });
const r404 = await call(blocksApi.onRequestPost, 'POST', '/api/blocks', 1, {}, { userId: 9999 });
check('POST /api/blocks: blocking yourself is a 400, someone who does not exist a 404', r.status === 400 && r404.status === 404);
r = await call(unblockApi.onRequestDelete, 'DELETE', '/x', 1, { userId: 'abc' });
check('DELETE /api/blocks/:userId checks the id is a number', r.status === 400);
await call(unblockApi.onRequestDelete, 'DELETE', '/x', 1, { userId: '4' });

// The other direction: an agent blocks a homeowner.
r = await call(blocksApi.onRequestPost, 'POST', '/api/blocks', 3, {}, { userId: 7 });
r = await call(bids.onRequestPost, 'POST', '/x', 3, P12, bidBody);
check('an agent who blocked the owner gets the same 404 on that home', NF(r));
const bid3 = one("SELECT id FROM service_bids WHERE request_id = 12 AND agent_user_id = 3").id;
r = await call(bid.onRequestPut, 'PUT', '/x', 7, { id: '12', bidId: String(bid3) }, { action: 'accept' });
check("...the owner can't accept that agent's proposal, and isn't told who blocked whom", r.status === 404 && r.json.error === 'Proposal not found.', JSON.stringify(r));
r = await call(invites.onRequestPost, 'POST', '/x', 7, P12, { agentUserId: 3 });
check('...or invite them (a neutral message)', r.status === 400 && r.json.error === "That agent can't be invited to this request.", JSON.stringify(r));
check("...and the owner's list leaves them out", !(await bidIds(12)).split(',').includes('3'));
await call(unblockApi.onRequestDelete, 'DELETE', '/x', 3, { userId: '7' });

// Shared contact, phone and preview address across a block made before this code (no side effects ran).
run("UPDATE users SET phone_public = 1 WHERE id = 1");
const home10 = one('SELECT * FROM pre_listings WHERE id = 10');
check('(baseline) agent 3 sees the shared contact and the public phone', !!(await addressViews.fetchSharedContact(DB, home10, 3)) && await auth.phoneVisibleTo(DB, { id: 3 }, { id: 1, phone: '619-555-0101', phone_public: 1 }) === '619-555-0101');
let pv = await sellerPrep.fetchPreviews(DB, 10, { isOwner: false, viewerId: 3, address: home10.address });
check('(baseline) agent 3 RSVP\'d, so they get the preview address', pv.address === '456 Hidden Ave');
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (3, 1)');
check('across a block, fetchSharedContact returns nothing', (await addressViews.fetchSharedContact(DB, home10, 3)) === null);
check('...phoneVisibleTo returns nothing, even for a public phone', await auth.phoneVisibleTo(DB, { id: 3 }, { id: 1, phone: '619-555-0101', phone_public: 1 }) === '');
check('...but the owner still sees their own phone', await auth.phoneVisibleTo(DB, { id: 1 }, { id: 1, phone: '619-555-0101', phone_public: 1 }) === '619-555-0101');
pv = await sellerPrep.fetchPreviews(DB, 10, { isOwner: false, viewerId: 3, address: home10.address });
check('...and an RSVP that predates the block no longer gets the address', pv.address === undefined && pv.previews.every(p => !p.imGoing), JSON.stringify(pv));
run('DELETE FROM user_blocks WHERE blocker_id = 3');
run("UPDATE users SET phone_public = 0 WHERE id = 1");

// Unblock brings proposals and opinions back (the rest doesn't).
r = await call(unblockApi.onRequestDelete, 'DELETE', '/x', 1, { userId: '2' });
check('unblock works', r.status === 200 && !one('SELECT 1 FROM user_blocks WHERE blocker_id = 1 AND blocked_id = 2'));
check("unblock: agent 2's proposal is back in the owner's list", await bidIds(10) === '2,3,6');
ops = await pl.fetchPriceOpinions(DB, 10);
check('unblock: their opinion is back, and so is the range', ops.opinions.length === 3 && ops.summary && ops.summary.count === 3);
check('unblock: their vote counts again', (await pl.getVoteTally(DB, 10)).total === 3);
check("unblock: what ended with the block doesn't come back (share, showing, interview, invite)",
  !one('SELECT 1 FROM contact_shares WHERE agent_id = 2') && one('SELECT status FROM pre_listing_showings WHERE id = 801').status === 'canceled'
  && one('SELECT status FROM pre_listing_interviews WHERE agent_user_id = 2').status === 'canceled'
  && one('SELECT status FROM agent_invites WHERE request_id = 10 AND agent_user_id = 2').status === 'declined');
r = await call(thread.onRequestPost, 'POST', '/x', 1, { id: String(K12) }, { body: 'Thanks for your proposal.' });
check('unblock: messaging works again', r.status === 201, JSON.stringify(r));
check('blockedIdsFor / isEitherBlocked / notBlockedSql agree', await (async () => {
  run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (6, 1)');
  const set = await blocksLib.blockedIdsFor(DB, 1);
  const either = await blocksLib.isEitherBlocked(DB, 1, 6);
  const sqlRow = one(`SELECT ${blocksLib.notBlockedSql('?1', '?2')} AS ok`, 6, 1);
  run('DELETE FROM user_blocks WHERE blocker_id = 6');
  return set.has(6) && either && sqlRow.ok === 0 && blocksLib.notBlockedSql('service_bids.agent_user_id', '?1') ===
    'NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ?1 AND ub.blocked_id = service_bids.agent_user_id) OR (ub.blocker_id = service_bids.agent_user_id AND ub.blocked_id = ?1))';
})());

// ================= Grey-area items (#15 no win rate / Top Rated, #5 offer alerts, FinderMine wording) =================
const stats = await market.fetchAgentStats(DB, 3);
check('fetchAgentStats no longer computes winRate or topRated (plain counts stay)', !('winRate' in stats) && !('topRated' in stats) && 'acceptedBids' in stats && 'decidedBids' in stats && 'totalBids' in stats, JSON.stringify(stats));
const bidRows = await market.fetchBids(DB, 'pre_listing', 10);
check('proposals carry no winRate, topRated or isVerified badge flag, but still the hire count', bidRows.every(b => !('winRate' in b) && !('topRated' in b) && !('isVerified' in b) && 'hiresOnPlatform' in b), JSON.stringify(Object.keys(bidRows[0])));
await notify.notifyOfferDecision(ctx, 20, '/listing/1', true, 750000);
await notify.notifyOfferDecision(ctx, 21, '/listing/1', true);
await notify.notifyOfferDecision(ctx, 22, '/listing/1', false, 750000);
check('offer accepted alert: "The owner wants to move forward at $X (not a contract yet)."', lastNote(20).body === 'The owner wants to move forward at $750,000 (not a contract yet).', JSON.stringify(lastNote(20)));
check('...without a price it still never says "accepted"', lastNote(21).body === 'The owner wants to move forward with your offer (not a contract yet).');
check('...a declined offer reads as before', lastNote(22).body === 'Your offer was not accepted this time.');
await notify.notifyCounterDecision(ctx, '/listing/1', 23, true, { price: 700000, acceptedBy: 'buyer' });
await notify.notifyCounterDecision(ctx, '/listing/1', 24, true, { price: 700000, acceptedBy: 'owner' });
await notify.notifyCounterDecision(ctx, '/listing/1', 25, true);
check('counter accepted alerts say who wants to move forward, at what price, not a contract yet',
  lastNote(23).body === 'The buyer wants to move forward at $700,000 (not a contract yet).' && lastNote(24).body === 'The owner wants to move forward at $700,000 (not a contract yet).'
  && lastNote(25).body === 'The other side wants to move forward with your counter-offer (not a contract yet).', JSON.stringify([lastNote(23), lastNote(24), lastNote(25)]));
await notify.notifyOfferCounter(ctx, '/listing/1', 26, 720000, 'owner');
check('counter-offer alert says not a contract yet', lastNote(26).body === 'The seller countered your offer at $720,000 (not a contract yet).', JSON.stringify(lastNote(26)));
check('no offer alert says "accepted!"', !q("SELECT body FROM notifications WHERE body LIKE '%accepted!%'").length);
await notify.notifyNewProjectInterest(ctx, 1, 7, 4);
check('FinderMine interest alert has no investor language', notes(7, '%FinderMine%')[0].body === 'User 4 is interested in your FinderMine project.' && !q("SELECT 1 FROM notifications WHERE body LIKE '%investor%'").length);

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
