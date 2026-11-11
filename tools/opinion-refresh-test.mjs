// Runs the real handlers for batch R3-1b's Opinion Refresh and price opinion history against an in-memory SQLite
// stand-in for D1 and a Map stand-in for R2: every version kept (votes POST), the owner's refresh request (gates, the
// 90-day claim, who gets asked, the race), the agents' Same / Update answers (gates, validation, the shared per-home
// budget), the alerts and held emails, who sees which history, the jury rules (no median or other cross-agent figure,
// arrival order, labels), the data export and the cascades. Emails use EMAIL_DEV_LOG (captured). No network.
// Usage: node --disable-warning=ExperimentalWarning tools/opinion-refresh-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
const batchSizes = [];
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
  batch: async (stmts) => { batchSizes.push(stmts.length); const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const objects = new Map();
const PHOTOS = {
  put: async (key, body) => { const buf = body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array(body); objects.set(key, buf); },
  head: async (key) => (objects.has(key) ? { size: objects.get(key).length } : null),
  get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
  delete: async (key) => { for (const k of [].concat(key)) objects.delete(k); },
};
const env = { DB, PHOTOS, EMAIL_DEV_LOG: '1' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);

let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
// Dev-log emails ("[email dev log] to x: subject\ntext") are captured; everything else printed is dropped.
const emails = [];
console.log = (...a) => {
  const s = a.join(' ');
  const m = /^\[email dev log\] to (\S+): ([^\n]*)\n?([\s\S]*)$/.exec(s);
  if (m) emails.push({ to: m[1], subject: m[2], text: m[3] });
};

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
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: type.includes('json') ? JSON.parse(text) : null };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => r.headers.get('Cache-Control') === 'private, no-store';

// People: 1 owner (also an approved agent, to prove an owner is never asked), 2 3 4 5 agents, 6 an approved agent
// whose account is suspended, 7 pending profile, 8 rejected profile, 9 a plain admin, 10 the admin-as-agent (operator),
// 11 an agent the owner blocked, 12 an agent who blocked the owner, 13 a demo agent, 14 an agent with duty hours
// (off duty now), 15 a second owner, 16 an agent with no number, 17 a second rejected profile, 18 a fresh agent.
const { pacificParts } = await mod('functions/_lib/agentDuty.js');
const offDay = (pacificParts().weekday + 3) % 7;
const user = (id, { role = 'user', status = 'active', email = `u${id}@example.test`, profile = null, duty = false } = {}) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, email, `Agent ${id}`, role, status);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
  if (profile) {
    run('INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, duty_days_json, duty_start, duty_end) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, profile, `0200${String(id).padStart(4, '0')}`, 'Bay Realty', duty ? JSON.stringify([offDay]) : null, duty ? '09:00' : null, duty ? '10:00' : null);
  }
};
user(1, { profile: 'approved' });
for (const id of [2, 3, 4, 5, 11, 12, 16, 18]) user(id, { profile: 'approved' });
user(6, { profile: 'approved', status: 'suspended' });
user(7, { profile: 'pending' });
user(8, { profile: 'rejected' });
user(9, { role: 'admin' });
user(10, { role: 'admin', profile: 'approved' });
user(13, { profile: 'approved', email: 'agent13@demo.amicohaus.local' });
user(14, { profile: 'approved', duty: true });
user(15);
user(17, { profile: 'rejected' }); // (profiles are pending, approved or rejected only)
run('UPDATE users SET display_name = ? WHERE id = 1', 'Owner One');
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 11), (12, 1)');

const home = (id, owner, { status = 'open', price = 900000 } = {}) => run(
  `INSERT INTO pre_listings (id, user_id, city, state, zip, neighborhood, property_type, beds, baths, asking_price, status)
   VALUES (?, ?, 'Chula Vista', 'CA', '91913', 'Rolling Hills', 'Single Family Home', 4, 3, ?, ?)`, id, owner, price, status);
// An opinion seeded straight into the table (an opinion from before the history began), dated N days ago.
const opinion = (homeId, agent, price, createdDaysAgo, updatedDaysAgo = createdDaysAgo, extra = {}) => run(
  `INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, comps_json, deck_r2_key, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`, homeId, agent, price, extra.comps || '[]', extra.deck || null, `-${createdDaysAgo} days`, `-${updatedDaysAgo} days`);
const versions = (homeId, agent) => q('SELECT price_opinion, source, reason, comp_json, ask_id, created_at FROM pre_listing_opinion_versions WHERE pre_listing_id = ? AND agent_user_id = ? ORDER BY created_at, id', homeId, agent);

const votes = await mod('functions/api/pre-listings/[id]/votes/index.js');
const deck = await mod('functions/api/pre-listings/[id]/votes/deck.js');
const detail = await mod('functions/api/pre-listings/[id].js');
const refresh = await mod('functions/api/pre-listings/[id]/opinion-refresh/index.js');
const answer = await mod('functions/api/pre-listings/[id]/opinion-refresh/answer.js');
const exportApi = await mod('functions/api/account/export.js');
const duty = await mod('functions/_lib/agentDuty.js');
const trail = await mod('functions/_lib/opinionTrail.js');
const notifyLib = await mod('functions/_lib/marketplaceNotify.js');

// ---------------- 1. Every version is kept (the real votes POST) ----------------
home(200, 15);
const P200 = { id: '200' };
const ownerNotes = (uid) => one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', uid).n;
let r = await call(votes.onRequestPost, 'POST', '/x', 2, P200, { vote: 'too_high', priceOpinion: 801000, comps: [] });
check('votes POST: a first opinion saves', r.status === 200, JSON.stringify(r.json));
let v = versions(200, 2);
check("a first opinion adds one version, 'first'", v.length === 1 && v[0].source === 'first' && v[0].price_opinion === 801000, JSON.stringify(v));
const notesAfterFirst = ownerNotes(15);
await call(votes.onRequestPost, 'POST', '/x', 2, P200, { vote: 'too_high', priceOpinion: 801000, comps: [] });
check('re-saving the same number adds nothing', versions(200, 2).length === 1);
check("...and re-saving the same vote doesn't notify the owner again (opinions-test rule unchanged)", ownerNotes(15) === notesAfterFirst, `${notesAfterFirst} -> ${ownerNotes(15)}`);
await call(votes.onRequestPost, 'POST', '/x', 2, P200, { vote: 'too_high', priceOpinion: 811000, comps: [] });
v = versions(200, 2);
check("a new number adds an 'edit' version", v.length === 2 && v[1].source === 'edit' && v[1].price_opinion === 811000, JSON.stringify(v));
// A legacy opinion (no versions), then a change: the old number becomes 'first', dated at the old updated_at.
run("INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, created_at, updated_at) VALUES (200, 3, 700000, '2026-01-01 10:00:00', '2026-01-02 11:00:00')");
r = await call(votes.onRequestPost, 'POST', '/x', 3, P200, { vote: 'just_right', priceOpinion: 720000, comps: [] });
v = versions(200, 3);
check("legacy opinion then a change: 'first' at the OLD price dated at the old updated_at, plus 'edit'",
  r.status === 200 && v.length === 2 && v[0].source === 'first' && v[0].price_opinion === 700000 && v[0].created_at === '2026-01-02 11:00:00'
  && v[1].source === 'edit' && v[1].price_opinion === 720000, JSON.stringify(v));
r = await call(votes.onRequestPost, 'POST', '/x', 2, P200, { vote: 'too_high', priceOpinion: '', comps: [] });
check('clearing the number adds no version (the history keeps the last one)',
  r.status === 200 && versions(200, 2).length === 2 && one('SELECT price_opinion FROM pre_listing_price_opinions WHERE pre_listing_id = 200 AND agent_user_id = 2').price_opinion === null, JSON.stringify(r.json));
const deckForm = () => { const f = new FormData(); f.append('file', new File([new TextEncoder().encode('%PDF-1.7 deck')], 'Deck.pdf')); return f; };
r = await call(deck.onRequestPost, 'POST', '/x', 3, P200, deckForm());
check('a deck upload adds no version', r.status === 201 && versions(200, 3).length === 2, `${r.status} ${versions(200, 3).length}`);

// ---------------- 2. The owner's refresh request ----------------
// Home 100 (owner 1). Opinions 100 days old from: 2 3 4 10 13 14 (eligible), 5 (updated 10 days ago), 6 (suspended
// account), 7 (pending), 8 and 17 (rejected), 11 (owner blocked), 12 (blocked the owner), 16 (no
// number), 1 (the owner's own row). Prices are distinct so a leak is easy to spot.
home(100, 1);
home(101, 1, { status: 'awarded' });
home(102, 1, { status: 'closed' });
home(103, 1);
home(104, 1);
home(105, 1);
const P = { id: '100' };
const PRICE = { 2: 812345, 3: 823456, 4: 834567, 10: 845678, 13: 856789, 14: 867891, 5: 878912, 6: 889123, 7: 891234, 8: 902345, 17: 913456, 11: 924567, 12: 935678, 1: 946789 };
// Arrival order on purpose not by number: 4 first, then 2, 10, 3 ... (created N days ago).
const CREATED = { 4: 140, 2: 130, 10: 120, 3: 110, 13: 105, 14: 104, 5: 103, 6: 102, 7: 101, 8: 101, 17: 101, 11: 101, 12: 101, 1: 101 };
for (const [a, price] of Object.entries(PRICE)) opinion(100, Number(a), price, CREATED[a], Number(a) === 5 ? 10 : 100, Number(a) === 2 ? { deck: 'decks/SECRET-DECK-KEY-2' } : {});
opinion(100, 16, null, 100);
for (const a of [2, 3]) opinion(101, a, 700000, 100);
for (const a of [2, 3]) opinion(102, a, 700000, 100);
opinion(104, 2, 700000, 20);
for (const a of [2, 3]) opinion(105, a, 700000, 100, 5);
// Agent 11's history is seeded too: it must not show while the block stands.
run("INSERT INTO pre_listing_opinion_versions (pre_listing_id, agent_user_id, price_opinion, source) VALUES (100, 11, 924567, 'first')");

r = await call(refresh.onRequestPost, 'POST', '/x', null, P, {});
check('refresh POST: signed out is 401', r.status === 401);
r = await call(refresh.onRequestPost, 'POST', '/x', 1, { id: '999' }, {});
check('refresh POST: a missing home is 404', r.status === 404 && r.json.error === 'Pre-listing not found.', JSON.stringify(r.json));
r = await call(refresh.onRequestPost, 'POST', '/x', 2, P, {});
check("refresh POST: an agent who isn't the owner gets 403", r.status === 403, JSON.stringify(r.json));
r = await call(refresh.onRequestPost, 'POST', '/x', 9, P, {});
check("refresh POST: an admin who isn't the owner gets 403", r.status === 403, JSON.stringify(r.json));
r = await call(refresh.onRequestPost, 'POST', '/x', 1, { id: '101' }, {});
check('refresh POST: awarded is 400 not_open', r.status === 400 && r.json.code === 'not_open' && r.json.error === 'Only an open pre-listing can ask for fresh price opinions.', JSON.stringify(r.json));
r = await call(refresh.onRequestPost, 'POST', '/x', 1, { id: '102' }, {});
check('refresh POST: closed is 400 not_open', r.status === 400 && r.json.code === 'not_open', JSON.stringify(r.json));
r = await call(refresh.onRequestPost, 'POST', '/x', 1, { id: '103' }, {});
check('refresh POST: no priced opinions is no_opinions', r.status === 400 && r.json.code === 'no_opinions' && r.json.error === 'No agent has shared a price opinion to refresh yet.', JSON.stringify(r.json));
r = await call(refresh.onRequestPost, 'POST', '/x', 1, { id: '104' }, {});
const expectAvail = one("SELECT datetime(created_at, '+90 days') AS t FROM pre_listing_price_opinions WHERE pre_listing_id = 104").t;
const availLabel = new Date(expectAvail.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
check('refresh POST: a first opinion under 90 days old is refresh_too_soon with availableAt (SQL UTC text)',
  r.status === 400 && r.json.code === 'refresh_too_soon' && r.json.availableAt === expectAvail && r.json.error === `You can ask for fresh opinions on ${availLabel}.`, JSON.stringify(r.json) + ' ' + expectAvail);
r = await call(refresh.onRequestPost, 'POST', '/x', 1, { id: '105' }, {});
check("refresh POST: every agent updated in the last 30 days is all_recent, and opinions_refreshed_at stays unset",
  r.status === 400 && r.json.code === 'all_recent' && r.json.error === "Your agents' price opinions are all from the last 30 days." && one('SELECT opinions_refreshed_at AS t FROM pre_listings WHERE id = 105').t === null, JSON.stringify(r.json));

emails.length = 0;
const [ra, rb] = await Promise.all([call(refresh.onRequestPost, 'POST', '/x', 1, P, {}), call(refresh.onRequestPost, 'POST', '/x', 1, P, {})]);
const winner = ra.status === 200 ? ra : rb;
const loser = ra.status === 200 ? rb : ra;
check('two refresh POSTs at once: exactly one 200, the other refresh_too_soon', [ra.status, rb.status].sort().join() === '200,400' && loser.json.code === 'refresh_too_soon', `${ra.status} ${rb.status} ${JSON.stringify(loser.json)}`);
check('the 200 is no-store, and asked = the eligible count (6)', noStore(winner) && winner.json.ok === true && winner.json.asked === 6, JSON.stringify(winner.json));
const round1 = one('SELECT opinions_refreshed_at AS t FROM pre_listings WHERE id = 100').t;
const askedIds = q('SELECT agent_user_id AS a FROM pre_listing_opinion_asks WHERE pre_listing_id = 100 ORDER BY a').map(x => x.a).join();
check('asks go only to eligible agents (not suspended, pending, rejected profile, blocked either way, the owner, recent, or no number)',
  askedIds === '2,3,4,10,13,14' && q('SELECT asked_at FROM pre_listing_opinion_asks WHERE pre_listing_id = 100').every(x => x.asked_at === round1), askedIds);
r = await call(refresh.onRequestPost, 'POST', '/x', 1, P, {});
check('a second POST is refresh_too_soon', r.status === 400 && r.json.code === 'refresh_too_soon' && !!r.json.availableAt, JSON.stringify(r.json));

// ---------------- 3. Notifications for the asks ----------------
const ASK_BODY = 'A homeowner you gave a price opinion to would like a fresh look. Is your number the same, or would you update it?';
const askNotes = q('SELECT user_id, body, link, emailed_at FROM notifications WHERE body = ? ORDER BY user_id', ASK_BODY);
check('every asked agent gets the in-app ask with the exact body and the home link',
  askNotes.map(n => n.user_id).join() === '2,3,4,10,13,14' && askNotes.every(n => n.link === '/app#pre-listing-100'), JSON.stringify(askNotes));
const priceDigits = Object.values(PRICE).flatMap(p => [String(p), p.toLocaleString('en-US')]);
const noNumber = (s) => !String(s).includes('$') && !priceDigits.some(d => String(s).includes(d));
const held14 = q("SELECT kind, ref, subject, text_body FROM held_emails WHERE user_id = 14");
check("an off-duty agent's email is held as kind 'opinion_refresh', ref pre_listing:100",
  held14.length === 1 && held14[0].kind === 'opinion_refresh' && held14[0].ref === 'pre_listing:100' && held14[0].subject === 'A homeowner asked for a fresh price opinion on Amico Haus', JSON.stringify(held14));
check('the demo agent gets no email (in-app only)', askNotes.find(n => n.user_id === 13).emailed_at === null && !emails.some(e => e.to.includes('demo.amicohaus.local')));
check('the on-duty agents got the email now (subject and CTA)', emails.filter(e => e.subject === 'A homeowner asked for a fresh price opinion on Amico Haus').length === 4
  && emails.every(e => e.text.includes('tap Same or Update')), JSON.stringify(emails.map(e => e.to)));
check('no ask body, subject or email has a $ or a price', askNotes.every(n => noNumber(n.body)) && emails.every(e => noNumber(e.subject) && noNumber(e.text)) && held14.every(h => noNumber(h.subject) && noNumber(h.text_body)));
check("AGENT_HOLD_KINDS includes 'opinion_refresh'", duty.AGENT_HOLD_KINDS.includes('opinion_refresh'), JSON.stringify(duty.AGENT_HOLD_KINDS));

// ---------------- 4. Visibility before anyone answers ----------------
r = await call(detail.onRequestGet, 'GET', '/x', 14, P);
check('agent detail: priceOpinions null, their own trail ("on file"), and myRefreshAsk.pending', r.status === 200 && r.json.priceOpinions === null
  && Array.isArray(r.json.myOpinionTrail) && r.json.myOpinionTrail.length === 1 && r.json.myOpinionTrail[0].onFile === true && r.json.myOpinionTrail[0].price === PRICE[14]
  && r.json.myRefreshAsk && r.json.myRefreshAsk.pending === true && r.json.myRefreshAsk.askedAt === round1 && noStore(r), JSON.stringify([r.json.myOpinionTrail, r.json.myRefreshAsk]));
check("...and no other agent's price is anywhere in it", !Object.entries(PRICE).some(([a, p]) => Number(a) !== 14 && r.text.includes(String(p))));
r = await call(detail.onRequestGet, 'GET', '/x', 5, P);
check('an agent who was not asked: myRefreshAsk null', r.status === 200 && r.json.myRefreshAsk === null, JSON.stringify(r.json.myRefreshAsk));
r = await call(detail.onRequestGet, 'GET', '/x', 9, P);
check('a plain admin: no trail anywhere, myOpinionTrail and myRefreshAsk null', r.status === 200 && r.json.myOpinionTrail === null && r.json.myRefreshAsk === null
  && !r.text.includes('"trail"') && r.json.priceOpinions === null, r.text.slice(0, 300));
r = await call(detail.onRequestGet, 'GET', '/x', 10, P);
check('the admin-as-agent gets only their own trail', r.status === 200 && r.json.myOpinionTrail.length === 1 && r.json.myOpinionTrail[0].price === PRICE[10]
  && !Object.entries(PRICE).some(([a, p]) => Number(a) !== 10 && r.text.includes(String(p))) && r.json.priceOpinions === null);

// ---------------- 5. The answer POST ----------------
const A = (who, body, params = P) => call(answer.onRequestPost, 'POST', '/x', who, params, body);
r = await A(null, { answer: 'same' });
check('answer: signed out is 401', r.status === 401);
r = await A(7, { answer: 'same' });
check('answer: not an approved agent is 403', r.status === 403 && r.json.error === 'Only approved agents can answer a refresh request.', JSON.stringify(r.json));
r = await A(11, { answer: 'same' });
check('answer: a blocked agent gets 404', r.status === 404 && r.json.error === 'Pre-listing not found.', JSON.stringify(r.json));
r = await A(12, { answer: 'same' });
check('answer: an agent who blocked the owner gets 404', r.status === 404, JSON.stringify(r.json));
r = await A(1, { answer: 'same' });
check("answer: the owner gets 403", r.status === 403 && r.json.error === "You can't answer a refresh on your own pre-listing.", JSON.stringify(r.json));
r = await A(2, { answer: 'same' }, { id: '101' });
check('answer: awarded is 400 not_open', r.status === 400 && r.json.code === 'not_open' && r.json.error === "This homeowner isn't taking fresh price opinions right now.", JSON.stringify(r.json));
r = await A(5, { answer: 'same' });
check('answer: no ask waiting is 400 no_refresh_ask', r.status === 400 && r.json.code === 'no_refresh_ask' && r.json.error === "There's no refresh request waiting for you on this home.", JSON.stringify(r.json));
r = await A(2, { answer: 'maybe' });
check('answer: an unknown answer is refused', r.status === 400 && r.json.error === 'Pick Same or Update.', JSON.stringify(r.json));

const opRow = (a) => one('SELECT price_opinion, comps_json, updated_at FROM pre_listing_price_opinions WHERE pre_listing_id = 100 AND agent_user_id = ?', a);
const askRow = (a) => one('SELECT id, answer, answered_at FROM pre_listing_opinion_asks WHERE pre_listing_id = 100 AND agent_user_id = ? ORDER BY id DESC LIMIT 1', a);
const before2 = opRow(2);
const ownerNotesBefore = ownerNotes(1);
r = await A(2, { answer: 'same' });
v = versions(100, 2);
check("'same': 200 no-store, ask answered 'same', the opinion's updated_at bumped",
  r.status === 200 && r.json.ok === true && r.json.answer === 'same' && noStore(r) && askRow(2).answer === 'same' && !!askRow(2).answered_at && opRow(2).updated_at > before2.updated_at && opRow(2).price_opinion === PRICE[2], JSON.stringify([r.json, askRow(2), opRow(2)]));
check("'same': the number on file became 'first' (old date), plus a 'same' version at the current price with the ask id",
  v.length === 2 && v[0].source === 'first' && v[0].created_at === before2.updated_at && v[1].source === 'same' && v[1].price_opinion === PRICE[2] && v[1].ask_id === askRow(2).id, JSON.stringify(v));
let ownerNote = one('SELECT body, emailed_at FROM notifications WHERE user_id = 1 ORDER BY id DESC LIMIT 1');
check("'same' tells the owner in-app only (no email), with the DRE identity line and no number",
  ownerNotes(1) === ownerNotesBefore + 1 && ownerNote.body === 'Agent 2 · DRE #02000002 · Bay Realty says their price opinion is the same.' && ownerNote.emailed_at === null && noNumber(ownerNote.body), JSON.stringify(ownerNote));

r = await A(3, { answer: 'update', priceOpinion: 830000, reason: '' });
check("'update' with no reason is refused", r.status === 400 && r.json.error === 'Add a one-line reason for the change.', JSON.stringify(r.json));
r = await A(3, { answer: 'update', priceOpinion: 5, reason: 'New sale nearby' });
check("'update' with a bad price is refused", r.status === 400 && r.json.error === 'Your updated price opinion should be a whole-dollar amount.', JSON.stringify(r.json));
r = await A(3, { answer: 'update', priceOpinion: 830000, reason: 'New sale nearby', comp: { address: '9 Elm St', soldPrice: 840000, soldDate: '2099-01-01' } });
check("'update' with a future comp date: 400 starting 'The new comparable sale:'", r.status === 400 && r.json.error.startsWith('The new comparable sale:'), JSON.stringify(r.json));
check('...and nothing was written by the refused answers', askRow(3).answer === null && versions(100, 3).length === 0 && opRow(3).price_opinion === PRICE[3]);
emails.length = 0;
const comps3 = opRow(3).comps_json;
r = await A(3, { answer: 'update', priceOpinion: 831000, reason: 'A new sale two streets over', comp: { address: '9 Elm St', soldPrice: 840000, soldDate: '2026-09-15', sqft: 2100, note: 'dropped' } });
v = versions(100, 3);
const comp3 = v.length ? JSON.parse(v[v.length - 1].comp_json || 'null') : null;
check("a good 'update': the number changes, version 'update' with the reason and comp_json, the opinion's comps_json untouched",
  r.status === 200 && r.json.answer === 'update' && opRow(3).price_opinion === 831000 && opRow(3).comps_json === comps3 && askRow(3).answer === 'update'
  && v.length === 2 && v[1].source === 'update' && v[1].reason === 'A new sale two streets over' && v[1].price_opinion === 831000
  && JSON.stringify(comp3) === JSON.stringify({ address: '9 Elm St', soldPrice: 840000, soldDate: '2026-09-15', sqft: 2100 }), JSON.stringify([r.json, v]));
ownerNote = one('SELECT body, emailed_at FROM notifications WHERE user_id = 1 ORDER BY id DESC LIMIT 1');
check("'update' sends the owner an emailable alert with the exact body, and no number anywhere",
  ownerNote.body === 'Agent 3 · DRE #02000003 · Bay Realty updated their price opinion.' && !!ownerNote.emailed_at && noNumber(ownerNote.body)
  && emails.length === 1 && emails[0].subject === 'Updated price opinion on Amico Haus' && emails[0].text.includes('see your price opinion history') && noNumber(emails[0].subject) && !emails[0].text.includes('831'), JSON.stringify([ownerNote, emails]));
r = await A(3, { answer: 'same' });
check('a second answer is 400 no_refresh_ask', r.status === 400 && r.json.code === 'no_refresh_ask', JSON.stringify(r.json));
const [a1, a2] = await Promise.all([A(4, { answer: 'same' }), A(4, { answer: 'update', priceOpinion: 840000, reason: 'Comps moved' })]);
check('two answers at once: exactly one 200', [a1.status, a2.status].sort().join() === '200,400' && versions(100, 4).filter(x => x.source !== 'first').length === 1, `${a1.status} ${a2.status}`);
// An 'update' to the same number is stored as Same (reason kept).
r = await A(13, { answer: 'update', priceOpinion: PRICE[13], reason: 'Checked again, still right' });
v = versions(100, 13);
check("an 'update' to the same number is stored as answer 'same' / source 'same', reason kept",
  r.status === 200 && r.json.answer === 'same' && askRow(13).answer === 'same' && v[v.length - 1].source === 'same' && v[v.length - 1].reason === 'Checked again, still right', JSON.stringify([r.json, v]));
// The votes' per-home daily budget is shared: 6 writes already today -> the answer is 429 and nothing is written.
for (let i = 0; i < 6; i++) run("INSERT INTO user_action_log (user_id, kind, ref) VALUES (10, 'price_vote', 'pre_listing:100')");
r = await A(10, { answer: 'same' });
check("it shares price_vote's 6-per-home daily budget (the 7th write is 429)", r.status === 429 && r.json.code === 'rate_limited' && askRow(10).answer === null, JSON.stringify(r.json));
// A cleared number: Same is refused, Update still works.
run('UPDATE pre_listing_price_opinions SET price_opinion = NULL WHERE pre_listing_id = 100 AND agent_user_id = 14');
r = await A(14, { answer: 'same' });
check("'same' with no current number: 'Share your number with Update.'", r.status === 400 && r.json.error === 'Share your number with Update.', JSON.stringify(r.json));

// ---------------- 6. Held emails are dropped when no longer wanted ----------------
const due = new Date(Date.now() - 60000).toISOString();
const holdFor = (agent, homeId) => run("INSERT INTO held_emails (user_id, kind, ref, subject, text_body, deliver_after) VALUES (?, 'opinion_refresh', ?, 'S', ?, ?)", agent, `pre_listing:${homeId}`, `held ${agent} ${homeId}`, due);
const ctx = { env, request: new Request('https://amicohaus.com/x'), waitUntil() {} };
const pendingAsk = (homeId, agent, owner = 1) => {
  run("UPDATE pre_listings SET opinions_refreshed_at = '2026-10-01 12:00:00' WHERE id = ?", homeId);
  run("INSERT INTO pre_listing_opinion_asks (pre_listing_id, agent_user_id, asked_at) VALUES (?, ?, '2026-10-01 12:00:00')", homeId, agent);
};
// Agent 14's own held row (from the round above) is still pending: it goes out.
run('UPDATE held_emails SET deliver_after = ? WHERE user_id = 14', due);
emails.length = 0;
let n = await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('a held ask still pending goes out', n === 1 && emails.length === 1 && emails[0].to === 'u14@example.test', `${n} ${JSON.stringify(emails)}`);
// Answered: agent 14 answers by Update, then a held row for it is dropped.
r = await A(14, { answer: 'update', priceOpinion: 870000, reason: 'Took another look' });
holdFor(14, 100);
n = await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('...dropped once the ask is answered', r.status === 200 && n === 0 && one("SELECT sent_at FROM held_emails WHERE text_body = 'held 14 100'").sent_at !== null, `${r.status} ${n}`);
home(106, 1); home(107, 1); home(108, 15); home(109, 1);
pendingAsk(106, 2); pendingAsk(107, 3); pendingAsk(108, 4, 15); pendingAsk(109, 4);
run("UPDATE pre_listings SET status = 'closed' WHERE id = 106");
holdFor(2, 106);
n = await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('...dropped once the home closes', n === 0);
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 3)');
holdFor(3, 107);
n = await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('...dropped once the owner blocks the agent', n === 0);
run('DELETE FROM user_blocks WHERE blocker_id = 1 AND blocked_id = 3');
run("UPDATE users SET status = 'suspended' WHERE id = 15");
holdFor(4, 108);
n = await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('...dropped once the owner is suspended', n === 0);
r = await A(4, { answer: 'same' }, { id: '108' });
check("answer: a suspended owner's home is a 404", r.status === 404, JSON.stringify(r.json));
run("UPDATE users SET status = 'active' WHERE id = 15");
holdFor(4, 109);
n = await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('...and a still-pending one on another home goes out (control)', n === 1);
// A newer round replaces the old ask: the old held email is dropped.
run("UPDATE pre_listings SET opinions_refreshed_at = '2026-10-02 12:00:00' WHERE id = 109");
holdFor(4, 109);
n = await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('...dropped once a newer round replaces the ask', n === 0);

// ---------------- 7. What the owner sees ----------------
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
let po = r.json.priceOpinions;
const byAgent = (a) => po.opinions.find(o => o.agentUserId === a);
check('owner detail: refresh status (too soon after a round, with the last round counts)',
  r.status === 200 && noStore(r) && po.refresh && po.refresh.canRequest === false && po.refresh.reason === 'too_soon' && po.refresh.lastRound
  && po.refresh.lastRound.askedAt === round1 && po.refresh.lastRound.asked === 6 && po.refresh.lastRound.answered === 5, JSON.stringify(po.refresh));
check("owner detail: each agent's own trail, oldest first", byAgent(3).trail.map(t => t.source).join() === 'first,update' && byAgent(3).trail[1].price === 831000
  && byAgent(3).trail[1].comp.address === '9 Elm St' && byAgent(2).trail.map(t => t.source).join() === 'first,same', JSON.stringify([byAgent(3).trail, byAgent(2).trail]));
check("owner detail: an agent with no versions shows the number on file (onFile)", byAgent(5).trail.length === 1 && byAgent(5).trail[0].onFile === true && byAgent(5).trail[0].price === PRICE[5], JSON.stringify(byAgent(5).trail));
check("owner detail: each agent's latest ask", byAgent(3).ask && byAgent(3).ask.answer === 'update' && byAgent(3).ask.current === true && byAgent(10).ask.answer === null && byAgent(5).ask === null, JSON.stringify([byAgent(3).ask, byAgent(10).ask]));
check("blocked and suspended agents' history is missing from the owner's view", !byAgent(11) && !byAgent(12) && !byAgent(6) && !r.text.includes(String(PRICE[11])) && !r.text.includes(String(PRICE[6])));
// Jury: no median, average or any cross-agent figure; trail keys fixed; arrival order.
check('summary keys are exactly count,low,high (no middle: Rudy 11.04)', Object.keys(po.summary).join() === 'count,low,high', JSON.stringify(po.summary));
const allKeys = new Set();
const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') for (const [k, val] of Object.entries(x)) { allKeys.add(k); walk(val); } };
walk(r.json);
const badKeys = [...allKeys].filter(k => /avg|average|mean|median|middle|trend|consensus|accuracy|score|rank/i.test(k));
check('no key anywhere in the owner response is an average, median, trend, consensus, accuracy, score or rank', badKeys.length === 0, badKeys.join());
check("every trail entry's keys are within price,source,reason,comp,at,onFile",
  po.opinions.every(o => o.trail.every(t => Object.keys(t).every(k => ['price', 'source', 'reason', 'comp', 'at', 'onFile'].includes(k)))));
const order = po.opinions.map(o => o.agentUserId);
check('the owner list is in arrival order (oldest first), not highest number first', order.slice(0, 4).join() === '4,2,10,3', order.join());
run('DELETE FROM user_blocks WHERE blocker_id = 1 AND blocked_id = 11');
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
po = r.json.priceOpinions;
check('after an unblock the agent and their history come back', !!byAgent(11) && byAgent(11).trail.length === 1 && byAgent(11).trail[0].price === PRICE[11]);
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 11)');

// Agent 3 (two versions now) sees only their own history.
r = await call(detail.onRequestGet, 'GET', '/x', 3, P);
check("agent detail: their own 2-version history, myRefreshAsk answered (not pending), no one else's numbers",
  r.json.myOpinionTrail.map(t => t.source).join() === 'first,update' && r.json.myRefreshAsk.pending === false && r.json.myRefreshAsk.answer === 'update'
  && !Object.entries(PRICE).some(([a, p]) => Number(a) !== 3 && r.text.includes(String(p))) && r.json.priceOpinions === null, JSON.stringify([r.json.myOpinionTrail, r.json.myRefreshAsk]));

// A new round once 90 days have passed since the last.
// (The last round's asks move back with it, as they would after a real 91 days.)
run("UPDATE pre_listing_opinion_asks SET asked_at = datetime(asked_at, '-91 days') WHERE pre_listing_id = 100");
run("UPDATE pre_listings SET opinions_refreshed_at = datetime(opinions_refreshed_at, '-91 days') WHERE id = 100");
run("UPDATE pre_listing_price_opinions SET updated_at = datetime('now', '-40 days') WHERE pre_listing_id = 100");
r = await call(refresh.onRequestPost, 'POST', '/x', 1, P, {});
check('with opinions_refreshed_at moved back 91 days: allowed again', r.status === 200 && r.json.asked >= 1, JSON.stringify(r.json));

// ---------------- 8. The helpers, directly ----------------
const st = await trail.opinionRefreshStatus(DB, one('SELECT * FROM pre_listings WHERE id = 101'));
check("opinionRefreshStatus: not_open on an awarded home", st.reason === 'not_open' && st.canRequest === false);
check('the label constant', trail.OPINION_LABEL === 'Agent price opinion, not an appraisal');

// ---------------- 9. Client copy ----------------
const clientJs = readFileSync(`${root}/opinion-refresh.js`, 'utf8');
check('opinion-refresh.js carries "Agent price opinion, not an appraisal"', clientJs.includes('Agent price opinion, not an appraisal'));
check('opinion-refresh.js never says worth, Value Trail or appraised', !/\bworth\b|value trail|appraised/i.test(clientJs));
check('opinion-refresh.js has no inline style or handler', !/\sstyle=|\son[a-z]+=/i.test(clientJs));
// Run the client functions in a tiny sandbox (client.js helpers stubbed) to check the HTML.
const sandbox = new Function('escapeHtml', 'money', 'sqlUtcToDate', 'PRICE_BASIS_NOTE', 'document', `${clientJs}; return { opinionRefreshBarHtml, opinionCardExtrasHtml, agentRefreshHtml };`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sql2date = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : null; };
const fns = sandbox(esc, (n) => '$' + (Number(n) || 0).toLocaleString('en-US'), sql2date, 'Base your price on the home and comparable sales only.', { addEventListener() {}, getElementById() { return null; } });
let html = fns.opinionRefreshBarHtml({ refresh: { canRequest: true, reason: null, availableAt: null, lastRound: { askedAt: '2026-11-04 18:00:00', asked: 3, answered: 1 } } }, 100);
check('refresh bar: the button and the last-round line', html.includes('data-or-action="refresh-opinions"') && html.includes('Asked 3 agents on Nov 4 · 1 answered so far.'), html);
html = fns.opinionRefreshBarHtml({ refresh: { canRequest: false, reason: 'too_soon', availableAt: '2027-02-02 20:00:00', lastRound: null } }, 100);
check('refresh bar: too soon shows the date', html === '<p class="tiny refresh-bar">You can ask for fresh opinions on Feb 2, 2027.</p>', html);
check("refresh bar: '' for not_open and no_opinions", fns.opinionRefreshBarHtml({ refresh: { reason: 'not_open' } }) === '' && fns.opinionRefreshBarHtml({ refresh: { reason: 'no_opinions' } }) === '' && fns.opinionRefreshBarHtml(null) === '');
html = fns.opinionCardExtrasHtml({ priceOpinion: 831000, ask: { askedAt: '2026-11-04 18:00:00', answer: 'update', answeredAt: '2026-11-06 18:00:00', current: true },
  trail: [{ price: 823456, source: 'first', reason: '', comp: null, at: '2026-07-01 18:00:00', onFile: true }, { price: 831000, source: 'update', reason: 'New sale', comp: { address: '9 Elm St', soldPrice: 840000, soldDate: '2026-10-02', sqft: 1850 }, at: '2026-11-06 18:00:00' }] });
check('owner card: label, ask status, history with a neutral spark, newest first, comp line',
  html.includes('<p class="opinion-label">Agent price opinion, not an appraisal</p>') && html.includes('Updated on Nov 6') && html.includes('Price opinion history (2)')
  && html.includes('class="trail-spark"') && html.indexOf('Updated') < html.indexOf('On file') && html.includes('New comparable sale: 9 Elm St sold for $840,000 on Oct 2, 2026 · 1,850 sq ft')
  && !/#[0-9a-f]{3,6}|green|red|%/i.test(html.match(/<svg[\s\S]*<\/svg>/)[0]), html);
html = fns.opinionCardExtrasHtml({ priceOpinion: null, ask: null, trail: [{ price: 823456, source: 'edit', reason: '', comp: null, at: '2026-07-01 18:00:00' }] });
check('owner card: a cleared number says so above its history', html.includes('This agent has no current price opinion. Their earlier numbers stay in your history.') && html.includes('Price opinion history (1)') && !html.includes('opinion-label'), html);
html = fns.agentRefreshHtml({ status: 'open' }, { pending: true }, [], { priceOpinion: 845678 });
check('agent panel: Same + Update and the number on file', html.includes('Fresh look requested') && html.includes('data-or-action="refresh-same"') && html.includes('$845,678') && html.includes('for="refreshReason"'), html);
html = fns.agentRefreshHtml({ status: 'open' }, { pending: true }, [], { priceOpinion: null });
check('agent panel: a cleared number has no Same button and no $0', !html.includes('refresh-same') && !html.includes('$0') && html.includes('You have no price opinion on file right now. Share your number with Update.'), html);
check('agent panel: nothing when the ask is not pending', fns.agentRefreshHtml({ status: 'open' }, { pending: false }, [], { priceOpinion: 1 }) === '');

// ---------------- 10. Export and cascades ----------------
batchSizes.length = 0;
r = await call(exportApi.onRequestGet, 'GET', '/x', 1, {});
let ex = JSON.parse(r.text);
// The owner tools batch adds ownerTools (45).
// The home facts batch adds openHouses (46).
check('owner export: no-store, and QUERIES is exactly 46 statements', noStore(r) && batchSizes.length === 1 && batchSizes[0] === 46, JSON.stringify(batchSizes));
const kinds = (rows) => [...new Set(rows.map(x => x.kind))].sort().join();
check('owner export: priceOpinionsReceived and priceOpinionHistoryOnMyHomes (versions and refresh asks)',
  ex.priceOpinionsReceived.some(x => x.pre_listing_id === 100 && x.agent_user_id === 3) && kinds(ex.priceOpinionHistoryOnMyHomes) === 'refresh_ask,version', JSON.stringify(Object.keys(ex)));
check("the export never carries a deck's storage key", !r.text.includes('SECRET-DECK-KEY'));
r = await call(exportApi.onRequestGet, 'GET', '/x', 3, {});
ex = JSON.parse(r.text);
const mineCount = one('SELECT (SELECT COUNT(*) FROM pre_listing_opinion_versions WHERE agent_user_id = 3) + (SELECT COUNT(*) FROM pre_listing_opinion_asks WHERE agent_user_id = 3) AS n').n;
check("agent export: priceOpinionHistoryMade has both kinds and only their own rows",
  kinds(ex.priceOpinionHistoryMade) === 'refresh_ask,version' && ex.priceOpinionHistoryMade.length === mineCount && !('agent_user_id' in ex.priceOpinionHistoryMade[0]), JSON.stringify(ex.priceOpinionHistoryMade.slice(0, 3)));
run('DELETE FROM users WHERE id = 3');
check("deleting the agent's account removes their versions and asks", one('SELECT COUNT(*) AS n FROM pre_listing_opinion_versions WHERE agent_user_id = 3').n === 0 && one('SELECT COUNT(*) AS n FROM pre_listing_opinion_asks WHERE agent_user_id = 3').n === 0);
run('DELETE FROM pre_listings WHERE id = 100');
check('deleting the pre-listing removes all of its versions and asks', one('SELECT COUNT(*) AS n FROM pre_listing_opinion_versions WHERE pre_listing_id = 100').n === 0 && one('SELECT COUNT(*) AS n FROM pre_listing_opinion_asks WHERE pre_listing_id = 100').n === 0);
check('notifyOpinionRefreshAsked / Answered are exported', typeof notifyLib.notifyOpinionRefreshAsked === 'function' && typeof notifyLib.notifyOpinionRefreshAnswered === 'function');

realLog(failed ? `\n${failed} FAILED, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failed ? 1 : 0);
