// Runs the real handlers for batch L1 role B2 (who sees pre-listings, photo and agent-media visibility, homeowner
// ratings removed, cleanup on delete, the data export) against an in-memory SQLite stand-in for D1 and a fake R2
// bucket that records every delete. Emails are captured by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/visibility-test.mjs <projectRoot>
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
      batchResult: async () => (/^\s*(SELECT|WITH)/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : stmt.run()),
    };
    return stmt;
  },
  // Like D1: all or nothing.
  batch: async (stmts) => {
    sqlite.exec('SAVEPOINT b');
    try { const out = []; for (const st of stmts) out.push(await st.batchResult()); sqlite.exec('RELEASE b'); return out; }
    catch (e) { sqlite.exec('ROLLBACK TO b'); sqlite.exec('RELEASE b'); throw e; }
  },
};
// A fake R2 bucket: delete() takes one key or a list (like R2), and every call is recorded.
const objects = new Map();
const deleteCalls = [];
const PHOTOS = {
  put: async (key, body) => {
    objects.set(key, body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array(body));
  },
  head: async (key) => (objects.has(key) ? { size: objects.get(key).length } : null),
  get: async (key, opts = {}) => {
    if (!objects.has(key)) return null;
    const all = objects.get(key);
    const r = opts.range;
    return { body: r ? all.slice(r.offset, r.offset + r.length) : all };
  },
  delete: async (keys) => { deleteCalls.push(keys); for (const k of [].concat(keys)) objects.delete(k); },
};
const env = { DB, PHOTOS, RESEND_API_KEY: 'test-key' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
globalThis.fetch = async () => new Response('{}', { status: 200 });
const call = async (handler, method, path, who, params = {}, body, headers = {}) => {
  const isForm = body instanceof FormData;
  const isRaw = body instanceof Uint8Array;
  const request = new Request(`https://amicohaus.com${path}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined && !isForm && !isRaw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isForm || isRaw ? body : JSON.stringify(body),
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = type.includes('json') ? await res.text() : '';
  return { status: res.status, json: text ? JSON.parse(text) : null, text, cache: res.headers.get('Cache-Control'), headers: res.headers };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const has = (key) => objects.has(key);
const putObj = (key) => objects.set(key, new Uint8Array([1, 2, 3, 4]));
console.log = () => {};

// --- People ---
// 1 homeowner A, 2 agent G (hired on 11), 3 agent H, 4 pending applicant, 5 rejected applicant, 6 buyer, 7 admin,
// 8 admin who is also an approved agent, 9 approved agent Q (never took part), 10 agent X (blocked the owner),
// 11 agent Y (the owner blocked them), 12 second homeowner, 13 suspended approved agent, 14-17 agents who took part
// in the closed home 12 one way each (invite, interview, opinion, vote).
const user = (id, { role = 'user', status = 'active', email } = {}) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, email || `u${id}@example.test`, `User ${id}`, role, status);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
const agent = (id, status = 'approved') => run('INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, ?, ?, ?)', id, status, `0100000${id % 10}`, `Realty ${id}`);
for (const id of [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 14, 15, 16, 17]) user(id);
user(7, { role: 'admin' }); user(8, { role: 'admin' }); user(13, { status: 'suspended' });
for (const id of [2, 3, 8, 9, 10, 11, 13, 14, 15, 16, 17]) agent(id);
agent(4, 'pending'); agent(5, 'rejected');

// --- Pre-listings ---
const preListing = (id, owner, status, extra = '') => run(
  `INSERT INTO pre_listings (id, user_id, title, description, city, state, zip, neighborhood, property_type, beds, baths, asking_price, address,
     occupancy_status, special_instructions, status${extra ? ', ' + extra.split('=')[0] : ''})
   VALUES (?, ?, 'Sunny Home', 'Bright kitchen', 'Chula Vista', 'CA', '91913', 'EastLake', 'Single Family Home', 4, 3, 750000, '456 Hidden Ave',
     'vacant', 'GATE NOTES ${id}', ?${extra ? ', ' + extra.split('=')[1] : ''})`, id, owner, status);
preListing(10, 1, 'open', "video_r2_key='pre-listing-video/10/v'");
run("UPDATE pre_listings SET video_content_type = 'video/mp4' WHERE id = 10");
preListing(11, 1, 'open');
preListing(12, 1, 'closed');
preListing(13, 12, 'open');
putObj('pre-listing-video/10/v');
run("INSERT INTO pre_listing_photos (id, pre_listing_id, r2_key, content_type, position) VALUES (100, 10, 'pre-listings/10/a', 'image/jpeg', 0), (101, 10, 'pre-listings/10/b', 'image/jpeg', 1), (120, 12, 'pre-listings/12/a', 'image/jpeg', 0), (121, 12, 'pre-listings/12/b', 'image/jpeg', 1)");
for (const k of ['pre-listings/10/a', 'pre-listings/10/b', 'pre-listings/12/a', 'pre-listings/12/b']) putObj(k);
// Home 11 awarded to G (H's proposal was declined).
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, message, commission_pct, status) VALUES (1100, 'pre_listing', 11, 2, 'G plan', 2, 'accepted'), (1101, 'pre_listing', 11, 3, 'H plan', 2, 'declined')");
run("UPDATE pre_listings SET status = 'awarded', awarded_bid_id = 1100 WHERE id = 11");
// Home 10: H voted; the owner shared contact info with Q.
run("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (10, 3, 'too_high')");
run("INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (10, 1, 9)");
// Home 12 (closed): one agent took part each way.
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, message, commission_pct, status, pitch_video_r2_key) VALUES (1200, 'pre_listing', 12, 3, 'H plan', 2, 'pending', 'pre-listing-pitch/12/3/p')");
putObj('pre-listing-pitch/12/3/p');
run("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 12, 14, 1)");
run("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, owner_notes, scores_json) VALUES (12, 15, 'OWNER PRIVATE NOTE', '{\"fit\":5}')");
run("INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, deck_r2_key, deck_name) VALUES (12, 16, 800000, 'pre-listing-decks/12/16/d', 'deck.pdf')");
putObj('pre-listing-decks/12/16/d');
run("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (12, 17, 'just_right')");
run("INSERT INTO bid_milestones (request_type, request_id, label) VALUES ('pre_listing', 12, 'Listed')");
// Same ids, other kinds and homes: these must survive home 12's delete.
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, message, commission_pct, status) VALUES (1300, 'transaction', 12, 3, 'trade plan', 2, 'pending')");
run("INSERT INTO bid_milestones (request_type, request_id, label) VALUES ('transaction', 12, 'Listed'), ('pre_listing', 11, 'Listed')");
// Blocks: X blocked the owner; the owner blocked Y; the buyer blocked the second homeowner.
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (10, 1), (1, 11), (6, 12)');
// Homeowner ratings existed once: a row the API must never read again.
run("INSERT INTO homeowner_reviews (homeowner_user_id, reviewer_user_id, request_type, request_id, rating) VALUES (1, 2, 'pre_listing', 11, 2)");

const vis = await mod('functions/_lib/visibility.js');
const index = await mod('functions/api/pre-listings/index.js');
const detail = await mod('functions/api/pre-listings/[id].js');
const photoFile = await mod('functions/api/pre-listing-photos/[id].js');
const photoList = await mod('functions/api/pre-listings/[id]/photos/index.js');
const video = await mod('functions/api/pre-listings/[id]/video.js');
const reviewHomeowner = await mod('functions/api/pre-listings/[id]/review-homeowner.js');
const P = (id) => ({ id: String(id) });

// --- Browse: a teaser for anyone who isn't an approved agent ---
const TEASER = ['id', 'city', 'state', 'zip', 'propertyType', 'beds', 'baths', 'askingPrice', 'priceOpen', 'proposalsPaused', 'createdAt', 'teaser'].sort().join();
for (const who of [6, 4, 5, 12]) {
  const r = await call(index.onRequestGet, 'GET', '/api/pre-listings', who);
  const rows = r.json.preListings;
  check(`browse as user ${who} (not an approved agent): every row is a teaser with only the allowed fields`,
    r.status === 200 && rows.length > 0 && rows.every(p => p.teaser === true && Object.keys(p).sort().join() === TEASER), JSON.stringify(rows[0]));
  check(`...nothing private in it (no owner, address, notes, neighborhood, vacancy, photos or votes) and never cached (user ${who})`,
    !/Hidden Ave|GATE NOTES|EastLake|vacant|User 1|photoIds|votes|userId/.test(r.text) && r.cache === 'private, no-store', r.text.slice(0, 200));
}
let r = await call(index.onRequestGet, 'GET', '/api/pre-listings', 6);
check('a teaser keeps the card facts (city, ZIP, type, beds/baths, price)', (() => { const p = r.json.preListings.find(x => x.id === 10); return p && p.city === 'Chula Vista' && p.zip === '91913' && p.propertyType === 'Single Family Home' && p.beds === 4 && p.baths === 3 && p.askingPrice === 750000 && p.priceOpen === false && p.proposalsPaused === false; })(), JSON.stringify(r.json.preListings));
check('browse lists open homes only (no awarded or closed ones)', !r.json.preListings.some(x => x.id === 11 || x.id === 12));
check("a home whose owner the viewer blocked drops out of their browse list (non-agent too)", !r.json.preListings.some(x => x.id === 13) && r.json.preListings.some(x => x.id === 10));
r = await call(index.onRequestGet, 'GET', '/api/pre-listings', 9);
const qRow = r.json.preListings.find(x => x.id === 10);
check('an approved agent gets the full card (photos, owner, votes sealed until they vote)', qRow && !qRow.teaser && qRow.photoIds.length === 2 && qRow.owner === 'User 1' && qRow.votes.sealed === true && qRow.votes.total === 1 && qRow.votes.too_high === undefined, JSON.stringify(qRow));
check('...also never cached', r.cache === 'private, no-store');
r = await call(index.onRequestGet, 'GET', '/api/pre-listings', 3);
check('an agent who voted sees the full tally in browse', r.json.preListings.find(x => x.id === 10).votes.too_high === 1);
for (const [who, label] of [[10, 'an agent who blocked the owner'], [11, 'an agent the owner blocked']]) {
  r = await call(index.onRequestGet, 'GET', '/api/pre-listings', who);
  check(`${label}: the owner's homes drop out of browse, others stay`, !r.json.preListings.some(x => x.id === 10) && r.json.preListings.some(x => x.id === 13), JSON.stringify(r.json.preListings.map(x => x.id)));
}
r = await call(index.onRequestGet, 'GET', '/api/pre-listings', 7);
check('an admin gets full cards with the full tally', (() => { const p = r.json.preListings.find(x => x.id === 10); return p && !p.teaser && p.votes.too_high === 1 && !p.votes.sealed; })(), JSON.stringify(r.json.preListings[0]));
r = await call(index.onRequestGet, 'GET', '/api/pre-listings', 8);
check('an admin who also competes as an agent sees a sealed tally until they vote (Fair Play)', r.json.preListings.find(x => x.id === 10).votes.sealed === true);
r = await call(index.onRequestGet, 'GET', '/api/pre-listings', null);
check('browse still needs sign-in', r.status === 401);

// The owner's own list: full, and a blocked agent's pending proposal or showing doesn't count as waiting.
run("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 10, 9, 'Q plan', 2, 'pending'), ('pre_listing', 10, 11, 'Y plan', 2, 'pending')");
run("INSERT INTO pre_listing_showings (pre_listing_id, agent_user_id, proposed_at, status) VALUES (10, 9, '2030-01-01T10:00:00Z', 'pending'), (10, 11, '2030-01-01T11:00:00Z', 'pending')");
r = await call(index.onRequestGet, 'GET', '/api/pre-listings?mine=1', 1);
const mine10 = r.json.preListings.find(x => x.id === 10);
check("the owner's own list is full (address-free card, photos, tally) for every status", mine10 && !mine10.teaser && mine10.photoIds.length === 2 && r.json.preListings.some(x => x.id === 12) && r.cache === 'private, no-store');
check("...and a blocked agent's pending proposal and showing aren't counted as waiting", mine10.pendingBidCount === 1 && mine10.pendingShowingCount === 1, JSON.stringify(mine10));
run("DELETE FROM pre_listing_showings WHERE pre_listing_id = 10");

// --- Detail ---
for (const [who, label] of [[6, 'a buyer'], [12, 'another homeowner'], [4, 'a pending applicant'], [5, 'a rejected applicant']]) {
  r = await call(detail.onRequestGet, 'GET', '/x', who, P(10));
  check(`${label} gets 403 agents_only on the detail, with nothing about the home`, r.status === 403 && r.json.code === 'agents_only' && r.json.error === 'Only approved agents can open pre-listings.' && !/Hidden|GATE|Sunny|EastLake/.test(r.text), r.text);
}
r = await call(detail.onRequestGet, 'GET', '/x', 9, P(10));
check('an approved agent opens an open pre-listing', r.status === 200 && r.json.preListing.id === 10 && r.cache === 'private, no-store');
check('...with a sealed tally until they vote', r.json.preListing.votes.sealed === true && r.json.preListing.votes.too_high === undefined, JSON.stringify(r.json.preListing.votes));
check('homeowner ratings are gone from the detail', !('homeownerRating' in r.json) && !/homeownerRating/i.test(r.text));
r = await call(detail.onRequestGet, 'GET', '/x', 3, P(10));
check('an agent who voted sees the full tally', r.json.preListing.votes.too_high === 1 && !r.json.preListing.votes.sealed);
r = await call(detail.onRequestGet, 'GET', '/x', 7, P(10));
check('an admin opens it with the full tally', r.status === 200 && r.json.preListing.votes.too_high === 1 && !r.json.preListing.votes.sealed);
r = await call(detail.onRequestGet, 'GET', '/x', 8, P(10));
check('an admin who also competes as an agent sees it sealed until they vote', r.status === 200 && r.json.preListing.votes.sealed === true);
r = await call(detail.onRequestGet, 'GET', '/x', 1, P(10));
check('the owner sees the full tally and the address', r.json.preListing.votes.too_high === 1 && r.json.preListing.address === '456 Hidden Ave' && r.json.isOwner === true);
for (const [who, label] of [[10, 'an agent who blocked the owner'], [11, 'an agent the owner blocked']]) {
  r = await call(detail.onRequestGet, 'GET', '/x', who, P(10));
  check(`${label} gets the same 404 as a missing home (nothing about a block)`, r.status === 404 && r.json.error === 'Pre-listing not found.' && !/block/i.test(r.text), r.text);
}
r = await call(detail.onRequestGet, 'GET', '/x', 9, P(999));
check('a missing home is that same 404', r.status === 404 && r.json.error === 'Pre-listing not found.');
// --- The price-vote GET follows the detail's rule (Fair Play), and blocks apply to an admin who competes as an agent ---
const votesApi = await mod('functions/api/pre-listings/[id]/votes/index.js');
r = await call(votesApi.onRequestGet, 'GET', '/x', 8, P(10));
check('votes GET: an admin who also competes as an agent gets a sealed tally until they vote', r.status === 200 && r.json.votes.sealed === true && r.json.votes.too_high === undefined, r.text);
r = await call(votesApi.onRequestGet, 'GET', '/x', 7, P(10));
check('votes GET: an admin with no agent profile gets the full tally', r.status === 200 && r.json.votes.too_high === 1 && !r.json.votes.sealed, r.text);
r = await call(votesApi.onRequestGet, 'GET', '/x', 9, P(10));
check("votes GET: an approved agent who hasn't voted gets it sealed", r.status === 200 && r.json.votes.sealed === true);
r = await call(votesApi.onRequestGet, 'GET', '/x', 1, P(10));
check('votes GET: the owner gets the full tally', r.status === 200 && r.json.votes.too_high === 1);
r = await call(votesApi.onRequestGet, 'GET', '/x', 6, P(10));
check('votes GET: someone who is not an approved agent gets agents_only', r.status === 403 && r.json.code === 'agents_only');
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 8)');
r = await call(detail.onRequestGet, 'GET', '/x', 8, P(10));
check('an admin who competes as an agent and is blocked by the owner gets the same 404 as any agent', r.status === 404 && r.json.error === 'Pre-listing not found.', r.text);
r = await call(votesApi.onRequestGet, 'GET', '/x', 8, P(10));
check('...on the price votes too', r.status === 404);
r = await call(detail.onRequestGet, 'GET', '/x', 7, P(10));
check('...while an admin who does not compete still opens it', r.status === 200);
run('DELETE FROM user_blocks WHERE blocker_id = 1 AND blocked_id = 8');
// A home that isn't open: only agents who took part.
r = await call(detail.onRequestGet, 'GET', '/x', 9, P(12));
check("an approved agent who didn't take part can't open a closed home (404)", r.status === 404, r.text);
for (const [who, how] of [[3, 'a proposal'], [14, 'an invite'], [15, 'an interview'], [16, 'a price opinion'], [17, 'a price vote']]) {
  r = await call(detail.onRequestGet, 'GET', '/x', who, P(12));
  check(`an agent who took part through ${how} can still open the closed home`, r.status === 200 && r.json.preListing.id === 12, r.text.slice(0, 120));
}
r = await call(detail.onRequestGet, 'GET', '/x', 3, P(11));
check('a past bidder can open an awarded home', r.status === 200);
r = await call(detail.onRequestGet, 'GET', '/x', 7, P(12));
check('an admin can open any home', r.status === 200);
check('agentTookPart: no row, no access', !(await vis.agentTookPart(DB, 12, 9)) && (await vis.agentTookPart(DB, '12', 14)));

// --- Notes for agents (#13): the owner, admins, the hired agent and agents the owner shared contact info with ---
const notes = async (who, id) => { const x = await call(detail.onRequestGet, 'GET', '/x', who, P(id)); return x.json && x.json.preListing ? x.json.preListing.specialInstructions : 'NO ACCESS'; };
check('the owner sees the notes for agents', (await notes(1, 11)) === 'GATE NOTES 11');
check('an admin sees them', (await notes(7, 11)) === 'GATE NOTES 11');
check('the hired agent sees them', (await notes(2, 11)) === 'GATE NOTES 11');
check("an agent who wasn't hired doesn't", (await notes(3, 11)) === undefined);
check('an agent the owner shared contact info with sees them', (await notes(9, 10)) === 'GATE NOTES 10');
check('any other approved agent does not', (await notes(3, 10)) === undefined && (await notes(16, 12)) === undefined);
r = await call(detail.onRequestGet, 'GET', '/x', 3, P(10));
check("...and the notes text isn't anywhere in their answer", !r.text.includes('GATE NOTES'));

// --- Photos and the walkthrough video ---
const photo = (who, id) => call(photoFile.onRequestGet, 'GET', `/api/pre-listing-photos/${id}`, who, P(id));
r = await photo(1, 100);
check('the owner gets their pre-listing photo, cached privately for an hour', r.status === 200 && r.cache === 'private, max-age=3600', `${r.status} ${r.cache}`);
r = await photo(9, 100);
check('an approved agent gets it too', r.status === 200 && r.cache === 'private, max-age=3600');
for (const [who, label] of [[6, 'a buyer'], [4, 'a pending applicant'], [11, 'a blocked agent'], [10, 'an agent who blocked the owner']]) {
  r = await photo(who, 100);
  check(`${label} gets a 404 for the photo`, r.status === 404 && r.json.error === 'Photo not found.', `${r.status}`);
}
r = await photo(9, 120);
check("an agent who didn't take part can't load a closed home's photo", r.status === 404);
r = await photo(16, 120);
check('...one who took part can', r.status === 200);
r = await photo(null, 100);
check('anonymous needs sign-in', r.status === 401);
r = await call(photoList.onRequestGet, 'GET', '/x', 6, P(10));
check('the photo list is 403 agents_only for a non-agent', r.status === 403 && r.json.code === 'agents_only');
r = await call(photoList.onRequestGet, 'GET', '/x', 11, P(10));
check('...404 for a blocked agent', r.status === 404);
r = await call(photoList.onRequestGet, 'GET', '/x', 9, P(10));
check('...and the list for an approved agent', r.status === 200 && r.json.photos.length === 2 && r.cache === 'private, no-store');
r = await call(photoList.onRequestGet, 'GET', '/x', 9, P(999));
check('...404 for a missing home', r.status === 404);
const vid = (who) => call(video.onRequestGet, 'GET', '/x', who, P(10));
r = await vid(7);
check('an admin can watch the walkthrough video now', r.status === 200, `${r.status} ${r.text}`);
r = await vid(9);
check('so can an approved agent', r.status === 200 && r.headers.get('Cache-Control') === 'private, max-age=3600');
r = await vid(6);
check('a non-agent is refused the video', r.status === 403);
r = await vid(11);
check('a blocked agent gets a 404 for the video', r.status === 404);

// --- Homeowner ratings are removed ---
r = await call(reviewHomeowner.onRequestPost, 'POST', '/x', 2, P(11), { rating: 1, comment: 'x' });
check('rating a homeowner is gone (410, code gone)', r.status === 410 && r.json.code === 'gone' && r.json.error === 'Homeowner ratings are no longer part of Amico Haus.', r.text);
check('...and nothing was written', one('SELECT COUNT(*) AS n FROM homeowner_reviews').n === 1);

// --- Listing, AugmentedHomes and GreenHomes photos: public only while the home is ---
const listingPhoto = await mod('functions/api/photos/[id].js');
const augPhoto = await mod('functions/api/augmented-home-photos/[id].js');
const greenPhoto = await mod('functions/api/green-home-photos/[id].js');
const listingPhotoList = await mod('functions/api/listings/[id]/photos/index.js');
const augPhotoList = await mod('functions/api/augmented-homes/[id]/photos/index.js');
const greenPhotoList = await mod('functions/api/green-homes/[id]/photos/index.js');
const listing = (id, owner, status = 'active') => run("INSERT INTO listings (id, user_id, title, city, state, property_type, estimated_value, price_tier, status) VALUES (?, ?, 'Home', 'Chula Vista', 'CA', 'Condo', 500000, 'mid', ?)", id, owner, status);
listing(20, 12); listing(21, 12, 'paused'); listing(22, 13);
run("INSERT INTO listing_photos (id, listing_id, r2_key, content_type) VALUES (200, 20, 'listings/20/a', 'image/jpeg'), (210, 21, 'listings/21/a', 'image/jpeg'), (220, 22, 'listings/22/a', 'image/jpeg')");
for (const k of ['listings/20/a', 'listings/21/a', 'listings/22/a']) putObj(k);
const home = (table, id, owner, status) => run(`INSERT INTO ${table} (id, user_id, title, city, state, property_type, asking_price, status) VALUES (?, ?, 'Home', 'Chula Vista', 'CA', 'Condo', 500000, ?)`, id, owner, status);
home('augmented_homes', 30, 12, 'active'); home('augmented_homes', 31, 12, 'withdrawn'); home('augmented_homes', 32, 12, 'under_contract'); home('augmented_homes', 33, 13, 'active');
home('green_homes', 40, 12, 'active'); home('green_homes', 41, 12, 'withdrawn');
run("INSERT INTO augmented_home_photos (id, augmented_home_id, r2_key, content_type) VALUES (300, 30, 'augmented-homes/30/a', 'image/png'), (310, 31, 'augmented-homes/31/a', 'image/png'), (320, 32, 'augmented-homes/32/a', 'image/png'), (330, 33, 'augmented-homes/33/a', 'image/png')");
run("INSERT INTO green_home_photos (id, green_home_id, r2_key, content_type) VALUES (400, 40, 'green-homes/40/a', 'image/png'), (410, 41, 'green-homes/41/a', 'image/png')");
for (const k of ['augmented-homes/30/a', 'augmented-homes/31/a', 'augmented-homes/32/a', 'augmented-homes/33/a', 'green-homes/40/a', 'green-homes/41/a']) putObj(k);
const PUBLIC = 'public, max-age=31536000, immutable';
for (const [label, handler, publicId, hiddenId, suspendedId] of [
  ['listing', listingPhoto, 200, 210, 220], ['AugmentedHomes', augPhoto, 300, 310, 330], ['GreenHomes', greenPhoto, 400, 410, null],
]) {
  r = await call(handler.onRequestGet, 'GET', '/x', null, P(publicId));
  check(`${label}: a live home's photo is public and cached as before (public pages and og:image keep working)`, r.status === 200 && r.cache === PUBLIC, `${r.status} ${r.cache}`);
  r = await call(handler.onRequestGet, 'GET', '/x', null, P(hiddenId));
  check(`${label}: a ${label === 'listing' ? 'paused' : 'withdrawn'} home's photo is a 404 for anonymous`, r.status === 404);
  r = await call(handler.onRequestGet, 'GET', '/x', 6, P(hiddenId));
  check(`${label}: ...and for another signed-in user`, r.status === 404);
  r = await call(handler.onRequestGet, 'GET', '/x', 12, P(hiddenId));
  check(`${label}: ...but the owner still gets it, never stored by a cache`, r.status === 200 && r.cache === 'private, no-store', `${r.status} ${r.cache}`);
  r = await call(handler.onRequestGet, 'GET', '/x', 7, P(hiddenId));
  check(`${label}: ...and so does an admin`, r.status === 200 && r.cache === 'private, no-store');
  if (suspendedId) {
    r = await call(handler.onRequestGet, 'GET', '/x', null, P(suspendedId));
    check(`${label}: a suspended owner's photo is a 404 for anonymous`, r.status === 404);
  }
}
r = await call(augPhoto.onRequestGet, 'GET', '/x', null, P(320));
check('AugmentedHomes: an under-contract home is still public (only withdrawn is hidden)', r.status === 200 && r.cache === PUBLIC);
for (const [label, handler, publicId, hiddenId] of [['listing', listingPhotoList, 20, 21], ['AugmentedHomes', augPhotoList, 30, 31], ['GreenHomes', greenPhotoList, 40, 41]]) {
  r = await call(handler.onRequestGet, 'GET', '/x', null, P(publicId));
  check(`${label} photo list: public while the home is`, r.status === 200 && r.json.photos.length === 1);
  r = await call(handler.onRequestGet, 'GET', '/x', null, P(hiddenId));
  check(`${label} photo list: a hidden home's list is a 404`, r.status === 404);
  r = await call(handler.onRequestGet, 'GET', '/x', 12, P(hiddenId));
  check(`${label} photo list: ...but the owner sees it (private, no-store)`, r.status === 200 && r.json.photos.length === 1 && r.cache === 'private, no-store');
  r = await call(handler.onRequestGet, 'GET', '/x', null, P(999));
  check(`${label} photo list: a missing home is a 404`, r.status === 404);
}

// --- Agent media: public only for an approved agent with an active account ---
const agentPhoto = await mod('functions/api/agent-photos/[id].js');
const agentVideo = await mod('functions/api/agent-video/[id].js');
const before = await mod('functions/api/case-study-photos/[id]/before.js');
const after = await mod('functions/api/case-study-photos/[id]/after.js');
for (const [uid, pid] of [[2, 500], [4, 501], [5, 502], [13, 503]]) {
  run('INSERT INTO agent_portfolio_photos (id, agent_user_id, r2_key, content_type) VALUES (?, ?, ?, ?)', pid, uid, `agent-portfolio/${uid}/a`, 'image/jpeg');
  run('INSERT INTO agent_case_studies (id, agent_user_id, before_r2_key, before_content_type, after_r2_key, after_content_type) VALUES (?, ?, ?, ?, ?, ?)', pid + 100, uid, `agent-case-study/${uid}/b`, 'image/jpeg', `agent-case-study/${uid}/a`, 'image/jpeg');
  run("UPDATE agent_profiles SET video_r2_key = ?, video_content_type = 'video/mp4' WHERE user_id = ?", `agent-video/${uid}/v`, uid);
  for (const k of [`agent-portfolio/${uid}/a`, `agent-case-study/${uid}/b`, `agent-case-study/${uid}/a`, `agent-video/${uid}/v`]) putObj(k);
}
const media = [['portfolio photo', agentPhoto, (pid) => pid], ['case study before photo', before, (pid) => pid + 100], ['case study after photo', after, (pid) => pid + 100], ['intro video', agentVideo, null]];
for (const [label, handler, idOf] of media) {
  const param = (uid, pid) => P(idOf ? idOf(pid) : uid);
  r = await call(handler.onRequestGet, 'GET', '/x', null, param(2, 500));
  check(`${label}: an approved agent's is public, cached as before`, r.status === 200 && r.cache === (idOf ? PUBLIC : 'public, max-age=3600'), `${r.status} ${r.cache}`);
  for (const [uid, pid, who] of [[4, 501, 'pending'], [5, 502, 'rejected'], [13, 503, 'suspended']]) {
    r = await call(handler.onRequestGet, 'GET', '/x', null, param(uid, pid));
    check(`${label}: a ${who} applicant's is a 404 for anonymous`, r.status === 404);
    r = await call(handler.onRequestGet, 'GET', '/x', 6, param(uid, pid));
    check(`${label}: ...and for another signed-in user (${who})`, r.status === 404);
    r = await call(handler.onRequestGet, 'GET', '/x', 7, param(uid, pid));
    check(`${label}: ...but an admin can review it (${who})`, r.status === 200 && r.cache === 'private, no-store', `${r.status} ${r.cache}`);
  }
  r = await call(handler.onRequestGet, 'GET', '/x', 4, param(4, 501));
  check(`${label}: a pending applicant can still see their own (private, no-store)`, r.status === 200 && r.cache === 'private, no-store');
}

// --- Agent media uploads: approved agents only (the license photo stays open to applicants) ---
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pngForm = (...fields) => { const f = new FormData(); for (const name of fields) f.append(name, new Blob([PNG], { type: 'image/png' }), 'x.png'); return f; };
const portfolioUp = await mod('functions/api/agents/portfolio-photos/index.js');
const caseUp = await mod('functions/api/agents/case-studies/index.js');
const videoUp = await mod('functions/api/agents/video.js');
const licenseUp = await mod('functions/api/agents/license-photo.js');
const NOT_APPROVED = 'Your agent profile needs to be approved first.';
const MP4 = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0]);
const putVideo = (who) => call(videoUp.onRequestPut, 'PUT', '/api/agents/video', who, {}, MP4, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) });
for (const [who, label] of [[4, 'a pending applicant'], [5, 'a rejected applicant']]) {
  const before = objects.size;
  r = await call(portfolioUp.onRequestPost, 'POST', '/x', who, {}, pngForm('photo'));
  check(`${label} can't upload portfolio photos (403)`, r.status === 403 && r.json.error === NOT_APPROVED, r.text);
  r = await call(caseUp.onRequestPost, 'POST', '/x', who, {}, pngForm('before', 'after'));
  check(`${label} can't upload a case study (403)`, r.status === 403 && r.json.error === NOT_APPROVED, r.text);
  r = await putVideo(who);
  check(`${label} can't upload an intro video (403)`, r.status === 403 && r.json.error === NOT_APPROVED, r.text);
  check(`...and nothing was stored for ${label}`, objects.size === before);
}
r = await call(licenseUp.onRequestPost, 'POST', '/x', 4, {}, pngForm('photo'));
check('a pending applicant can still upload their license photo', r.status === 200, r.text);
r = await call(portfolioUp.onRequestPost, 'POST', '/x', 6, {}, pngForm('photo'));
check('someone with no agent profile is told to apply first (as before)', r.status === 400);
r = await call(portfolioUp.onRequestPost, 'POST', '/x', 2, {}, pngForm('photo'));
check('an approved agent uploads a portfolio photo', r.status === 201, r.text);
r = await call(caseUp.onRequestPost, 'POST', '/x', 2, {}, pngForm('before', 'after'));
check('...and a case study', r.status === 201, r.text);
r = await putVideo(2);
check('...and an intro video', r.status === 200, r.text);
check("...and the replaced intro video is removed from storage", !has('agent-video/2/v'));

// --- deleteR2Keys ---
const { deleteR2Keys } = await mod('functions/_lib/r2Cleanup.js');
deleteCalls.length = 0;
const many = Array.from({ length: 2500 }, (_, i) => `bulk/${i}`);
let n = await deleteR2Keys(PHOTOS, [...many, null, undefined, '', many[0], many[1]]);
check('deleteR2Keys drops nulls and duplicates and deletes in chunks of 1000', n === 2500 && deleteCalls.length === 3 && deleteCalls[0].length === 1000 && deleteCalls[1].length === 1000 && deleteCalls[2].length === 500, `${n} ${deleteCalls.map(c => c.length)}`);
n = await deleteR2Keys(PHOTOS, ['single/key']);
check('...a single key is sent on its own', deleteCalls[3] === 'single/key');
n = await deleteR2Keys({ delete: async () => { throw new Error('R2 down'); } }, ['a', 'b']);
check('...a storage failure never throws', n === 2);
check('...no bucket or no keys is a no-op', (await deleteR2Keys(null, ['a'])) === 0 && (await deleteR2Keys(PHOTOS, [])) === 0 && (await deleteR2Keys(PHOTOS, [null])) === 0);

// --- Deleting a pre-listing leaves nothing behind ---
// Then & Now photo pairs (owner tools batch): both files go with the home.
run("INSERT INTO pre_listing_then_now (pre_listing_id, then_r2_key, then_content_type, now_r2_key, now_content_type) VALUES (12, 'pre-listing-then-now/12/t', 'image/jpeg', 'pre-listing-then-now/12/n', 'image/jpeg')");
putObj('pre-listing-then-now/12/t'); putObj('pre-listing-then-now/12/n');
r = await call(detail.onRequestDelete, 'DELETE', '/x', 1, P(12));
check('the owner deletes their closed pre-listing', r.status === 200, r.text);
check('...its photos, the price-opinion deck and the pitch reel are removed from storage',
  !has('pre-listings/12/a') && !has('pre-listings/12/b') && !has('pre-listing-decks/12/16/d') && !has('pre-listing-pitch/12/3/p'));
check('...and both photos of its Then & Now pair', !has('pre-listing-then-now/12/t') && !has('pre-listing-then-now/12/n'));
check("...another home's photos are untouched", has('pre-listings/10/a') && has('pre-listings/10/b'));
check('...its proposals, invites and hire checklist rows are gone (no orphans)',
  one("SELECT COUNT(*) AS n FROM service_bids WHERE request_type = 'pre_listing' AND request_id = 12").n === 0
  && one("SELECT COUNT(*) AS n FROM agent_invites WHERE request_type = 'pre_listing' AND request_id = 12").n === 0
  && one("SELECT COUNT(*) AS n FROM bid_milestones WHERE request_type = 'pre_listing' AND request_id = 12").n === 0);
check('...while a trade with the same id and other homes keep theirs',
  one("SELECT COUNT(*) AS n FROM service_bids WHERE request_type = 'transaction' AND request_id = 12").n === 1
  && one("SELECT COUNT(*) AS n FROM bid_milestones WHERE request_type = 'transaction' AND request_id = 12").n === 1
  && one("SELECT COUNT(*) AS n FROM bid_milestones WHERE request_type = 'pre_listing' AND request_id = 11").n === 1);
r = await call(detail.onRequestDelete, 'DELETE', '/x', 7, P(10));
check('an admin removing a home also removes its walkthrough video and photos', r.status === 200 && !has('pre-listing-video/10/v') && !has('pre-listings/10/a'), r.text);
check('...and it is on the admin activity log', one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'delete_pre_listing' AND target_id = 10").n === 1);

// --- Listings: trash keeps photos for a restore; purging removes them; an admin delete removes them right away ---
const listingApi = await mod('functions/api/listings/[id].js');
const trashList = await mod('functions/api/listings/trash/index.js');
const trashItem = await mod('functions/api/listings/trash/[id].js');
const trashLib = await mod('functions/_lib/trash.js');
listing(23, 12); listing(24, 12); listing(25, 12); listing(26, 12);
run("INSERT INTO listing_photos (id, listing_id, r2_key, content_type) VALUES (230, 23, 'listings/23/a', 'image/jpeg'), (240, 24, 'listings/24/a', 'image/jpeg'), (250, 25, 'listings/25/a', 'image/jpeg')");
for (const k of ['listings/23/a', 'listings/24/a', 'listings/25/a']) putObj(k);
r = await call(listingApi.onRequestDelete, 'DELETE', '/x', 12, P(23));
check("the owner's own delete goes to the trash and keeps the photo for a restore", r.status === 200 && has('listings/23/a') && one('SELECT COUNT(*) AS n FROM deleted_listings WHERE user_id = 12').n === 1);
const trashId = one('SELECT id FROM deleted_listings WHERE user_id = 12').id;
r = await call(trashItem.onRequestDelete, 'DELETE', '/x', 6, P(trashId));
check("someone else can't purge the owner's trash", has('listings/23/a') && one('SELECT COUNT(*) AS n FROM deleted_listings WHERE id = ?', trashId).n === 1);
r = await call(trashItem.onRequestDelete, 'DELETE', '/x', 12, P(trashId));
check('emptying one trash entry removes its photo from storage', r.status === 200 && !has('listings/23/a') && one('SELECT COUNT(*) AS n FROM deleted_listings WHERE id = ?', trashId).n === 0);
await call(listingApi.onRequestDelete, 'DELETE', '/x', 12, P(24));
run("UPDATE deleted_listings SET deleted_at = datetime('now', '-8 day') WHERE user_id = 12");
r = await call(trashList.onRequestGet, 'GET', '/x', 12);
check('a trash entry past its 7 days is purged with its photo when the trash is opened', r.status === 200 && r.json.trash.length === 0 && !has('listings/24/a'));
// A restored listing reuses its old keys: purging another snapshot that names a live key never deletes it.
run("INSERT INTO deleted_listings (user_id, snapshot, deleted_at) VALUES (12, ?, datetime('now', '-9 day'))", JSON.stringify({ listing: {}, photos: [{ r2_key: 'listings/20/a' }, { r2_key: 'listings/old/x' }] }));
putObj('listings/old/x');
await trashLib.purgeExpiredTrash(DB, PHOTOS);
check('...a key a live listing still uses is kept; the rest go', has('listings/20/a') && !has('listings/old/x') && one('SELECT COUNT(*) AS n FROM deleted_listings').n === 0);
r = await call(listingApi.onRequestDelete, 'DELETE', '/x', 7, P(25));
check("an admin removing someone else's listing skips the trash and removes the photo right away", r.status === 200 && !has('listings/25/a') && one('SELECT COUNT(*) AS n FROM deleted_listings').n === 0);
// #8: an admin can hide or remove someone else's listing, never edit it.
const before26 = one('SELECT description, status FROM listings WHERE id = 26');
r = await call(listingApi.onRequestPut, 'PUT', '/x', 7, P(26), { action: 'edit', title: 'Admin title', city: 'X', state: 'CA', propertyType: 'Condo', beds: 1, baths: 1, estimatedValue: 1 });
check("an admin can't edit someone else's listing", r.status === 403 && /hide or remove/.test(r.json.error), r.text);
r = await call(listingApi.onRequestPut, 'PUT', '/x', 7, P(26), { description: 'Admin words' });
check("...nor change its description", r.status === 403 && one('SELECT description FROM listings WHERE id = 26').description === before26.description);
r = await call(listingApi.onRequestPut, 'PUT', '/x', 7, P(26), { status: 'paused', description: 'sneaky' });
check("...nor slip a description in with a status change", r.status === 403 && one('SELECT status FROM listings WHERE id = 26').status === 'active');
r = await call(listingApi.onRequestPut, 'PUT', '/x', 7, P(26), { status: 'paused' });
check('...but can hide it, on the admin activity log', r.status === 200 && one('SELECT status FROM listings WHERE id = 26').status === 'paused' && one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'hide_listing' AND target_id = 26").n === 1);
r = await call(listingApi.onRequestPut, 'PUT', '/x', 7, P(26), { status: 'active' });
check('...and show it again', r.status === 200 && one('SELECT status FROM listings WHERE id = 26').status === 'active' && one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'unhide_listing'").n === 1);
r = await call(listingApi.onRequestPut, 'PUT', '/x', 12, P(26), { showExactAddress: true, description: 'Owner words' });
check('the owner still edits their own description; the old reveal-address switch is ignored', r.status === 200 && one('SELECT description, show_exact_address FROM listings WHERE id = 26').description === 'Owner words' && one('SELECT show_exact_address AS s FROM listings WHERE id = 26').s === 0);

// --- AugmentedHomes / GreenHomes deletes remove their photos ---
const augApi = await mod('functions/api/augmented-homes/[id].js');
const greenApi = await mod('functions/api/green-homes/[id].js');
r = await call(augApi.onRequestDelete, 'DELETE', '/x', 12, P(30));
check('deleting an AugmentedHomes home removes its photos from storage', r.status === 200 && !has('augmented-homes/30/a') && has('augmented-homes/32/a'));
r = await call(greenApi.onRequestDelete, 'DELETE', '/x', 7, P(40));
check('an admin deleting a GreenHomes home removes its photos too', r.status === 200 && !has('green-homes/40/a') && has('green-homes/41/a'));

// --- Account delete: every stored file, and the team-invite foreign key can't block it ---
const { hashPassword } = await mod('functions/_lib/auth.js');
const accountDelete = await mod('functions/api/account/delete.js');
user(50); user(51); user(52); agent(50); agent(51); agent(52);
run('UPDATE users SET password_hash = ? WHERE id = 50', await hashPassword('pw-50'));
listing(60, 50);
run("INSERT INTO listing_photos (listing_id, r2_key, content_type) VALUES (60, 'listings/60/a', 'image/jpeg')");
run("INSERT INTO deleted_listings (user_id, snapshot) VALUES (50, ?)", JSON.stringify({ listing: {}, photos: [{ r2_key: 'listings/59/trashed' }] }));
preListing(70, 50, 'open', "video_r2_key='pre-listing-video/70/v'");
run("INSERT INTO pre_listing_photos (pre_listing_id, r2_key, content_type) VALUES (70, 'pre-listings/70/a', 'image/jpeg')");
run("INSERT INTO pre_listing_then_now (pre_listing_id, then_r2_key, then_content_type, now_r2_key, now_content_type) VALUES (70, 'pre-listing-then-now/70/t', 'image/jpeg', 'pre-listing-then-now/70/n', 'image/jpeg')");
run("INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, deck_r2_key) VALUES (70, 2, 700000, 'pre-listing-decks/70/2/d'), (13, 50, 700000, 'pre-listing-decks/13/50/d')");
run("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status, pitch_video_r2_key) VALUES ('pre_listing', 70, 3, 'x', 2, 'pending', 'pre-listing-pitch/70/3/p'), ('pre_listing', 13, 50, 'x', 2, 'pending', 'pre-listing-pitch/13/50/p')");
run("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 70, 3, 50)");
run("INSERT INTO bid_milestones (request_type, request_id, label) VALUES ('pre_listing', 70, 'Listed')");
home('augmented_homes', 80, 50, 'active'); home('green_homes', 81, 50, 'active');
run("INSERT INTO dev_projects (id, user_id, city, state, project_type) VALUES (82, 50, 'Chula Vista', 'CA', 'flip')");
run("INSERT INTO augmented_home_photos (augmented_home_id, r2_key, content_type) VALUES (80, 'augmented-homes/80/a', 'image/png')");
run("INSERT INTO green_home_photos (green_home_id, r2_key, content_type) VALUES (81, 'green-homes/81/a', 'image/png')");
run("INSERT INTO dev_project_photos (dev_project_id, r2_key, content_type) VALUES (82, 'dev-projects/82/a', 'image/png')");
run("UPDATE agent_profiles SET video_r2_key = 'agent-video/50/v', license_photo_r2_key = 'agent-license/50/l' WHERE user_id = 50");
run("INSERT INTO agent_portfolio_photos (agent_user_id, r2_key, content_type) VALUES (50, 'agent-portfolio/50/a', 'image/jpeg')");
run("INSERT INTO agent_case_studies (agent_user_id, before_r2_key, before_content_type, after_r2_key, after_content_type) VALUES (50, 'agent-case-study/50/b', 'image/jpeg', 'agent-case-study/50/a', 'image/jpeg')");
// 50 became a team's owner after its founder (51) and invited 52.
run("INSERT INTO agent_teams (id, name, created_by_user_id) VALUES (90, 'Flores Team', 51)");
run("INSERT INTO agent_team_members (team_id, agent_user_id, role, status, invited_by_user_id) VALUES (90, 50, 'owner', 'active', 51), (90, 52, 'member', 'invited', 50)");
const accountKeys = ['listings/60/a', 'listings/59/trashed', 'pre-listings/70/a', 'pre-listing-video/70/v', 'pre-listing-decks/70/2/d', 'pre-listing-decks/13/50/d',
  'pre-listing-pitch/70/3/p', 'pre-listing-pitch/13/50/p', 'augmented-homes/80/a', 'green-homes/81/a', 'dev-projects/82/a', 'agent-video/50/v', 'agent-license/50/l',
  'agent-portfolio/50/a', 'agent-case-study/50/b', 'agent-case-study/50/a', 'pre-listing-then-now/70/t', 'pre-listing-then-now/70/n'];
for (const k of accountKeys) putObj(k);
r = await call(accountDelete.onRequestPost, 'POST', '/x', 50, {}, { password: 'wrong' });
check('account delete still needs the password', r.status === 400 && one('SELECT COUNT(*) AS n FROM users WHERE id = 50').n === 1 && accountKeys.every(has));
r = await call(accountDelete.onRequestPost, 'POST', '/x', 50, {}, { password: 'pw-50' });
check('an agent who invited a teammate can delete their account (no foreign-key failure)', r.status === 200 && one('SELECT COUNT(*) AS n FROM users WHERE id = 50').n === 0, r.text);
check('...the teammate they invited keeps their membership', (() => { const m = one('SELECT invited_by_user_id FROM agent_team_members WHERE agent_user_id = 52'); return m && m.invited_by_user_id === null; })());
const left = accountKeys.filter(has);
check('...every stored file is removed: listing + trashed photos, pre-listing photo/video/decks/pitch reels (both sides), Augmented/Green/project photos, intro video, license photo, portfolio and case-study photos', left.length === 0, JSON.stringify(left));
check("...proposals, invites and the checklist on their pre-listing are gone; other people's files stay",
  one("SELECT COUNT(*) AS n FROM service_bids WHERE request_type = 'pre_listing' AND request_id = 70").n === 0
  && one("SELECT COUNT(*) AS n FROM agent_invites WHERE request_type = 'pre_listing' AND request_id = 70").n === 0
  && one("SELECT COUNT(*) AS n FROM bid_milestones WHERE request_type = 'pre_listing' AND request_id = 70").n === 0
  && has('listings/20/a') && has('augmented-homes/32/a'));

// --- Data export ---
const exportApi = await mod('functions/api/account/export.js');
run("UPDATE users SET password_hash = 'pbkdf2:SECRETHASH', totp_secret = 'TOTPSECRET', totp_enabled = 1, verify_token = 'VERIFYTOKEN', reset_token = 'RESETTOKEN', bio = 'Hi', phone = '619-555-0100' WHERE id = 1");
run("UPDATE agent_profiles SET review_invite_token = 'INVITETOKEN', reviewed_by = 7, license_photo_r2_key = 'agent-license/3/l', video_r2_key = 'agent-video/3/v' WHERE user_id = 3");
run("INSERT INTO conversations (id, user_a_id, user_b_id) VALUES (700, 1, 3)");
run("INSERT INTO messages (conversation_id, sender_id, body) VALUES (700, 3, 'HELLO FROM H'), (700, 1, 'HELLO FROM A')");
run("INSERT INTO messages (conversation_id, sender_id, body, deliver_after) VALUES (700, 3, 'HELD FOR SUNDAY', '2099-01-01 09:00:00')");
preListing(71, 1, 'open');
run("INSERT INTO pre_listing_photos (pre_listing_id, r2_key, content_type) VALUES (71, 'pre-listings/71/a', 'image/jpeg')");
run("INSERT INTO pre_listing_then_now (pre_listing_id, caption, then_r2_key, then_content_type, now_r2_key, now_content_type) VALUES (71, 'Kitchen', 'pre-listing-then-now/71/t', 'image/jpeg', 'pre-listing-then-now/71/n', 'image/jpeg')");
run("INSERT INTO pre_listing_price_history (pre_listing_id, old_price, new_price) VALUES (71, 800000, 750000)");
run("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status, owner_pick, pitch_video_r2_key) VALUES ('pre_listing', 71, 3, 'H PROPOSAL', 2, 'pending', 'shortlist', 'pre-listing-pitch/71/3/p')");
run("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, owner_notes) VALUES (71, 3, 'A PRIVATE INTERVIEW NOTE')");
run("INSERT INTO pre_listing_previews (id, pre_listing_id, starts_at, ends_at) VALUES (710, 71, '2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z')");
run("INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (710, 3)");
run("INSERT INTO pre_listing_showings (pre_listing_id, agent_user_id, proposed_at) VALUES (71, 3, '2030-01-02T10:00:00Z')");
run("INSERT INTO finalist_debriefs (pre_listing_id, agent_user_id, reasons_json) VALUES (71, 3, '[\"marketing\"]')");
run("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 71, 9, 1)");
run("INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (1, 'user', 3, 'Rules problem'), (3, 'user', 1, 'NOT MINE')");
run("INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max) VALUES (1, 'Chula Vista', 'Any', 0, 900000)");
run("INSERT INTO agent_reviews (agent_user_id, reviewer_user_id, request_type, request_id, rating, comment) VALUES (3, 1, 'pre_listing', 71, 5, 'Great plan')");
run("INSERT INTO past_client_reviews (agent_user_id, reviewer_user_id, rating, client_side, sale_year, sale_city, sale_address) VALUES (3, 6, 5, 'sold', 2024, 'Chula Vista', '9 CLIENT PRIVATE ST')");
run("INSERT INTO founding_agents (zip, agent_user_id) VALUES ('91913', 3)");
run("INSERT INTO agent_teams (id, name, created_by_user_id) VALUES (91, 'H Team', 3)");
run("INSERT INTO agent_team_members (team_id, agent_user_id, role, status) VALUES (91, 3, 'owner', 'active')");
run("INSERT INTO agent_packages (agent_user_id, tier, title) VALUES (3, 'basic', 'Starter')");
run("INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, deck_r2_key, deck_name) VALUES (71, 3, 760000, 'pre-listing-decks/71/3/d', 'h.pdf')");
run("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (71, 3, 'just_right')");
const SECRETS = ['SECRETHASH', 'TOTPSECRET', 'VERIFYTOKEN', 'RESETTOKEN', 'INVITETOKEN', 'r2_key', 'agent-license/', 'agent-video/', 'pre-listing-pitch/', 'pre-listing-decks/', 'pre-listings/71/a', 'pre-listing-then-now/', 'password_hash', 'totp_secret', 't1"', 't3"'];
r = await call(exportApi.onRequestGet, 'GET', '/x', 1);
const ex = r.json;
check('the export is never cached', r.status === 200 && r.cache === 'private, no-store', r.cache);
const exText = JSON.stringify(ex);
check("the homeowner's export carries no password hash, two-factor secret, link or session token, or storage key", SECRETS.every(s => !exText.includes(s)), SECRETS.filter(s => exText.includes(s)).join());
check('...account fields (bio, phone, two-factor on/off, terms) are there', ex.account.bio === 'Hi' && ex.account.phone === '619-555-0100' && ex.account.twoFactorEnabled === true && 'termsVersion' in ex.account);
check('...messages received and conversations are there; a message still held for its weekly time is not',
  ex.messagesReceived.some(m => m.body === 'HELLO FROM H') && !ex.messagesReceived.some(m => m.body === 'HELD FOR SUNDAY') && ex.messagesSent.some(m => m.body === 'HELLO FROM A') && ex.conversations.some(c => c.id === 700 && c.other_user_id === 3));
check('...their pre-listings with photo details, price history, showings, previews + RSVPs, interviews (with their own notes), feedback sent, proposals received and invites sent',
  ex.preListings.some(p => p.id === 71) && ex.preListingPhotos.some(p => p.pre_listing_id === 71 && !('r2_key' in p)) && ex.preListingPriceHistory.length === 1
  && ex.showingRequests.length === 1 && ex.brokerPreviews.length === 1 && ex.brokerPreviewRsvps.length === 1
  && ex.interviews.some(i => i.owner_notes === 'A PRIVATE INTERVIEW NOTE') && ex.finalistFeedbackSent.length === 1
  && ex.proposalsReceived.some(b => b.message === 'H PROPOSAL' && b.owner_pick === 'shortlist') && ex.agentInvitesSent.some(i => i.agent_user_id === 9));
check('...blocks they made (never who blocked them), reports they filed (never reports about them), saved searches',
  ex.blocks.some(b => b.blocked_id === 11) && !ex.blocks.some(b => b.blocked_id === 1) && ex.reportsFiled.length === 1 && ex.reportsFiled[0].reason === 'Rules problem' && !exText.includes('NOT MINE') && ex.savedSearches.length === 1);
check('...and no homeowner rating anywhere', !/homeowner_?rating|homeowner_reviews/i.test(exText));
const exH = (await call(exportApi.onRequestGet, 'GET', '/x', 3)).json;
const exHText = JSON.stringify(exH);
check("an agent's export has their profile without storage keys, tokens or who reviewed them",
  exH.agentProfile && exH.agentProfile.license_number && !('license_photo_r2_key' in exH.agentProfile) && !('video_r2_key' in exH.agentProfile) && !('review_invite_token' in exH.agentProfile) && !('reviewed_by' in exH.agentProfile), JSON.stringify(exH.agentProfile));
check('...their proposals, price votes and opinions (deck name, not its key), founding spots, team, packages, reviews received',
  exH.proposalsSent.some(b => b.message === 'H PROPOSAL' && b.has_pitch_video === 1) && exH.priceVotesMade.length >= 1 && exH.priceOpinionsMade.some(o => o.deck_name === 'h.pdf')
  && exH.foundingSpots.some(f => f.zip === '91913') && exH.teamMemberships.some(t => t.team_name === 'H Team') && exH.agentPackages.length === 1
  && exH.reviewsReceived.some(x => x.comment === 'Great plan') && exH.pastClientReviewsReceived.length === 1);
check("...but never the homeowner's private side: their shortlist pick, interview notes, or a past client's street address",
  !exH.proposalsSent.some(b => 'owner_pick' in b) && !exHText.includes('A PRIVATE INTERVIEW NOTE') && !exHText.includes('9 CLIENT PRIVATE ST') && !exHText.includes('reviewer_user_id'));
check('...nor any storage key or token', SECRETS.every(s => !exHText.includes(s)), SECRETS.filter(s => exHText.includes(s)).join());
r = await call(exportApi.onRequestGet, 'GET', '/x', null);
check('the export needs sign-in', r.status === 401);

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
