// Runs the real pre-listing handlers for batch R3-1a "You're in Control" (asking price left blank, pause new
// proposals, share my contact info, who saw my address, one waiting showing request, the contact dial on showings
// and proposal edits, DRE identity fields, invites camelCase) against an in-memory SQLite stand-in for D1. Emails
// are captured by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/prelisting-control-test.mjs <projectRoot>
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
const call = async (handler, method, path, who, params = {}, body) => {
  // The withdraw-and-resend rounds below go past the per-home proposal limit (batch L1, rateLimits.js); the limits
  // are covered by tools/abuse-test.mjs, so each call here starts with a clean action log.
  sqlite.prepare('DELETE FROM user_action_log').run();
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, json: type.includes('json') ? await res.json() : null };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const notes = (uid, like) => q('SELECT body, link FROM notifications WHERE user_id = ? AND body LIKE ? ORDER BY id', uid, like);
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
console.log = () => {};

// 1 homeowner A (has a phone), 2 agent G, 3 agent H, 4 pending agent, 5 plain user C, 6 agent K, 7 second homeowner,
// 9 approved agent who never engaged, 30-32 buyers.
const user = (id, extra = {}) => {
  sqlite.prepare('INSERT INTO users (id, email, display_name, phone) VALUES (?, ?, ?, ?)').run(id, `u${id}@example.test`, `User ${id}`, extra.phone ?? null);
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
};
user(1, { phone: '619-555-0101' }); for (const id of [2, 3, 4, 5, 6, 7, 9]) user(id);
const agent = (id, status, lic, brok) => sqlite.prepare('INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, ?, ?, ?)').run(id, status, lic, brok);
agent(2, 'approved', '01234567', 'Pacific Realty'); agent(3, 'approved', '07654321', 'Bay Homes'); agent(4, 'pending', '01111111', 'Pending Realty');
agent(6, 'approved', '02222222', 'Coast Homes'); agent(9, 'approved', '03333333', 'Quiet Realty');
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address)
  VALUES (10, 1, 'Sunny Home', 'Chula Vista', 'CA', '91913', 'Single Family Home', 4, 3, 750000, '456 Hidden Ave')`).run();

const pl = await mod('functions/_lib/preListings.js');
const index = await mod('functions/api/pre-listings/index.js');
const detail = await mod('functions/api/pre-listings/[id].js');
const bids = await mod('functions/api/pre-listings/[id]/bids/index.js');
const votes = await mod('functions/api/pre-listings/[id]/votes/index.js');
const showings = await mod('functions/api/pre-listings/[id]/showings/index.js');
const showing = await mod('functions/api/pre-listings/[id]/showings/[showingId].js');
const previews = await mod('functions/api/pre-listings/[id]/previews/index.js');
const preview = await mod('functions/api/pre-listings/[id]/previews/[previewId].js');
const shares = await mod('functions/api/pre-listings/[id]/contact-shares/index.js');
const unshare = await mod('functions/api/pre-listings/[id]/contact-shares/[agentId].js');
const P10 = { id: '10' };
const base = { city: 'Chula Vista', state: 'CA', zip: '91913', propertyType: 'Single Family Home', beds: 3, baths: 2, occupancyStatus: 'occupied' };

// --- Asking price can be left blank ---
const PRICE_ERR = 'Enter an asking price as a whole-dollar amount, or leave it blank.';
const FILL_ERR = 'Fill in city, state, property type, beds, and baths.';
for (const [raw, want] of [['', 0], [null, 0], ['   ', 0], ['0', 0], [0, 0], ['$750,000', 750000], ['750 000', 750000], [750000, 750000], ['750000.00', 750000], ['1000', 1000], ['500000000', 500000000]]) {
  const v = pl.validatePreListingInput({ ...base, askingPrice: raw });
  check(`asking price ${JSON.stringify(raw)} -> ${want}${want ? '' : ' (open to price opinions)'}`, !v.error && v.data.askingPrice === want && v.data.priceOpen === (want === 0), JSON.stringify(v));
}
check('a missing asking price is open to price opinions (no more $1)', pl.validatePreListingInput({ ...base }).data.askingPrice === 0);
for (const raw of ['999', '1', '750000.5', 'abc', '-5', '500000001', '1e6', '$7.5M']) {
  const v = pl.validatePreListingInput({ ...base, askingPrice: raw });
  check(`asking price ${JSON.stringify(raw)} is refused with the friendly message`, v.error === PRICE_ERR, JSON.stringify(v));
}
for (const [label, over] of [['blank beds', { beds: '' }], ['missing beds', { beds: undefined }], ['null baths', { baths: null }], ['blank baths', { baths: ' ' }]]) {
  check(`${label} is refused (beds and baths are required)`, pl.validatePreListingInput({ ...base, askingPrice: '', ...over }).error === FILL_ERR);
}
check('a typed 0 beds is fine (a studio)', pl.validatePreListingInput({ ...base, beds: 0, baths: '1' }).data.beds === 0);
check('priceIsOpen: 0 and the old $1 blank are open; $1,000 is a price', pl.priceIsOpen(0) && pl.priceIsOpen(1) && pl.priceIsOpen(null) && !pl.priceIsOpen(1000));

let r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 1, {}, { ...base, title: 'Open Home', askingPrice: '', address: '789 Open St' });
const OPEN = r.json && r.json.id;
const PO = { id: String(OPEN) };
check('posting with the price left blank works and stores 0', r.status === 201 && one('SELECT asking_price FROM pre_listings WHERE id = ?', OPEN).asking_price === 0, JSON.stringify(r));
const alert = sent.find(m => m.to === 'rudypabloflores@gmail.com' && /New pre-listing/.test(m.subject));
check('the admin alert says "Asking: open to price opinions"', !!alert && alert.text.includes('Asking: open to price opinions') && !alert.text.includes('$0'), alert && alert.text);
r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 1, {}, { ...base, askingPrice: '999' });
check('posting a sub-$1,000 price is refused', r.status === 400 && r.json.error === PRICE_ERR);
r = await call(index.onRequestPost, 'POST', '/api/pre-listings', 1, {}, { ...base, beds: '', askingPrice: 700000 });
check('posting with beds left blank is refused', r.status === 400 && r.json.error === FILL_ERR);

r = await call(detail.onRequestGet, 'GET', '/x', 1, PO);
check('the detail says priceOpen with askingPrice 0', r.json.preListing.priceOpen === true && r.json.preListing.askingPrice === 0 && r.json.preListing.proposalsPaused === false, JSON.stringify(r.json.preListing).slice(0, 200));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
check('a priced home says priceOpen false', r.json.preListing.priceOpen === false && r.json.preListing.askingPrice === 750000);
r = await call(index.onRequestGet, 'GET', '/api/pre-listings', 2);
const openCard = r.json.preListings.find(p => p.id === OPEN);
check('the browse list carries priceOpen, proposalsPaused and a 0 price point', openCard && openCard.priceOpen === true && openCard.askingPrice === 0 && openCard.proposalsPaused === false && JSON.stringify(openCard.priceSeries) === '[0]', JSON.stringify(openCard));
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price) VALUES (51, 7, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 1)`).run();
r = await call(detail.onRequestGet, 'GET', '/x', 2, { id: '51' });
check('an older home saved as $1 by the blank-price bug reads as open to price opinions', r.json.preListing.priceOpen === true && r.json.preListing.askingPrice === 0);

// --- Price opinions on a home with no price ---
const NO_PRICE_ERR = "This homeowner hasn't set a price yet. Share your suggested list price.";
r = await call(votes.onRequestPost, 'POST', '/x', 2, PO, { vote: 'too_high' });
check('a vote alone on a no-price home is refused: a suggested price is needed', r.status === 400 && r.json.error === NO_PRICE_ERR, JSON.stringify(r.json));
r = await call(votes.onRequestPost, 'POST', '/x', 2, PO, { vote: 'too_high', priceOpinion: 800000, note: 'Recent sales nearby.', comps: [{ address: '1 Elm St', soldPrice: 790000 }] });
check('a suggested price on a no-price home is saved', r.status === 200 && one('SELECT price_opinion FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = 2', OPEN).price_opinion === 800000, JSON.stringify(r.json));
check('...and the vote sent along is ignored, not stored', one('SELECT COUNT(*) AS n FROM pre_listing_price_votes WHERE pre_listing_id = ?', OPEN).n === 0);
let opNotes = notes(1, '%shared a price opinion on your home.');
check('the owner is told, with the agent\'s DRE identity line', opNotes.length === 1 && opNotes[0].body === 'User 2 · DRE #01234567 · Pacific Realty shared a price opinion on your home.' && opNotes[0].link === `/app#pre-listing-${OPEN}`, JSON.stringify(opNotes));
check('...and by email', sent.some(m => m.to === 'u1@example.test' && /price opinion/i.test(m.subject)));
await call(votes.onRequestPost, 'POST', '/x', 2, PO, { priceOpinion: 810000, comps: [] });
check('updating the opinion does not notify again (once per agent)', notes(1, '%shared a price opinion on your home.').length === 1);
await call(votes.onRequestPost, 'POST', '/x', 3, PO, { priceOpinion: 820000 });
check("a second agent's first opinion does notify", notes(1, '%shared a price opinion on your home.').length === 2);
r = await call(votes.onRequestGet, 'GET', '/x', 6, PO);
check('an agent sees how many agents shared a price opinion (sealed, count only)', r.json.votes.sealed === true && r.json.votes.total === 2 && r.json.votes.opinionCount === 2 && r.json.votes.priceOpen === true, JSON.stringify(r.json.votes));
r = await call(votes.onRequestGet, 'GET', '/x', 1, PO);
check('the owner sees the same count', r.json.votes.opinionCount === 2 && r.json.votes.total === 2 && !r.json.votes.sealed);
r = await call(detail.onRequestGet, 'GET', '/x', 1, PO);
const opG = r.json.priceOpinions.opinions.find(o => o.agentUserId === 2);
check('price opinions carry the DRE number and brokerage', opG && opG.licenseNumber === '01234567' && opG.brokerageName === 'Pacific Realty' && opG.priceOpinion === 810000, JSON.stringify(opG));
check('...and the detail tally counts opinions', r.json.preListing.votes.opinionCount === 2);
r = await call(votes.onRequestPost, 'POST', '/x', 2, P10, { vote: 'too_high' });
check('on a priced home a plain vote still works as before', r.status === 200 && notes(1, 'User 2 · DRE #01234567 · Pacific Realty says your asking price looks too high.').length === 1);
r = await call(votes.onRequestGet, 'GET', '/x', 2, P10);
check('...and its tally is a vote tally', r.json.votes.too_high === 1 && r.json.votes.priceOpen === false && r.json.votes.opinionCount === undefined, JSON.stringify(r.json.votes));

// --- Switching between a price and blank is a price change ---
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price) VALUES (52, 1, 'Edit Me', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 650000)`).run();
const P12 = { id: '52' };
await call(votes.onRequestPost, 'POST', '/x', 3, P12, { vote: 'just_right' });
const editBody = { ...base, title: 'Edit Me', propertyType: 'Condo' };
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P12, { ...editBody, askingPrice: '' });
const hist = () => q('SELECT old_price, new_price FROM pre_listing_price_history WHERE pre_listing_id = 52 ORDER BY id').map(h => `${h.old_price}>${h.new_price}`).join(',');
check('clearing the price clears the votes and logs 650000 -> 0', r.status === 200 && r.json.votesCleared === 1 && r.json.priceOpen === true && hist() === '650000>0', JSON.stringify(r.json) + hist());
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P12, { ...editBody, askingPrice: null });
check('saving it blank again is no change', r.json.votesCleared === 0 && hist() === '650000>0');
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P12, { ...editBody, askingPrice: '$660,000' });
check('setting a price again logs 0 -> 660000', r.json.priceOpen === false && hist() === '650000>0,0>660000' && one('SELECT asking_price FROM pre_listings WHERE id = 52').asking_price === 660000);
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P12, { ...editBody, askingPrice: 'abc' });
check('a bad price on edit is refused and changes nothing', r.status === 400 && r.json.error === PRICE_ERR && one('SELECT asking_price FROM pre_listings WHERE id = 52').asking_price === 660000);
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P12, { ...editBody, askingPrice: 660000, baths: '' });
check('blank baths on edit is refused', r.status === 400 && r.json.error === FILL_ERR);

// --- Demand meter: a no-price home matches on area and type ---
for (const id of [30, 31, 32]) {
  user(id);
  sqlite.prepare("INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max) VALUES (?, 'Chula Vista', 'Any', 100000, 200000)").run(id);
}
r = await call(detail.onRequestGet, 'GET', '/x', 1, PO);
check('buyers whose price range is far off still count for a no-price home', r.json.preListing.buyerDemand === 3, String(r.json.preListing.buyerDemand));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
check('...but not for a $750,000 home', r.json.preListing.buyerDemand === null, String(r.json.preListing.buyerDemand));

// --- Pause new proposals ---
const bidBody = { message: 'My plan for your home', commissionPct: 2.5 };
r = await call(bids.onRequestPost, 'POST', '/x', 2, P10, bidBody);
check('an agent sends a proposal while open', r.status === 201);
for (const [who, want, label] of [[5, 403, 'a stranger'], [2, 403, 'an agent with a proposal'], [null, 401, 'anonymous']]) {
  r = await call(detail.onRequestPut, 'PUT', '/x', who, P10, { action: 'pause' });
  check(`${label} can't pause someone else's pre-listing`, r.status === want && one('SELECT proposals_paused FROM pre_listings WHERE id = 10').proposals_paused === 0, `status ${r.status}`);
}
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P10, { action: 'pause' });
check('the owner pauses new proposals', r.status === 200 && r.json.ok === true && r.json.proposalsPaused === true && one('SELECT proposals_paused FROM pre_listings WHERE id = 10').proposals_paused === 1, JSON.stringify(r.json));
r = await call(bids.onRequestPost, 'POST', '/x', 3, P10, bidBody);
check('while paused, a new proposal is refused with code proposals_paused', r.status === 400 && r.json.code === 'proposals_paused' && r.json.error === "This homeowner has paused new proposals for now. Check back soon: you'll be able to send one when they reopen.", JSON.stringify(r.json));
r = await call(bids.onRequestPost, 'POST', '/x', 2, P10, { ...bidBody, message: 'Updated plan' });
check('...but an agent who already sent one can still update it', r.status === 201 && one("SELECT message FROM service_bids WHERE request_id = 10 AND agent_user_id = 2").message === 'Updated plan');
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 10, 6, 'old', 2, 'withdrawn')").run();
r = await call(bids.onRequestPost, 'POST', '/x', 6, P10, bidBody);
check('...and a withdrawn one can\'t be sent again while paused', r.status === 400 && r.json.code === 'proposals_paused' && one("SELECT status FROM service_bids WHERE request_id = 10 AND agent_user_id = 6").status === 'withdrawn');
// An agent the owner invited can still send one: the invite is the owner asking for it.
user(11); agent(11, 'approved', '04444444', 'Invite Realty');
r = await call(detail.onRequestGet, 'GET', '/x', 11, P10);
check('(setup) an agent with no invite sees the paused form', r.json.preListing.proposalsPaused === true && !r.json.preListing.invitedByOwner);
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 10, 11, 1)").run();
r = await call(detail.onRequestGet, 'GET', '/x', 11, P10);
check('an invited agent is told they can still propose while paused', r.json.preListing.invitedByOwner === true);
r = await call(bids.onRequestPost, 'POST', '/x', 11, P10, bidBody);
check('...and their proposal goes through', r.status === 201 && one("SELECT status FROM service_bids WHERE request_id = 10 AND agent_user_id = 11").status === 'pending', JSON.stringify(r.json));
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 10, 3, 7)").run();
r = await call(bids.onRequestPost, 'POST', '/x', 3, P10, bidBody);
check("...but an invite from someone other than the owner doesn't count", r.status === 400 && r.json.code === 'proposals_paused');
sqlite.prepare('DELETE FROM agent_invites WHERE request_id = 10').run();
sqlite.prepare('DELETE FROM service_bids WHERE agent_user_id = 11').run();
for (const who of [1, 3]) {
  r = await call(detail.onRequestGet, 'GET', '/x', who, P10);
  check(`viewer ${who} sees proposalsPaused in the detail`, r.json.preListing.proposalsPaused === true);
}
// Batch L1: only approved agents (and the owner/admins) open a pre-listing; a plain user gets 403 agents_only.
r = await call(detail.onRequestGet, 'GET', '/x', 5, P10);
check('a plain user (5) gets 403 agents_only on the detail', r.status === 403 && r.json.code === 'agents_only', JSON.stringify(r.json));
r = await call(index.onRequestGet, 'GET', '/api/pre-listings', 3);
check('...and in the browse list', r.json.preListings.find(p => p.id === 10).proposalsPaused === true);
r = await call(detail.onRequestPut, 'PUT', '/x', 1, P10, { action: 'resume' });
check('the owner resumes proposals', r.status === 200 && r.json.proposalsPaused === false && one('SELECT proposals_paused FROM pre_listings WHERE id = 10').proposals_paused === 0);
r = await call(bids.onRequestPost, 'POST', '/x', 3, P10, bidBody);
check('...and new proposals come in again', r.status === 201);
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, status) VALUES (53, 1, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, 'closed')").run();
r = await call(detail.onRequestPut, 'PUT', '/x', 1, { id: '53' }, { action: 'pause' });
check('a closed pre-listing can\'t be paused', r.status === 400);

// --- Proposal edits stay quiet for an owner on Weekly or Quiet ---
// (Alerts to a homeowner carry the agent's DRE identity line.)
const editNotes = () => notes(1, 'User 2 · DRE #01234567 · Pacific Realty updated their proposal.').length;
let before = editNotes();
await call(bids.onRequestPost, 'POST', '/x', 2, P10, { ...bidBody, message: 'Edit while open' });
check('an edit notifies an owner on Open (as before)', editNotes() === before + 1);
for (const mode of ['weekly', 'quiet']) {
  sqlite.prepare('UPDATE users SET contact_mode = ? WHERE id = 1').run(mode);
  before = editNotes();
  await call(bids.onRequestPost, 'POST', '/x', 2, P10, { ...bidBody, message: `Edit while ${mode}` });
  check(`an edit doesn't re-notify an owner on ${mode}`, editNotes() === before);
}
sqlite.prepare("DELETE FROM service_bids WHERE request_id = 10 AND agent_user_id = 6").run();
r = await call(bids.onRequestPost, 'POST', '/x', 6, P10, bidBody);
check('a NEW proposal still notifies an owner on quiet', r.status === 201 && notes(1, 'User 6 · DRE #02222222 · Coast Homes submitted a proposal.').length === 1);
// Withdraw-and-resend isn't a way around Weekly/Quiet: only an agent's first proposal alerts those owners.
const bidOne = await mod('functions/api/pre-listings/[id]/bids/[bidId].js');
const kNotes = () => notes(1, 'User 6 · DRE #02222222 · Coast Homes %').length;
const kMails = () => sent.filter(m => m.to === 'u1@example.test' && /proposal/i.test(m.subject)).length;
const k6 = () => one("SELECT id, status FROM service_bids WHERE request_type = 'pre_listing' AND request_id = 10 AND agent_user_id = 6");
for (const mode of ['quiet', 'weekly']) {
  sqlite.prepare('UPDATE users SET contact_mode = ? WHERE id = 1').run(mode);
  const n0 = kNotes();
  const m0 = kMails();
  let resent = true;
  for (let round = 1; round <= 3; round++) {
    const w = await call(bidOne.onRequestPut, 'PUT', '/x', 6, { id: '10', bidId: String(k6().id) }, { action: 'withdraw' });
    const s = await call(bids.onRequestPost, 'POST', '/x', 6, P10, { ...bidBody, message: `ping ${round}: please reply` });
    resent = resent && w.status === 200 && s.status === 201 && k6().status === 'pending';
  }
  check(`${mode}: withdrawing and re-sending a proposal 3 times sends the owner no new alert or email`, resent && kNotes() === n0 && kMails() === m0, `${kNotes() - n0} alerts, ${kMails() - m0} emails`);
}
sqlite.prepare("UPDATE users SET contact_mode = 'open' WHERE id = 1").run();
{
  const n0 = kNotes();
  await call(bidOne.onRequestPut, 'PUT', '/x', 6, { id: '10', bidId: String(k6().id) }, { action: 'withdraw' });
  await call(bids.onRequestPost, 'POST', '/x', 6, P10, { ...bidBody, message: 'Back again' });
  check('open: a proposal sent again after withdrawing still alerts the owner (as before)', kNotes() === n0 + 1 && notes(1, 'User 6 · DRE #02222222 · Coast Homes submitted a proposal.').length >= 2);
}

// --- Showing requests: one waiting per agent, identity fields, Quiet mode ---
r = await call(showings.onRequestPost, 'POST', '/x', 2, P10, { proposedAt: future(48), note: 'Saturday?' });
const S1 = r.json && r.json.id;
check('an agent requests a showing', r.status === 201 && S1);
r = await call(showings.onRequestPost, 'POST', '/x', 2, P10, { proposedAt: future(72) });
check('a second request while one is waiting is refused with code showing_pending', r.status === 400 && r.json.code === 'showing_pending' && r.json.error === 'You already have a showing request waiting for this home. You can change it or cancel it first.', JSON.stringify(r.json));
check('...and only one request was stored', one("SELECT COUNT(*) AS n FROM pre_listing_showings WHERE pre_listing_id = 10 AND agent_user_id = 2").n === 1);
r = await call(showings.onRequestGet, 'GET', '/x', 1, P10);
const sRow = r.json.showings.find(s => s.id === S1);
check('the owner\'s showing list carries the DRE number and brokerage', sRow && sRow.agentName === 'User 2' && sRow.agentLicenseNumber === '01234567' && sRow.agentBrokerageName === 'Pacific Realty', JSON.stringify(sRow));
await call(showing.onRequestPut, 'PUT', '/x', 2, { id: '10', showingId: String(S1) }, { action: 'cancel' });
r = await call(showings.onRequestPost, 'POST', '/x', 2, P10, { proposedAt: future(72) });
check('after canceling, the agent can ask again', r.status === 201);
r = await call(showings.onRequestPost, 'POST', '/x', 3, P10, { proposedAt: future(50) });
check('another agent can have their own waiting request', r.status === 201);
sqlite.prepare("UPDATE users SET contact_mode = 'quiet' WHERE id = 1").run();
sqlite.prepare("UPDATE pre_listing_showings SET status = 'declined' WHERE pre_listing_id = 10").run();
r = await call(showings.onRequestPost, 'POST', '/x', 3, P10, { proposedAt: future(60) });
check('Quiet: a showing request from an agent is refused with code contact_quiet', r.status === 403 && r.json.code === 'contact_quiet' && r.json.error === 'This homeowner has chosen Quiet mode, so showing requests are off for now. A price opinion or a proposal reaches them right away.', JSON.stringify(r.json));
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', 10, 6, 1)").run();
r = await call(showings.onRequestPost, 'POST', '/x', 6, P10, { proposedAt: future(60) });
check('Quiet: an agent the owner invited is exempt', r.status === 201, JSON.stringify(r.json));
sqlite.prepare("UPDATE users SET contact_mode = 'weekly' WHERE id = 1").run();
r = await call(showings.onRequestPost, 'POST', '/x', 3, P10, { proposedAt: future(60) });
check('Weekly: showing requests still go through', r.status === 201, JSON.stringify(r.json));
sqlite.prepare("UPDATE users SET contact_mode = 'open' WHERE id = 1").run();

// --- Share my contact info with this agent ---
const SHARE_ERR = "You can share with agents who've sent you a proposal, opinion or request for this home.";
r = await call(shares.onRequestPost, 'POST', '/x', null, P10, { agentId: 2 });
check('sharing needs sign-in', r.status === 401);
for (const [who, label] of [[5, 'a stranger'], [2, 'the agent themself'], [3, 'another agent']]) {
  r = await call(shares.onRequestPost, 'POST', '/x', who, P10, { agentId: 2 });
  check(`${label} can't share the owner's contact info`, r.status === 403, `status ${r.status}`);
}
check('...and no share row exists', one('SELECT COUNT(*) AS n FROM contact_shares').n === 0);
r = await call(shares.onRequestPost, 'POST', '/x', 1, { id: '999' }, { agentId: 2 });
check('an unknown pre-listing is a 404', r.status === 404);
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 9 });
check('an agent who never engaged with this home can\'t be shared with', r.status === 400 && r.json.error === SHARE_ERR, JSON.stringify(r.json));
sqlite.prepare("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (10, 4, 'too_low')").run();
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 4 });
check('...nor an agent who isn\'t approved', r.status === 400 && r.json.error === SHARE_ERR);
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 'abc' });
check('...nor a made-up id', r.status === 400);
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 2 });
const share1 = r.json && r.json.share;
check('the owner shares with an agent who sent a proposal', r.status === 200 && r.json.ok === true && share1 && share1.agentId === 2 && !!share1.sharedAt, JSON.stringify(r.json));
const shareNote = notes(2, '%shared their contact info with you%');
check('the agent is told in-app (and by email)', shareNote.length === 1 && shareNote[0].body === 'User 1 shared their contact info with you for Sunny Home.' && shareNote[0].link === '/app#pre-listing-10' && sent.some(m => m.to === 'u2@example.test' && /shared their contact info/.test(m.subject)), JSON.stringify(shareNote));
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 2 });
check('sharing again is fine: same time, no second notice', r.status === 200 && r.json.share.sharedAt === share1.sharedAt && notes(2, '%shared their contact info with you%').length === 1 && one('SELECT COUNT(*) AS n FROM contact_shares').n === 1);

r = await call(detail.onRequestGet, 'GET', '/x', 2, P10);
const sc = r.json.preListing.sharedContact;
check('the agent now sees the exact address, phone and email', sc && sc.address === '456 Hidden Ave' && sc.phone === '619-555-0101' && sc.email === 'u1@example.test' && sc.ownerName === 'User 1' && sc.sharedAt === share1.sharedAt, JSON.stringify(sc));
check('...in sharedContact only (the top-level address stays hidden) and never the owner-only lists', r.json.preListing.address === undefined && !('contactShares' in r.json.preListing) && !('addressViews' in r.json.preListing));
const view = () => one("SELECT view_count FROM address_views WHERE pre_listing_id = 10 AND agent_id = 2 AND via = 'share'");
check('...and the look is logged via share', view() && view().view_count === 1);
await call(detail.onRequestGet, 'GET', '/x', 2, P10);
check('a second look counts up on the same row', view().view_count === 2 && one('SELECT COUNT(*) AS n FROM address_views').n === 1);
// (5, a plain user, can't open the detail at all since batch L1; checked above.)
for (const who of [3, 6]) {
  r = await call(detail.onRequestGet, 'GET', '/x', who, P10);
  const p = r.json.preListing;
  check(`viewer ${who} gets no address, no sharedContact and no owner lists`, p.address === undefined && p.sharedContact === undefined && p.contactShares === undefined && p.addressViews === undefined && !JSON.stringify(r.json).includes('456 Hidden') && !JSON.stringify(r.json).includes('619-555-0101'));
}
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
const cs = r.json.preListing.contactShares;
const av = r.json.preListing.addressViews;
check('the owner sees who they shared with (with DRE identity)', cs.length === 1 && cs[0].agentId === 2 && cs[0].agentName === 'User 2' && cs[0].licenseNumber === '01234567' && cs[0].brokerageName === 'Pacific Realty' && cs[0].sharedAt === share1.sharedAt, JSON.stringify(cs));
check('...and who saw the address', av.length === 1 && av[0].agentId === 2 && av[0].via === 'share' && av[0].viewCount === 2 && av[0].licenseNumber === '01234567' && !!av[0].firstSeenAt && !!av[0].lastSeenAt, JSON.stringify(av));
r = await call(shares.onRequestPost, 'POST', '/x', 1, PO, { agentId: 3 });
check('a price opinion counts as engaging (share on the no-price home)', r.status === 200);
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 6 });
check('so does a showing request', r.status === 200);

for (const [who, want, label] of [[2, 403, 'the agent'], [5, 403, 'a stranger'], [null, 401, 'anonymous']]) {
  r = await call(unshare.onRequestDelete, 'DELETE', '/x', who, { id: '10', agentId: '2' });
  check(`${label} can't stop the owner's share`, r.status === want && one('SELECT COUNT(*) AS n FROM contact_shares WHERE pre_listing_id = 10 AND agent_id = 2').n === 1, `status ${r.status}`);
}
r = await call(unshare.onRequestDelete, 'DELETE', '/x', 1, { id: '999', agentId: '2' });
check('stop sharing on an unknown pre-listing is a 404', r.status === 404);
r = await call(unshare.onRequestDelete, 'DELETE', '/x', 1, { id: '10', agentId: '2' });
check('the owner stops sharing', r.status === 200 && r.json.ok === true && one('SELECT COUNT(*) AS n FROM contact_shares WHERE pre_listing_id = 10 AND agent_id = 2').n === 0);
r = await call(detail.onRequestGet, 'GET', '/x', 2, P10);
check('...and the agent no longer sees it', r.json.preListing.sharedContact === undefined && !JSON.stringify(r.json).includes('456 Hidden'));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
check('...while "Who saw my address" keeps the record', r.json.preListing.addressViews.some(v => v.agentId === 2 && v.via === 'share') && !r.json.preListing.contactShares.some(s => s.agentId === 2));

// A closed home: no new shares, and an earlier share stops showing.
sqlite.prepare("INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address) VALUES (54, 1, 'Wrapping Up', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000, '1 Done Ln')").run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 54, 2, 'x', 2, 'pending')").run();
r = await call(shares.onRequestPost, 'POST', '/x', 1, { id: '54' }, { agentId: 2 });
check('share on another home', r.status === 200);
await call(detail.onRequestPut, 'PUT', '/x', 1, { id: '54' }, { action: 'close' });
r = await call(detail.onRequestGet, 'GET', '/x', 2, { id: '54' });
check('once the home is closed, the shared contact is no longer shown', r.json.preListing.sharedContact === undefined);
r = await call(shares.onRequestPost, 'POST', '/x', 1, { id: '54' }, { agentId: 2 });
check('...and a closed home takes no new shares', r.status === 400);
sqlite.prepare("INSERT INTO address_views (pre_listing_id, agent_id, via) VALUES (54, 2, 'share')").run();
r = await call(detail.onRequestDelete, 'DELETE', '/x', 1, { id: '54' });
check('deleting the pre-listing deletes its shares and its "who saw my address" rows', r.status === 200 && one('SELECT COUNT(*) AS n FROM contact_shares WHERE pre_listing_id = 54').n === 0 && one('SELECT COUNT(*) AS n FROM address_views WHERE pre_listing_id = 54').n === 0, `status ${r.status}`);
sqlite.prepare("UPDATE users SET phone = NULL WHERE id = 1").run();
sqlite.prepare("INSERT OR IGNORE INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (10, 1, 2)").run();
r = await call(detail.onRequestGet, 'GET', '/x', 2, P10);
check("an owner with no phone on file shares phone ''", r.json.preListing.sharedContact && r.json.preListing.sharedContact.phone === '');
sqlite.prepare("UPDATE users SET phone = '619-555-0101' WHERE id = 1").run();

// --- Broker preview RSVPs are logged too ---
r = await call(previews.onRequestPost, 'POST', '/x', 1, P10, { startsAt: future(30), endsAt: future(32) });
const PV = r.json && r.json.id;
await call(preview.onRequestPut, 'PUT', '/x', 9, { id: '10', previewId: String(PV) }, { going: true });
r = await call(previews.onRequestGet, 'GET', '/x', 9, P10);
const pview = () => one("SELECT view_count FROM address_views WHERE pre_listing_id = 10 AND agent_id = 9 AND via = 'preview'");
check('an agent who RSVP\'d gets the address and the look is logged via preview', r.json.address === '456 Hidden Ave' && pview() && pview().view_count === 1, JSON.stringify(r.json));
await call(previews.onRequestGet, 'GET', '/x', 9, P10);
check('...counting each look', pview().view_count === 2);
await call(previews.onRequestGet, 'GET', '/x', 3, P10);
r = await call(previews.onRequestGet, 'GET', '/x', 1, P10);
const rsvpAgent = r.json.previews[0].agents[0];
check("the owner's RSVP list carries the agent's DRE number and brokerage", rsvpAgent.agentUserId === 9 && rsvpAgent.licenseNumber === '03333333' && rsvpAgent.brokerageName === 'Quiet Realty', JSON.stringify(rsvpAgent));
check("an agent who didn't RSVP (and the owner) aren't logged", !one("SELECT 1 FROM address_views WHERE agent_id IN (1, 3)"));
r = await call(detail.onRequestGet, 'GET', '/x', 1, P10);
check('the owner\'s list shows the preview look with its DRE identity', r.json.preListing.addressViews.some(v => v.agentId === 9 && v.via === 'preview' && v.viewCount === 2 && v.licenseNumber === '03333333'), JSON.stringify(r.json.preListing.addressViews));
r = await call(shares.onRequestPost, 'POST', '/x', 1, P10, { agentId: 9 });
check('a preview RSVP counts as engaging', r.status === 200);

// --- Agent invites and the agent's own proposals: camelCase price + priceOpen ---
const { fetchMyInvites } = await mod('functions/_lib/agentInvites.js');
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id) VALUES ('pre_listing', ?, 9, 1), ('pre_listing', 10, 9, 1)").run(OPEN);
const inv = await fetchMyInvites(DB, 9);
const invOpen = inv.find(i => i.requestId === OPEN).preListing;
const invPriced = inv.find(i => i.requestId === 10).preListing;
check('invites return askingPrice (camelCase) and priceOpen', invOpen.askingPrice === 0 && invOpen.priceOpen === true && invPriced.askingPrice === 750000 && invPriced.priceOpen === false && !('asking_price' in invPriced), JSON.stringify(inv));
const { fetchAgentOwnBids } = await mod('functions/_lib/marketplace.js');
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', ?, 3, 'x', 2, 'pending')").run(OPEN);
const own = await fetchAgentOwnBids(DB, 3);
const ownOpen = own.find(b => b.requestId === OPEN).preListing;
check("an agent's own proposal list says priceOpen too", ownOpen.priceOpen === true && ownOpen.askingPrice === 0 && ownOpen.proposalsPaused === false, JSON.stringify(ownOpen));

// --- Agent identity in the homeowner's alerts and interview list (California DRE rule at a point of contact) ---
check("the owner's broker-preview RSVP alert carries the agent's DRE identity line",
  notes(1, "User 9 · DRE #03333333 · Quiet Realty RSVP'd to your broker preview%").length >= 1, JSON.stringify(notes(1, '%RSVP%')));
check("the owner's showing-request alert carries the agent's DRE identity line",
  notes(1, '% · DRE #% requested a showing for %').length >= 1 && notes(1, '%requested a showing%').every(n => n.body.includes(' · DRE #')), JSON.stringify(notes(1, '%requested a showing%')));
const interviews = await mod('functions/api/pre-listings/[id]/interviews/index.js');
sqlite.prepare("INSERT OR IGNORE INTO pre_listing_interviews (pre_listing_id, agent_user_id, format, slots_json) VALUES (10, 2, 'video', ?)").run(JSON.stringify([future(48)]));
r = await call(interviews.onRequestGet, 'GET', '/x', 1, P10);
const iv2 = r.json && r.json.interviews.find(i => i.agentUserId === 2);
check("the owner's interview list carries the agent's DRE number and brokerage", iv2 && iv2.licenseNumber === '01234567' && iv2.brokerageName === 'Pacific Realty', JSON.stringify(r.json));

// --- A held "new pre-listing near you" email is dropped once the owner pauses new proposals ---
const { runDueHeldEmails } = await mod('functions/_lib/agentDuty.js');
sqlite.prepare(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price)
  VALUES (60, 7, 'Still Open', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 600000)`).run();
sqlite.prepare("UPDATE pre_listings SET status = 'open', proposals_paused = 1 WHERE id = 10").run();
const past = new Date(Date.now() - 60000).toISOString();
const hold = sqlite.prepare("INSERT INTO held_emails (user_id, kind, ref, subject, text_body, deliver_after) VALUES (?, 'new_request', ?, 'New pre-listing near you on Amico Haus', ?, ?)");
hold.run(3, 'pre_listing:10', 'A new pre-listing opened for proposals near you. (paused home)', past);
hold.run(6, 'pre_listing:60', 'A new pre-listing opened for proposals near you. (open home)', past);
sent.length = 0;
await runDueHeldEmails({ env, request: new Request('https://amicohaus.com/api/x') }, { budgetMs: 5000 });
check('a held new-request email for a paused home is dropped', !sent.some(m => JSON.stringify(m).includes('(paused home)')), JSON.stringify(sent));
check('...while one for a home still taking proposals goes out', sent.some(m => JSON.stringify(m).includes('(open home)')), JSON.stringify(sent));
sqlite.prepare('UPDATE pre_listings SET proposals_paused = 0 WHERE id = 10').run();

// --- The agent's proposal form while new proposals are paused (main.js renderBidFormAndVote, run on its own) ---
const mainSrc = readFileSync(`${root}/main.js`, 'utf8');
const fnStart = mainSrc.indexOf('function renderBidFormAndVote(');
const fnSrc = mainSrc.slice(fnStart, mainSrc.indexOf('\n}\n', fnStart) + 2);
const renderBidForm = new Function('escapeHtml', 'CONTACT_ERROR_COPY', 'currentAgentPackages', 'PACKAGE_TIER_LABELS', 'money', 'renderPriceOpinionForm',
  `${fnSrc}; return renderBidFormAndVote;`)(
  (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
  { proposals_paused: 'This homeowner has paused new proposals for now.' }, [], {}, (n) => `$${n}`, () => '');
const bidOf = (status) => ({ id: 5, status, message: 'My earlier plan', commissionPct: 2.5, flatFee: null });
const pausedHtml = (b) => renderBidForm(b, null, false, { paused: true });
check('paused, no proposal yet: the paused note, no form', /proposals-paused-panel/.test(pausedHtml(null)) && !/data-action="submit-bid"/.test(pausedHtml(null)));
for (const status of ['withdrawn', 'declined']) {
  const html = pausedHtml(bidOf(status));
  check(`paused, a ${status} proposal: the paused note (with the old text, read-only), not a form the server would refuse`,
    /proposals-paused-panel/.test(html) && !/data-action="submit-bid"/.test(html) && !/Yours is already in/.test(html) && /My earlier plan/.test(html), html.slice(0, 300));
}
const livePaused = pausedHtml(bidOf('pending'));
check('paused, a live (pending) proposal: the form to update it, with the "already in" note', /data-action="submit-bid"/.test(livePaused) && /Update Proposal/.test(livePaused) && /Yours is already in/.test(livePaused));
const notPaused = renderBidForm(bidOf('withdrawn'), null, false, { paused: false });
check('not paused, a withdrawn proposal: the form to send it again, no paused note', /data-action="submit-bid"/.test(notPaused) && !/paused/i.test(notPaused));

// The "New proposals paused" badge group can wrap and shrink inside a card head (no overflow on a 375px phone).
const css = readFileSync(`${root}/styles.css`, 'utf8');
const badgesRule = (css.match(/\.card-badges\s*\{[^}]*\}/) || [''])[0];
check('.card-badges can shrink and wrap (no flex-shrink: 0, min-width: 0)', /flex-wrap:\s*wrap/.test(badgesRule) && /min-width:\s*0/.test(badgesRule) && !/flex-shrink:\s*0/.test(badgesRule), badgesRule);

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
