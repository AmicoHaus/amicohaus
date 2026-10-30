// Runs the real handlers for the seller prep tools (prep picks, listing-ready checklist, video walkthrough, broker
// previews, interviews) against an in-memory SQLite stand-in for D1 and a Map stand-in for R2. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/seller-prep-test.mjs <projectRoot>
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
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
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

// 1 owner, 2-5 approved agents, 6 plain homeowner, 7 other owner.
for (const [id, agent] of [[1, 0], [2, 1], [3, 1], [4, 1], [5, 1], [6, 0], [7, 0]]) {
  sqlite.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)').run(id, `u${id}@example.test`, `User ${id}`);
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
  if (agent) sqlite.prepare("INSERT INTO agent_profiles (user_id, status) VALUES (?, 'approved')").run(id);
}
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address)
  VALUES (10, 1, 'Chula Vista', 'CA', '91913', 'Single Family Home', 4, 3, 900000, '123 Secret St')`).run();
for (const a of [2, 3, 4, 5]) sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, commission_pct, status) VALUES ('pre_listing', 10, ?, 2.5, 'pending')").run(a);

const call = async (handler, method, path, who, params, body, headers = {}) => {
  const isRaw = body instanceof Uint8Array;
  const request = new Request(`https://amicohaus.com${path}`, {
    method, headers: { Cookie: `ah_session=t${who}`, ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: isRaw ? body : body ? JSON.stringify(body) : undefined,
  });
  // Like Cloudflare: a background task that fails is only logged, never fatal to the request.
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) p.catch(() => {}); } });
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, bytes: type.includes('json') ? null : new Uint8Array(await res.arrayBuffer()) };
};
const P = { id: '10' };
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
console.log = () => {};

// --- Prep picks ride along with the sealed opinion ---
const votes = await mod('functions/api/pre-listings/[id]/votes/index.js');
const detail = await mod('functions/api/pre-listings/[id].js');
await call(votes.onRequestPost, 'POST', '/x', 2, P, { vote: 'just_right', priceOpinion: 900000, comps: [], prep: ['paint_inside', 'staging', 'bogus'] });
await call(votes.onRequestPost, 'POST', '/x', 3, P, { vote: 'too_high', priceOpinion: 870000, comps: [], prep: ['paint_inside', 'curb_appeal'] });
let r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
const ps = r.json.priceOpinions.prepSummary;
check('the owner sees the combined fix-before-list, most-agreed first', ps[0].key === 'paint_inside' && ps[0].count === 2 && ps.length === 3 && !ps.some(p => p.key === 'bogus'), JSON.stringify(ps));
r = await call(detail.onRequestGet, 'GET', '/x', 3, P);
check("an agent sees only their own prep picks", r.json.myVote.prep.join() === 'paint_inside,curb_appeal' && r.json.priceOpinions === null);

// --- Listing-ready checklist ---
const ready = await mod('functions/api/pre-listings/[id]/listing-ready.js');
const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
r = await call(ready.onRequestPut, 'PUT', '/x', 1, P, { checked: ['payoff', 'keys', 'nope'], targetListDate: soon });
check('the owner saves the listing-ready checklist and target date', r.status === 200 && r.json.checked.join() === 'payoff,keys' && r.json.targetListDate === soon, JSON.stringify(r.json));
r = await call(ready.onRequestPut, 'PUT', '/x', 1, P, { checked: [], targetListDate: '2020-01-01' });
check('a past target date is refused', r.status === 400);
r = await call(ready.onRequestPut, 'PUT', '/x', 2, P, { checked: ['keys'] });
check("an agent can't change the owner's checklist", r.status === 403);
r = await call(detail.onRequestGet, 'GET', '/x', 2, P);
check('agents never see the checklist or target date', r.json.preListing.listingReady === undefined && r.json.preListing.targetListDate === undefined);

// --- Video walkthrough ---
const video = await mod('functions/api/pre-listings/[id]/video.js');
const clip = new Uint8Array(1000).map((_, i) => i % 256);
r = await call(video.onRequestPut, 'PUT', '/x', 1, P, clip, { 'Content-Type': 'video/mp4', 'Content-Length': '1000' });
check('the owner uploads a video', r.status === 200, JSON.stringify(r.json));
const uploadedVersion = r.json.videoVersion;
r = await call(video.onRequestPut, 'PUT', '/x', 1, P, clip, { 'Content-Type': 'text/html', 'Content-Length': '1000' });
check('a non-video type is refused', r.status === 400);
r = await call(video.onRequestPut, 'PUT', '/x', 1, P, clip, { 'Content-Type': 'video/mp4', 'Content-Length': String(96 * 1024 * 1024) });
check('a video over 95MB (Cloudflare refuses bodies over 100MB) is refused before upload', r.status === 400);
r = await call(detail.onRequestGet, 'GET', '/x', 1, P);
check('the detail carries the same video version the upload returned (for cache-busting)', uploadedVersion && r.json.preListing.videoVersion === uploadedVersion, `${uploadedVersion} / ${r.json.preListing.videoVersion}`);
r = await call(video.onRequestPut, 'PUT', '/x', 1, P, clip, { 'Content-Type': 'video/mp4', 'Content-Length': String(94 * 1024 * 1024) });
check('a video declared at 94MB is accepted', r.status === 200, JSON.stringify(r.json));
r = await call(video.onRequestPut, 'PUT', '/x', 2, P, clip, { 'Content-Type': 'video/mp4', 'Content-Length': '1000' });
check("an agent can't upload a video to someone else's pre-listing", r.status === 403);
r = await call(video.onRequestGet, 'GET', '/x', 2, P, null, { Range: 'bytes=100-199' });
check('an approved agent can watch it, with seeking (range requests)', r.status === 206 && r.bytes.length === 100 && r.bytes[0] === 100 && r.headers.get('Content-Range') === 'bytes 100-199/1000', `${r.status} ${r.headers.get('Content-Range')}`);
r = await call(video.onRequestGet, 'GET', '/x', 6, P);
check('a plain homeowner browsing cannot watch it', r.status === 403);
r = await call(detail.onRequestGet, 'GET', '/x', 2, P);
check('the detail says there is a video', r.json.preListing.hasVideo === true);
const firstVideoKey = sqlite.prepare('SELECT video_r2_key FROM pre_listings WHERE id = 10').get().video_r2_key;
await call(video.onRequestPut, 'PUT', '/x', 1, P, clip, { 'Content-Type': 'video/quicktime', 'Content-Length': '1000' });
check('replacing the video removes the old file', !objects.has(firstVideoKey));

// --- Broker previews ---
const previews = await mod('functions/api/pre-listings/[id]/previews/index.js');
const preview = await mod('functions/api/pre-listings/[id]/previews/[previewId].js');
r = await call(previews.onRequestPost, 'POST', '/x', 1, P, { startsAt: future(48), endsAt: future(50), note: 'Park on the street' });
check('the owner opens a preview window', r.status === 201, JSON.stringify(r.json));
const previewId = String(r.json.id);
await new Promise(res => setTimeout(res, 20));
const noticeCount = (uid) => sqlite.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(uid).n;
check('agents who engaged hear about it; uninvolved people do not', noticeCount(2) >= 1 && noticeCount(6) === 0, `${noticeCount(2)} / ${noticeCount(6)}`);
r = await call(previews.onRequestPost, 'POST', '/x', 1, P, { startsAt: future(48), endsAt: future(57) });
check('a window longer than 6 hours is refused', r.status === 400);
r = await call(previews.onRequestPost, 'POST', '/x', 1, P, { startsAt: future(-2), endsAt: future(1) });
check('a window in the past is refused', r.status === 400);
r = await call(previews.onRequestPost, 'POST', '/x', 2, P, { startsAt: future(48), endsAt: future(50) });
check("an agent can't open a window on someone else's pre-listing", r.status === 403);
r = await call(previews.onRequestGet, 'GET', '/x', 3, P);
check('before RSVPing, an agent sees the window but not the address', r.json.previews.length === 1 && r.json.address === undefined && r.json.previews[0].agents === undefined, JSON.stringify(r.json));
r = await call(preview.onRequestPut, 'PUT', '/x', 3, { id: '10', previewId }, { going: true });
check('an agent RSVPs', r.status === 200 && r.json.going === true);
r = await call(previews.onRequestGet, 'GET', '/x', 3, P);
check('...and then gets the street address', r.json.address === '123 Secret St' && r.json.previews[0].imGoing === true);
r = await call(previews.onRequestGet, 'GET', '/x', 4, P);
check("another agent still doesn't get the address", r.json.address === undefined && r.json.previews[0].rsvpCount === 1);
r = await call(previews.onRequestGet, 'GET', '/x', 1, P);
check('the owner sees who is coming', r.json.previews[0].agents.map(a => a.agentUserId).join() === '3');
r = await call(previews.onRequestGet, 'GET', '/x', 6, P);
check('a plain homeowner cannot see previews', r.status === 403);
r = await call(preview.onRequestPut, 'PUT', '/x', 1, { id: '10', previewId }, { going: true });
check("the owner can't RSVP to their own preview", r.status === 403);
const before3 = noticeCount(3);
r = await call(preview.onRequestDelete, 'DELETE', '/x', 1, { id: '10', previewId });
await new Promise(res => setTimeout(res, 20));
check('the owner cancels it and the agent who RSVP\'d is told', r.status === 200 && noticeCount(3) === before3 + 1);

// --- Interviews ---
const interviews = await mod('functions/api/pre-listings/[id]/interviews/index.js');
const interview = await mod('functions/api/pre-listings/[id]/interviews/[agentId].js');
const slots = [future(24), future(30)];
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 2, format: 'video', slots });
check('the owner asks an agent who sent a proposal for an interview', r.status === 201, JSON.stringify(r.json));
sqlite.prepare("INSERT INTO users (id, email, display_name) VALUES (8, 'u8@example.test', 'No Proposal')").run();
sqlite.prepare("INSERT INTO agent_profiles (user_id, status) VALUES (8, 'approved')").run();
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 8, format: 'video', slots });
check('an agent who never sent a proposal cannot be asked', r.status === 400);
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 3, format: 'video', slots: [future(-1)] });
check('a past time is refused', r.status === 400);
await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 3, format: 'phone', slots });
await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 4, format: 'in_person', slots });
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 5, format: 'video', slots });
check('no more than 3 interviews at once', r.status === 400 && /up to 3/.test(r.json.error), JSON.stringify(r.json));
r = await call(interview.onRequestPut, 'PUT', '/x', 2, { id: '10', agentId: '2' }, { chosenSlot: future(99) });
check('an agent can only pick one of the offered times', r.status === 400);
r = await call(interview.onRequestPut, 'PUT', '/x', 2, { id: '10', agentId: '2' }, { chosenSlot: slots[1] });
check('the agent picks an offered time', r.status === 200 && r.json.status === 'scheduled');
r = await call(interview.onRequestPut, 'PUT', '/x', 3, { id: '10', agentId: '2' }, { chosenSlot: slots[0] });
check("an agent can't change someone else's interview", r.status === 403);
r = await call(interview.onRequestPut, 'PUT', '/x', 1, { id: '10', agentId: '2' }, { scores: { pricing: 5, fit: 4, bogus: 3, terms: 9 }, ownerNotes: 'Sharp on comps', done: true });
check('the owner saves a scorecard (bad values dropped) and marks it done', r.status === 200 && r.json.status === 'done' && JSON.stringify(r.json.scores) === '{"pricing":5,"fit":4}', JSON.stringify(r.json));
r = await call(interviews.onRequestGet, 'GET', '/x', 2, P);
check("the agent sees their own interview but never the owner's scorecard or notes", r.json.interviews.length === 1 && r.json.interviews[0].scores === undefined && r.json.interviews[0].ownerNotes === undefined);
r = await call(interviews.onRequestGet, 'GET', '/x', 1, P);
check('the owner sees all interviews with their scorecards', r.json.interviews.length === 3 && r.json.interviews.find(i => i.agentUserId === 2).scores.pricing === 5);
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 5, format: 'video', slots });
check('once one is done, a new one can be requested', r.status === 201);
r = await call(interview.onRequestPut, 'PUT', '/x', 1, { id: '10', agentId: '5' }, { action: 'cancel' });
check('the owner cancels a request', r.status === 200 && r.json.status === 'canceled');

// --- Review fixes ---
// An unchanged date that has since passed still lets the checklist save.
sqlite.prepare("UPDATE pre_listings SET target_list_date = '2026-01-01' WHERE id = 10").run();
r = await call(ready.onRequestPut, 'PUT', '/x', 1, P, { checked: ['keys', 'photos'], targetListDate: '2026-01-01' });
check('after listing day, ticking items still saves (the unchanged date is not re-checked)', r.status === 200 && r.json.checked.join() === 'keys,photos', JSON.stringify(r.json));
r = await call(ready.onRequestPut, 'PUT', '/x', 1, P, { checked: [], targetListDate: '2025-06-01' });
check('...but a newly picked past date is still refused', r.status === 400);

// Expired requests don't count toward the 3-interview cap, and can be re-offered.
sqlite.prepare("UPDATE pre_listing_interviews SET status = 'requested', slots_json = ? WHERE pre_listing_id = 10 AND agent_user_id = 3").run(JSON.stringify([new Date(Date.now() - 3600000).toISOString()]));
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 5, format: 'video', slots });
check('a request whose times have all passed no longer blocks a new one', r.status === 201, JSON.stringify(r.json));
r = await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 3, format: 'phone', slots: [future(26)] });
check('...and the owner can offer that agent new times', r.status === 201, JSON.stringify(r.json));
const agentNotices = (uid) => sqlite.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(uid).n;
const n3 = agentNotices(3);
await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 3, format: 'phone', slots: [future(26)].map(s => s) });
await new Promise(res => setTimeout(res, 20));
r = await call(interviews.onRequestGet, 'GET', '/x', 1, P);
const sameSlots = r.json.interviews.find(i => i.agentUserId === 3).slots;
await call(interviews.onRequestPost, 'POST', '/x', 1, P, { agentUserId: 3, format: 'phone', slots: sameSlots });
await new Promise(res => setTimeout(res, 20));
check('sending the exact same request again does not notify the agent again', agentNotices(3) === n3 + 1, `${n3} -> ${agentNotices(3)}`);
await call(interview.onRequestPut, 'PUT', '/x', 3, { id: '10', agentId: '3' }, { chosenSlot: sameSlots[0] });
await new Promise(res => setTimeout(res, 20));
const ownerAfterPick = agentNotices(1);
await call(interview.onRequestPut, 'PUT', '/x', 3, { id: '10', agentId: '3' }, { chosenSlot: sameSlots[0] });
await new Promise(res => setTimeout(res, 20));
check('picking the same time twice notifies the owner once', agentNotices(1) === ownerAfterPick);

// RSVPs notify the owner; preview notices skip agents who withdrew.
r = await call(previews.onRequestPost, 'POST', '/x', 1, P, { startsAt: future(72), endsAt: future(73) });
const pv2 = String(r.json.id);
const ownerBefore = agentNotices(1);
await call(preview.onRequestPut, 'PUT', '/x', 4, { id: '10', previewId: pv2 }, { going: true });
await new Promise(res => setTimeout(res, 20));
check('the owner is told when an agent RSVPs (and so can see the address)', agentNotices(1) === ownerBefore + 1);
sqlite.prepare("UPDATE service_bids SET status = 'withdrawn' WHERE request_id = 10 AND agent_user_id = 5").run();
sqlite.prepare('DELETE FROM pre_listing_price_votes WHERE pre_listing_id = 10 AND agent_user_id = 5').run();
const n5 = agentNotices(5);
await call(previews.onRequestPost, 'POST', '/x', 1, P, { startsAt: future(80), endsAt: future(81) });
await new Promise(res => setTimeout(res, 20));
check('an agent who withdrew their proposal is not told about new preview windows', agentNotices(5) === n5, `${n5} -> ${agentNotices(5)}`);

// Hiring an agent wraps up: previews come down, other interviews are canceled (agents told), the hire's is kept.
const bidOf = (a) => sqlite.prepare("SELECT id FROM service_bids WHERE request_id = 10 AND agent_user_id = ?").get(a).id;
const bids = await mod('functions/api/pre-listings/[id]/bids/[bidId].js');
const n4 = agentNotices(4);
r = await call(bids.onRequestPut, 'PUT', '/x', 1, { id: '10', bidId: String(bidOf(3)) }, { action: 'accept' });
await new Promise(res => setTimeout(res, 20));
check('hiring an agent works', r.status === 200, JSON.stringify(r.json));
const statusOf = (a) => sqlite.prepare('SELECT status FROM pre_listing_interviews WHERE pre_listing_id = 10 AND agent_user_id = ?').get(a)?.status;
check("...other agents' open interviews are canceled; the hired agent's is kept", statusOf(5) === 'canceled' && statusOf(3) === 'scheduled', `${statusOf(5)} / ${statusOf(3)}`);
check('...upcoming previews come down and agents who RSVP\'d are told', sqlite.prepare('SELECT COUNT(*) AS n FROM pre_listing_previews WHERE pre_listing_id = 10').get().n === 0 && agentNotices(4) > n4);
r = await call(previews.onRequestGet, 'GET', '/x', 4, P);
check('...and agents no longer get previews or the address', r.json.previews.length === 0 && r.json.address === undefined);
r = await call(interview.onRequestPut, 'PUT', '/x', 3, { id: '10', agentId: '3' }, { chosenSlot: sameSlots[0] });
check('...and nobody can pick interview times on a pre-listing that is no longer open', r.status === 400, String(r.status));

// --- Closing, and a failing notification during a hire ---
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address)
  VALUES (11, 1, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, '9 Quiet Ct')`).run();
for (const a of [2, 3, 4]) sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, commission_pct, status) VALUES ('pre_listing', 11, ?, 2.5, 'pending')").run(a);
const P11 = { id: '11' };
r = await call(previews.onRequestPost, 'POST', '/x', 1, P11, { startsAt: future(40), endsAt: future(41) });
const pv11 = String(r.json.id);
await call(preview.onRequestPut, 'PUT', '/x', 2, { id: '11', previewId: pv11 }, { going: true });
await call(interviews.onRequestPost, 'POST', '/x', 1, P11, { agentUserId: 2, format: 'video', slots: [future(30)] });
await call(interviews.onRequestPost, 'POST', '/x', 1, P11, { agentUserId: 4, format: 'phone', slots: [future(31)] });
// Even with every notification failing, hiring still succeeds and the wrap-up still happens.
const realPrepare = DB.prepare;
DB.prepare = (sql) => (/INSERT INTO notifications/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('notifications down'); }, first: async () => null, all: async () => ({ results: [] }) }) } : realPrepare(sql));
const bid11 = sqlite.prepare("SELECT id FROM service_bids WHERE request_id = 11 AND agent_user_id = 2").get().id;
r = await call(bids.onRequestPut, 'PUT', '/x', 1, { id: '11', bidId: String(bid11) }, { action: 'accept' });
await new Promise(res => setTimeout(res, 30));
DB.prepare = realPrepare;
const st11 = (a) => sqlite.prepare('SELECT status FROM pre_listing_interviews WHERE pre_listing_id = 11 AND agent_user_id = ?').get(a).status;
check('a notification failure never turns a hire into an error', r.status === 200, JSON.stringify(r.json));
check("...the hired agent's interview that never got a time is canceled too (it could no longer be picked)", st11(2) === 'canceled' && st11(4) === 'canceled', `${st11(2)} / ${st11(4)}`);
check('...and the previews came down anyway', sqlite.prepare('SELECT COUNT(*) AS n FROM pre_listing_previews WHERE pre_listing_id = 11').get().n === 0);

sqlite.prepare(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address)
  VALUES (12, 1, 'Bonita', 'CA', '91902', 'Condo', 2, 2, 650000, '1 Elm')`).run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, commission_pct, status) VALUES ('pre_listing', 12, 4, 2.5, 'pending')").run();
const P12 = { id: '12' };
r = await call(previews.onRequestPost, 'POST', '/x', 1, P12, { startsAt: future(40), endsAt: future(41) });
await call(preview.onRequestPut, 'PUT', '/x', 4, { id: '12', previewId: String(r.json.id) }, { going: true });
await call(interviews.onRequestPost, 'POST', '/x', 1, P12, { agentUserId: 4, format: 'phone', slots: [future(31)] });
const n4close = agentNotices(4);
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P12, { action: 'close' });
await new Promise(res => setTimeout(res, 30));
check('closing a pre-listing cancels its interviews and previews, and tells the agent (twice: preview + interview)', r.status === 200 && sqlite.prepare("SELECT status FROM pre_listing_interviews WHERE pre_listing_id = 12").get().status === 'canceled' && agentNotices(4) === n4close + 2, `${n4close} -> ${agentNotices(4)}`);
// A preview row left on a closed pre-listing (e.g. created before this change) still isn't shown to agents.
sqlite.prepare('INSERT INTO pre_listing_previews (pre_listing_id, starts_at, ends_at) VALUES (12, ?, ?)').run(future(50), future(51));
const leftover = sqlite.prepare('SELECT MAX(id) AS id FROM pre_listing_previews').get().id;
sqlite.prepare('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (?, 4)').run(leftover);
r = await call(previews.onRequestGet, 'GET', '/x', 4, P12);
check('agents never see previews or the address of a closed pre-listing, even if a window is still on file', r.json.previews.length === 0 && r.json.address === undefined, JSON.stringify(r.json));

// --- Cleanup on delete ---
sqlite.prepare("UPDATE pre_listings SET status = 'closed' WHERE id = 10").run(); // awarded pre-listings can't be deleted by the owner
const videoKey = sqlite.prepare('SELECT video_r2_key FROM pre_listings WHERE id = 10').get().video_r2_key;
r = await call(detail.onRequestDelete, 'DELETE', '/x', 1, P);
check('deleting the pre-listing removes its video file', r.status === 200 && !objects.has(videoKey));

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
