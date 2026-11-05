// Batch L1, builder B6: the "jury test" grey-area fixes on the server and the remaining pages. Runs the real route
// handlers against an in-memory SQLite stand-in for D1 (schema.sql), with a stubbed fetch (no email goes out) and a
// fake R2 bucket that records deletes. Covers: hire-checklist labels, disputes 410 + read-only history, offer and
// Market Pulse wording, home-trade partner confirmation (+ blocks and limits), soft-hide moderation, past-client
// review fields, Terms acceptance at signup, FinderMine without investment terms, the payment widget, team names,
// life-event labels, owner-entered wording on pages and flyers, and the static pages' copy and footer line.
// Usage: node --disable-warning=ExperimentalWarning tools/grey-area-test.mjs <projectRoot>
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
// A fake R2 bucket: put/get keep bytes in memory, delete records every key asked for.
const r2 = new Map();
const deletedKeys = [];
const PHOTOS = {
  async put(key, body) { r2.set(key, body); },
  async get(key) { return r2.has(key) ? { body: new Uint8Array([1, 2, 3]) } : null; },
  async delete(keys) { for (const k of [].concat(keys)) { deletedKeys.push(k); r2.delete(k); } },
};
const env = { DB, RESEND_API_KEY: 'test-key', PHOTOS };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
globalThis.fetch = async (url, opts) => { try { sent.push(JSON.parse(opts.body)); } catch { sent.push({}); } return new Response('{"id":"x"}', { status: 200 }); };
const call = async (handler, method, path, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${path}`, {
    method,
    headers: { 'CF-Connecting-IP': '203.0.113.9', ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = type.includes('json') || type.includes('html') ? await res.text() : '';
  return { status: res.status, headers: res.headers, text, json: type.includes('json') ? JSON.parse(text) : null };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const notes = (uid, like) => q('SELECT body FROM notifications WHERE user_id = ? AND body LIKE ? ORDER BY id', uid, like);
console.log = () => {};

// People: 1 homeowner A, 2 approved agent G (Pacific Realty), 3 approved agent H (Pacific Realty), 4 pending agent,
// 5 plain user C, 6 approved agent K (Coast Homes), 7 homeowner B (A's trade partner), 8 admin, 9 reviewer R.
const user = (id, name) => {
  run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', id, `u${id}@example.test`, name);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
user(1, 'Alex Rivera'); user(2, 'Gina Flores'); user(3, 'Hank Ortiz'); user(4, 'Pat Pending'); user(5, 'Casey Lee');
user(6, 'Kim Nguyen'); user(7, 'Blake Moreno'); user(8, 'Rudy Admin'); user(9, 'Rae Reviewer');
run("UPDATE users SET role = 'admin' WHERE id = 8");
const agent = (id, status, lic, brok) => run('INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, notify_new_requests) VALUES (?, ?, ?, ?, 1)', id, status, lic, brok);
agent(2, 'approved', '01234567', 'Pacific Realty'); agent(3, 'approved', '07654321', 'Pacific Realty, Inc.');
agent(4, 'pending', '01111111', 'Pending Realty'); agent(6, 'approved', '02222222', 'Coast Homes');

// ===================== 1. Hire checklist labels (#2) =====================
const milestones = await mod('functions/_lib/milestones.js');
await milestones.seedDefaultMilestones(DB, 'pre_listing', 900);
const labels = q("SELECT label FROM bid_milestones WHERE request_type = 'pre_listing' AND request_id = 900 ORDER BY sort_order").map(r => r.label);
check('new hires get the listing-style checklist (no deposits, no paying the agent directly)',
  JSON.stringify(labels) === JSON.stringify(["Listing agreement signed with the agent's brokerage", 'Home prepped and photographed', 'Listed', 'In escrow', 'Closed']), JSON.stringify(labels));
check('no checklist step mentions a deposit or a payment', !labels.some(l => /deposit|payment/i.test(l)));

// ===================== 2. Disputes are replaced (decision 4) =====================
const GONE = 'Disputes have been replaced by Report a rules problem.';
for (const [label, path] of [['pre-listing', 'functions/api/pre-listings/[id]/disputes.js'], ['trade', 'functions/api/transactions/[id]/disputes.js']]) {
  const h = await mod(path);
  const r = await call(h.onRequestPost, 'POST', '/x', 1, { id: '1' }, { reason: 'payment_dispute', description: 'x' });
  check(`a new ${label} dispute answers 410 gone`, r.status === 410 && r.json.code === 'gone' && r.json.error === GONE, r.text);
}
run(`INSERT INTO disputes (id, request_type, request_id, raised_by_user_id, against_user_id, reason, description, status, admin_notes)
     VALUES (1, 'pre_listing', 77, 1, 2, 'payment_dispute', 'old one', 'dismissed', 'Admin wrote this')`);
check('...and no dispute row was added', one('SELECT COUNT(*) AS n FROM disputes').n === 1);
const adminDisputeOne = await mod('functions/api/admin/disputes/[id].js');
let r = await call(adminDisputeOne.onRequestPut, 'PUT', '/x', 8, { id: '1' }, { status: 'resolved', adminNotes: 'verdict' });
check('the admin can no longer rule on a dispute (410)', r.status === 410 && r.json.code === 'gone');
check('...and the old record is untouched', one('SELECT status, admin_notes FROM disputes WHERE id = 1').admin_notes === 'Admin wrote this');
const adminDisputes = await mod('functions/api/admin/disputes/index.js');
r = await call(adminDisputes.onRequestGet, 'GET', '/api/admin/disputes', 8);
check('the admin dispute screen is read-only history (all statuses by default)', r.status === 200 && r.json.readOnly === true && r.json.disputes.length === 1 && r.json.disputes[0].status === 'dismissed', r.text);
check('...with the payment reason shown as a question for the broker', r.json.disputes[0].reasonLabel === "Fee question (contact the agent's broker)");
r = await call(adminDisputes.onRequestGet, 'GET', '/api/admin/disputes', 1);
check('...and stays admin-only', r.status === 403);
const myDisputes = await mod('functions/api/disputes/index.js');
r = await call(myDisputes.onRequestGet, 'GET', '/api/disputes', 2);
const md = r.json.disputes[0];
check("a party's own history shows no admin notes and no verdict", md && md.adminNotes === undefined && md.status === undefined && r.json.notice === GONE, JSON.stringify(r.json));

// ===================== 3. Offers and Market Pulse wording (#4, #5, #10) =====================
const L = (id, uid, extra = {}) => {
  run(`INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, is_rental, rent_amount, life_event_tags_json)
       VALUES (?, ?, ?, 'Chula Vista', 'CA', 'Single Family Home', 3, 2, ?, '600k-1m', ?, ?, ?)`,
    id, uid, extra.title || `Home ${id}`, extra.value || 700000, extra.rental ? 1 : 0, extra.rent || 0, extra.tags || '[]');
  run(`INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (?, 'Chula Vista', 'Any', 0, 0, 0, 1000000)`, id);
};
L(101, 1, { tags: '["divorce_separation","upsizing_growing_family"]' }); L(102, 7);
run("UPDATE users SET is_verified = 1 WHERE id = 5");
run("INSERT INTO listing_offers (id, listing_id, buyer_user_id, offer_price) VALUES (1, 101, 5, 690000), (2, 101, 9, 680000)");
const listingOffers = await mod('functions/api/listings/[id]/offers/index.js');
r = await call(listingOffers.onRequestGet, 'GET', '/x', 1, { id: '101' });
check('the owner sees offers with no "verified" flag beside the buyer', r.json.offers.length === 2 && r.json.offers.every(o => !('buyerVerified' in o)), JSON.stringify(r.json.offers[0]));
const listingOffer = await mod('functions/api/listings/[id]/offers/[offerId].js');
r = await call(listingOffer.onRequestPut, 'PUT', '/x', 1, { id: '101', offerId: '1' }, { action: 'accept' });
let ev = one("SELECT * FROM market_events WHERE event_type = 'offer_accepted' ORDER BY id DESC LIMIT 1");
check('accepting an offer logs "Offer accepted on Amico Haus in Chula Vista (not a closed sale)" with no amount',
  r.status === 200 && ev && ev.headline === 'Offer accepted on Amico Haus in Chula Vista (not a closed sale)' && ev.amount === null, JSON.stringify(ev));
await call(listingOffer.onRequestPut, 'PUT', '/x', 1, { id: '101', offerId: '2' }, { action: 'counter', counterPrice: 695000 });
await call(listingOffer.onRequestPut, 'PUT', '/x', 9, { id: '101', offerId: '2' }, { action: 'accept_counter' });
ev = one("SELECT * FROM market_events WHERE event_type = 'offer_accepted' ORDER BY id DESC LIMIT 1");
check('an accepted counter-offer logs the same wording, no amount', ev.headline.includes('(not a closed sale)') && !ev.headline.includes('$') && ev.amount === null, ev.headline);

for (const [kind, table, dir] of [['augmented_home', 'augmented_homes', 'augmented-homes'], ['green_home', 'green_homes', 'green-homes']]) {
  run(`INSERT INTO ${table} (id, user_id, title, city, state, property_type, beds, baths, asking_price, life_event_tags_json, mello_roos_annual, hoa_monthly)
       VALUES (201, 1, 'Nice Place', 'Bonita', 'CA', 'Condo', 2, 2, 650000, '["divorce_separation"]', 0, 250)`);
  run(`INSERT INTO ${table.replace(/s$/, '')}_offers (id, ${kind}_id, buyer_user_id, offer_price) VALUES (1, 201, 5, 640000)`);
  const idx = await mod(`functions/api/${dir}/[id]/offers/index.js`);
  r = await call(idx.onRequestGet, 'GET', '/x', 1, { id: '201' });
  check(`${dir}: owner's offer list has no "verified" flag`, r.json.offers.length === 1 && !('buyerVerified' in r.json.offers[0]));
  r = await call(idx.onRequestGet, 'GET', '/x', 5, { id: '201' });
  check(`${dir}: the buyer's own offer has no "verified" flag`, r.json.myOffer && !('buyerVerified' in r.json.myOffer));
  const one2 = await mod(`functions/api/${dir}/[id]/offers/[offerId].js`);
  r = await call(one2.onRequestPut, 'PUT', '/x', 1, { id: '201', offerId: '1' }, { action: 'accept' });
  ev = one('SELECT * FROM market_events WHERE entity_kind = ? ORDER BY id DESC LIMIT 1', kind);
  check(`${dir}: accepted offer reads "Offer accepted on Amico Haus in Bonita (not a closed sale)"`, ev && ev.headline === 'Offer accepted on Amico Haus in Bonita (not a closed sale)' && ev.amount === null, JSON.stringify(ev));
}

const me = await mod('functions/_lib/marketEvents.js');
run(`INSERT INTO market_events (event_type, entity_kind, entity_id, city, state, headline, amount) VALUES
  ('offer_accepted', 'listing', 101, 'Chula Vista', 'CA', 'Deal closed in Chula Vista, CA: $690,000', 690000),
  ('new_listing', 'dev_project', 55, 'San Diego', 'CA', 'New FinderMine project in San Diego, CA: Fix & Flip — $250,000 sought', 250000),
  ('price_drop', 'listing', 101, 'Chula Vista', 'CA', 'Price drop in Chula Vista, CA: $700,000 → $650,000', 650000),
  ('price_drop', 'listing', 101, 'Chula Vista', 'CA', 'Price drop in Chula Vista, CA: $650,000 → $640,000', 640000),
  ('new_listing', 'listing', 102, 'Chula Vista', 'CA', 'New listing: Home in Chula Vista, CA — $700,000', 700000),
  ('open_house_scheduled', 'listing', 102, 'Chula Vista', 'CA', 'Open house scheduled in Chula Vista, CA', NULL)`);
const events = await me.fetchRecentMarketEvents(DB, 50);
check('older "Deal closed ... $X" rows are read back with the new wording and no amount',
  events.filter(e => e.eventType === 'offer_accepted').every(e => e.headline.endsWith('(not a closed sale)') && e.amount === null) && !events.some(e => /Deal closed/.test(e.headline)));
const fm = events.find(e => e.entityKind === 'dev_project');
check('older FinderMine rows lose the "$X sought" and the amount, and "Fix & Flip" reads "Renovation"', fm && fm.headline === 'New FinderMine project in San Diego, CA: Renovation' && fm.amount === null, fm && fm.headline);
const lb = await me.fetchMarketLeaderboard(DB, {});
check('the leaderboard has no "hottest" and no "biggest price drop"', !('hottest' in lb) && !('biggestDrop' in lb), JSON.stringify(lb));
check('..."Most activity this week" counts only new listings and open houses (listing 102, 2 events)', lb.mostActivity && lb.mostActivity.entity_id === 102 && lb.mostActivity.event_count === 2, JSON.stringify(lb.mostActivity));
const trendsRoute = await mod('functions/api/market-trends.js');
r = await call(trendsRoute.onRequestGet, 'GET', '/api/market-trends', null);
check('the public trends answer carries the same leaderboard shape', r.status === 200 && r.json.leaderboard && !('hottest' in r.json.leaderboard) && 'mostActivity' in r.json.leaderboard);
const digest = await mod('functions/_lib/weeklyDigest.js');
run("INSERT INTO market_pulse_alerts (user_id, label, event_type) VALUES (5, 'Offers', 'offer_accepted')");
const d = await digest.buildWeeklyDigest(DB, { id: 5, display_name: 'Casey' });
check('the weekly digest says "offers accepted (not closed sales)", never "deals closed"', d && /offers? accepted \(not closed sales\)/.test(d.text) && !/deal/i.test(d.text), d && d.text);

// ===================== 4. Home trades: partner confirmation, blocks, limits (#7) =====================
const txIndex = await mod('functions/api/transactions/index.js');
const txOne = await mod('functions/api/transactions/[id].js');
const txConfirm = await mod('functions/api/transactions/[id]/confirm.js');
const txBids = await mod('functions/api/transactions/[id]/bids/index.js');
const txBid = await mod('functions/api/transactions/[id]/bids/[bidId].js');
const txInvites = await mod('functions/api/transactions/[id]/invites.js');
const txRateHomeowner = await mod('functions/api/transactions/[id]/review-homeowner.js');
const DUAL = "One agent for both homes, or two agents under the same brokerage, is dual agency and needs both owners' written consent. Each of you can choose your own agent.";
r = await call(txIndex.onRequestPost, 'POST', '/api/transactions', 1, {}, { listingIdA: 101, listingIdB: 102, note: 'Lets trade' });
const TX = r.json && r.json.id;
const PT = { id: String(TX) };
check('a partner can ask to open a trade; it starts unconfirmed', r.status === 201 && r.json.partnerConfirmed === false && one('SELECT partner_confirmed_at FROM transaction_requests WHERE id = ?', TX).partner_confirmed_at === null, r.text);
check('...the other partner is asked to confirm (in-app)', notes(7, '%would like to open your trade to agent proposals. Confirm it%').length === 1);
check('...and no agent is told yet', notes(2, '%trade%').length === 0 && notes(6, '%trade%').length === 0);
r = await call(txIndex.onRequestGet, 'GET', '/api/transactions', 2);
check('an approved agent does not see an unconfirmed trade in the list', r.json.transactions.length === 0);
r = await call(txOne.onRequestGet, 'GET', '/x', 2, PT);
check('...and gets 404 on it', r.status === 404);
r = await call(txBids.onRequestPost, 'POST', '/x', 2, PT, { message: 'Hi', commissionPct: 2 });
check('...and cannot send a proposal on it (404, as if it did not exist)', r.status === 404, r.text);
r = await call(txInvites.onRequestPost, 'POST', '/x', 1, PT, { agentUserId: 2 });
check('a partner cannot invite agents before the other confirms', r.status === 400 && /confirm/i.test(r.json.error), r.text);
r = await call(txOne.onRequestGet, 'GET', '/x', 1, PT);
check('the opener sees awaitingPartner, the dual-agency line, and no homeowner ratings', r.json.awaitingPartner === true && r.json.needsMyConfirmation === false && r.json.dualAgencyNote === DUAL && !('homeownerRatings' in r.json), r.text.slice(0, 300));
r = await call(txOne.onRequestGet, 'GET', '/x', 7, PT);
check('the partner sees needsMyConfirmation', r.json.needsMyConfirmation === true);
r = await call(txConfirm.onRequestPost, 'POST', '/x', 1, PT);
check('the opener cannot confirm their own request', r.status === 400);
r = await call(txConfirm.onRequestPost, 'POST', '/x', 5, PT);
check('someone outside the trade cannot confirm it (404)', r.status === 404);
r = await call(txConfirm.onRequestPost, 'POST', '/x', 7, PT);
check('the partner confirms', r.status === 200 && r.json.partnerConfirmed === true && one('SELECT partner_confirmed_at FROM transaction_requests WHERE id = ?', TX).partner_confirmed_at !== null);
check('...the opener is told, and approved agents are alerted only now', notes(1, '%confirmed your trade request%').length === 1 && notes(2, '%trade%').length === 1 && notes(6, '%trade%').length === 1 && notes(4, '%trade%').length === 0);
r = await call(txIndex.onRequestGet, 'GET', '/api/transactions', 2);
check('the confirmed trade now shows to approved agents', r.json.transactions.length === 1 && r.json.transactions[0].partnerConfirmed === true);
r = await call(txIndex.onRequestGet, 'GET', '/api/transactions', 5);
check('a signed-in non-agent gets an empty trade list', r.status === 200 && r.json.transactions.length === 0);
r = await call(txOne.onRequestGet, 'GET', '/x', 5, PT);
check('...and agents_only on the detail', r.status === 403 && r.json.code === 'agents_only');
r = await call(txBids.onRequestPost, 'POST', '/x', 2, PT, { message: 'I can help with both closings.', commissionPct: 2 });
check('an approved agent can now send a proposal, with the dual-agency line', r.status === 201 && r.json.dualAgencyNote === DUAL, r.text);
const bidG = one("SELECT id FROM service_bids WHERE request_type = 'transaction' AND request_id = ? AND agent_user_id = 2", TX).id;
// Per-request proposal limit (B1's rateLimits.js): 5 a day per trade, the 6th is refused with 429.
let codes = [];
for (let i = 0; i < 5; i++) codes.push((await call(txBids.onRequestPost, 'POST', '/x', 2, PT, { message: `Edit ${i}`, commissionPct: 2 })).status);
const limited = await call(txBids.onRequestPost, 'POST', '/x', 2, PT, { message: 'one more', commissionPct: 2 });
check('trade proposals count toward the per-request limit: 6th in a day is 429 rate_limited', codes.slice(0, 4).every(c => c === 201) && codes[4] === 429 && limited.status === 429 && limited.json.code === 'rate_limited', JSON.stringify(codes) + ' ' + limited.status);
check('...counted with ref transaction:<id>', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 2 AND kind = 'proposal' AND ref = ?", `transaction:${TX}`).n === 5);
// Blocks: the partner blocks agent K; K can't see or bid, and A can't hire or invite K.
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (7, 6)');
r = await call(txIndex.onRequestGet, 'GET', '/api/transactions', 6);
check('an agent blocked by either partner does not see the trade', r.json.transactions.length === 0);
r = await call(txOne.onRequestGet, 'GET', '/x', 6, PT);
check('...gets 404 on the detail', r.status === 404);
r = await call(txBids.onRequestPost, 'POST', '/x', 6, PT, { message: 'Hi', commissionPct: 2 });
check('...and 404 on a proposal', r.status === 404);
r = await call(txInvites.onRequestPost, 'POST', '/x', 1, PT, { agentUserId: 6 });
check("the other partner can't invite an agent their partner blocked", r.status === 400 && r.json.error === "That agent can't be invited to this request.", r.text);
r = await call(txInvites.onRequestPost, 'POST', '/x', 7, PT, { agentUserId: 6 });
check('the partner who blocked is told to unblock first', r.status === 400 && r.json.error === 'Unblock this agent first.', r.text);
r = await call(txInvites.onRequestPost, 'POST', '/x', 1, PT, { agentUserId: 3 });
check('inviting an unblocked approved agent works once confirmed', r.status === 201, r.text);
check('...and counts toward the agent_invite limit', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 1 AND kind = 'agent_invite'").n === 1);
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, message, status) VALUES (950, 'transaction', ?, 6, 'old', 'pending')", TX);
r = await call(txBid.onRequestPut, 'PUT', '/x', 7, { id: String(TX), bidId: '950' }, { action: 'accept' });
check('accepting a blocked agent is refused: "Unblock this agent first."', r.status === 400 && r.json.error === 'Unblock this agent first.', r.text);
r = await call(txOne.onRequestGet, 'GET', '/x', 1, PT);
check("the partners' proposal list leaves the blocked agent out", r.json.bids.every(b => b.agentUserId !== 6), JSON.stringify(r.json.bids.map(b => b.agentUserId)));
r = await call(txBid.onRequestPut, 'PUT', '/x', 1, { id: String(TX), bidId: String(bidG) }, { action: 'accept' });
check('either partner can accept once both confirmed, and is shown the dual-agency line', r.status === 200 && r.json.dualAgencyNote === DUAL, r.text);
// The other partner asking for the same trade counts as confirming it.
L(103, 1); L(104, 7);
r = await call(txIndex.onRequestPost, 'POST', '/api/transactions', 1, {}, { listingIdA: 103, listingIdB: 104 });
const TX2 = r.json.id;
r = await call(txIndex.onRequestPost, 'POST', '/api/transactions', 7, {}, { listingIdA: 104, listingIdB: 103 });
check('the other partner asking for the same trade confirms it', r.status === 201 && r.json.id === TX2 && r.json.partnerConfirmed === true, r.text);
run("INSERT INTO service_bids (id, request_type, request_id, agent_user_id, message, status) VALUES (951, 'transaction', 999, 2, 'x', 'pending')");
run("INSERT INTO transaction_requests (id, opened_by_user_id, listing_a_id, listing_b_id, user_a_id, user_b_id) VALUES (999, 1, 101, 104, 1, 7)");
r = await call(txBid.onRequestPut, 'PUT', '/x', 1, { id: '999', bidId: '951' }, { action: 'accept' });
check('no one can be hired on an unconfirmed trade', r.status === 400 && /confirm/i.test(r.json.error), r.text);
r = await call(txRateHomeowner.onRequestPost, 'POST', '/x', 2, PT, { ratings: [] });
check('rating homeowners on a trade answers 410 gone', r.status === 410 && r.json.code === 'gone');

// ===================== 5. Posts and comments: soft-hide, agent identity (#8) =====================
const comments = await mod('functions/api/posts/[id]/comments.js');
const commentDel = await mod('functions/api/comments/[id].js');
const commentHide = await mod('functions/api/comments/[id]/hide.js');
const commentLike = await mod('functions/api/comments/[id]/like.js');
const posts = await mod('functions/api/posts/index.js');
const postDel = await mod('functions/api/posts/[id]/index.js');
const postHide = await mod('functions/api/posts/[id]/hide.js');
const reportsAdmin = await mod('functions/api/admin/reports/[id].js');
const reportsList = await mod('functions/api/admin/reports/index.js');
run("INSERT INTO posts (id, user_id, listing_id, body) VALUES (500, 1, 101, '')"); // listing 101's deal thread (owner A)
const PP = { id: '500' };
await call(comments.onRequestPost, 'POST', '/x', 2, PP, { body: 'Agent G here: lovely home.' });
await call(comments.onRequestPost, 'POST', '/x', 5, PP, { body: 'Who lives nearby?' });
await call(comments.onRequestPost, 'POST', '/x', 9, PP, { body: 'Nice yard.' });
const cG = one('SELECT id FROM comments WHERE user_id = 2').id;
const cC = one('SELECT id FROM comments WHERE user_id = 5').id;
const cR = one('SELECT id FROM comments WHERE user_id = 9').id;
r = await call(comments.onRequestGet, 'GET', '/x', 5, PP);
const gC = r.json.comments.find(c => c.id === cG);
check("an approved agent's comment carries authorAgent { licenseNumber, brokerageName }", gC && gC.authorAgent && gC.authorAgent.licenseNumber === '01234567' && gC.authorAgent.brokerageName === 'Pacific Realty', JSON.stringify(gC));
check("...and a homeowner's carries authorAgent null", r.json.comments.find(c => c.id === cC).authorAgent === null);
r = await call(comments.onRequestGet, 'GET', '/x', 1, PP);
check("the home's owner may hide others' comments on their own thread (canHide)", r.json.comments.find(c => c.id === cC).canHide === true);
r = await call(commentHide.onRequestPost, 'POST', '/x', 7, { id: String(cC) }, { reason: 'nope' });
check("someone else can't hide a comment on A's thread", r.status === 403);
r = await call(commentHide.onRequestPost, 'POST', '/x', 1, { id: String(cC) }, {});
check('the owner hides a comment (soft-hide with a default reason)', r.status === 200 && one('SELECT hidden_at, hidden_reason FROM comments WHERE id = ?', cC).hidden_at !== null && one('SELECT COUNT(*) AS n FROM comments WHERE id = ?', cC).n === 1, r.text);
check('...the author gets "Your comment was hidden: ..."', notes(5, 'Your comment was hidden: %').length === 1);
r = await call(comments.onRequestGet, 'GET', '/x', 9, PP);
check('...nobody else sees it', !r.json.comments.some(c => c.id === cC));
r = await call(comments.onRequestGet, 'GET', '/x', null, PP);
check('...not even signed out (a home\x27s discussion needs sign-in at all: 401)', r.status === 401 && !(r.json && r.json.comments));
r = await call(comments.onRequestGet, 'GET', '/x', 5, PP);
const own = r.json.comments.find(c => c.id === cC);
check('...the author still sees it, marked hidden with the reason', own && own.hidden === true && own.hiddenReason.length > 0, JSON.stringify(own));
r = await call(commentLike.onRequestPost, 'POST', '/x', 9, { id: String(cC) });
check('...and it cannot be liked by others (404)', r.status === 404);
r = await call(commentDel.onRequestDelete, 'DELETE', '/x', 8, { id: String(cR) });
check('an admin taking down a comment must give a reason', r.status === 400 && r.json.code === 'reason_required');
r = await call(commentDel.onRequestDelete, 'DELETE', '/x?reason=Spam', 8, { id: String(cR) });
check('...with a reason it is hidden, not deleted, and logged', r.status === 200 && one('SELECT hidden_reason FROM comments WHERE id = ?', cR).hidden_reason === 'Spam' && one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'hide_comment'").n === 1);
check('...and the author is told the reason', notes(9, 'Your comment was hidden: Spam').length === 1);
r = await call(commentHide.onRequestPost, 'POST', '/x', 1, { id: String(cR) }, { action: 'unhide' });
check('only an admin can put a hidden comment back', r.status === 403);
r = await call(commentHide.onRequestPost, 'POST', '/x', 8, { id: String(cR) }, { action: 'unhide' });
check('...an admin can', r.status === 200 && one('SELECT hidden_at FROM comments WHERE id = ?', cR).hidden_at === null);
r = await call(commentDel.onRequestDelete, 'DELETE', '/x', 2, { id: String(cG) });
check('an author still deletes their own comment outright', r.status === 200 && one('SELECT COUNT(*) AS n FROM comments WHERE id = ?', cG).n === 0);
// Feed posts
run("INSERT INTO posts (id, user_id, body) VALUES (600, 2, 'Agent post'), (601, 5, 'Homeowner post')");
r = await call(posts.onRequestGet, 'GET', '/api/posts', 9);
const p600 = r.json.posts.find(p => p.id === 600);
check("feed posts by approved agents carry authorAgent; others null", p600 && p600.authorAgent && p600.authorAgent.licenseNumber === '01234567' && r.json.posts.find(p => p.id === 601).authorAgent === null);
r = await call(postHide.onRequestPost, 'POST', '/x', 1, { id: '601' }, { reason: 'x' });
check('only admins hide posts', r.status === 403);
r = await call(postDel.onRequestDelete, 'DELETE', '/x', 8, { id: '601' }, {});
check('an admin taking down a post needs a reason', r.status === 400 && r.json.code === 'reason_required');
r = await call(postDel.onRequestDelete, 'DELETE', '/x', 8, { id: '601' }, { reason: 'Advertising' });
check('...then it is hidden, not deleted', r.status === 200 && one('SELECT hidden_reason FROM posts WHERE id = 601').hidden_reason === 'Advertising');
check('...and the author is told', notes(5, 'Your post was hidden: Advertising').length === 1);
r = await call(posts.onRequestGet, 'GET', '/api/posts', 9);
check('a hidden post leaves the feed for others', !r.json.posts.some(p => p.id === 601));
r = await call(posts.onRequestGet, 'GET', '/api/posts', 5);
check('...but its author still sees it, marked hidden', r.json.posts.some(p => p.id === 601 && p.hidden === true));
// Reports queue: hide instead of delete, reason required
run(`INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES
  (1, 9, 'post', 600, 'Rules problem'), (2, 9, 'listing', 102, 'Fair housing concern'), (3, 9, 'user', 6, 'Rules problem'), (4, 9, 'comment', ?, 'Spam')`, cR);
r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '1' }, { action: 'delete_target' });
check('a report action that takes something down needs a reason', r.status === 400 && r.json.code === 'reason_required');
r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '1' }, { action: 'delete_target', reason: 'Breaks the rules' });
check('...the old "delete" action now hides the post and resolves the report', r.status === 200 && one('SELECT COUNT(*) AS n FROM posts WHERE id = 600').n === 1 && one('SELECT hidden_reason FROM posts WHERE id = 600').hidden_reason === 'Breaks the rules' && one('SELECT status FROM reports WHERE id = 1').status === 'resolved');
r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '4' }, { action: 'hide_target', reason: 'Spam again' });
check('hide_target hides a reported comment', r.status === 200 && one('SELECT hidden_reason FROM comments WHERE id = ?', cR).hidden_reason === 'Spam again');
r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '2' }, { action: 'hide_target', reason: 'Describes who should live there' });
check('hide_target pauses a reported listing (never deletes it) and tells the owner', r.status === 200 && one('SELECT status FROM listings WHERE id = 102').status === 'paused' && notes(7, 'Your listing was paused by Amico Haus: %').length === 1);
r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '3' }, { action: 'hide_target', reason: 'x' });
check('a report about a person is resolved or dismissed, not "hidden"', r.status === 400);
r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '3' }, { action: 'dismiss' });
check('...dismissing it works', r.status === 200 && one('SELECT status FROM reports WHERE id = 3').status === 'dismissed');
r = await call(reportsList.onRequestGet, 'GET', '/x', 8);
check('the reports queue shows which targets are already hidden', r.json.reports.find(x => x.id === 1).target_hidden === true);
run("UPDATE listings SET status = 'active' WHERE id = 102");

// ===================== 6. Past-client reviews (#12) =====================
run("UPDATE agent_profiles SET review_invite_token = 'tokentoken12', review_invite_from_year = 2020, review_invite_to_year = 2025 WHERE user_id = 3");
const pcr = await mod('functions/api/past-client-reviews/index.js');
const pcrAdmin = await mod('functions/api/admin/past-client-reviews/index.js');
r = await call(pcr.onRequestPost, 'POST', '/x', 9, {}, { token: 'tokentoken12', rating: 5, clientSide: 'sold', saleYear: 2022, saleCity: 'Chula Vista', comment: 'Great.' });
check('a past-client review posts without a street address (city, year and side are enough)', r.status === 201 && one('SELECT sale_address FROM past_client_reviews WHERE reviewer_user_id = 9').sale_address === '', r.text);
r = await call(pcr.onRequestPost, 'POST', '/x', 5, {}, { token: 'tokentoken12', rating: 4, clientSide: 'sold', saleYear: 2022, saleCity: '', comment: '' });
check('...the city is still required', r.status === 400 && /city/i.test(r.json.error));
r = await call(pcr.onRequestPost, 'POST', '/x', 5, {}, { token: 'tokentoken12', rating: 4, clientSide: 'bought', saleYear: 2021, saleCity: 'Bonita', saleAddress: '12', comment: '' });
check('...a typed address too short to be one is refused', r.status === 400);
r = await call(pcr.onRequestPost, 'POST', '/x', 5, {}, { token: 'tokentoken12', rating: 4, clientSide: 'bought', saleYear: 2021, saleCity: 'Bonita', saleAddress: '12 Elm Street', comment: '' });
check('...a full address is still accepted', r.status === 201);
r = await call(pcrAdmin.onRequestGet, 'GET', '/x', 8);
const rv5 = r.json.reviews.find(x => x.reviewerUserId === 5);
check("the admin list hides the reviewer's email and the address until the review is reported", rv5 && rv5.reported === false && rv5.reviewerEmail === null && rv5.saleAddress === null, JSON.stringify(rv5));
// A report about the person (any reason), or one an admin files on the review, doesn't reveal anything.
run("INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (3, 'user', 5, 'Rules problem')");
run("INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (8, 'past_client_review', ?, 'Fake review')", rv5.id);
r = await call(pcrAdmin.onRequestGet, 'GET', '/x', 8);
const rv5a = r.json.reviews.find(x => x.reviewerUserId === 5);
check('...a report about the reviewer, or an admin\x27s own report on the review, still reveals nothing', rv5a.reported === false && rv5a.reviewerEmail === null && rv5a.saleAddress === null, JSON.stringify(rv5a));
run("INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (3, 'past_client_review', ?, 'Fake review')", rv5.id);
r = await call(pcrAdmin.onRequestGet, 'GET', '/x', 8);
const rv5b = r.json.reviews.find(x => x.reviewerUserId === 5);
check('...and shows them once a member has reported the review itself', rv5b.reported === true && rv5b.reviewerEmail === 'u5@example.test' && rv5b.saleAddress === '12 Elm Street', JSON.stringify(rv5b));
const pcrLib = await mod('functions/_lib/pastClientReviews.js');
check('the profile list never carries the address', (await pcrLib.fetchPastClientReviews(DB, 3)).every(x => !('saleAddress' in x) && 'reviewerUserId' in x));

// ===================== 7. Terms acceptance stored at signup (#16) =====================
const signup = await mod('functions/api/auth/signup.js');
const { CURRENT_TERMS_VERSION } = await mod('functions/_lib/terms.js');
r = await call(signup.onRequestPost, 'POST', '/api/auth/signup', null, {}, { email: 'new.person@example.test', displayName: 'New Person', intent: 'homeowner' });
const nu = one("SELECT terms_version, terms_accepted_at FROM users WHERE email = 'new.person@example.test'");
check("a new account records the Terms version 2026-11-05 (CURRENT_TERMS_VERSION) and when it was accepted", CURRENT_TERMS_VERSION === '2026-11-05' && [201, 202].includes(r.status) && nu && nu.terms_version === CURRENT_TERMS_VERSION && !!nu.terms_accepted_at, r.text + JSON.stringify(nu));
run("UPDATE users SET terms_version = NULL, terms_accepted_at = NULL, verify_sent_at = NULL WHERE email = 'new.person@example.test'");
r = await call(signup.onRequestPost, 'POST', '/api/auth/signup', null, {}, { email: 'new.person@example.test', displayName: 'New Person' });
check('...signing up again while pending records it again', one("SELECT terms_version FROM users WHERE email = 'new.person@example.test'").terms_version === CURRENT_TERMS_VERSION);

// ===================== 8. FinderMine without investment terms (decision 1) =====================
const dpIndex = await mod('functions/api/dev-projects/index.js');
const dpOne = await mod('functions/api/dev-projects/[id].js');
const dpInterest = await mod('functions/api/dev-projects/[id]/interest.js');
const dpPhotos = await mod('functions/api/dev-projects/[id]/photos/index.js');
const dpPhoto = await mod('functions/api/dev-project-photos/[id].js');
const projectPage = await mod('functions/project/[id].js');
const base = { title: 'Duplex rebuild', city: 'National City', state: 'CA', projectType: 'multifamily', stage: 'permitting', description: 'Looking for a builder.' };
r = await call(dpIndex.onRequestPost, 'POST', '/api/dev-projects', 1, {}, { ...base, minInvestment: 50000, targetReturn: '15-18% IRR', fundingGoal: 900000 });
const P = r.json.id;
const row = one('SELECT funding_goal, min_investment, target_return FROM dev_projects WHERE id = ?', P);
check('a funding amount, minimum investment and target return are never stored', r.status === 201 && row.funding_goal === 0 && row.min_investment === 0 && row.target_return === '', JSON.stringify(row));
ev = one("SELECT headline, amount FROM market_events WHERE entity_kind = 'dev_project' AND entity_id = ?", P);
check('the new-project event has no dollar amount', ev && !ev.headline.includes('$') && ev.amount === null, JSON.stringify(ev));
r = await call(dpIndex.onRequestPost, 'POST', '/api/dev-projects', 1, {}, { ...base, stage: 'funded' });
check('"Fully Funded" is no longer a stage', r.status === 400);
run("UPDATE dev_projects SET funding_goal = 900000, min_investment = 10000, target_return = '12%', stage = 'funded' WHERE id = ?", P);
r = await call(dpIndex.onRequestGet, 'GET', '/api/dev-projects', 5);
const card = r.json.projects.find(x => x.id === P);
check('browse cards carry no investment fields (no funding amount) or investor count', card && !('fundingGoal' in card) && !('minInvestment' in card) && !('targetReturn' in card) && !('interestCount' in card) && card.stage === null, JSON.stringify(card));
r = await call(dpOne.onRequestGet, 'GET', '/x', 1, { id: String(P) });
check('the detail carries no investment fields (no funding amount), interested investors or interest flag', r.json.project && !('fundingGoal' in r.json.project) && !('minInvestment' in r.json.project) && !('targetReturn' in r.json.project) && !('interestCount' in r.json.project) && !('interestedInvestors' in r.json) && !('amInterested' in r.json), r.text.slice(0, 300));
r = await call(dpOne.onRequestPut, 'PUT', '/x', 1, { id: String(P) }, { ...base, stage: 'concept', minInvestment: 5, targetReturn: 'x' });
check('saving clears an older funding amount, minimum investment and target return', r.status === 200 && one('SELECT min_investment, target_return FROM dev_projects WHERE id = ?', P).target_return === '' && one('SELECT min_investment, funding_goal FROM dev_projects WHERE id = ?', P).min_investment === 0 && one('SELECT funding_goal FROM dev_projects WHERE id = ?', P).funding_goal === 0);
r = await call(dpOne.onRequestPut, 'PUT', '/x', 1, { id: String(P) }, { action: 'set-status', status: 'funded' });
check('"Mark Funded" is gone (status must be open or closed)', r.status === 400);
r = await call(dpInterest.onRequestPost, 'POST', '/x', 5, { id: String(P) }, {});
check('"Express Interest" answers 410 gone', r.status === 410 && r.json.code === 'gone');
run("INSERT INTO dev_project_photos (id, dev_project_id, r2_key, content_type, position) VALUES (700, ?, 'dev-projects/x/one', 'image/jpeg', 0), (701, ?, 'dev-projects/x/two', 'image/jpeg', 1)", P, P);
r2.set('dev-projects/x/one', 'a'); r2.set('dev-projects/x/two', 'b');
r = await call(dpPhoto.onRequestGet, 'GET', '/x', null, { id: '700' });
check('a FinderMine photo needs sign-in', r.status === 401);
r = await call(dpPhoto.onRequestGet, 'GET', '/x', 5, { id: '700' });
check('...signed in it loads with a private cache', r.status === 200 && r.headers.get('Cache-Control') === 'private, max-age=3600', String(r.status) + r.headers.get('Cache-Control'));
r = await call(dpPhotos.onRequestGet, 'GET', '/x', null, { id: String(P) });
check('the photo list needs sign-in too', r.status === 401);
r = await call(projectPage.onRequestGet, 'GET', `/project/${P}`, null, { id: String(P) });
check('a project page signed out asks to sign in, noindex, and shows nothing of the project',
  r.status === 200 && r.headers.get('X-Robots-Tag') === 'noindex, nofollow' && r.text.includes('noindex') && !r.text.includes('Duplex rebuild') && r.text.includes('/login'), r.text.slice(0, 200));
r = await call(projectPage.onRequestGet, 'GET', `/project/${P}`, 5, { id: String(P) });
check('signed in, the project page shows the project with noindex',
  r.status === 200 && r.text.includes('Duplex rebuild') && r.text.includes('<meta name="robots" content="noindex, nofollow">') && r.headers.get('X-Robots-Tag') === 'noindex, nofollow');
check('...and no investment terms, investor count, "Fully Funded" or "Verified"',
  !/Min\. investment|Target return|investors? interested|Fully Funded|Funding sought|Verified/i.test(r.text) && r.text.includes('builder, partner or co-buyer'), (r.text.match(/Min\. investment|Target return|investors? interested|Fully Funded|Funding sought|Verified/i) || [''])[0]);
check('...with the Equal Housing Opportunity footer line', r.text.includes('<p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>'));
r = await call(dpOne.onRequestDelete, 'DELETE', '/x', 1, { id: String(P) });
check('deleting a project removes its photos from R2', r.status === 200 && deletedKeys.includes('dev-projects/x/one') && deletedKeys.includes('dev-projects/x/two') && one('SELECT COUNT(*) AS n FROM dev_project_photos WHERE dev_project_id = ?', P).n === 0);

// ===================== 9. Payment widget (#20) =====================
const mc = await mod('functions/_lib/mortgageCalc.js');
const html = mc.mortgageCalcHtml(650000);
check('the payment widget starts with no rate ("your rate") and shows "—"', !/value="6\.75"/.test(html) && html.includes('placeholder="your rate"') && html.includes('<strong class="mc-monthly">—</strong>'));
check('...labels the result "Your estimate (not an APR or a rate quote)" and says any lender is fine',
  html.includes('Your estimate (not an APR or a rate quote)') && html.includes('You are always free to choose any lender you like'));
check('...and every input has a label for=', ['mcPrice', 'mcDownPct', 'mcRate', 'mcTerm'].every(i => html.includes(`for="${i}"`) && html.includes(`id="${i}"`)));

// ===================== 10. Team names (#23) =====================
const teams = await mod('functions/_lib/agentTeams.js');
let t = await teams.createTeam(DB, 2, 'Rockstar Realty');
check('a team name with "realty" is refused', !!t.error && /realty/i.test(t.error));
t = await teams.createTeam(DB, 2, 'Dream Team');
check("a team name without a member's surname is refused", !!t.error && t.error.includes('"Flores Team"'), JSON.stringify(t));
for (const bad of ['Flores Real Estate', 'Flores Brokerage', 'Flores Broker Group', 'Flores Inc', 'Flores Company']) {
  check(`"${bad}" is refused`, !!teams.validateTeamName(bad, ['Flores']).error);
}
t = await teams.createTeam(DB, 2, 'The Flores Group');
check('a team name with the surname works', !!t.teamId, JSON.stringify(t));
let inv = await teams.inviteToTeam(DB, t.teamId, 2, 6);
check('an agent at another brokerage cannot be invited', inv.error === 'A team can only include agents at the same brokerage.', JSON.stringify(inv));
inv = await teams.inviteToTeam(DB, t.teamId, 2, 3);
check('an agent at the same brokerage (ignoring ", Inc.") can', inv.ok === true, JSON.stringify(inv));
await teams.respondToInvite(DB, 3, true);
const team = await teams.fetchTeamDetail(DB, t.teamId);
check('the team shows plain counts and no win rate', team.teamStats.winRate === null && 'acceptedBids' in team.teamStats && team.members.every(m => !m.stats || Object.keys(m.stats).join() === 'totalBids,acceptedBids'));
check('"Team" is not added when the name already ends in Team, Group or Associates',
  teams.teamDisplayName('The Flores Group') === 'The Flores Group' && teams.teamDisplayName('Flores Team') === 'Flores Team' && teams.teamDisplayName('Flores & Associates') === 'Flores & Associates' && teams.teamDisplayName('Flores') === 'Flores Team');

// ===================== 11. Life-event labels (#9) and the rental math (#6) =====================
const le = await mod('functions/_lib/lifeEvents.js');
check('the reasons are property reasons only',
  JSON.stringify(le.LIFE_EVENT_ITEMS.map(i => i.label)) === JSON.stringify(['Need more space', 'Need less space', 'Relocating', 'Estate / inherited', 'Investment', 'Life change', 'Other']));
check('old keys map to the new ones on save', JSON.stringify(le.validLifeEventKeys(['divorce_separation', 'retirement', 'upsizing_growing_family', 'inheritance', 'downsizing', 'bogus'])) === JSON.stringify(['life_change', 'more_space', 'estate', 'less_space']));
check('old keys read as the new labels; unknown keys never print', le.lifeEventLabel('divorce_separation') === 'Life change' && le.lifeEventLabel('upsizing_growing_family') === 'Need more space' && le.lifeEventLabel('bogus') === null);
check('no label mentions family, divorce, retirement or age', !Object.values(le.LIFE_EVENT_LABELS).some(l => /family|divorce|separat|retire|empty|age/i.test(l)));
const util = await mod('functions/_lib/util.js');
const yrs = util.lumpSumRentalYears(util.netSaleProceeds(700000), 3000);
check('the rental math has no +15% lump-sum bonus (high equals low)', !('RENTAL_LUMP_SUM_BONUS_PCT' in util) && yrs.yearsHigh === yrs.yearsLow);

// ===================== 12. Owner-entered wording on pages and flyers (#9, #10, #18, #21) =====================
const hc = await mod('functions/_lib/homeCosts.js');
const lines = hc.homeCostsLines({ melloRoosAnnual: 0, hoaMonthly: 0, hoaDetails: { includes: [], rentals: '', pets: '', specialAssessment: '' } });
check('cost lines say "Owner says: no Mello-Roos"', lines.includes('Owner says: no Mello-Roos') && lines.includes('Owner says: no HOA') && hc.HOME_COSTS_HEADING === 'Costs (from the owner)');
run('UPDATE users SET is_verified = 1 WHERE id = 1');
for (const [dir, label] of [['augmented-home', 'AugmentedHomes'], ['green-home', 'GreenHomes']]) {
  const page = await mod(`functions/${dir}/[id].js`);
  r = await call(page.onRequestGet, 'GET', `/${dir}/201`, null, { id: '201' });
  check(`${label} page: no "Verified" badge and no why-you're-moving tags`, r.status === 200 && !/Verified/.test(r.text) && !/Life change|divorce/i.test(r.text), (r.text.match(/Verified|Life change|divorce/i) || [''])[0]);
  check(`${label} page: costs are "(from the owner)" with the confirm line`, r.text.includes('Costs (from the owner)') && r.text.includes("Confirm on the property tax bill and in the seller&#39;s Mello-Roos and HOA disclosures.") && r.text.includes('Owner says: no Mello-Roos'));
  check(`${label} page: payment widget has no preset rate, and the footer line is there`, !/value="6\.75"/.test(r.text) && r.text.includes('Equal Housing Opportunity · <a href="/accessibility">Accessibility</a>'));
  const flyer = await mod(`functions/${dir}/[id]/flyer.js`);
  r = await call(flyer.onRequestGet, 'GET', '/x', 1, { id: '201' });
  check(`${label} flyer: owner's price, presented-by line, Equal Housing Opportunity`, r.status === 200 && r.text.includes("Owner's asking price") && r.text.includes('Posted by the owner on Amico Haus · presented by Rudy Flores, Coldwell Banker West, DRE #02257808, who does not represent this home') && r.text.includes('Equal Housing Opportunity'), r.text.slice(-600));
}
const lflyer = await mod('functions/listing/[id]/flyer.js');
r = await call(lflyer.onRequestGet, 'GET', '/x', 1, { id: '101' });
check("listing flyer: the owner's value is labeled, the presented-by line and Equal Housing Opportunity are there",
  r.status === 200 && r.text.includes("Owner's estimated value (not an appraisal or list price)") && r.text.includes('who does not represent this home') && r.text.includes('Equal Housing Opportunity'));
check('listing flyer: no why-you\'re-moving tags (never keys, never labels)', !/divorce_separation|upsizing_growing_family|Life change|Need more space/.test(r.text));
run("UPDATE agent_profiles SET status = 'approved', license_number = '02257808' WHERE user_id = 4");
run("UPDATE listings SET user_id = 4 WHERE id = 104");
r = await call(lflyer.onRequestGet, 'GET', '/x', 4, { id: '104' });
check("Rudy's own flyer doesn't claim he doesn't represent it", r.text.includes('Posted on Amico Haus by Rudy Flores') && !r.text.includes('who does not represent this home'));

// ===================== 13. Static pages (#2, #14, #16, #18, #22, #24) =====================
const page = (f) => readFileSync(`${root}/${f}`, 'utf8');
const terms = page('terms.html');
check('Terms: dated November 5, 2026 (version 2026-11-05) and titled Terms of Use', terms.includes('Last updated November 5, 2026 (version 2026-11-05).') && terms.includes('<title>Terms of Use — Amico Haus</title>'));
check('Terms: section 1 names who presents it and that Amico Haus does not represent you',
  terms.includes('Amico Haus is presented by Rudy Flores, a salesperson licensed under Coldwell Banker West (DRE #02257808). Amico Haus does not represent you; any agent, including Rudy, represents you only under a signed agreement with their brokerage.') && !terms.includes('is not a licensed real estate agent'));
check('Terms: the fee wording (escrow at closing, never pay an agent personally, no payments)',
  terms.includes("Any commission is set in your written agreement with the agent's brokerage and is normally paid through escrow at closing. Never pay an agent personally or in advance. Amico Haus never handles payments.") && !terms.includes('Handle payment for any engagement directly'));
check('Terms: Offers, FinderMine, copyright, governing law, indemnity and agent rules sections',
  /Offers on listings/.test(terms) && /FinderMine/.test(terms) && /securities/.test(terms) && /Copyright and takedown/.test(terms) && /repeat infringers/.test(terms) && /governed by California law/.test(terms) && /San Diego County, California/.test(terms) && /indemnify/.test(terms) && terms.includes('id="agent-rules"'));
check('Terms: agent rules cover license, service area, fair housing, DRE # and broker, shared contact, do-not-call',
  ['active California real estate license', 'San Diego County', 'fair housing', 'DRE license number', 'only about that home', 'do-not-call'].every(s => terms.includes(s)));
check('Terms: the California protected classes are listed',
  ['ancestry', 'citizenship', 'immigration status', 'primary language', 'sexual orientation', 'gender identity', 'gender expression', 'genetic information', 'marital status', 'source of income', 'Section 8', 'military or veteran status', 'age'].every(s => terms.includes(s)));
check('Terms: dual agency, partner confirmation and the offer tools line', terms.includes(DUAL) && terms.includes('The other partner confirms first') && terms.includes("Not a purchase agreement. A California home sale needs a written contract signed by both sides, usually prepared by your agents. Accepting here only tells the other side you'd like to move forward.") && terms.includes('no agency is created'));
check('Terms: no "vetted", no lump-sum bonus, no homeowner ratings, no dispute records',
  !/vetted/i.test(terms) && !/additional amount of time/.test(terms) && !/rate the homeowner/.test(terms) && !/for its records/.test(terms));
const signupHtml = page('signup.html');
const consentAt = signupHtml.indexOf('By tapping Email Me a Link you agree to the <a href="/terms">Terms of Use</a> and <a href="/privacy">Privacy Policy</a>.');
check('Signup: the consent line sits directly above the "Email Me a Link" button', consentAt > 0 && consentAt < signupHtml.indexOf('id="submitBtn"') && !signupHtml.includes('By signing up, you agree'));
check('Signup: "Get approved", not "Get vetted"', signupHtml.includes('Get approved, share your strategy') && !/vetted/i.test(signupHtml));
check('Contact: the phone consent line', page('contact.html').includes("By adding your phone you agree Rudy may call or text you about your message; consent isn't required to get help."));
const about = page('about.html');
check('About: no "every request is created by a real homeowner", no "both review each other", the fee wording',
  !about.includes('Every request on this platform is created by a real homeowner') && !about.includes('review each other') && about.includes("Requests are posted by people who say they own the home; Amico Haus doesn't check title.") && about.includes('Never pay an agent personally or in advance.') && about.includes('we recommend a licensed agent on every trade'));
const demo = page('demo.html');
check('Demo: no "one of ours", no "review each other"', !demo.includes('one of ours') && !demo.includes('review each other') && demo.includes('connect with an approved local agent on Amico Haus'));
const pcrHtml = page('past-client-review.html');
check('Past-client review page: address optional, the reworded note, star choices named for screen readers',
  pcrHtml.includes('Street address (optional)') && pcrHtml.includes('Kept private. Amico Haus uses it only if a review is reported as fake, and never to contact you about real estate.') && !pcrHtml.includes('public sale records') && pcrHtml.includes('aria-label="5 stars"'));
const mine = ['terms.html', 'about.html', 'demo.html', 'contact.html', 'signup.html', 'login.html', 'assumable-loans.html', 'profile.html', 'past-client-review.html', '404.html', 'admin-seed.html', 'forgot-password.html', 'reset-password.html', 'verify-email.html'];
const FOOTER = '<p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>';
// L1.1 (F17): login.html carries the Terms and Privacy links in the same footer line (FOOTER_LEGAL_APP).
const FOOTER_LEGAL_APP = '<p class="footer-legal"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>';
const missingFooter = mine.filter(f => !page(f).includes(f === 'login.html' ? FOOTER_LEGAL_APP : FOOTER));
check('every page this batch owns has the Equal Housing Opportunity footer line', missingFooter.length === 0, missingFooter.join(', '));
// A <script> tag is fine only with a src= or as JSON-LD data (never run); no style="" and no on*= handlers anywhere.
const inlineScript = (html) => (html.match(/<script\b[^>]*>/gi) || []).some(tag => !/\ssrc=/i.test(tag) && !/type="application\/ld\+json"/i.test(tag));
const cspBad = mine.filter(f => / style="|\son[a-z]+="/i.test(page(f)) || inlineScript(page(f)));
check('no inline style="", on*= handlers or inline scripts on those pages', cspBad.length === 0, cspBad.join(', '));
check('admin page: dispute history is read-only', page('admin-seed.html').includes('Dispute History (read-only)'));

// ===================== L1 review fixes (hidden posts, moderation pauses, blocks, suspended owners, limits, export) =====================
user(60, 'Owner Sixty'); user(61, 'Member Sixtyone'); user(62, 'Trader Sixtytwo'); user(63, 'Trader Sixtythree'); user(64, 'Owner Sixtyfour');
user(65, 'Owner Sixtyfive'); user(66, 'Trader Sixtysix'); user(67, 'Trader Sixtyseven'); user(68, 'Agent Sixtyeight');
agent(68, 'approved', '06800000', 'Harbor Realty');
const fut = (h) => new Date(Date.now() + h * 3600000).toISOString();

// A hidden post stays hidden on the public profile API and in group feeds; hidden comments aren't counted anywhere.
const usersApi = await mod('functions/api/users/[id].js');
const groupsApi = await mod('functions/api/groups/[id].js');
const dealThreads = await mod('functions/_lib/dealThreads.js');
run("INSERT INTO groups (id, type, key, label) VALUES (60, 'location', 'cv-fix', 'Chula Vista')");
run("INSERT INTO posts (id, user_id, group_id, body, hidden_at, hidden_reason) VALUES (6001, 60, 60, 'HIDDEN BODY', datetime('now'), 'Fair housing'), (6002, 60, 60, 'Shown body', NULL, NULL)");
run("INSERT INTO comments (post_id, user_id, body, hidden_at) VALUES (6002, 61, 'hidden comment', datetime('now')), (6002, 61, 'shown comment', NULL)");
r = await call(usersApi.onRequestGet, 'GET', '/api/users/60', null, { id: '60' });
check('a hidden post is left off the public profile API, and hidden comments are not counted', r.status === 200 && !r.text.includes('HIDDEN BODY') && r.json.posts.length === 1 && r.json.posts[0].comment_count === 1, r.text.slice(0, 300));
r = await call(groupsApi.onRequestGet, 'GET', '/api/groups/60', 61, { id: '60' });
check('...and out of a group feed for other members', !r.text.includes('HIDDEN BODY') && r.json.posts.length === 1 && r.json.posts[0].comment_count === 1, r.text.slice(0, 300));
r = await call(groupsApi.onRequestGet, 'GET', '/api/groups/60', null, { id: '60' });
check('...and for visitors who are signed out', !r.text.includes('HIDDEN BODY'));
r = await call(groupsApi.onRequestGet, 'GET', '/api/groups/60', 60, { id: '60' });
check('...while its author still sees it there, marked hidden', r.json.posts.some(p => p.id === 6001 && p.hidden === true && p.hiddenReason === 'Fair housing'));
run("INSERT INTO posts (id, user_id, group_id, body) VALUES (6009, 2, 60, 'Agent group post')");
r = await call(groupsApi.onRequestGet, 'GET', '/api/groups/60', 61, { id: '60' });
check("an approved agent's group post carries their DRE # and brokerage, like the main feed", r.json.posts.some(p => p.id === 6009 && p.authorAgent && p.authorAgent.licenseNumber === '01234567' && p.authorAgent.brokerageName === 'Pacific Realty') && r.json.posts.some(p => p.id === 6002 && p.authorAgent === null), r.text.slice(0, 300));
L(601, 60);
run("INSERT INTO posts (id, user_id, listing_id, body) VALUES (6003, 60, 601, '')");
run("INSERT INTO comments (post_id, user_id, body, hidden_at) VALUES (6003, 61, 'a', datetime('now')), (6003, 61, 'b', NULL)");
check('the comment count on browse cards leaves hidden comments out', (await dealThreads.fetchCommentCountBatch(DB, 'listing', [601])).get(601) === 1);

// A listing taken down by moderation stays paused until an admin makes it active again.
const listingsOne = await mod('functions/api/listings/[id].js');
const trashLib = await mod('functions/_lib/trash.js');
run("INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (6001, 61, 'listing', 601, 'Fair housing concern')");
r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '6001' }, { action: 'hide_target', reason: 'Describes who should live there' });
let lrow = one('SELECT status, hidden_at, hidden_reason FROM listings WHERE id = 601');
check('a report takedown pauses the listing and marks the pause as moderation', r.status === 200 && lrow.status === 'paused' && !!lrow.hidden_at && lrow.hidden_reason === 'Describes who should live there', JSON.stringify(lrow));
r = await call(listingsOne.onRequestPut, 'PUT', '/x', 60, { id: '601' }, { status: 'active' });
check("...the owner can't reactivate it (403 moderation_paused, with the reason)", r.status === 403 && r.json.code === 'moderation_paused' && r.json.error === 'Paused by Amico Haus: Describes who should live there' && one('SELECT status FROM listings WHERE id = 601').status === 'paused', r.text);
r = await call(listingsOne.onRequestDelete, 'DELETE', '/x', 60, { id: '601' });
const trashRow = one('SELECT id FROM deleted_listings WHERE user_id = 60');
const restored = await trashLib.restoreFromTrash(DB, 60, trashRow.id);
lrow = one('SELECT status, hidden_at, hidden_reason FROM listings WHERE id = ?', restored.id);
check('...nor undo it by deleting it and restoring it from Recently Deleted', r.status === 200 && lrow.status === 'paused' && !!lrow.hidden_at && lrow.hidden_reason === 'Describes who should live there', JSON.stringify(lrow));
const matchNotifyLib = await mod('functions/_lib/matchNotify.js');
const notesBeforeRestoreNotify = one('SELECT COUNT(*) AS n FROM notifications').n;
await matchNotifyLib.notifyNewMatches({ env: { DB }, waitUntil() {} }, restored.id);
check('...and the restored, still-paused listing announces no new matches', one('SELECT COUNT(*) AS n FROM notifications').n === notesBeforeRestoreNotify);
r = await call(listingsOne.onRequestPut, 'PUT', '/x', 8, { id: String(restored.id) }, { status: 'active' });
lrow = one('SELECT status, hidden_at, hidden_reason FROM listings WHERE id = ?', restored.id);
check('an admin making it active again clears the moderation mark', r.status === 200 && lrow.status === 'active' && lrow.hidden_at === null && lrow.hidden_reason === null, JSON.stringify(lrow));
await call(listingsOne.onRequestPut, 'PUT', '/x', 8, { id: String(restored.id) }, { status: 'paused', reason: 'Spam' });
r = await call(listingsOne.onRequestPut, 'PUT', '/x', 60, { id: String(restored.id) }, { status: 'active' });
check("an admin's own pause of someone else's listing is moderation too", one('SELECT hidden_reason FROM listings WHERE id = ?', restored.id).hidden_reason === 'Spam' && r.status === 403 && r.json.code === 'moderation_paused');
run('UPDATE listings SET hidden_at = NULL, hidden_reason = NULL WHERE id = ?', restored.id);
r = await call(listingsOne.onRequestPut, 'PUT', '/x', 60, { id: String(restored.id) }, { status: 'active' });
check("an owner's own pause is still the owner's to undo", r.status === 200 && one('SELECT status FROM listings WHERE id = ?', restored.id).status === 'active');
await call(listingsOne.onRequestPut, 'PUT', '/x', 60, { id: String(restored.id) }, { status: 'paused' });
r = await call(listingsOne.onRequestPut, 'PUT', '/x', 8, { id: String(restored.id) }, { status: 'active' });
check("...and an admin can't reactivate a listing its owner paused (only a moderation pause)", r.status === 403 && r.json.code === 'owner_paused' && one('SELECT status FROM listings WHERE id = ?', restored.id).status === 'paused', r.text);

// A block either way between two homeowners: no match, no trade request, no offer.
L(6602, 62); L(6603, 63);
const matchesApi = await mod('functions/api/matches.js');
const sees6603 = (j) => JSON.stringify(j).includes('"listingId":6603');
r = await call(matchesApi.onRequestGet, 'GET', '/api/matches', 62);
check('(setup) two matching trade listings see each other', sees6603(r.json), r.text.slice(0, 200));
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (63, 62)');
r = await call(matchesApi.onRequestGet, 'GET', '/api/matches', 62);
check("after a block either way they are no longer each other's matches", !sees6603(r.json));
r = await call(txIndex.onRequestPost, 'POST', '/api/transactions', 62, {}, { listingIdA: 6602, listingIdB: 6603, note: 'still want to trade' });
check('...a trade request between them gets the non-match answer (never "blocked") and nothing is stored', r.status === 400 && r.json.error === "These two listings aren't actually a mutual match." && !one('SELECT 1 AS x FROM transaction_requests WHERE listing_a_id = 6602'), r.text);
r = await call(listingOffers.onRequestPost, 'POST', '/x', 62, { id: '6603' }, { offerPrice: 700000 });
check("...and an offer on the other's listing is a 404", r.status === 404, r.text);
// A trade request asked for before the block can't be confirmed after it (agents would then be told).
run("INSERT INTO transaction_requests (id, opened_by_user_id, listing_a_id, listing_b_id, user_a_id, user_b_id, note) VALUES (6690, 62, 6602, 6603, 62, 63, 'asked before the block')");
r = await call(txConfirm.onRequestPost, 'POST', '/x', 63, { id: '6690' });
check('...and a trade request from before the block cannot be confirmed (404, nothing changes)', r.status === 404 && one('SELECT partner_confirmed_at FROM transaction_requests WHERE id = 6690').partner_confirmed_at === null, r.text);

// A suspended owner's pre-listing is gone for agents (open, browse, proposals, showings); admins can still open it.
const plIndex = await mod('functions/api/pre-listings/index.js');
const plOne = await mod('functions/api/pre-listings/[id].js');
const plBids = await mod('functions/api/pre-listings/[id]/bids/index.js');
const plShowings = await mod('functions/api/pre-listings/[id]/showings/index.js');
const plShowing = await mod('functions/api/pre-listings/[id]/showings/[showingId].js');
run(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price) VALUES
  (650, 65, 'Home', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 700000), (651, 64, 'Home', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 700000)`);
r = await call(plOne.onRequestGet, 'GET', '/x', 68, { id: '650' });
check('(setup) an approved agent opens an open pre-listing', r.status === 200, r.text.slice(0, 200));
run("UPDATE users SET status = 'suspended' WHERE id = 65");
r = await call(plOne.onRequestGet, 'GET', '/x', 68, { id: '650' });
check("a suspended owner's pre-listing is a 404 to agents", r.status === 404);
r = await call(plIndex.onRequestGet, 'GET', '/api/pre-listings', 68);
check('...it leaves the agent browse (other homes stay)', !r.json.preListings.some(p => p.id === 650) && r.json.preListings.some(p => p.id === 651));
r = await call(plIndex.onRequestGet, 'GET', '/api/pre-listings', 61);
check('...and the teaser list', !r.json.preListings.some(p => p.id === 650));
r = await call(plBids.onRequestPost, 'POST', '/x', 68, { id: '650' }, { message: 'Plan', commissionPct: 2 });
check('...no proposal can be sent to it', r.status === 404);
r = await call(plShowings.onRequestPost, 'POST', '/x', 68, { id: '650' }, { proposedAt: fut(72) });
check('...nor a showing request', r.status === 404);
r = await call(plOne.onRequestGet, 'GET', '/x', 8, { id: '650' });
check('...while an admin can still open it', r.status === 200);

// A refused duplicate showing request doesn't use up one of the agent's slots.
r = await call(plShowings.onRequestPost, 'POST', '/x', 68, { id: '651' }, { proposedAt: fut(72) });
const sid = r.json && r.json.id;
const dupA = await call(plShowings.onRequestPost, 'POST', '/x', 68, { id: '651' }, { proposedAt: fut(80) });
const dupB = await call(plShowings.onRequestPost, 'POST', '/x', 68, { id: '651' }, { proposedAt: fut(90) });
check('duplicate showing requests are refused (showing_pending)', r.status === 201 && dupA.status === 400 && dupA.json.code === 'showing_pending' && dupB.json.code === 'showing_pending', `${r.status} ${dupA.text}`);
check("...without using up the agent's showing-request slots", one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 68 AND kind = 'showing_request'").n === 1);
await call(plShowing.onRequestPut, 'PUT', '/x', 68, { id: '651', showingId: String(sid) }, { action: 'cancel' });
r = await call(plShowings.onRequestPost, 'POST', '/x', 68, { id: '651' }, { proposedAt: fut(96) });
check('...so after a cancel a new request goes through', r.status === 201, r.text);

// A trade proposal's per-request limit can't be dodged by spelling the request id another way.
L(6604, 66); L(6605, 67);
run("INSERT INTO transaction_requests (id, opened_by_user_id, listing_a_id, listing_b_id, user_a_id, user_b_id, status, partner_confirmed_at) VALUES (6100, 66, 6604, 6605, 66, 67, 'open', datetime('now'))");
const tcodes = [];
for (const sp of ['6100', '06100', '6100.0', '+6100', '006100']) tcodes.push((await call(txBids.onRequestPost, 'POST', '/x', 68, { id: sp }, { message: 'A plan for both homes', commissionPct: 2 })).status);
r = await call(txBids.onRequestPost, 'POST', '/x', 68, { id: '0006100' }, { message: 'One more', commissionPct: 2 });
check("a trade proposal's per-request limit counts every spelling of the id as the same request", tcodes.every(c => c === 201) && r.status === 429 && one("SELECT COUNT(*) AS n FROM service_bids WHERE request_type = 'transaction' AND request_id = 6100").n === 1, `${tcodes} ${r.status}`);
check('...and an id that is not a whole number is a 404', (await call(txBids.onRequestPost, 'POST', '/x', 68, { id: 'abc' }, { message: 'x', commissionPct: 2 })).status === 404);

// Export My Data: proposals stay sealed until Decision Night; past-client reviews written and saved alerts are in it.
const exportApi = await mod('functions/api/account/export.js');
run('UPDATE pre_listings SET proposals_due_at = ? WHERE id = 651', fut(72));
run("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 651, 3, 'SEALED PLAN', 2.5, 'pending')");
run(`INSERT INTO accessibility_needs_alerts (user_id, label, adaptations_json) VALUES (64, 'ramp alert', '["ramp"]')`);
run("INSERT INTO past_client_reviews (agent_user_id, reviewer_user_id, rating, client_side, sale_year, sale_city, sale_address) VALUES (68, 64, 5, 'sold', 2022, 'Bonita', '9 Private Ln')");
r = await call(exportApi.onRequestGet, 'GET', '/api/account/export', 64);
const ex = JSON.parse(r.text);
const sealedBid = ex.proposalsReceived.find(b => b.request_id === 651);
check('the export keeps proposals sealed until Decision Night (no message or fee, the due time instead)', sealedBid && sealedBid.sealedUntil && !('message' in sealedBid) && !('commission_pct' in sealedBid) && !r.text.includes('SEALED PLAN'), JSON.stringify(sealedBid));
check('...and has the past-client reviews the person wrote (with the address they gave) and their saved alerts',
  ex.pastClientReviewsWritten.length === 1 && ex.pastClientReviewsWritten[0].sale_address === '9 Private Ln'
  && ex.alerts.some(a => a.kind === 'accessibility' && a.label === 'ramp alert') && !r.text.includes('notified_home_ids_json'), JSON.stringify({ p: ex.pastClientReviewsWritten, a: ex.alerts }));
run('UPDATE pre_listings SET proposals_due_at = NULL WHERE id = 651');
r = await call(exportApi.onRequestGet, 'GET', '/api/account/export', 64);
check('...once they are open, the export has them in full', r.text.includes('SEALED PLAN'));

// Copy fixes.
const mnotify = await mod('functions/_lib/marketplaceNotify.js');
await mnotify.notifyBidDecision({ env, waitUntil() {} }, 68, 'pre_listing', 651, true);
check('the chosen agent is told it was chosen on Amico Haus and a written agreement comes next (never "accepted!")', notes(68, 'The homeowner chose your proposal on Amico Haus. Next step: a written agreement with your brokerage.').length === 1);
L(6606, 68);
r = await call(lflyer.onRequestGet, 'GET', '/x', 68, { id: '6606' });
check('a flyer for a listing an approved agent posted says "by the agent named above", never "Posted by the owner"', r.status === 200 && r.text.includes('Posted on Amico Haus by the agent named above') && !r.text.includes('Posted by the owner'), r.text.slice(-500));
const dpLib = await mod('functions/_lib/devProjects.js');
check('FinderMine "flip" projects read as "Renovation" (the stored key stays)', dpLib.PROJECT_TYPE_LABELS.flip === 'Renovation' && dpLib.PROJECT_TYPES.includes('flip') && page('main.js').includes("flip: 'Renovation'") && !page('main.js').includes('Fix & Flip'));
check('demo seed posts carry no family-status lines or money math', !/Kids are grown|Empty-nesters|Growing family|typical selling costs|another mortgage|SELLING_COST_PCT/.test(page('functions/api/admin/seed.js')));
check('...and migration_v43 rewrites the ones already stored, demo accounts only',
  page('migration_v43.sql').includes("WHERE body LIKE 'Kids are grown%' AND user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.amicohaus.local')") && page('migration_v43.sql').includes("LIKE '%after typical selling costs%'"));
check('the agent profile no longer promises a sale-records check', !page('functions/profile/[id].js').includes('Not yet checked') && page('functions/profile/[id].js').includes("Amico Haus doesn't check these against sale records."));
check('Brag Cards and the badge carry the founding caption', page('functions/_lib/brag.js').includes('approved agents there; recognition only'));
check('home page: a partner asks, the other confirms, each picks their own agent', page('index.html').includes('Either partner in a match can ask to bring agents in to help coordinate the closing. The other partner confirms first, and each of you can choose your own agent.'));
check('README: no "a fact, not a claim" and no agent-on-every-trade promise', !page('README.md').includes('a fact, not a claim') && !page('README.md').includes('still with a licensed agent involved') && page('README.md').includes('we recommend a licensed agent on every trade'));
check('choosing a proposal says it only marks it chosen; a written agreement comes next', page('main.js').includes('This only marks it as chosen on Amico Haus') && !page('main.js').includes("toast('Proposal accepted!')"));
check('opening a trade to agents says it waits for the partner', page('main.js').includes('Sent to your trade partner to confirm. Agents see it once they do.') && !page('main.js').includes('Opened to agent bids!'));

console.log = realLog;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
