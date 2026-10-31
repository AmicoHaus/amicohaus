// Runs the real handlers for batch B1 (Decision Night, Pitch Reels, finalist feedback, the platform-operator label
// and the fairness fixes) against an in-memory SQLite stand-in for D1 and a Map stand-in for R2. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/decision-night-test.mjs <projectRoot>
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
      // Like D1's batch: a SELECT comes back with its rows.
      batchResult: async () => (/^s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : stmt.run()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const objects = new Map();
const PHOTOS = {
  put: async (key, body) => { const buf = body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array(body); objects.set(key, buf); },
  head: async (key) => (objects.has(key) ? { size: objects.get(key).length } : null),
  get: async (key, opts = {}) => {
    if (!objects.has(key)) return null;
    const all = objects.get(key);
    const r = opts.range;
    return { body: r ? all.slice(r.offset, r.offset + r.length) : all };
  },
  delete: async (key) => { objects.delete(key); },
};
const env = { DB, PHOTOS };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);

let failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };

// 1 owner, 2-5 approved agents (5 is the admin/platform operator), 6 suspended agent, 7 demo agent, 8 other homeowner.
for (const [id, agent, extra] of [[1, 0, {}], [2, 1, {}], [3, 1, {}], [4, 1, {}], [5, 1, { role: 'admin' }], [6, 1, { status: 'suspended' }], [7, 1, { demo: true }], [8, 0, {}]]) {
  sqlite.prepare('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(id, extra.demo ? `d${id}@demo.amicohaus.local` : `u${id}@example.test`, `User ${id}`, extra.role || 'user', extra.status || 'active');
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
  if (agent) sqlite.prepare("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, service_zips_json, notify_new_requests) VALUES (?, 'approved', ?, ?, '[\"91913\"]', 1)").run(id, `0100000${id}`, `Realty ${id}`);
}
for (const [zip, lat, lng] of [['91913', 32.62, -116.99]]) sqlite.prepare('INSERT OR IGNORE INTO zip_codes (zip, lat, lng) VALUES (?, ?, ?)').run(zip, lat, lng);
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price)
  VALUES (10, 1, 'Chula Vista', 'CA', '91913', 'Single Family Home', 4, 3, 900000)`).run();

const call = async (handler, method, path, who, params, body, headers = {}) => {
  const isRaw = body instanceof Uint8Array;
  const request = new Request(`https://amicohaus.com${path}`, {
    method, headers: { Cookie: `ah_session=t${who}`, ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: isRaw ? body : body ? JSON.stringify(body) : undefined,
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, bytes: type.includes('json') ? null : new Uint8Array(await res.arrayBuffer()) };
};
const P = { id: '10' };
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
const notes = (uid) => sqlite.prepare('SELECT body FROM notifications WHERE user_id = ? ORDER BY id').all(uid).map(r => r.body);
console.log = () => {};

const detail = await mod('functions/api/pre-listings/[id].js');
const dn = await mod('functions/api/pre-listings/[id]/decision-night.js');
const bidsApi = await mod('functions/api/pre-listings/[id]/bids/index.js');
const bidApi = await mod('functions/api/pre-listings/[id]/bids/[bidId].js');
const pitch = await mod('functions/api/pre-listings/[id]/pitch-video.js');
const debrief = await mod('functions/api/pre-listings/[id]/debrief.js');
const interviews = await mod('functions/api/pre-listings/[id]/interviews/index.js');
const lib = await mod('functions/_lib/decisionNight.js');
const bidBody = (n) => ({ message: `Plan ${n}`, commissionPct: 2 + n / 10, services: [] });

// --- Setting Decision Night ---
let r = await call(dn.onRequestPut, 'PUT', '/x', 1, P, { dueAt: future(2) });
check('a Decision Night less than 12 hours out is refused', r.status === 400 && /12 hours/.test(r.json.error), JSON.stringify(r.json));
r = await call(dn.onRequestPut, 'PUT', '/x', 1, P, { dueAt: future(24 * 30) });
check('more than 3 weeks out is refused', r.status === 400);
r = await call(dn.onRequestPut, 'PUT', '/x', 2, P, { dueAt: future(48) });
check('only the owner can set it', r.status === 403);
r = await call(dn.onRequestPut, 'PUT', '/x', 1, P, { dueAt: future(48) });
check('the owner sets Decision Night 2 days out', r.status === 200 && !!r.json.dueAt);
r = await call(dn.onRequestPut, 'PUT', '/x', 1, P, { dueAt: future(30) });
check('it can only move later, never earlier', r.status === 400 && /only move later/.test(r.json.error));
r = await call(dn.onRequestPut, 'PUT', '/x', 1, P, { dueAt: future(72) });
check('moving it later works', r.status === 200);
sqlite.prepare('UPDATE pre_listings SET proposals_due_at = ? WHERE id = 10').run(future(3));
r = await call(dn.onRequestPut, 'PUT', '/x', 1, P, { dueAt: future(6) });
check('a sealed Decision Night can move a little later, even inside 12 hours', r.status === 200, JSON.stringify(r.json));

// --- Sealed proposals ---
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 10, 3, 1)").run();
for (const a of [2, 3, 4, 5]) await call(bidsApi.onRequestPost, 'POST', '/x', a, P, bidBody(a));
await call(bidsApi.onRequestPost, 'POST', '/x', 2, P, { ...bidBody(2), message: 'Plan 2, improved' });
check('the owner is told a proposal came in, without whose', notes(1).filter(b => /new proposal came in/.test(b)).length === 4 && !notes(1).some(b => /User \d submitted/.test(b)), JSON.stringify(notes(1)));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
const invitesApi = await mod('functions/api/pre-listings/[id]/invites.js');
r = await call(invitesApi.onRequestGet, 'GET', '/x', 1, P);
check("while sealed an invited agent who answered still shows as pending (no hint who sent one)", r.json.invites.length === 1 && r.json.invites[0].status === 'pending', JSON.stringify(r.json.invites));
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 2, format: 'video', slots: [future(30)] });
const r2 = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 8, format: 'bogus' });
check('no interviews while sealed, and the answer is the same for agents who did or did not bid', r.status === 400 && /Decision Night/.test(r.json.error) && r2.json.error === r.json.error, JSON.stringify([r.json, r2.json]));
check('editing a sealed proposal sends no second "new proposal" message', notes(1).filter(b => /new proposal came in/.test(b)).length === 4);
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
check('while sealed the owner sees how many, not the proposals', r.json.bids.length === 0 && r.json.preListing.decisionNight.sealed === true && r.json.preListing.decisionNight.sealedCount === 4, JSON.stringify(r.json.preListing.decisionNight));
r = await call(detail.onRequestGet, 'GET', '/x', 3, P);
check('agents see the Decision Night time (but never a count)', r.json.preListing.decisionNight && r.json.preListing.decisionNight.sealed && r.json.preListing.decisionNight.sealedCount === undefined);
const bid2 = sqlite.prepare("SELECT id FROM service_bids WHERE agent_user_id = 2").get().id;
r = await call(bidApi.onRequestPut, 'PUT', '/x', 1, { id: '10', bidId: String(bid2) }, { action: 'accept' });
check('nothing can be accepted while sealed', r.status === 400 && /Decision Night/.test(r.json.error));
r = await call(bidApi.onRequestPut, 'PUT', '/x', 1, { id: '10', bidId: String(bid2) }, { action: 'shortlist' });
check('or shortlisted', r.status === 400);

// --- Pitch reels while sealed ---
const clip = new Uint8Array(4096).fill(7);
r = await call(pitch.onRequestPut, 'PUT', '/x', 8, P, clip, { 'Content-Type': 'video/mp4', 'Content-Length': String(clip.length) });
check('a non-agent cannot add a pitch reel', r.status === 403);
r = await call(pitch.onRequestPut, 'PUT', '/x', 2, P, clip, { 'Content-Type': 'video/mp4', 'Content-Length': String(clip.length) });
check('an agent with a proposal adds a pitch reel', r.status === 200 && /^[0-9a-f-]{8}$/.test(r.json.pitchVersion), JSON.stringify(r.json));
r = await call(pitch.onRequestPut, 'PUT', '/x', 3, P, clip, { 'Content-Type': 'image/png', 'Content-Length': String(clip.length) });
check('only video files are accepted', r.status === 400);
r = await call(pitch.onRequestGet, 'GET', '/x?agent=2', 1, P);
const noReel = await call(pitch.onRequestGet, 'GET', '/x?agent=3', 1, P);
check('the owner cannot watch it before Decision Night, and gets the same answer whether or not a reel exists', r.status === 403 && noReel.status === 403 && r.json.error === noReel.json.error);
r = await call(pitch.onRequestGet, 'GET', '/x', 2, P);
check('the agent can watch their own', r.status === 200 && r.bytes.length === clip.length);
r = await call(pitch.onRequestGet, 'GET', '/x?agent=2', 3, P);
check('another agent never can', r.status === 403);
r = await call(detail.onRequestGet, 'GET', '/x', 2, P);
check("the agent's own proposal shows the reel", r.json.myBid.hasPitchVideo === true);

// --- Opening early, and lazily telling the owner when it's due ---
// The proposals came in before the (now past) Decision Night.
sqlite.prepare("UPDATE service_bids SET created_at = datetime('now', '-10 minutes'), submitted_at = datetime('now', '-10 minutes')").run();
sqlite.prepare("UPDATE pre_listings SET proposals_due_at = ? WHERE id = 10").run(new Date(Date.now() - 60000).toISOString());
const told = await lib.runDueDecisionNights({ env, request: new Request('https://amicohaus.com/x'), waitUntil() {} });
check('when Decision Night arrives the owner is told once', told === 1 && notes(1).some(b => /Decision Night: your 4 proposals are open/.test(b)), JSON.stringify(notes(1).slice(-1)));
check('...and only once', await lib.runDueDecisionNights({ env, request: new Request('https://amicohaus.com/x'), waitUntil() {} }) === 0);
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
r = await call(dn.onRequestPut, 'PUT', '/x', 1, P, { dueAt: future(48) });
check('once it has happened, proposals cannot be sealed again', r.status === 400 && /already happened/.test(r.json.error), JSON.stringify(r.json));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
check('after Decision Night the owner sees every proposal', r.json.bids.length === 4 && r.json.preListing.decisionNight.sealed === false);
const op = r.json.bids.find(b => b.agentUserId === 5);
check("the admin account's proposal is labeled as the platform operator", op.isPlatformOperator === true && r.json.bids.filter(b => b.isPlatformOperator).length === 1);
check('proposals carry the DRE number for the reel caption', r.json.bids.find(b => b.agentUserId === 2).licenseNumber === '01000002');
r = await call(pitch.onRequestGet, 'GET', '/x?agent=2', 1, P, null, { Range: 'bytes=0-99' });
check('now the owner can watch the reel (with seeking)', r.status === 206 && r.bytes.length === 100);

// A late proposal is marked
sqlite.prepare("UPDATE service_bids SET submitted_at = datetime('now', '+1 minute') WHERE agent_user_id = 4").run();
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
check('a proposal sent after Decision Night is marked', r.json.bids.find(b => b.agentUserId === 4).afterDecisionNight === true && r.json.bids.find(b => b.agentUserId === 2).afterDecisionNight === false);

// --- Shortlist / pass ---
r = await call(bidApi.onRequestPut, 'PUT', '/x', 1, { id: '10', bidId: String(bid2) }, { action: 'shortlist' });
check('the owner shortlists from the reels', r.status === 200 && r.json.ownerPick === 'shortlist');
const bid3 = sqlite.prepare("SELECT id FROM service_bids WHERE agent_user_id = 3").get().id;
r = await call(bidApi.onRequestPut, 'PUT', '/x', 1, { id: '10', bidId: String(bid3) }, { action: 'pass' });
check('...and passes', r.status === 200 && r.json.ownerPick === 'pass');
r = await call(bidApi.onRequestPut, 'PUT', '/x', 2, { id: '10', bidId: String(bid2) }, { action: 'shortlist' });
check('an agent cannot shortlist themselves', r.status === 403);
r = await call(detail.onRequestGet, 'GET', '/x', 2, P);
check("agents never see the owner's picks", JSON.stringify(r.json).indexOf('ownerPick') === -1);

// --- Finalists, hiring, finalist feedback ---
sqlite.prepare("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status, slots_json) VALUES (10, 4, 'done', '[]')").run();
const pastSlot = new Date(Date.now() - 3600000).toISOString();
sqlite.prepare("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status, slots_json, chosen_slot) VALUES (10, 3, 'scheduled', ?, ?)").run(JSON.stringify([pastSlot]), pastSlot);
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status, owner_pick) VALUES ('pre_listing', 10, 6, 'x', 2, 'pending', 'shortlist')").run();
const marketplace = await mod('functions/_lib/marketplace.js');
check("a shortlist doesn't show in the agent's stats while the homeowner is still deciding", (await marketplace.fetchAgentStats(DB, 2)).finalistCount === 0);
const bid5 = sqlite.prepare("SELECT id FROM service_bids WHERE agent_user_id = 5").get().id;
r = await call(debrief.onRequestPost, 'POST', '/x', 1, P, { reasons: ['marketing'] });
check('feedback waits until someone is hired', r.status === 400);
r = await call(bidApi.onRequestPut, 'PUT', '/x', 1, { id: '10', bidId: String(bid5) }, { action: 'accept' });
check('the owner hires an agent', r.status === 200);
check('...and once decided the shortlist counts as a finalist home', (await marketplace.fetchAgentStats(DB, 2)).finalistCount === 1);
check('an interview whose time already came is kept as done, not canceled', sqlite.prepare('SELECT status FROM pre_listing_interviews WHERE pre_listing_id = 10 AND agent_user_id = 3').get().status === 'done');
check('every other agent is told it was decided', [2, 3, 4].every(a => notes(a).some(b => /chose another agent this time/.test(b))));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
check('the finalists are the shortlisted and interviewed agents (not the hired one, not a suspended one)', r.json.preListing.debrief.finalists.map(f => f.agentUserId).join() === '2,3,4' && r.json.preListing.debrief.sent === false, JSON.stringify(r.json.preListing.debrief));
r = await call(debrief.onRequestPost, 'POST', '/x', 1, P, { reasons: ['marketing', 'local', 'fit', 'timing'] });
check('at most 3 reasons', r.status === 400);
r = await call(debrief.onRequestPost, 'POST', '/x', 1, P, { reasons: ['fees_terms', 'not-a-reason'] });
check('only preset reasons are kept', r.status === 200 && JSON.parse(sqlite.prepare('SELECT reasons_json FROM finalist_debriefs WHERE agent_user_id = 2').get().reasons_json).join() === 'fees_terms');
check('each finalist gets the reasons, with no fee or winner named', [2, 3, 4].every(a => notes(a).some(b => /What tipped their decision: Fees or terms\./.test(b) && !/User 5|\d%|\$/.test(b))) && !notes(6).some(b => /tipped/.test(b)));
r = await call(debrief.onRequestPost, 'POST', '/x', 1, P, { reasons: ['marketing'] });
check('feedback goes out once', r.status === 200 && r.json.sent === 0);
r = await call(debrief.onRequestPost, 'POST', '/x', 2, P, { reasons: ['marketing'] });
check('only the owner can send it', r.status === 403);
const myBids = await (await mod('functions/_lib/marketplace.js')).fetchAgentOwnBids(DB, 2);
check("the finalist sees the feedback on their proposal list", myBids[0].finalistFeedback.join() === 'Fees or terms');

// --- Fair Play: no staff peek at sealed vote tallies ---
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price) VALUES (11, 8, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 500000)`).run();
sqlite.prepare("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (11, 2, 'too_high')").run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 11, 3, 'x', 2, 'pending')").run();
r = await call(dn.onRequestPut, 'PUT', '/x', 8, { id: '11' }, { dueAt: future(48) });
check('a Decision Night cannot be set after proposals are already open to the owner', r.status === 400 && /before the first proposal/.test(r.json.error), JSON.stringify(r.json));
r = await call(detail.onRequestGet, 'GET', '/x', 5, { id: '11' });
check('an admin account that competes as an agent sees a sealed tally until it votes', r.json.preListing.votes.sealed === true, JSON.stringify(r.json.preListing.votes));

// --- New-request alerts: active real agents only, never the poster ---
const notify = await mod('functions/_lib/marketplaceNotify.js');
sqlite.prepare('DELETE FROM notifications').run();
const ctx = { env, request: new Request('https://amicohaus.com/x'), waitUntil() {} };
await notify.notifyAgentsNewRequest(ctx, 'pre_listing', 11, '91913', [3]);
const pinged = sqlite.prepare("SELECT DISTINCT user_id FROM notifications WHERE body LIKE 'A new pre-listing%' ORDER BY user_id").all().map(x => x.user_id);
check('new pre-listing alerts skip suspended and demo agents and the poster', pinged.join() === '2,4,5', JSON.stringify(pinged));

// --- Cleanup: deleting the pre-listing removes pitch reels from storage ---
const keysBefore = [...objects.keys()].filter(k => k.startsWith('pre-listing-pitch/10/')).length;
sqlite.prepare("UPDATE pre_listings SET status = 'closed' WHERE id = 10").run();
r = await call(detail.onRequestDelete, 'DELETE', '/x', 1, P);
check('deleting a pre-listing deletes its pitch reels', keysBefore === 1 && r.status === 200 && ![...objects.keys()].some(k => k.startsWith('pre-listing-pitch/10/')), `before=${keysBefore} status=${r.status}`);

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
