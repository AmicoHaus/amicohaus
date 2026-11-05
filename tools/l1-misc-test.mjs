// Batch L1 (role B3): saved searches (validation, cap, duplicates, rate limit, the background notifier with
// neighborhood, demo/suspended/blocked filters, one alert per person, the real /listing link), the reveal-box
// removal, matches leaving out suspended owners, match feedback ownership, license wording data (licenseCheckedAt)
// and the profile/listing page wording, founding-spot fixes (edit grants, suspend releases, back of the line),
// agent rules agreement, fixed rejection reasons, attribution wording and the signup alert, signup counting, the
// service-estimate ranges, hired-here review remove/restore with recusal, and the public directory filters.
// Runs the real handlers against an in-memory SQLite stand-in for D1; emails are captured by a stubbed fetch.
// Usage: node --disable-warning=ExperimentalWarning tools/l1-misc-test.mjs <projectRoot>
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
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; else passed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); };
const call = async (handler, method, path, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: type.includes('json') ? JSON.parse(text) : null };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const exec = (sql, ...a) => sqlite.prepare(sql).run(...a);
const savedNotes = (uid) => q("SELECT body, link FROM notifications WHERE user_id = ? AND type = 'saved_search' ORDER BY id", uid);
console.log = () => {};

const user = (id, name, extra = {}) => {
  exec('INSERT INTO users (id, email, display_name, role, status, signup_intent, signup_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, extra.email || `u${id}@example.test`, name, extra.role || 'user', extra.status || 'active', extra.intent || null, extra.source || null);
  exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
// 1 homeowner Ana, 2 searcher Sam, 3 demo searcher, 4 suspended searcher, 5 blocked the owner, 6 blocked by the owner,
// 7 approved agent Gus, 8 admin, 9 and 13 trade owners, 11 price-filtered searcher, 12 neighborhood-only searcher,
// 14 rental owner.
user(1, 'Ana Owner'); user(2, 'Sam Searcher'); user(3, 'Demo Searcher', { email: 'd3@demo.amicohaus.local' });
user(4, 'Sus Searcher', { status: 'suspended' }); user(5, 'Blocker'); user(6, 'Blocked'); user(7, 'Gus Agent');
user(8, 'Dee Admin', { role: 'admin' }); user(9, 'Bo Trader'); user(11, 'Rich Searcher'); user(12, 'Hood Searcher');
user(13, 'Cy Trader'); user(14, 'Rae Landlord');
exec('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (5, 1), (1, 6)');
for (const [zip, lat, lng] of [['91910', 32.637, -117.06], ['91911', 32.607, -117.05], ['91913', 32.62, -116.99], ['91914', 32.66, -116.96], ['91915', 32.62, -116.95], ['91902', 32.67, -117.01], ['92104', 32.74, -117.13]]) {
  exec('INSERT OR IGNORE INTO zip_codes (zip, lat, lng) VALUES (?, ?, ?)', zip, lat, lng);
}

const savedApi = await mod('functions/api/saved-searches/index.js');
const savedOne = await mod('functions/api/saved-searches/[id].js');
const listingsApi = await mod('functions/api/listings/index.js');
const bulkApi = await mod('functions/api/listings/bulk.js');
const listingsLib = await mod('functions/_lib/listings.js');
const savedLib = await mod('functions/_lib/savedSearches.js');
const listingPage = await mod('functions/listing/[id].js');
const directoryApi = await mod('functions/api/directory.js');

// ---------------- Saved searches: POST validation, cap, duplicates, rate limit ----------------
let r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 2, {}, { locations: 'Eastlake', propertyType: 'Any', priceMin: -50, priceMax: '1e308' });
let row = r.json && one('SELECT * FROM saved_searches WHERE id = ?', r.json.id);
check('a negative min is stored as 0 and a huge max is capped (num())', r.status === 201 && row.price_min === 0 && row.price_max === 500000000, JSON.stringify(row));
exec('DELETE FROM saved_searches WHERE user_id = 2');
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 2, {}, { locations: 'Chula Vista', priceMin: 900000, priceMax: 500000 });
check('max below min is refused', r.status === 400 && /at or above the min/.test(r.json.error), JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 2, {}, { locations: 'Chula Vista', priceMin: 'abc', priceMax: '', propertyType: 'Castle' });
row = r.json && one('SELECT * FROM saved_searches WHERE id = ?', r.json.id);
check('text and blanks mean "no limit", and an unknown type means Any', r.status === 201 && row.price_min === 0 && row.price_max === 0 && row.property_type === 'Any', JSON.stringify(row));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 2, {}, { locations: 'chula vista', priceMin: '', priceMax: '', propertyType: 'Any' });
check('the same search again (any letter case) is refused as a duplicate', r.status === 400 && r.json.code === 'saved_search_duplicate', JSON.stringify(r.json));
for (let i = 1; i <= 9; i++) await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 2, {}, { locations: `Town ${i}` });
check('ten saved searches are allowed', one('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = 2').n === 10);
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 2, {}, { locations: 'Town 11' });
check('the 11th is refused with the cap message', r.status === 400 && r.json.code === 'saved_search_limit' && /up to 10 saved searches/.test(r.json.error), JSON.stringify(r.json));
r = await call(savedApi.onRequestGet, 'GET', '/api/saved-searches', 2);
check('GET lists only their own searches, newest first, with the cap', r.status === 200 && r.json.searches.length === 10 && r.json.max === 10 && r.json.searches[0].locations === 'Town 9');
const someId = r.json.searches[0].id;
r = await call(savedOne.onRequestDelete, 'DELETE', '/x', 9, { id: String(someId) });
check("someone else can't delete it", r.status === 403);
r = await call(savedOne.onRequestDelete, 'DELETE', '/x', 2, { id: 'abc' });
check('a non-number id is a 404', r.status === 404);
r = await call(savedOne.onRequestDelete, 'DELETE', '/x', 2, { id: String(someId) });
check('the owner can delete it', r.status === 200 && !one('SELECT 1 AS x FROM saved_searches WHERE id = ?', someId));
exec("DELETE FROM saved_searches WHERE user_id = 2 AND locations LIKE 'Town %'");
for (let i = 0; i < 20; i++) exec("INSERT INTO user_action_log (user_id, kind) VALUES (11, 'saved_search')");
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 11, {}, { locations: 'Chula Vista', priceMin: 2000000 });
check('the 21st save in a day hits the rate limit (429 rate_limited)', r.status === 429 && r.json.code === 'rate_limited' && !one('SELECT 1 AS x FROM saved_searches WHERE user_id = 11'), JSON.stringify(r.json));
exec('DELETE FROM user_action_log WHERE user_id = 11');
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 11, {}, { locations: 'Chula Vista', priceMin: 2000000 });
check('...and each save is recorded against the limit', r.status === 201 && one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 11 AND kind = 'saved_search'").n === 1);
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', null, {}, { locations: 'X' });
check('signed out: 401', r.status === 401);

// ---------------- Saved searches: the notifier ----------------
// Sam has two overlapping searches; demo, suspended and blocked people and the owner have matching ones too.
exec("INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max) VALUES (2, 'Eastlake', 'Any', 0, 0), (2, 'Chula Vista', 'Condo', 500000, 900000)");
for (const uid of [1, 3, 4, 5, 6]) exec("INSERT INTO saved_searches (user_id, locations) VALUES (?, 'Chula Vista')", uid);
exec("INSERT INTO saved_searches (user_id, locations) VALUES (12, 'Eastlake')");
const trade = { city: 'Chula Vista', state: 'CA', neighborhood: 'Eastlake', propertyType: 'Condo', estimatedValue: 750000, beds: 2, baths: 2,
  locations: 'San Diego', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0 };
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Reveal test', address: '77 Hidden Ln', showExactAddress: true });
const L1 = r.json && r.json.id;
check('a new listing is created', r.status === 201 && !!L1, JSON.stringify(r.json));
check('the old "reveal exact address" box can no longer be turned on', one('SELECT show_exact_address FROM listings WHERE id = ?', L1).show_exact_address === 0);
check('one alert per person, even with two matching searches', savedNotes(2).length === 1, JSON.stringify(savedNotes(2)));
check('the alert names the neighborhood and links to the real listing page', savedNotes(2)[0] && savedNotes(2)[0].body === 'A new listing matches your saved search: Condo in Eastlake, Chula Vista, CA' && savedNotes(2)[0].link === `/listing/${L1}`, JSON.stringify(savedNotes(2)));
check('a neighborhood-only search now fires', savedNotes(12).length === 1);
check('demo, suspended, blocked (both ways) people and the owner get nothing', [1, 3, 4, 5, 6].every(uid => savedNotes(uid).length === 0), JSON.stringify([1, 3, 4, 5, 6].map(u => savedNotes(u).length)));
check("a search whose price range doesn't fit gets nothing", savedNotes(11).length === 0);
const before = q("SELECT id FROM notifications WHERE type = 'saved_search'").length;
await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, isRental: true, rentAmount: 3000 });
await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, isBuyerOnly: true });
check('a rental or a buyer-only profile alerts no saved search', q("SELECT id FROM notifications WHERE type = 'saved_search'").length === before);
const validated = listingsLib.validateListingInput({ ...trade, showExactAddress: true });
await listingsLib.insertListing(DB, 1, validated.data);
check('insertListing itself no longer sends saved-search alerts (they run in the background)', q("SELECT id FROM notifications WHERE type = 'saved_search'").length === before);
check('validateListingInput always turns the reveal box off (trade and rental)', validated.data.showExactAddress === false && listingsLib.validateListingInput({ ...trade, isRental: true, rentAmount: 2000, showExactAddress: true }).data.showExactAddress === false);
exec("UPDATE users SET email = 'u13@demo.amicohaus.local' WHERE id = 13");
await savedLib.notifySavedSearches(DB, { id: 999, user_id: 13, city: 'Chula Vista', state: 'CA', neighborhood: '', property_type: 'Condo', estimated_value: 700000 });
exec("UPDATE users SET email = 'u13@example.test', status = 'suspended' WHERE id = 13");
await savedLib.notifySavedSearches(DB, { id: 998, user_id: 13, city: 'Chula Vista', state: 'CA', neighborhood: '', property_type: 'Condo', estimated_value: 700000 });
exec("UPDATE users SET status = 'active' WHERE id = 13");
check("a demo or suspended owner's listing alerts nobody", q("SELECT id FROM notifications WHERE type = 'saved_search'").length === before);
r = await call(bulkApi.onRequestPost, 'POST', '/api/listings/bulk', 1, {}, { listings: [
  { ...trade, neighborhood: '', title: 'B1', estimatedValue: 600000 }, { ...trade, neighborhood: '', title: 'B2', estimatedValue: 610000 },
  { ...trade, neighborhood: '', title: 'B3', estimatedValue: 620000 }, { city: '' }] });
const firstBulk = r.json.results[0].id;
check('a bulk upload saves the good rows', r.status === 200 && r.json.created === 3);
check('...and each matching person gets ONE alert for the whole upload, linking the first home', savedNotes(2).length === 2 && savedNotes(2)[1].body === '3 new listings match your saved search, including Condo in Chula Vista, CA' && savedNotes(2)[1].link === `/listing/${firstBulk}`, JSON.stringify(savedNotes(2)));

// ---------------- The public listing page ----------------
exec("UPDATE users SET is_verified = 1 WHERE id = 1");
exec(`UPDATE listings SET life_event_tags_json = '["more_space"]', mello_roos_annual = 0 WHERE id = ?`, L1);
const page = async (who, id = L1) => call(listingPage.onRequestGet, 'GET', `/listing/${id}`, who, { id: String(id) });
r = await page(1);
check('the owner sees their street address, marked "only you see this"', r.status === 200 && r.text.includes('77 Hidden Ln <span class="tiny">(only you see this)</span>'), (r.text.match(/77 Hidden[^<]*<[^>]*>[^<]*/) || [''])[0]);
r = await page(8);
check('an admin sees it marked private', r.text.includes('77 Hidden Ln <span class="tiny">(private: only the owner and admins see this)</span>'));
const anon = await page(null);
const other = await page(2);
check('anyone else never sees the street address', !anon.text.includes('77 Hidden Ln') && !other.text.includes('77 Hidden Ln'));
check('no "Verified" badge on the page, even for a flagged owner', !/Verified/.test(anon.text) && !/badge-verified/.test(anon.text));
check('"why I\'m moving" tags are not on the public page', !/Need more space/.test(anon.text) && !/more_space/.test(anon.text) && !/Need more space/.test((await page(1)).text));
check("the value is labeled as the owner's estimate", anon.text.includes("Owner's estimated value (not an appraisal or list price)"));
check('costs are labeled as from the owner, with the confirm line', anon.text.includes('Costs (from the owner)') && anon.text.includes('Owner says: no Mello-Roos') && /Confirm on the property tax bill and in the seller(?:'|&#39;)s Mello-Roos and HOA disclosures./.test(anon.text), (anon.text.match(/Costs[^\n]{0,300}/) || [''])[0]);
check('the meta description says "owner\'s estimated value", not "valued around"', /<meta name="description" content="[^"]*Owner&#39;s estimated value \$750,000 \(not an appraisal\)/.test(anon.text) && !/valued around/.test(anon.text));
check('the footer carries Equal Housing Opportunity and the accessibility link', anon.text.includes('<p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>'));
check('signed out: no comments, a sign-up line instead (nothing to index)', !/comments-list/.test(anon.text) && /to read and join the discussion/.test(anon.text));
check('the offer form carries the "not a purchase agreement" line', other.text.includes('Not a purchase agreement. A California home sale needs a written contract signed by both sides, usually prepared by your agents. Accepting here only tells the other side you\x27d like to move forward.') && /Submit Offer/.test(other.text));
// Comments: signed-in only, agent identity line, hidden ones left out, the composer line.
exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, license_verified, license_verified_at, reviewed_at, service_zips_json) VALUES (7, 'approved', '01234567', 'Bay Realty', 1, '2026-10-30 18:00:00', '2026-10-29 17:00:00', '[\"91913\"]')");
const thread = one('SELECT id FROM posts WHERE listing_id = ?', L1).id;
exec("INSERT INTO comments (post_id, user_id, body) VALUES (?, 7, 'Lovely light in the kitchen'), (?, 2, 'Is the garage big?')", thread, thread);
exec("INSERT INTO comments (post_id, user_id, body, hidden_at, hidden_reason) VALUES (?, 9, 'Hidden remark', datetime('now'), 'Off topic')", thread);
r = await page(2);
check('signed in: comments show, with the composer fair-housing line', r.text.includes('Is the garage big?') && r.text.includes('Describe the home, not who should live there or who lives nearby.'));
check("an approved agent's comment carries their DRE identity line", r.text.includes('Gus Agent · DRE #01234567 on file · Bay Realty'));
check('a hidden comment is left out for everyone else', !r.text.includes('Hidden remark'));
r = await page(9);
check('...but its author still sees it, labeled', r.text.includes('Hidden remark') && r.text.includes('Hidden by moderation. Only you can see this comment.'));
r = await page(8);
check('...and an admin sees it, with the reason', r.text.includes('Hidden remark') && r.text.includes('Hidden (admins only see this): Off topic'));
check('signed out still sees no comment text', !(await page(null)).text.includes('Lovely light'));
// Rentals and an agent-owned listing.
const rentalId = Number(exec("INSERT INTO listings (user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, is_rental, rent_amount) VALUES (14, 'Rental', 'Chula Vista', 'CA', 'Condo', 2, 2, 600000, '600k-1m', 1, 1800)").lastInsertRowid);
r = await page(null, rentalId);
check('a rental says "rent calculator" (not rent-for-equity) with the prepayment caution', r.text.includes('rent calculator</a>') && !/rent-for-equity/.test(r.text) && r.text.includes('A large rent prepayment can be lost if the landlord sells, refinances or loses the home.'));
check('a signed-out visit creates no discussion thread (nothing written by crawlers)', !one('SELECT 1 AS x FROM posts WHERE listing_id = ?', rentalId));
check('...and its meta description no longer says "Ultra-luxury"', !/Ultra-luxury/i.test(r.text) && /For rent at \$1,800\/mo/.test(r.text));
const agentListing = Number(exec("INSERT INTO listings (user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier) VALUES (7, 'Client home', 'Chula Vista', 'CA', 'Condo', 2, 2, 700000, '600k-1m')").lastInsertRowid);
r = await page(null, agentListing);
check('an agent-owned listing says "DRE #… on file" in the Listed-by line', /Listed by <a[^>]*>Gus Agent · DRE #01234567 on file · Bay Realty<\/a>/.test(r.text));

// ---------------- Public directory API ----------------
exec("UPDATE users SET status = 'suspended' WHERE id = 14");
r = await call(directoryApi.onRequestGet, 'GET', '/api/directory?limit=60', null);
check("the public directory leaves out suspended owners' listings", r.status === 200 && !r.json.listings.some(l => l.id === rentalId) && r.json.listings.some(l => l.id === L1));
check('...and never sends "why I\'m moving" tags', r.json.listings.every(l => !('life_event_tags' in l) && !('life_event_tags_json' in l)));
exec("UPDATE users SET status = 'active' WHERE id = 14");

// ---------------- Matches ----------------
const matchesApi = await mod('functions/api/matches.js');
const matchNotify = await mod('functions/_lib/matchNotify.js');
const feedback = await mod('functions/api/match-feedback/[a]/[b].js');
const addListing = (uid, city, type, value, wantsCity, wantsType, min, max, extra = '') => {
  const id = Number(exec(`INSERT INTO listings (user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier${extra ? ', is_rental, rent_amount' : ''}) VALUES (?, 'M', ?, 'CA', ?, 3, 2, ?, '600k-1m'${extra ? `, ${extra}` : ''})`, uid, city, type, value).lastInsertRowid);
  if (wantsCity) exec('INSERT INTO desired_criteria (listing_id, locations, property_type, price_min, price_max, min_beds, min_baths) VALUES (?, ?, ?, ?, ?, 0, 0)', id, wantsCity, wantsType, min, max);
  return id;
};
const MA = addListing(9, 'Spring Valley', 'Townhouse', 800000, 'La Mesa', 'Townhouse', 500000, 700000);
const MB = addListing(13, 'La Mesa', 'Townhouse', 600000, 'Spring Valley', 'Townhouse', 700000, 900000);
const hasPartner = (res, id) => (res.json.matches || []).some(m => (m.a && m.a.listingId === id) || (m.b && m.b.listingId === id));
r = await call(matchesApi.onRequestGet, 'GET', '/api/matches', 9);
check('(setup) the two trades match', hasPartner(r, MB), JSON.stringify(r.json).slice(0, 200));
exec("UPDATE users SET status = 'suspended' WHERE id = 13");
r = await call(matchesApi.onRequestGet, 'GET', '/api/matches', 9);
check("a suspended owner's listing no longer shows as a match", !hasPartner(r, MB));
const ctx = { env, request: new Request('https://amicohaus.com/api/listings'), waitUntil() {} };
await matchNotify.notifyNewMatches(ctx, MA);
check('...and a new listing never notifies a suspended owner', q("SELECT 1 FROM notifications WHERE user_id = 13 AND type = 'match'").length === 0);
exec("UPDATE users SET status = 'active' WHERE id = 13");
const rentalMatch = addListing(14, 'La Mesa', 'Townhouse', 600000, null, null, 0, 0, '1, 3000');
await matchNotify.notifyNewMatches(ctx, rentalMatch);
const rentNote = one("SELECT body FROM notifications WHERE user_id = 9 AND type = 'match' AND body LIKE '%rental match%' ORDER BY id DESC");
check('a rental match alert has no "covers about X years" money math', !!rentNote && !/covers|years/.test(rentNote.body), rentNote && rentNote.body);
r = await call(feedback.onRequestPut, 'PUT', '/x', 2, { a: String(MA), b: String(MB) }, { feedback: 'down' });
check("match feedback on two listings you don't own is refused", r.status === 404 && !one('SELECT 1 AS x FROM match_feedback WHERE user_id = 2'));
r = await call(feedback.onRequestPut, 'PUT', '/x', 9, { a: String(MA), b: String(MB) }, { feedback: 'down' });
check('...and works for an owner of one of them', r.status === 200 && !!one('SELECT 1 AS x FROM match_feedback WHERE user_id = 9'));

// ---------------- License wording data ----------------
const agentsLib = await mod('functions/_lib/agents.js');
const dirLib = await mod('functions/_lib/agentDirectory.js');
let prof = await agentsLib.getAgentProfile(DB, 7);
check('licenseCheckedAt is the DRE check date', prof.licenseCheckedAt === '2026-10-30 18:00:00' && prof.licenseNumber === '01234567' && prof.licenseVerified === true, JSON.stringify(prof.licenseCheckedAt));
exec('UPDATE agent_profiles SET license_verified_at = NULL WHERE user_id = 7');
check('...else the approval date', (await agentsLib.getAgentProfile(DB, 7)).licenseCheckedAt === '2026-10-29 17:00:00');
exec('UPDATE agent_profiles SET license_verified = 0 WHERE user_id = 7');
check('...and nothing once the check is cleared (license marked not active, or the number changed)', (await agentsLib.getAgentProfile(DB, 7)).licenseCheckedAt === null);
exec("UPDATE agent_profiles SET license_verified = 1, license_verified_at = '2026-10-30 18:00:00' WHERE user_id = 7");
exec("UPDATE users SET is_verified = 1 WHERE id = 7");
let entry = await dirLib.buildAgentDirectoryEntry(DB, 7);
check('the directory entry carries licenseNumber, licenseVerified and licenseCheckedAt', entry.licenseNumber === '01234567' && entry.licenseVerified === true && entry.licenseCheckedAt === '2026-10-30 18:00:00');
check('...and no Top Rated flag or Verified badge field', !('topRated' in entry) && !('isVerified' in entry) && !('winRate' in entry));
check('"Local specialist" is now "focusedServiceArea" (old name kept for the cards)', entry.focusedServiceArea === true && entry.isLocalSpecialist === true);
const filters = (qs) => dirLib.parseDirectoryFilters(new URL(`https://amicohaus.com/api/agents/directory?${qs}`));
check('the Top Rated filter is gone (ignored)', !('topRatedOnly' in filters('topRatedOnly=1')) && await dirLib.agentMatchesFilters(DB, entry, filters('topRatedOnly=1')));
check('the focused-service-area filter works under both names', filters('focusedServiceAreaOnly=1').focusedServiceAreaOnly && filters('localSpecialistOnly=1').focusedServiceAreaOnly
  && await dirLib.agentMatchesFilters(DB, entry, filters('focusedServiceAreaOnly=1')));

// ---------------- The agent profile page ----------------
const profilePage = await mod('functions/profile/[id].js');
const tid = Number(exec("INSERT INTO agent_teams (name, created_by_user_id) VALUES ('Coastal Agent Group', 7)").lastInsertRowid);
exec("INSERT INTO agent_team_members (team_id, agent_user_id, role, status) VALUES (?, 7, 'owner', 'active')", tid);
exec("INSERT INTO founding_agents (zip, agent_user_id) VALUES ('91913', 7)");
exec(`UPDATE agent_profiles SET default_commission_pct = 2.5 WHERE user_id = 7`);
r = await call(profilePage.onRequestGet, 'GET', '/profile/7', null, { id: '7' });
const ptext = r.text;
check('the profile says "DRE license # on file · checked <date> · Check current status" with the DRE link', r.status === 200
  && ptext.includes('DRE license #01234567 on file · checked Oct 30, 2026 · <a href="https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=01234567" target="_blank" rel="noopener noreferrer">Check current status</a>'), (ptext.match(/DRE license[^\n]{0,200}/) || [''])[0]);
check('no "License checked on DRE" chip, no Verified badge, no Top Rated', !/License checked on DRE/.test(ptext) && !/✓ Verified/.test(ptext) && !/Top Rated/.test(ptext));
check('the meta description says "approved", never "vetted"', /is an approved real estate agent on Amico Haus/.test(ptext) && !/vetted/i.test(ptext));
check('the founding chip explains itself: recognition only', ptext.includes('title="Among the first 3 approved agents in 91913; recognition only."'));
check('the fee line sits with the fees', ptext.includes('Each agent sets their own fees; commissions are negotiable and not set by law or by Amico Haus.'));
check('the review section carries the operator line', ptext.includes('Amico Haus is run by Rudy Flores, a Coldwell Banker West agent who may compete for the same homes.'));
check("a team name ending in Group doesn't get \"Team\" added", ptext.includes('Bay Realty · Coastal Agent Group') && !ptext.includes('Coastal Agent Group Team'));
check('the profile footer carries Equal Housing Opportunity', ptext.includes('<p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>'));
r = await call(profilePage.onRequestGet, 'GET', '/profile/1', null, { id: '1' });
check('a homeowner profile shows no Verified badge either', r.status === 200 && !/✓ Verified/.test(r.text));

// ---------------- Hired-here review remove / restore, with recusal ----------------
const reviewsAdmin = await mod('functions/api/admin/agent-reviews/[id].js');
const reviewsList = await mod('functions/api/admin/agent-reviews/index.js');
const market = await mod('functions/_lib/marketplace.js');
exec("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, status) VALUES (60, 1, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 700000, 'awarded'), (61, 9, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 700000, 'awarded')");
exec("INSERT INTO service_bids (request_type, request_id, agent_user_id, status) VALUES ('pre_listing', 60, 7, 'accepted'), ('pre_listing', 61, 7, 'accepted'), ('pre_listing', 61, 8, 'declined')");
exec("INSERT INTO agent_reviews (id, agent_user_id, reviewer_user_id, request_type, request_id, rating, comment) VALUES (500, 7, 1, 'pre_listing', 60, 5, 'Great to work with'), (501, 7, 9, 'pre_listing', 61, 4, 'Solid')");
check('(setup) two reviews count', (await market.fetchAgentRatingSummary(DB, 7)).reviewCount === 2);
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 7, { id: '500' }, { action: 'remove', reason: 'x' });
check('only admins can remove a review', r.status === 403);
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '500' }, { action: 'remove' });
check('a removal needs a reason', r.status === 400);
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '501' }, { action: 'remove', reason: 'Fake hire' });
check('recused: an admin account proposed on that home, so no admin can remove it', r.status === 403 && r.json.code === 'recused' && !!one('SELECT 1 AS x FROM agent_reviews WHERE id = 501'));
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '500' }, { action: 'remove', reason: 'Not about the agent\'s work' });
check('an admin removes a review with a reason', r.status === 200 && !one('SELECT 1 AS x FROM agent_reviews WHERE id = 500'));
check('...it leaves the rating everywhere at once', (await market.fetchAgentRatingSummary(DB, 7)).reviewCount === 1 && !(await call(profilePage.onRequestGet, 'GET', '/profile/7', null, { id: '7' })).text.includes('Great to work with'));
check('...the reviewer is told why', !!one("SELECT 1 AS x FROM notifications WHERE user_id = 1 AND body = 'Your review of Gus Agent was removed: Not about the agent''s work'"));
check('...and it is logged with the reason', !!one("SELECT 1 AS x FROM admin_audit_log WHERE action = 'agent_review_remove' AND target_id = 500 AND details LIKE '%Not about the agent%'"));
r = await call(reviewsList.onRequestGet, 'GET', '/x', 8);
check('the admin list shows the removed review with its reason, and "recused" on the other', r.status === 200 && r.json.removed.some(x => x.id === 500 && x.reason === "Not about the agent's work" && x.comment === 'Great to work with')
  && r.json.reviews.some(x => x.id === 501 && x.recused === true) && !r.json.reviews.some(x => x.id === 500), JSON.stringify(r.json).slice(0, 300));
check('only admins see the list', (await call(reviewsList.onRequestGet, 'GET', '/x', 2)).status === 403);
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '500' }, { action: 'restore', reason: 'Checked: a real hire' });
check('restore puts the same review back', r.status === 200 && one('SELECT comment, rating FROM agent_reviews WHERE id = 500').comment === 'Great to work with' && (await market.fetchAgentRatingSummary(DB, 7)).reviewCount === 2);
check('...and the removed list is empty again', (await call(reviewsList.onRequestGet, 'GET', '/x', 8)).json.removed.length === 0);
await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '500' }, { action: 'remove', reason: 'Again' });
exec("INSERT INTO agent_reviews (agent_user_id, reviewer_user_id, request_type, request_id, rating, comment) VALUES (7, 1, 'pre_listing', 60, 3, 'Newer review')");
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '500' }, { action: 'restore', reason: 'try' });
check("a removed review can't be restored over the homeowner's newer review of that hire", r.status === 409 && r.json.code === 'conflict');
// A removed review can't simply be posted again by the same reviewer (the removal would have no lasting effect).
exec("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, status) VALUES (62, 9, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 700000, 'awarded')");
exec("INSERT INTO service_bids (request_type, request_id, agent_user_id, status) VALUES ('pre_listing', 62, 7, 'accepted')");
exec("INSERT INTO agent_reviews (id, agent_user_id, reviewer_user_id, request_type, request_id, rating, comment) VALUES (510, 7, 9, 'pre_listing', 62, 1, 'Rule-breaking review')");
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '510' }, { action: 'remove', reason: 'Abusive' });
const repost = await market.submitReview(DB, 7, 9, 'pre_listing', '62', { rating: 1, comment: 'Rule-breaking review' });
check("the reviewer can't post a removed review again (told why, nothing stored)", r.status === 200 && !!repost.error && /was removed/.test(repost.error) && !one("SELECT 1 AS x FROM agent_reviews WHERE request_id = 62 AND request_type = 'pre_listing'"), JSON.stringify(repost));
r = await call(reviewsAdmin.onRequestPut, 'PUT', '/x', 8, { id: '510' }, { action: 'restore', reason: 'Reconsidered' });
check('...and a restore still works (no newer review in the way)', r.status === 200 && !!one('SELECT 1 AS x FROM agent_reviews WHERE id = 510'));
const again = await market.submitReview(DB, 7, 9, 'pre_listing', 62, { rating: 2, comment: 'x' });
check('...after a restore the usual "already reviewed" rule applies', again.error === "You've already reviewed this.", JSON.stringify(again));

// ---------------- Agent rules agreement, founding fixes ----------------
const apply = await mod('functions/api/agents/apply.js');
const decide = await mod('functions/api/admin/agent-applications/[id].js');
const appList = await mod('functions/api/admin/agent-applications/index.js');
const usersAdmin = await mod('functions/api/admin/users/[id].js');
const zipBoard = await mod('functions/_lib/zipBoard.js');
for (const id of [20, 21, 22, 23, 24, 25, 26, 27]) user(id, `Agent ${id}`);
r = await call(apply.onRequestPost, 'POST', '/x', 27, {}, { brokerageName: 'New Realty', licenseNumber: '05000027', serviceZips: ['92104'] });
check('a new application without agreeing to the agent rules is refused', r.status === 400 && r.json.code === 'rules_required' && /agent rules in the Terms of Use/.test(r.json.error) && !one('SELECT 1 AS x FROM agent_profiles WHERE user_id = 27'));
r = await call(apply.onRequestPost, 'POST', '/x', 27, {}, { brokerageName: 'New Realty', licenseNumber: '05000027', serviceZips: ['92104'], acceptRules: true });
let ap = one('SELECT status, rules_version, rules_accepted_at FROM agent_profiles WHERE user_id = 27');
check('agreeing stores the rules version and when', r.status === 201 && ap.status === 'pending' && ap.rules_version === '2026-11-04' && !!ap.rules_accepted_at, JSON.stringify(ap));
exec("UPDATE agent_profiles SET rules_accepted_at = '2026-11-04 01:00:00' WHERE user_id = 27");
r = await call(apply.onRequestPost, 'POST', '/x', 27, {}, { brokerageName: 'New Realty 2', licenseNumber: '05000027', serviceZips: ['92104'] });
check('a later save on the current version needs no new agreement, and keeps the first date', r.status === 201 && one('SELECT rules_accepted_at FROM agent_profiles WHERE user_id = 27').rules_accepted_at === '2026-11-04 01:00:00');
r = await call(apply.onRequestPost, 'POST', '/x', 7, {}, { brokerageName: 'Bay Realty', licenseNumber: '01234567', serviceZips: ['91913'] });
check("an approved agent who hasn't agreed yet is asked to on their next save", r.status === 400 && r.json.code === 'rules_required');

// Rejection reasons (fixed list).
r = await call(appList.onRequestGet, 'GET', '/x', 8);
check('the application list sends the fixed rejection reasons and the rules agreement', r.status === 200 && r.json.rejectionReasons.length === 5 && r.json.rejectionReasons.includes('License not found or not active')
  && r.json.applications.some(a => a.userId === 27 && a.rulesVersion === '2026-11-04' && a.rulesCurrent === true), JSON.stringify(r.json.rejectionReasons));
r = await call(decide.onRequestPut, 'PUT', '/x', 8, { id: '27' }, { decision: 'reject', rejectionReason: 'Other (explained below)' });
check('"Other" needs a short explanation', r.status === 400);
r = await call(decide.onRequestPut, 'PUT', '/x', 8, { id: '27' }, { decision: 'reject', rejectionReason: 'Incomplete application' });
check('a rejection stores the listed reason and tells the applicant', r.status === 200 && one('SELECT rejection_reason FROM agent_profiles WHERE user_id = 27').rejection_reason === 'Incomplete application'
  && !!one("SELECT 1 AS x FROM notifications WHERE user_id = 27 AND body LIKE '%Reason: Incomplete application.%'"));
r = await call(decide.onRequestPut, 'PUT', '/x', 8, { id: '27' }, { decision: 'reject', rejectionReason: 'License expired' });
check('free text from the old prompt is filed under Other', r.status === 200 && one('SELECT rejection_reason FROM agent_profiles WHERE user_id = 27').rejection_reason === 'Other: License expired');

// Founding: an approved agent who adds a launch ZIP on an edit takes an open spot right away.
const approvedAgent = (id, zips) => exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, service_zips_json, rules_version) VALUES (?, 'approved', ?, 'Realty', ?, '2026-11-04')", id, `060000${id}`, JSON.stringify(zips));
approvedAgent(20, ['92104']); approvedAgent(21, ['91902']); approvedAgent(22, ['91902']); approvedAgent(23, ['92104']); approvedAgent(24, ['92104']);
exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, service_zips_json, rules_version) VALUES (25, 'pending', '06000025', 'Realty', '[]', '2026-11-04')");
const editZips = (id, zips) => call(apply.onRequestPost, 'POST', '/x', id, {}, { brokerageName: 'Realty', licenseNumber: `060000${id}`, serviceZips: zips });
r = await editZips(20, ['92104', '91902']);
check('an approved agent adding a launch ZIP gets an open founding spot (no re-approval)', r.status === 201 && !!one("SELECT 1 AS x FROM founding_agents WHERE agent_user_id = 20 AND zip = '91902'"));
const n20 = one("SELECT body FROM notifications WHERE user_id = 20 ORDER BY id DESC");
check('...and is told, with "recognition only"', !!n20 && /founding agent in 91902/.test(n20.body) && /recognition only/.test(n20.body) && /no leads, clients or business are promised/.test(n20.body), n20 && n20.body);
await editZips(25, ['91902']);
check('a pending applicant editing gets no spot', !one("SELECT 1 AS x FROM founding_agents WHERE agent_user_id = 25"));
await editZips(21, ['91902']); await editZips(22, ['91902']);
const founders = async (zip) => (await DB.prepare(`SELECT agent_user_id FROM (${zipBoard.LIVE_FOUNDERS_SQL}) WHERE zip = ? ORDER BY agent_user_id`).bind(zip).all()).results.map(x => x.agent_user_id).join();
check('(setup) 91902 is full: 20, 21, 22', (await founders('91902')) === '20,21,22', await founders('91902'));
r = await call(usersAdmin.onRequestPost, 'POST', '/x', 2, { id: '21' }, { action: 'suspend' });
check('only admins can suspend', r.status === 403);
r = await call(usersAdmin.onRequestPost, 'POST', '/x', 8, { id: '8' }, { action: 'suspend' });
check("an admin account can't be suspended here", r.status === 400);
r = await call(usersAdmin.onRequestPost, 'POST', '/x', 8, { id: '21' }, { action: 'suspend' });
check('suspending an agent signs them out and releases their founding spots', r.status === 200 && one('SELECT status FROM users WHERE id = 21').status === 'suspended'
  && !one('SELECT 1 AS x FROM sessions WHERE user_id = 21') && !one('SELECT 1 AS x FROM founding_agents WHERE agent_user_id = 21'));
check('...and it is in the audit log', !!one("SELECT 1 AS x FROM admin_audit_log WHERE action = 'user_suspend' AND target_id = 21"));
await editZips(23, ['91902']);
check('the next approved agent takes the open spot', (await founders('91902')) === '20,22,23');
r = await call(usersAdmin.onRequestPost, 'POST', '/x', 8, { id: '21' }, { action: 'unsuspend' });
check('a reinstated agent goes to the back of the line (no spot while the ZIP is full)', r.status === 200 && r.json.foundingZips.length === 0 && one('SELECT status FROM users WHERE id = 21').status === 'active' && (await founders('91902')) === '20,22,23');
// Suspended outside the app (straight in the database): their old row must not bump the agent who took the spot.
exec("UPDATE users SET status = 'suspended' WHERE id = 22");
await editZips(24, ['91902']);
exec("UPDATE users SET status = 'active' WHERE id = 22");
check('an agent suspended in the database and reinstated does not silently push out the newer founder', (await founders('91902')) === '20,23,24', await founders('91902'));
exec('DELETE FROM founding_agents WHERE agent_user_id = 24');
r = await call(usersAdmin.onRequestPost, 'POST', '/x', 8, { id: '21' }, { action: 'suspend' });
r = await call(usersAdmin.onRequestPost, 'POST', '/x', 8, { id: '21' }, { action: 'unsuspend' });
check('...and gets a spot again when one is open', r.status === 200 && r.json.foundingZips.join() === '91902');
exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, service_zips_json, rules_version) VALUES (26, 'pending', '06000026', 'Realty', '[\"91913\"]', '2026-11-04')");
r = await call(decide.onRequestPut, 'PUT', '/x', 8, { id: '26' }, { decision: 'approve', licenseNumber: '06000026' });
const n26 = one("SELECT body FROM notifications WHERE user_id = 26 ORDER BY id DESC");
check('the approval message keeps saying founding is recognition only', r.status === 200 && /founding agent in 91913/.test(n26.body) && /recognition only/.test(n26.body), n26 && n26.body);
check('foundingCaption wording', zipBoard.foundingCaption(['91913']) === 'Among the first 3 approved agents in 91913; recognition only.');
r = await call(usersAdmin.onRequestPost, 'POST', '/x', 8, { id: '1' }, { action: 'verify' });
check('the admin verify toggle still works (the flag stays, just never shown)', r.status === 200 && one('SELECT is_verified FROM users WHERE id = 1').is_verified === 1);

// ---------------- Attribution wording ----------------
const attribution = await mod('functions/_lib/attribution.js');
const organic = attribution.describeAttribution(JSON.stringify({ utm_source: 'tiktok', utm_medium: 'video', utm_campaign: 'founding-agents', utm_content: 'mv4', utm_term: 'agents' }));
check('an organic video link reads "content:", and utm_term is printed', organic === 'tiktok / video · campaign: founding-agents · content: mv4 · term: agents', organic);
const paidLine = attribution.describeAttribution(JSON.stringify({ utm_source: 'facebook', utm_medium: 'cpc', utm_content: 'ad7', fbclid: 'x' }));
check('a paid link reads "ad:"', paidLine === 'facebook / cpc · ad: ad7 · Facebook/Instagram ad click', paidLine);

// ---------------- Signup alert when a new real account confirms its email ----------------
const auth = await mod('functions/_lib/auth.js');
const verifyEmail = await mod('functions/api/auth/verify-email.js');
const pendingUser = async (id, email, intent, source) => {
  exec(`INSERT INTO users (id, email, display_name, email_confirmation_pending, verify_token, verify_token_expires, signup_intent, signup_source)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)`, id, email, `New ${id}`, await auth.hashToken(`tok${id}`), new Date(Date.now() + 3600000).toISOString(), intent, source);
};
const confirm = (id) => call(verifyEmail.onRequestPost, 'POST', '/api/auth/verify-email', null, {}, { token: `tok${id}`, password: 'a long password' });
const alertsTo = () => sent.filter(m => m.to === 'rudypabloflores@gmail.com' && /^New signup/.test(m.subject));
sent.length = 0;
await pendingUser(40, 'new40@example.test', 'agent', JSON.stringify({ utm_source: 'tiktok', utm_medium: 'video', utm_content: 'mv4' }));
r = await confirm(40);
check('confirming a new account works', r.status === 200 && one('SELECT email_confirmation_pending FROM users WHERE id = 40').email_confirmation_pending === 0);
check('...and Rudy gets a short "New signup (agent)" alert with the Came from line', alertsTo().length === 1 && alertsTo()[0].subject === 'New signup (agent)' && /Came from: tiktok \/ video · content: mv4/.test(alertsTo()[0].text), JSON.stringify(alertsTo()));
check('...without the person\'s email address in it', !alertsTo()[0].text.includes('new40@example.test'));
r = await confirm(40);
check('a second tap on the same link sends no second alert', r.status === 400 && alertsTo().length === 1);
await pendingUser(41, 'new41@example.test', null, null);
await confirm(41);
check('a homeowner (or no intent) reads "New signup (homeowner)"', alertsTo().length === 2 && alertsTo()[1].subject === 'New signup (homeowner)' && /Came from: Unknown/.test(alertsTo()[1].text));
await pendingUser(42, 'test42@resend.dev', 'homeowner', null);
await pendingUser(43, 'd43@demo.amicohaus.local', 'homeowner', null);
await confirm(42); await confirm(43);
check('test-suite (@resend.dev) and demo accounts never alert', alertsTo().length === 2);
for (let i = 0; i < 40; i++) exec("INSERT INTO admin_alerts_sent (user_id, kind) VALUES (1, 'pre_listing')");
await pendingUser(44, 'new44@example.test', 'homeowner', null);
await confirm(44);
check('signups have their own daily budget (a busy pre-listing day does not block them)', alertsTo().length === 3);
for (let i = 0; i < 25; i++) exec("INSERT INTO admin_alerts_sent (user_id, kind) VALUES (2, 'signup')");
await pendingUser(45, 'new45@example.test', 'homeowner', null);
await confirm(45);
check('...and that budget is capped', alertsTo().length === 3);

// ---------------- Signup counting ----------------
const timeseries = await mod('functions/api/admin/activity-timeseries.js');
const todaySignups = async () => { const res = await call(timeseries.onRequestGet, 'GET', '/x', 8); return res.json.signups[res.json.signups.length - 1]; };
const s0 = await todaySignups();
exec("INSERT INTO users (id, email, display_name, email_confirmation_pending) VALUES (50, 'p50@example.test', 'Pending', 1), (51, 'x51@resend.dev', 'Test', 0), (52, 'real52@example.test', 'Real', 0)");
check('the growth chart counts confirmed real signups only (not pending, not @resend.dev)', (await todaySignups()) === s0 + 1, `${s0} -> ${await todaySignups()}`);

// ---------------- Service estimates: 3+ agents, range only, "Not a quote" ----------------
const estimatesApi = await mod('functions/api/agents/service-estimates.js');
const staging = (fee) => JSON.stringify([{ type: 'staging', feeType: 'flat', fee }]);
for (const [id, fee, extra] of [[30, 500], [31, 900], [33, 100, { email: 'd33@demo.amicohaus.local' }], [34, 5000, { status: 'suspended' }]]) {
  user(id, `Fee ${id}`, extra || {});
  exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, services_json) VALUES (?, 'approved', ?, 'R', ?)", id, `0700${id}00`, staging(fee));
}
r = await call(estimatesApi.onRequestGet, 'GET', '/api/agents/service-estimates', null);
check('a service fewer than 3 agents list shows nothing (demo and suspended agents never count)', r.status === 200 && r.json.estimates.staging === null, JSON.stringify(r.json.estimates.staging));
user(32, 'Fee 32');
exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, services_json) VALUES (32, 'approved', '07003200', 'R', ?)", staging(700));
r = await call(estimatesApi.onRequestGet, 'GET', '/api/agents/service-estimates', null);
const st = r.json.estimates.staging;
check('with 3 agents: the low-high range only, no average', !!st && st.min === 500 && st.max === 900 && st.agentCount === 3 && !('avg' in st), JSON.stringify(st));
check('...labeled "Not a quote"', /^Not a quote\./.test(r.json.note) && r.json.minAgents === 3);

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
