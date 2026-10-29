// Runs the real handlers for sealed price opinions (votes, comps, presentation files), the buyer demand meter and
// the Mello-Roos / HOA snapshot against an in-memory SQLite stand-in for D1 and a Map stand-in for R2. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/opinions-test.mjs <projectRoot>
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
};
const objects = new Map();
const PHOTOS = {
  put: async (key, body) => { objects.set(key, new Uint8Array(body)); },
  get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
  delete: async (key) => { objects.delete(key); },
};
const env = { DB, PHOTOS };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);

let failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };

// People: 1 owner, 2-5 approved agents, 6 a plain homeowner, 7 suspended agent, 8 an admin.
const people = [[1, 'owner'], [2, 'agent'], [3, 'agent'], [4, 'agent'], [5, 'agent'], [6, 'home'], [7, 'agent'], [8, 'admin']];
for (const [id, kind] of people) {
  sqlite.prepare("INSERT INTO users (id, email, display_name, status, role) VALUES (?, ?, ?, ?, ?)").run(id, `u${id}@example.test`, `User ${id}`, id === 7 ? 'suspended' : 'active', kind === 'admin' ? 'admin' : 'user');
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
  if (kind === 'agent') sqlite.prepare("INSERT INTO agent_profiles (user_id, status) VALUES (?, 'approved')").run(id);
}
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, city, state, zip, neighborhood, property_type, beds, baths, asking_price)
  VALUES (10, 1, 'Chula Vista', 'CA', '91913', 'EastLake', 'Single Family Home', 4, 3, 900000)`).run();

const req = (method, path, who, body, extra = {}) => new Request(`https://amicohaus.com${path}`, {
  method, headers: { Cookie: `ah_session=t${who}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
  body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, ...extra,
});
const call = async (handler, method, path, who, params, body) => {
  const res = await handler({ request: req(method, path, who, body), env, params, waitUntil() {} });
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, bytes: type.includes('json') ? null : new Uint8Array(await res.arrayBuffer()) };
};

const votes = await mod('functions/api/pre-listings/[id]/votes/index.js');
const deck = await mod('functions/api/pre-listings/[id]/votes/deck.js');
const detail = await mod('functions/api/pre-listings/[id].js');
const list = await mod('functions/api/pre-listings/index.js');
const costsApi = await mod('functions/api/home-costs/[kind]/[id].js');
const P = { id: '10' };
console.log = () => {}; // marketplace notifications log when email isn't configured

// --- Sealed votes and opinions ---
const ownerNotices = () => sqlite.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1').get().n;
let r = await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 2, P, { vote: 'too_high', note: 'Two recent sales on this street.', priceOpinion: 850000, comps: [{ address: '1 Elm St', soldPrice: 860000, soldDate: '2026-09-01', sqft: 2100 }] });
check('agent saves a vote with a suggested price, a note and a comp', r.status === 200, JSON.stringify(r.json));
await new Promise(res => setTimeout(res, 20));
const noticesAfterFirst = ownerNotices();
await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 2, P, { vote: 'too_high', note: 'Two recent sales on this street.', priceOpinion: 855000, comps: [] });
await new Promise(res => setTimeout(res, 20));
check('re-saving the same vote (new price, fewer comps) does not notify the owner again', noticesAfterFirst >= 1 && ownerNotices() === noticesAfterFirst, `${noticesAfterFirst} -> ${ownerNotices()}`);
await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 2, P, { vote: 'just_right', note: 'Two recent sales on this street.', priceOpinion: 850000, comps: [] });
await new Promise(res => setTimeout(res, 20));
check('changing the vote does notify the owner', ownerNotices() === noticesAfterFirst + 1, `${noticesAfterFirst} -> ${ownerNotices()}`);
await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 2, P, { vote: 'too_high', note: 'Two recent sales on this street.', priceOpinion: 850000, comps: [{ address: '1 Elm St', soldPrice: 860000, soldDate: '2026-09-01', sqft: 2100 }] });
r = await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 3, P, { vote: 'just_right', priceOpinion: 5 });
check('a nonsense suggested price is refused', r.status === 400 && /whole-dollar/.test(r.json.error), JSON.stringify(r.json));
r = await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 3, P, { vote: 'just_right', comps: [{ address: '', soldPrice: 900000 }] });
check('a half-filled comp says which comp and what is missing', r.status === 400 && /Comp 1: add the address/.test(r.json.error), JSON.stringify(r.json));
r = await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 3, P, { vote: 'just_right', comps: [1, 2, 3, 4].map(i => ({ address: `${i} Oak`, soldPrice: 900000 })) });
check('more than 3 comps is refused', r.status === 400 && /up to 3/.test(r.json.error), JSON.stringify(r.json));
r = await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 3, P, { vote: 'just_right', comps: [{ address: '2 Oak', soldPrice: 900000, soldDate: '2099-01-01' }] });
check('a future sold date is refused', r.status === 400 && /past date/.test(r.json.error), JSON.stringify(r.json));

r = await call(votes.onRequestGet, 'GET', '/api/pre-listings/10/votes', 3, P);
check('an agent who has not voted sees a sealed tally (count only)', r.json.votes.sealed === true && r.json.votes.total === 1 && r.json.votes.too_high === undefined, JSON.stringify(r.json));
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 3, P);
check('...the detail view is sealed for them too', r.json.preListing.votes.sealed === true && r.json.priceOpinions === null, JSON.stringify(r.json.preListing.votes));
r = await call(list.onRequestGet, 'GET', '/api/pre-listings', 3, {});
check('...and so is the browse list', r.json.preListings.find(p => p.id === 10).votes.sealed === true);
r = await call(votes.onRequestGet, 'GET', '/api/pre-listings/10/votes', 2, P);
check('the agent who voted sees the full tally', r.json.votes.too_high === 1 && !r.json.votes.sealed, JSON.stringify(r.json));
r = await call(votes.onRequestGet, 'GET', '/api/pre-listings/10/votes', 6, P);
check('a homeowner browsing sees the full tally', r.json.votes.too_high === 1 && !r.json.votes.sealed);
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 2, P);
check("an agent sees their own opinion and comps, never others'", r.json.myVote.priceOpinion === 850000 && r.json.myVote.comps.length === 1 && r.json.priceOpinions === null, JSON.stringify(r.json.myVote));

await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 3, P, { vote: 'just_right', priceOpinion: 900000, comps: [] });
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 1, P);
check('the owner sees each opinion, no range yet with 2 prices', r.json.priceOpinions.opinions.length === 2 && r.json.priceOpinions.summary === null, JSON.stringify(r.json.priceOpinions));
await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 4, P, { vote: 'too_low', priceOpinion: 1000000, comps: [] });
await call(votes.onRequestPost, 'POST', '/api/pre-listings/10/votes', 5, P, { vote: 'too_low', priceOpinion: 950000, comps: [] });
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 1, P);
const sum = r.json.priceOpinions.summary;
check('with 3+ prices the owner gets the range and middle', sum && sum.low === 850000 && sum.high === 1000000 && sum.median === 925000 && sum.count === 4, JSON.stringify(sum));
sqlite.prepare("INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion) VALUES (10, 7, 2000000)").run();
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 1, P);
check("a suspended agent's opinion is left out", !r.json.priceOpinions.opinions.some(o => o.agentUserId === 7) && r.json.priceOpinions.summary.high === 1000000);

// --- Presentation files ---
const fileForm = (name, bytes) => { const f = new FormData(); f.append('file', new File([bytes], name)); return f; };
const PDF = new TextEncoder().encode('%PDF-1.7 test deck');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
r = await call(deck.onRequestPost, 'POST', '/api/pre-listings/10/votes/deck', 2, P, fileForm('My Deck!!.pdf', PDF));
check('an agent attaches a PDF', r.status === 201 && r.json.deck.name === 'My Deck.pdf', JSON.stringify(r.json));
r = await call(deck.onRequestPost, 'POST', '/api/pre-listings/10/votes/deck', 3, P, fileForm('fake.pdf', new TextEncoder().encode('<html>not a pdf')));
check("a file that isn't really a PDF is refused", r.status === 400, JSON.stringify(r.json));
r = await call(deck.onRequestPost, 'POST', '/api/pre-listings/10/votes/deck', 3, P, fileForm('script.html', PDF));
check('an unsupported file type is refused', r.status === 400);
r = await call(deck.onRequestPost, 'POST', '/api/pre-listings/10/votes/deck', 3, P, fileForm('Plan.pptx', ZIP));
check('a PowerPoint (.pptx) is accepted', r.status === 201);
r = await call(deck.onRequestPost, 'POST', '/api/pre-listings/10/votes/deck', 6, P, fileForm('x.pdf', PDF));
check('a non-agent cannot attach a file', r.status === 403);
r = await call(deck.onRequestPost, 'POST', '/api/pre-listings/10/votes/deck', 1, P, fileForm('x.pdf', PDF));
check('the owner cannot attach a file to their own pre-listing', r.status === 403);
r = await call(deck.onRequestGet, 'GET', '/api/pre-listings/10/votes/deck?agent=2', 1, P);
check('the owner downloads it, as an attachment', r.status === 200 && /attachment/.test(r.headers.get('Content-Disposition')) && r.headers.get('Content-Type') === 'application/pdf' && r.bytes.length === PDF.length, String(r.status));
r = await call(deck.onRequestGet, 'GET', '/api/pre-listings/10/votes/deck?agent=2', 3, P);
check("another agent cannot download someone else's file", r.status === 403, String(r.status));
r = await call(deck.onRequestGet, 'GET', '/api/pre-listings/10/votes/deck', 2, P);
check('the agent downloads their own file', r.status === 200);
r = await call(deck.onRequestGet, 'GET', '/api/pre-listings/10/votes/deck?agent=2', 8, P);
check('an admin cannot download it either (only the homeowner and the agent)', r.status === 403, String(r.status));
const big = new FormData(); big.append('file', new File([PDF], 'big.pdf'));
r = await deck.onRequestPost({ request: new Request('https://amicohaus.com/api/pre-listings/10/votes/deck', { method: 'POST', headers: { Cookie: 'ah_session=t2', 'Content-Length': String(30 * 1024 * 1024) }, body: big }), env, params: P, waitUntil() {} });
check('a file declared over 20MB is refused before it is read', r.status === 400 && /20MB/.test((await r.json()).error));
const firstKey = sqlite.prepare('SELECT deck_r2_key FROM pre_listing_price_opinions WHERE pre_listing_id = 10 AND agent_user_id = 2').get().deck_r2_key;
await call(deck.onRequestPost, 'POST', '/api/pre-listings/10/votes/deck', 2, P, fileForm('v2.pdf', PDF));
check('a replacement file removes the old one from storage', !objects.has(firstKey));
r = await call(deck.onRequestDelete, 'DELETE', '/api/pre-listings/10/votes/deck', 2, P);
check('the agent removes their file', r.status === 200 && sqlite.prepare('SELECT deck_name FROM pre_listing_price_opinions WHERE agent_user_id = 2').get().deck_name === null);

// --- Changing the asking price resets votes but keeps opinions ---
const body = { title: '', askingPrice: 950000, city: 'Chula Vista', state: 'CA', zip: '91913', neighborhood: 'EastLake', propertyType: 'Single Family Home', beds: 4, baths: 3, occupancyStatus: 'occupied' };
r = await call(detail.onRequestPut, 'PUT', '/api/pre-listings/10', 1, P, body);
check('changing the asking price clears the votes', r.status === 200 && r.json.votesCleared >= 4, JSON.stringify(r.json));
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 3, P);
check("...but keeps the agent's suggested price and file, with the vote reset", r.json.myVote && r.json.myVote.vote === null && r.json.myVote.priceOpinion === 900000 && r.json.myVote.deck && r.json.preListing.votes.sealed === true, JSON.stringify(r.json.myVote));
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 1, P);
const ana = r.json.priceOpinions.opinions.find(o => o.agentUserId === 2);
check("...and the agent's note survives the price change too", ana && ana.note === 'Two recent sales on this street.' && ana.vote === null, JSON.stringify(ana));

// --- Buyer demand meter ---
sqlite.prepare("INSERT INTO users (id, email, display_name) VALUES (20, 'demo1@demo.amicohaus.local', 'Demo')").run();
const search = (uid, loc, type = 'Any', min = 0, max = 0) => sqlite.prepare('INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max) VALUES (?, ?, ?, ?, ?)').run(uid, loc, type, min, max);
for (const id of [30, 31, 32]) sqlite.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)').run(id, `b${id}@example.test`, 'Buyer');
search(30, 'Chula Vista'); search(31, 'EastLake, Bonita', 'Single Family Home', 800000, 1000000);
search(20, 'Chula Vista'); search(1, 'Chula Vista'); search(32, 'Anywhere');
// Too broad, or just a word inside the name: never counts.
for (const [i, loc] of ['California', 'Southern California', 'Vista', 'Lake', 'San Diego County'].entries()) {
  sqlite.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)').run(50 + i, `broad${i}@example.test`, 'Broad');
  search(50 + i, loc);
}
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 1, P);
check('2 real matching buyers are not shown (under 3)', r.json.preListing.buyerDemand === null, String(r.json.preListing.buyerDemand));
search(32, 'chula vista', 'Single Family Home', 0, 900000);
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 1, P);
check('a buyer whose price cap is below the asking price does not count', r.json.preListing.buyerDemand === null, String(r.json.preListing.buyerDemand));
search(32, 'Chula Vista', 'Single Family Home', 0, 1200000);
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 1, P);
check('3 real buyers: count shown; demo, owner, "anywhere", whole-state, county and partial-word searches never count', r.json.preListing.buyerDemand === 3, String(r.json.preListing.buyerDemand));
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 6, P);
check('a plain homeowner browsing does not get the count', r.json.preListing.buyerDemand === undefined);

// Area matching on its own (a San Diego home, so county-style and other-state names really get tested).
const { countBuyerDemand } = await mod('functions/_lib/buyerDemand.js');
const sdHome = { userId: 999, city: 'San Diego', state: 'CA', neighborhood: 'North Park', propertyType: 'Condo', price: 600000, beds: 2, baths: 2 };
for (const [loc, counts] of [['San Diego', true], ['San Diego CA', true], ['san diego california', true], ['North Park', true], ['San Diego County', false], ['San Diego Co', false], ['San Diego TX', false], ['Southern California', false], ['Diego', false]]) {
  const fake = { prepare: (sql) => ({ bind: () => ({ all: async () => ({ results: sql.includes('saved_searches') ? [{ user_id: 5, locations: loc, property_type: 'Any', price_min: 0, price_max: 0 }] : [] }) }) }) };
  check(`"${loc}" ${counts ? 'counts' : 'does not count'} for a San Diego / North Park home`, (await countBuyerDemand(fake, sdHome) === 1) === counts);
}

// --- Mello-Roos / HOA snapshot ---
r = await call(costsApi.onRequestPut, 'PUT', '/api/home-costs/pre_listing/10', 1, { kind: 'pre_listing', id: '10' }, { melloRoosAnnual: 3200, hoaMonthly: 95, hoaDetails: { includes: ['pool', 'bogus'], rentals: 'limited', pets: 'nope', specialAssessment: 'Roof' } });
check('the owner saves Mello-Roos / HOA (junk keys dropped)', r.status === 200 && r.json.costs.hoaDetails.includes.join() === 'pool' && r.json.costs.hoaDetails.pets === '', JSON.stringify(r.json));
r = await call(costsApi.onRequestPut, 'PUT', '/api/home-costs/pre_listing/10', 1, { kind: 'pre_listing', id: '10' }, { melloRoosAnnual: 3200, hoaMonthly: 95, hoaDetails: { rentals: 'not_allowed', pets: 'not_allowed' } });
check('"not allowed" rentals/pets (not legal for a California HOA) are not stored', r.status === 200 && r.json.costs.hoaDetails.rentals === '' && r.json.costs.hoaDetails.pets === '', JSON.stringify(r.json.costs.hoaDetails));
r = await call(costsApi.onRequestPut, 'PUT', '/api/home-costs/pre_listing/10', 1, { kind: 'pre_listing', id: '10' }, { melloRoosAnnual: 3200, hoaMonthly: 95, hoaDetails: { rentals: 'no_short_term', pets: 'limited' } });
check('"no short-term rentals" and "limited pets" are kept', r.json.costs.hoaDetails.rentals === 'no_short_term' && r.json.costs.hoaDetails.pets === 'limited');
r = await call(costsApi.onRequestPut, 'PUT', '/api/home-costs/pre_listing/10', 1, { kind: 'pre_listing', id: '10' }, { melloRoosAnnual: 3200, hoaMonthly: 0, hoaDetails: { rentals: 'no_short_term', pets: 'limited', includes: ['pool'] } });
check('with no HOA, HOA rules and inclusions are not stored', r.json.costs.hoaDetails.rentals === '' && r.json.costs.hoaDetails.pets === '' && r.json.costs.hoaDetails.includes.length === 0);
r = await call(costsApi.onRequestPut, 'PUT', '/api/home-costs/pre_listing/10', 2, { kind: 'pre_listing', id: '10' }, { melloRoosAnnual: 0 });
check("someone else can't change it", r.status === 403);
r = await call(costsApi.onRequestPut, 'PUT', '/api/home-costs/users/1', 1, { kind: 'users', id: '1' }, { melloRoosAnnual: 0 });
check('an unknown kind of home is refused (no table name injection)', r.status === 404);
r = await call(costsApi.onRequestPut, 'PUT', '/api/home-costs/pre_listing/10', 1, { kind: 'pre_listing', id: '10' }, { melloRoosAnnual: -5 });
check('a negative amount is refused', r.status === 400);
r = await call(detail.onRequestGet, 'GET', '/api/pre-listings/10', 3, P);
check('agents see the snapshot on the pre-listing', r.json.preListing.costs.melloRoosAnnual === 3200 && r.json.preListing.costs.hoaMonthly === 0);

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
