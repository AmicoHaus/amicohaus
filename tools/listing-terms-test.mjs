// Nuanced ideas batch (role P): Terms Wishlist, Owner Will Carry, Sell and Stay, and listing storage (ZIP, terms, the
// head-start create path, trash restore, announceNewListing), on trade listings and pre-listings. Real handlers on an
// in-memory SQLite stand-in for D1 (schema.sql). No network. Both launch states are exercised: every tool on
// (env.NUANCED_ALL_LIVE = '1') and the shipped gate (the dark tools answer "Not found." or are ignored).
// Usage: node --disable-warning=ExperimentalWarning tools/listing-terms-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const schemaSql = readFileSync(`${root}/schema.sql`, 'utf8');
// A D1 stand-in that counts every statement (first/all/run and each one in a batch), the most params bound to one,
// and keeps each statement's SQL with its param count.
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schemaSql);
  const stats = { statements: 0, maxParams: 0, log: [] };
  const note = (sql, args) => { stats.statements++; stats.maxParams = Math.max(stats.maxParams, args.length); stats.log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: args.length }); };
  const DB = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        first: async () => { note(sql, args); return sqlite.prepare(sql).get(...args) ?? null; },
        all: async () => { note(sql, args); return { results: sqlite.prepare(sql).all(...args) }; },
        run: async () => { note(sql, args); const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
        batchResult: async () => (/^\s*SELECT/i.test(sql) ? stmt.all() : stmt.run()),
      };
      return stmt;
    },
    batch: async (stmts) => { const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
  };
  const reset = () => { stats.statements = 0; stats.maxParams = 0; stats.log = []; };
  return { sqlite, DB, stats, reset };
}
const { sqlite, DB, stats, reset } = makeDb();
// Every tool on (the test harness and the preview test env only), and the gate as it ships.
const envLive = { DB, RESEND_API_KEY: 'test-key', NUANCED_ALL_LIVE: '1' };
const envShipped = { DB, RESEND_API_KEY: 'test-key' };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; else passed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
globalThis.fetch = async () => new Response('{}', { status: 200 });
const callWith = (env) => async (handler, method, path, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  // Work started with waitUntil can itself call waitUntil: wait for all of it, so counts never race.
  for (let i = 0; i < pending.length; i++) await pending[i];
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: type.includes('json') ? JSON.parse(text) : null };
};
const call = callWith(envLive);
const callShipped = callWith(envShipped);
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const exec = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => r.headers.get('Cache-Control') === 'private, no-store';
console.log = () => {};
// Visible text of a piece of HTML: tags dropped, entities decoded.
const textOf = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const headFile = (f) => { try { return execFileSync('git', ['-C', root, 'show', `HEAD:${f}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, '\n'); } catch { return null; } };

const user = (id, name, extra = {}) => {
  exec('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, extra.email || `u${id}@example.test`, name, extra.role || 'user', extra.status || 'active');
  exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
// 1 owner Ana, 2 owner Bo, 3 searcher Sam (flagged search), 4 searcher Tess (plain search), 5 admin, 6 approved agent
// Gil, 7 member Mia (watches 91915), 8 member Nia (watches nothing), 9 owner Cy (the other side of a mutual match)
user(1, 'Ana Owner'); user(2, 'Bo Owner'); user(3, 'Sam Searcher'); user(4, 'Tess Searcher'); user(5, 'Adm In', { role: 'admin' });
user(6, 'Gil Agent'); user(7, 'Mia Member'); user(8, 'Nia Member'); user(9, 'Cy Owner');
exec("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (6, 'approved', '01000006', 'Pacific Realty')");
exec("INSERT INTO zip_codes (zip, lat, lng) VALUES ('91915', 32.62, -116.94)");
exec("INSERT INTO watch_areas (user_id, zip) VALUES (7, '91915')");

const lt = await mod('functions/_lib/listingTerms.js');
const gate = await mod('functions/_lib/nuancedGate.js');
const listingsLib = await mod('functions/_lib/listings.js');
const savedLib = await mod('functions/_lib/savedSearches.js');
const watch = await mod('functions/_lib/watchAreas.js');
const directory = await mod('functions/api/directory.js');
const savedApi = await mod('functions/api/saved-searches/index.js');
const listingsApi = await mod('functions/api/listings/index.js');
const listingOne = await mod('functions/api/listings/[id].js');
const bulkApi = await mod('functions/api/listings/bulk.js');
const trashItem = await mod('functions/api/listings/trash/[id].js');
const termsApi = await mod('functions/api/listing-terms/[kind]/[id].js');
const preApi = await mod('functions/api/pre-listings/index.js');
const preOne = await mod('functions/api/pre-listings/[id].js');
const ALL = gate.liveTools({ NUANCED_ALL_LIVE: '1' });
const SHIPPED = gate.liveTools({}, null);

// ================= 1. Terms Wishlist: the lib =================
const KEYS = Object.keys(lt.WISHLIST_ITEMS);
check('eight fixed wish-list items, at most 5 ranked', KEYS.length === 8 && lt.WISHLIST_MAX === 5);
let v = lt.validateListingTerms({ termsWishlist: ['as_is', 'cash_only', 'quick_close', 'as_is', 42, 'items_stay'] }, { kind: 'listing' });
check('unknown keys dropped, order kept, each key once', JSON.stringify(v.data.termsWishlist) === '["as_is","quick_close","items_stay"]', JSON.stringify(v.data));
v = lt.validateListingTerms({ termsWishlist: [...KEYS].reverse() }, { kind: 'listing' });
check('cut to the first 5 in the order given', JSON.stringify(v.data.termsWishlist) === JSON.stringify([...KEYS].reverse().slice(0, 5)));
v = lt.validateListingTerms({ termsWishlist: ['as_is'], ownerCarry: true, assumable: 'yes' }, { kind: 'listing', isRental: true });
check('a rental stores [], 0, 0', JSON.stringify(v.data) === '{"termsWishlist":[],"ownerCarry":0,"assumable":0}', JSON.stringify(v.data));
v = lt.validateListingTerms({ termsWishlist: ['as_is'], ownerCarry: true, assumable: false, rate: 6.5, downPayment: 50000, months: 360, note: 'cash buyers only' }, { kind: 'pre_listing' });
check('the three keys are the only stored values (no rate, amount, term or free text gets through)', JSON.stringify(v.data) === '{"termsWishlist":["as_is"],"ownerCarry":1,"assumable":0}', JSON.stringify(v.data));
check('junk input never throws and stores nothing', ['x', null, 7, [], { termsWishlist: 'as_is' }].every(i => JSON.stringify(lt.validateListingTerms(i, {}).data) === '{"termsWishlist":[],"ownerCarry":0,"assumable":0}'));
check('listingTermsFromRow: the same shape from a row, never throws on bad JSON', JSON.stringify(lt.listingTermsFromRow({ terms_wishlist_json: '["flexible_close","nope"]', owner_carry: 1, assumable: 0 })) === '{"termsWishlist":["flexible_close"],"ownerCarry":1,"assumable":0}'
  && JSON.stringify(lt.listingTermsFromRow({ terms_wishlist_json: '{oops' })) === '{"termsWishlist":[],"ownerCarry":0,"assumable":0}' && JSON.stringify(lt.listingTermsFromRow(null)) === '{"termsWishlist":[],"ownerCarry":0,"assumable":0}');

const rowWish = { terms_wishlist_json: '["stay_after","as_is","quick_close"]', owner_carry: 0, assumable: 0, stay_after_days: 14 };
let blocks = lt.termsBlocksHtml(rowWish, ALL);
check('the wish-list block: heading, ranked items, both lines', blocks.wishlist === `<div class="card about-card terms-wishlist"><h2>${esc(lt.WISHLIST_HEADING)}</h2><ol><li>${esc(lt.WISHLIST_ITEMS.stay_after)}</li><li>${esc(lt.WISHLIST_ITEMS.as_is)}</li><li>${esc(lt.WISHLIST_ITEMS.quick_close)}</li></ol><p class="tiny">${esc(lt.WISHLIST_LINE)}</p><p class="tiny">${esc(lt.WISHLIST_BUYER_LINE)}</p></div>`, blocks.wishlist);
check('the offer note is LETTER_LINE when a wish list exists', blocks.offerNote === `<p class="tiny">${esc(lt.LETTER_LINE)}</p>`);
check('exact copy: heading and lines', lt.WISHLIST_HEADING === 'What matters to this seller besides price (from the owner)'
  && lt.WISHLIST_LINE === "A wish list, not a requirement or an offer. It's about the sale, never about the buyer. Terms are agreed in writing, with your agents."
  && lt.WISHLIST_BUYER_LINE === 'Inspections and contingencies protect buyers. Talk with your agent before giving any up.'
  && lt.LETTER_LINE === 'No personal letter needed: this seller listed the terms that matter to them.');
const preBlocks = lt.termsBlocksHtml(rowWish, ALL, { kind: 'pre_listing' });
check('on a pre-listing with a stay set, the stay item names the days (it stores no number of its own)', preBlocks.wishlist.includes('<li>Time to stay after closing (up to 14 days)</li>') && !blocks.wishlist.includes('up to 14 days'));
check('a pre-listing with no stay set keeps the plain item', lt.termsBlocksHtml({ ...rowWish, stay_after_days: 0 }, ALL, { kind: 'pre_listing' }).wishlist.includes(`<li>${esc(lt.WISHLIST_ITEMS.stay_after)}</li>`));
check('no wish list -> no block and no offer note', JSON.stringify(lt.termsBlocksHtml({ terms_wishlist_json: '[]' }, ALL)) === '{"financing":"","wishlist":"","offerNote":""}');
check('not live -> nothing renders', JSON.stringify(lt.termsBlocksHtml(rowWish, { ...ALL, termsWishlist: false })) === '{"financing":"","wishlist":"","offerNote":""}');
check('a rental, a buyer profile and a portfolio get no blocks', ['is_rental', 'is_buyer_only', 'is_portfolio'].every(k => JSON.stringify(lt.termsBlocksHtml({ ...rowWish, owner_carry: 1, [k]: 1 }, ALL)) === '{"financing":"","wishlist":"","offerNote":""}'));
// Nothing about the buyer: the items and the rendered block name no kind of person, letter, story or financing type.
const PERSON_WORDS = /famil|kids|children|couple|married|single|religio|church|age\b|young|senior|veteran|nationalit|letter from|about you|your story|cash buyers? only|no (fha|va)/i;
const everyItem = lt.termsBlocksHtml({ terms_wishlist_json: JSON.stringify(KEYS.slice(0, 5)) }, ALL).wishlist + lt.termsBlocksHtml({ terms_wishlist_json: JSON.stringify(KEYS.slice(3)) }, ALL, { kind: 'pre_listing' }).wishlist;
check('labels and the rendered block match none of the person words', !PERSON_WORDS.test(Object.values(lt.WISHLIST_ITEMS).join(' | ')) && !PERSON_WORDS.test(textOf(everyItem)) && !PERSON_WORDS.test(lt.LETTER_LINE));
check('no wish-list item is about financing type, the buyer or money', !/cash|fha|\bva\b|loan|lender|buyer who (is|has)|\$|credit|appraisal/i.test(Object.values(lt.WISHLIST_ITEMS).join(' | ')));

// ================= 2. Owner Will Carry: the lib =================
const colNames = (t) => q(`PRAGMA table_info(${t})`).map(c => c.name);
const CREDIT_COL = /(^|_)(rate|apr|interest|down|downpayment|payment|payments|balance|term_months|loan_type|loan|amortization|balloon)(_|$)/;
const creditCols = ['listings', 'pre_listings'].flatMap(t => colNames(t).filter(c => CREDIT_COL.test(c) && c !== 'step_down_json').map(c => `${t}.${c}`));
check('schema: no column for a rate, down payment, payment, balance, term or loan type on listings or pre_listings', creditCols.length === 0, creditCols.join());
check('schema: owner_carry and assumable are the only financing columns', ['listings', 'pre_listings'].every(t => colNames(t).includes('owner_carry') && colNames(t).includes('assumable'))
  && colNames('saved_searches').includes('deal_flags'));
const rowCarry = { terms_wishlist_json: '[]', owner_carry: 1, assumable: 1 };
blocks = lt.termsBlocksHtml(rowCarry, ALL);
check('the financing line: heading, both owner-says lines, then the assumable link', blocks.financing === `<p class="tiny financing-flags"><span class="label">${esc(lt.FINANCING_HEADING)}</span> ${esc(lt.OWNER_CARRY_LINE + ' ' + lt.ASSUMABLE_LINE)} <a href="/assumable-loans">About assumable loans</a></p>`, blocks.financing);
check('only the flag that is set prints; the link only after an assumable line', lt.termsBlocksHtml({ owner_carry: 1 }, ALL).financing === `<p class="tiny financing-flags"><span class="label">${esc(lt.FINANCING_HEADING)}</span> ${esc(lt.OWNER_CARRY_LINE)}</p>`
  && lt.termsBlocksHtml({ assumable: 1 }, ALL).financing.includes(esc(lt.ASSUMABLE_LINE)) && !lt.termsBlocksHtml({ assumable: 1 }, ALL).financing.includes(esc(lt.OWNER_CARRY_LINE)));
const finText = textOf(blocks.financing);
check('the financing line has no %, $, digit, lender name or phone link', !/[%$\d]/.test(finText) && !/Point Mortgage|NMLS|tel:|lender/i.test(blocks.financing), finText);
check('every financing line says it is the owner\'s word', lt.OWNER_CARRY_LINE.startsWith('The owner says') && lt.ASSUMABLE_LINE.startsWith('The owner says') && lt.FINANCING_HEADING.endsWith('(from the owner)'));
check('exact copy: both lines and the error', lt.OWNER_CARRY_LINE === "The owner says they're open to seller financing. No terms are offered here: they're between you, your agents and a licensed loan professional. Federal and state lending rules apply."
  && lt.ASSUMABLE_LINE === 'The owner says their loan may be assumable. The loan servicer decides; ask them what applies.'
  && lt.CREDIT_TERMS_ERROR === "Leave loan terms out of your listing (rates, down payments, payments, years). The flag only says you're open to it.");
check('dark (the shipped gate) -> no financing line, even with both flags stored', lt.termsBlocksHtml(rowCarry, SHIPPED).financing === '' && SHIPPED.ownerCarry === false && SHIPPED.termsWishlist === true);
const CREDIT_CASES = [['5% interest, 20% down', 1], ['Owner will carry at 6.5% APR', 1], ['$2,500/mo payments', 1], ['$50k down', 1], ['30-year note', 1], ['No bank qualifying', 1], ['balloon in 5 years', 1], ['rate 5.5%', 1], ['3.25% rate assumable', 1], ['$1,900 a month', 1],
  ['Open to carrying a note for the right terms', 0], ['100% remodeled, 2-car garage', 0], ['Solar owned, 6 kW', 0], ['Lot is 7,200 sqft', 0], ['Selling points: view and yard', 0], ['First-rate kitchen', 0], ['Down the street from the park', 0], ['HOA $250/mo', 1]];
const creditWrong = CREDIT_CASES.filter(([s, w]) => (lt.creditTermsProblem(s) === lt.CREDIT_TERMS_ERROR) !== !!w || (!w && lt.creditTermsProblem(s) !== null)).map(c => c[0]);
check('creditTermsProblem: the 18 cases (10 refused, 7 pass, a dollars-a-month figure refused)', creditWrong.length === 0, creditWrong.join(' | '));
// The common phrasings the first pattern missed (review fix): a bare percent, "N percent", interest only, PITI, a
// loan balance or payoff, a dollar figure "monthly", "5 years at 6". Ordinary listing words still pass.
const CREDIT_MORE = [['Assumable 2.75% VA loan!', 1], ['Assumable VA loan at 2.75%', 1], ['Take over my 3.1% mortgage', 1], ['FHA loan, 2.9 percent, balance about $412,000', 1],
  ['Loan balance $412,000, payment $2,350 monthly', 1], ['Owner will carry 5 years at 6%', 1], ['Owner carry: 6% for 5 years, interest only', 1],
  ['Seller financing available, 10 percent down, 7 percent', 1], ['PITI is $2,400', 1], ['Balance of $300,000 left', 1], ['Low payoff', 1],
  ['Remodeled 2 years ago, new roof', 0], ['Built in 1998, 3 bed 2 bath, 1,850 sqft', 0], ['Low rate assumable loan', 0], ['5 minutes to the 125', 0], ['Lived here 12 years, great loan officer', 0],
  ['A perfect balance of indoor and outdoor living', 0], ['100% remodeled', 0], ['EastLake Greens', 0]];
const creditMoreWrong = CREDIT_MORE.filter(([s, w]) => (lt.creditTermsProblem(s) === lt.CREDIT_TERMS_ERROR) !== !!w || (!w && lt.creditTermsProblem(s) !== null)).map(c => c[0]);
check('creditTermsProblem: bare percents, "N percent", interest only, PITI, balances, "monthly" and "years at" are refused; ordinary listing words pass', creditMoreWrong.length === 0, creditMoreWrong.join(' | '));
check('creditTermsProblem: empty text is fine', lt.creditTermsProblem('') === null && lt.creditTermsProblem(null) === null);
const lender = (src) => (src || '').match(/<p class="form-note trust"><strong>Talk to a lender\.<\/strong>[\s\S]*?<\/p>/);
const pageNow = readFileSync(`${root}/functions/listing/[id].js`, 'utf8').replace(/\r\n/g, '\n');
const pageHead = headFile('functions/listing/[id].js');
check('listing page: the "Talk to a lender" note is byte-identical to HEAD', pageHead === null ? !!lender(pageNow) : (!!lender(pageNow) && lender(pageNow)[0] === lender(pageHead)[0]));
check('listing page: the financing block is not inside the lender note', !/financing|owner_carry|assumable/i.test(lender(pageNow)[0].replace('financing a cash difference', '')));

// ================= 3. Sell and Stay: the lib =================
const migration = readFileSync(`${root}/migration_v47.sql`, 'utf8');
check('Sell and Stay adds no column (the migration adds nothing about a stay to listings or pre_listings)', !/ALTER TABLE (listings|pre_listings|saved_searches) ADD COLUMN \w*stay/i.test(migration) && /Sell and Stay: no schema change/.test(migration));
check('the badge string, exactly', lt.sellStayBadge(14) === 'Seller would like to stay up to 14 days after closing' && lt.sellStayBadge(29) === 'Seller would like to stay up to 29 days after closing');
check('no stay -> no badge', lt.sellStayBadge(0) === '' && lt.sellStayBadge(null) === '' && lt.sellStayBadge(-3) === '' && lt.sellStayBadge('x') === '');
check('SELL_STAY_NOTE exactly, with no dollar figure', lt.SELL_STAY_NOTE === 'Your agents write the rent-back terms. No rent amounts are set on Amico Haus.' && !lt.SELL_STAY_NOTE.includes('$'));
{
  const cards = await mod('functions/_lib/ideaCards.js');
  const stayCard = Array.isArray(cards.IDEA_CARDS) ? cards.IDEA_CARDS.find(c => c.key === 'stay') : null;
  check('the Sell and stay idea card (when built) has no $ and no per-day or deposit figure', !stayCard || (!JSON.stringify(stayCard).includes('$') && !/per day|deposit of|\d+ a day/i.test(JSON.stringify(stayCard))));
}

// ================= 4. Listing storage: create =================
const trade = { city: 'Chula Vista', state: 'CA', neighborhood: 'EastLake', propertyType: 'Single Family Home', estimatedValue: 950000, beds: 4, baths: 3,
  locations: 'San Diego', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0, title: 'Corner lot home', description: 'Bright and open.' };
let r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, zip: '9191' });
check('a ZIP that isn\'t 5 digits -> 400 with the exact error', r.status === 400 && r.json.error === 'ZIP code should be 5 digits.', JSON.stringify(r.json));
reset();
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, zip: '91915', terms: { termsWishlist: ['as_is', 'bogus', 'quick_close'], ownerCarry: true, assumable: false } });
const homeId = r.json && r.json.id;
let row = one('SELECT * FROM listings WHERE id = ?', homeId);
check('a listing with a ZIP and terms is created', r.status === 201 && !!homeId, JSON.stringify(r.json));
check('...ZIP, ranked wish list and flags are stored from the same request', row.zip === '91915' && row.terms_wishlist_json === '["as_is","quick_close"]' && row.owner_carry === 1 && row.assumable === 0 && row.status === 'active' && row.head_start_until === null, JSON.stringify(row));
const insertStmt = stats.log.find(s => s.sql.startsWith('INSERT INTO listings'));
check('the listings INSERT binds 33 params in one statement', !!insertStmt && insertStmt.params === 33 && stats.log.filter(s => /^(INSERT INTO|UPDATE) listings/.test(s.sql)).length === 1, insertStmt && String(insertStmt.params));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'No extras' });
row = one('SELECT zip, terms_wishlist_json, owner_carry, assumable FROM listings WHERE id = ?', r.json.id);
check('no ZIP or terms -> the defaults', JSON.stringify(row) === '{"zip":"","terms_wishlist_json":"[]","owner_carry":0,"assumable":0}', JSON.stringify(row));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, isRental: true, rentAmount: 9000, zip: '91915', terms: { termsWishlist: ['as_is'], ownerCarry: true } });
row = one('SELECT zip, terms_wishlist_json, owner_carry, assumable FROM listings WHERE id = ?', r.json.id);
check('a rental keeps its ZIP and stores no terms', r.status === 201 && JSON.stringify(row) === '{"zip":"91915","terms_wishlist_json":"[]","owner_carry":0,"assumable":0}', JSON.stringify(row));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, isBuyerOnly: true, zip: '91915', terms: { termsWishlist: ['as_is'], assumable: true } });
row = one('SELECT zip, terms_wishlist_json, owner_carry, assumable FROM listings WHERE id = ?', r.json.id);
check('a buyer-only profile stores no ZIP and no terms', r.status === 201 && JSON.stringify(row) === '{"zip":"","terms_wishlist_json":"[]","owner_carry":0,"assumable":0}', JSON.stringify(row));
// Credit terms in a flagged listing's text.
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, description: 'Owner will carry at 6.5% APR.', terms: { ownerCarry: true } });
check('a flagged listing can\'t be created with "6.5% APR" in its description', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR, JSON.stringify(r.json));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: '$50k down takes it', terms: { assumable: true } });
check('...or with "$50k down" in its title', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, neighborhood: 'EastLake, 2.75% VA loan', terms: { assumable: true } });
check('...or with a rate in its public neighborhood line', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR, JSON.stringify(r.json));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, description: 'Assumable VA loan at 2.75%. Interest only for 5 years.', terms: { assumable: true } });
check('...or with "Assumable VA loan at 2.75%" in its description', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR, JSON.stringify(r.json));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, description: '100% remodeled. Down the street from the park.', terms: { ownerCarry: true } });
const remodeledId = r.json && r.json.id;
check('"100% remodeled" and "Down the street" pass on a flagged listing', r.status === 201, JSON.stringify(r.json));
// The shipped gate: Owner Will Carry is dark, the wish list is live.
r = await callShipped(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Shipped gate', description: 'Was 6.5% APR once.', terms: { termsWishlist: ['flexible_close'], ownerCarry: true, assumable: true } });
row = one('SELECT terms_wishlist_json, owner_carry, assumable FROM listings WHERE id = ?', r.json && r.json.id);
const shippedId = r.json && r.json.id;
check('shipped gate, a member: the wish list is stored, the financing flags are ignored (and no credit check runs)', r.status === 201 && JSON.stringify(row) === '{"terms_wishlist_json":"[\\"flexible_close\\"]","owner_carry":0,"assumable":0}', JSON.stringify(r.json) + JSON.stringify(row));
r = await callShipped(listingsApi.onRequestPost, 'POST', '/api/listings', 5, {}, { ...trade, title: 'Admin walk-through', terms: { ownerCarry: true } });
const adminHomeId = r.json && r.json.id;
check('shipped gate, an admin: the flag is stored (the admin walks through the dark tool)', r.status === 201 && one('SELECT owner_carry FROM listings WHERE id = ?', adminHomeId).owner_carry === 1);
// Bulk upload never stores terms.
r = await call(bulkApi.onRequestPost, 'POST', '/api/listings/bulk', 6, {}, { listings: [{ ...trade, title: 'Bulk row', terms: { termsWishlist: ['as_is'], ownerCarry: true, assumable: true } }] });
row = r.json && r.json.results && r.json.results[0] && one('SELECT terms_wishlist_json, owner_carry, assumable FROM listings WHERE id = ?', r.json.results[0].id);
check('the bulk upload stores no terms', !!row && JSON.stringify(row) === '{"terms_wishlist_json":"[]","owner_carry":0,"assumable":0}', JSON.stringify(r.json) + JSON.stringify(row));

// ================= 5. Listing storage: edit =================
const editBody = { ...trade, title: 'Corner lot home, edited', action: 'edit' };
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, editBody);
row = one('SELECT title, zip, terms_wishlist_json, owner_carry FROM listings WHERE id = ?', homeId);
check('an edit without zip or terms keeps them', r.status === 200 && row.title === 'Corner lot home, edited' && row.zip === '91915' && row.terms_wishlist_json === '["as_is","quick_close"]' && row.owner_carry === 1, JSON.stringify(row));
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, zip: '', terms: { termsWishlist: ['simple_handoff'] } });
row = one('SELECT zip, terms_wishlist_json, owner_carry, assumable FROM listings WHERE id = ?', homeId);
check('an edit with zip and a wish list changes those, and keeps the flags it didn\'t send', r.status === 200 && JSON.stringify(row) === '{"zip":"","terms_wishlist_json":"[\\"simple_handoff\\"]","owner_carry":1,"assumable":0}', JSON.stringify(row));
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, zip: 'abcde' });
check('a bad ZIP on edit -> 400, nothing changed', r.status === 400 && r.json.error === 'ZIP code should be 5 digits.' && one('SELECT zip FROM listings WHERE id = ?', homeId).zip === '');
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, zip: '91915', description: '30-year note available.' });
check('a flagged listing\'s full edit can\'t add loan terms', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR && one('SELECT zip FROM listings WHERE id = ?', homeId).zip === '');
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { description: 'Payments of $1,900 a month.' });
check('...nor can its plain description edit', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR);
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, zip: '91915', description: '30-year note available.', terms: { ownerCarry: false, assumable: false } });
row = one('SELECT zip, description, owner_carry FROM listings WHERE id = ?', homeId);
check('once the same edit turns the flags off, the text is the owner\'s to write', r.status === 200 && row.owner_carry === 0 && row.zip === '91915' && row.description === '30-year note available.', JSON.stringify(r.json));
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, zip: '91915', description: '30-year note available.', terms: { ownerCarry: true } });
check('...and turning a flag on over that text is refused', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR && one('SELECT owner_carry FROM listings WHERE id = ?', homeId).owner_carry === 0);
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, description: 'Bright and open.', terms: { termsWishlist: ['as_is', 'quick_close'], ownerCarry: true, assumable: true } });
check('clean text + both flags saves', r.status === 200 && one('SELECT owner_carry + assumable AS n FROM listings WHERE id = ?', homeId).n === 2);
r = await callShipped(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, description: 'Rate 5.5% once.', terms: { termsWishlist: ['items_stay'], ownerCarry: false, assumable: false } });
row = one('SELECT terms_wishlist_json, owner_carry, assumable FROM listings WHERE id = ?', homeId);
check('shipped gate: an edit writes the wish list and leaves the stored flags alone', r.status === 200 && JSON.stringify(row) === '{"terms_wishlist_json":"[\\"items_stay\\"]","owner_carry":1,"assumable":1}', JSON.stringify(row));
await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 1, { id: String(homeId) }, { ...editBody, description: 'Bright and open.', terms: { termsWishlist: ['as_is', 'quick_close'] } });
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${homeId}`, 2, { id: String(homeId) }, { ...editBody, terms: { termsWishlist: [] } });
check("someone else can't edit the terms", r.status === 403);

// ================= 6. GET /api/listings/:id: what other viewers get =================
exec(`UPDATE listings SET step_down_json = '{"startPrice":950000}', step_next_at = '2099-01-01 17:00:00' WHERE id = ?`, homeId);
r = await call(listingOne.onRequestGet, 'GET', `/api/listings/${homeId}`, 4, { id: String(homeId) });
check('live, a stranger: flags, schedule and wish list are in the JSON; the head start never is', r.status === 200 && r.json.listing.owner_carry === 1 && r.json.listing.assumable === 1 && 'step_down_json' in r.json.listing && 'terms_wishlist_json' in r.json.listing && !('head_start_until' in r.json.listing) && noStore(r));
r = await callShipped(listingOne.onRequestGet, 'GET', `/api/listings/${homeId}`, 4, { id: String(homeId) });
check('shipped gate, a stranger: no owner_carry, assumable, step_down_json, step_next_at or head_start_until', r.status === 200 && ['owner_carry', 'assumable', 'step_down_json', 'step_next_at', 'head_start_until'].every(k => !(k in r.json.listing)) && 'terms_wishlist_json' in r.json.listing, Object.keys(r.json.listing).join());
r = await callShipped(listingOne.onRequestGet, 'GET', `/api/listings/${homeId}`, null, { id: String(homeId) });
check('shipped gate, signed out: the same', r.status === 200 && ['owner_carry', 'assumable', 'step_down_json', 'step_next_at', 'head_start_until'].every(k => !(k in r.json.listing)));
r = await callShipped(listingOne.onRequestGet, 'GET', `/api/listings/${homeId}`, 1, { id: String(homeId) });
check('the owner always gets their own row whole', r.json.isOwner === true && 'owner_carry' in r.json.listing && 'head_start_until' in r.json.listing && 'step_down_json' in r.json.listing);
exec(`UPDATE listings SET step_down_json = '{}', step_next_at = NULL WHERE id = ?`, homeId);

// ================= 7. Directory =================
// Flagged: homeId (both flags), remodeledId and adminHomeId (owner_carry). Everything else unflagged.
const carryIds = [homeId, remodeledId, adminHomeId].sort((a, b) => a - b).join(',');
const dirIds = async (qs, env = envLive, who = null) => {
  const res = await callWith(env)(directory.onRequestGet, 'GET', `/api/directory?limit=60&${qs}`, who);
  return res.json.listings.map(l => l.id).sort((a, b) => a - b).join(',');
};
const allIds = await dirIds('');
check('ownerCarry=1 returns only homes whose owner said so', (await dirIds('ownerCarry=1')) === carryIds, await dirIds('ownerCarry=1'));
check('assumable=1 returns only homes whose owner said so', (await dirIds('assumable=1')) === String(homeId));
check('both filters combine', (await dirIds('ownerCarry=1&assumable=1')) === String(homeId));
check('shipped gate: both filters are ignored for a visitor and a member', (await dirIds('ownerCarry=1&assumable=1', envShipped)) === allIds && (await dirIds('ownerCarry=1', envShipped, 4)) === allIds);
check('shipped gate: an admin can filter', (await dirIds('ownerCarry=1', envShipped, 5)) === carryIds);
r = await call(directory.onRequestGet, 'GET', '/api/directory?limit=60', null);
let card = r.json.listings.find(l => l.id === homeId);
check('live: cards carry owner_carry and assumable, and the page is told to show the filters', card.owner_carry === 1 && card.assumable === 1 && r.json.dealFilters === true);
check('cards never carry the wish list, the ZIP, the schedule or the head start', !/terms_wishlist|termsWishlist|step_down|step_next|head_start|"zip"/.test(r.text));
const dirSelect = () => stats.log.find(s => s.sql.startsWith('SELECT listings.id, listings.title'));
reset();
await call(directory.onRequestGet, 'GET', '/api/directory?limit=60&ownerCarry=1&assumable=1', 3);
const dirWith = stats.statements, dirParams = dirSelect().params;
check('the two filters are plain conditions in the directory\'s one SELECT', dirSelect().sql.includes('listings.owner_carry = 1 AND listings.assumable = 1'));
reset();
await call(directory.onRequestGet, 'GET', '/api/directory?limit=60', 3);
check('...they add no bound params and no statement', dirParams === dirSelect().params && dirWith <= stats.statements, `${dirParams} vs ${dirSelect().params}; ${dirWith} vs ${stats.statements}`);
r = await callShipped(directory.onRequestGet, 'GET', '/api/directory?limit=60', 4);
check('shipped gate: cards have no financing flags and no dealFilters', !/owner_carry|assumable|dealFilters/.test(r.text));

// ================= 8. Saved searches =================
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Chula Vista', deal: { ownerCarry: true } });
check('a saved search with "owner open to seller financing" -> deal_flags 1', r.status === 201 && one('SELECT deal_flags FROM saved_searches WHERE user_id = 3').deal_flags === 1, JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'chula vista' });
check('the same criteria without the flag is a different search', r.status === 201, JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Chula Vista', deal: { ownerCarry: true } });
check('the same flagged search again is a duplicate', r.status === 400 && r.json.code === 'saved_search_duplicate', JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Chula Vista', deal: { ownerCarry: true, assumable: true } });
check('both flags -> deal_flags 3, a different search again', r.status === 201 && one('SELECT deal_flags FROM saved_searches WHERE id = ?', r.json.id).deal_flags === 3);
exec('DELETE FROM saved_searches WHERE user_id = 3 AND deal_flags != 1');
r = await call(savedApi.onRequestGet, 'GET', '/api/saved-searches', 3);
check('live: GET returns deal_flags, private, no-store', noStore(r) && r.json.searches.length === 1 && r.json.searches[0].deal_flags === 1);
r = await callShipped(savedApi.onRequestGet, 'GET', '/api/saved-searches', 3);
check('shipped gate: GET leaves deal_flags out', r.json.searches.length === 1 && !('deal_flags' in r.json.searches[0]) && 'toy_flags' in r.json.searches[0]);
r = await callShipped(savedApi.onRequestPost, 'POST', '/api/saved-searches', 4, {}, { locations: 'Chula Vista', deal: { ownerCarry: true, assumable: true } });
check('shipped gate: the deal ticks are ignored (stored 0)', r.status === 201 && one('SELECT deal_flags FROM saved_searches WHERE user_id = 4').deal_flags === 0);
// Alerts: 3 has the flagged search, 4 the plain one.
const ssNotes = uid => q("SELECT body FROM notifications WHERE user_id = ? AND type = 'saved_search' ORDER BY id", uid);
exec("DELETE FROM notifications WHERE type = 'saved_search'");
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Plain home' });
check('an unflagged new listing alerts the plain search, never the flagged one', r.status === 201 && ssNotes(4).length === 1 && ssNotes(3).length === 0, `${ssNotes(4).length} ${ssNotes(3).length}`);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Assumable only', terms: { assumable: true } });
check('"loan may be assumable" alone doesn\'t match a seller-financing search', ssNotes(3).length === 0 && ssNotes(4).length === 2);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Owner carry home', terms: { ownerCarry: true } });
check('a flagged new listing alerts the flagged search (and the plain one)', ssNotes(3).length === 1 && ssNotes(4).length === 3, `${ssNotes(3).length} ${ssNotes(4).length}`);
check('the alert body is the same string as before (it never says financing is available)', ssNotes(3)[0].body === 'A new listing matches your saved search: Single Family Home in EastLake, Chula Vista, CA' && ssNotes(4).every(n => n.body === ssNotes(3)[0].body), ssNotes(3)[0].body);
const fromData = savedLib.savedSearchHome(77, 1, { city: 'Chula Vista', state: 'CA', neighborhood: 'EastLake', propertyType: 'Condo', estimatedValue: 5, homeFacts: { toy: { rv: 'yes' } }, terms: { ownerCarry: 1, assumable: 0 } });
const fromRow = savedLib.savedSearchHomeFromRow({ id: 77, user_id: 1, city: 'Chula Vista', state: 'CA', neighborhood: 'EastLake', property_type: 'Condo', estimated_value: 5, home_facts_json: '{"toy":{"rv":"yes"}}', owner_carry: 1, assumable: 0, is_rental: 0, is_buyer_only: 0, is_portfolio: 0 });
check('savedSearchHomeFromRow builds the same object as savedSearchHome', JSON.stringify(fromData) === JSON.stringify(fromRow), `${JSON.stringify(fromData)} vs ${JSON.stringify(fromRow)}`);
check('...and null for a rental, a buyer profile or a portfolio', [{ is_rental: 1 }, { is_buyer_only: 1 }, { is_portfolio: 1 }].every(x => savedLib.savedSearchHomeFromRow({ id: 1, user_id: 1, ...x }) === null));

// ================= 9. PUT /api/listing-terms/:kind/:id =================
exec(`INSERT INTO pre_listings (id, user_id, title, description, city, state, zip, property_type, beds, baths, asking_price, stay_after_days)
      VALUES (501, 1, 'Canyon view', 'Quiet street.', 'Chula Vista', 'CA', '91915', 'Condo', 3, 2, 700000, 14)`);
const putTerms = (kind, id, who, body, env = envLive) => callWith(env)(termsApi.onRequestPut, 'PUT', `/api/listing-terms/${kind}/${id}`, who, { kind, id: String(id) }, body);
r = await putTerms('pre_listing', 501, null, { termsWishlist: ['as_is'] });
check('signed out -> 401', r.status === 401);
r = await putTerms('pre_listing', 501, 2, { termsWishlist: ['as_is'] });
check('another member -> 403', r.status === 403);
r = await putTerms('augmented_home', 501, 1, { termsWishlist: ['as_is'] });
check('an unknown kind -> 404', r.status === 404);
r = await putTerms('pre_listing', 999999, 1, { termsWishlist: ['as_is'] });
check('a home that isn\'t there -> 404', r.status === 404);
reset();
r = await putTerms('pre_listing', 501, 1, { termsWishlist: ['stay_after', 'as_is', 'nope'], ownerCarry: true, assumable: true });
row = one('SELECT terms_wishlist_json, owner_carry, assumable FROM pre_listings WHERE id = 501');
check('the owner saves a pre-listing\'s terms', r.status === 200 && r.json.ok === true && JSON.stringify(row) === '{"terms_wishlist_json":"[\\"stay_after\\",\\"as_is\\"]","owner_carry":1,"assumable":1}' && noStore(r), JSON.stringify(r.json) + JSON.stringify(row));
check('...in 2 statements + the session, one of them the UPDATE', stats.statements === 3 && stats.log.filter(s => s.sql.startsWith('UPDATE')).length === 1, stats.log.map(s => s.sql.slice(0, 40)).join(' | '));
check('...and the response repeats what was stored', JSON.stringify(r.json.terms) === '{"termsWishlist":["stay_after","as_is"],"ownerCarry":1,"assumable":1}', JSON.stringify(r.json.terms));
r = await putTerms('pre_listing', 501, 1, { termsWishlist: ['quick_close'] });
row = one('SELECT terms_wishlist_json, owner_carry, assumable FROM pre_listings WHERE id = 501');
check('a body without the flags keeps them', r.status === 200 && JSON.stringify(row) === '{"terms_wishlist_json":"[\\"quick_close\\"]","owner_carry":1,"assumable":1}', JSON.stringify(row));
r = await putTerms('pre_listing', 501, 1, { ownerCarry: false, assumable: false }, envShipped);
check('shipped gate, a member: the route still answers (the wish list is live) but leaves the flags alone', r.status === 200 && one('SELECT owner_carry + assumable AS n FROM pre_listings WHERE id = 501').n === 2 && JSON.stringify(r.json.terms) === '{}', JSON.stringify(r.json));
exec("UPDATE pre_listings SET owner_carry = 0, assumable = 0, description = 'Seller offers 5% interest, 20% down.' WHERE id = 501");
r = await putTerms('pre_listing', 501, 1, { ownerCarry: true });
check('a flag can\'t be turned on over text that states loan terms', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR && one('SELECT owner_carry FROM pre_listings WHERE id = 501').owner_carry === 0);
exec("UPDATE pre_listings SET description = 'Quiet street.', neighborhood = 'Otay Ranch, PITI is $2,400' WHERE id = 501");
r = await putTerms('pre_listing', 501, 1, { assumable: true });
check('...nor over a neighborhood line that states them', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR && one('SELECT assumable FROM pre_listings WHERE id = 501').assumable === 0);
exec("UPDATE pre_listings SET description = 'Seller offers 5% interest, 20% down.', neighborhood = '' WHERE id = 501");
r = await putTerms('pre_listing', 501, 1, { termsWishlist: ['as_is', 'quick_close'] });
check('...while the wish list alone still saves', r.status === 200);
exec("UPDATE pre_listings SET description = 'Quiet street.', owner_carry = 1 WHERE id = 501");
r = await putTerms('listing', homeId, 1, { termsWishlist: ['home_sale_ok'] });
check('a trade listing\'s terms save in place too', r.status === 200 && one('SELECT terms_wishlist_json FROM listings WHERE id = ?', homeId).terms_wishlist_json === '["home_sale_ok"]');
const buyerOnlyId = one('SELECT id FROM listings WHERE is_buyer_only = 1 AND user_id = 1').id;
r = await putTerms('listing', buyerOnlyId, 1, { termsWishlist: ['as_is'] });
check('a buyer-only profile -> 400 terms_not_for_this_listing', r.status === 400 && r.json.code === 'terms_not_for_this_listing', JSON.stringify(r.json));
const rentalId = one('SELECT id FROM listings WHERE is_rental = 1 AND user_id = 1').id;
r = await putTerms('listing', rentalId, 1, { termsWishlist: ['as_is'], ownerCarry: true });
check('a rental stores no terms', r.status === 200 && JSON.stringify(one('SELECT terms_wishlist_json, owner_carry FROM listings WHERE id = ?', rentalId)) === '{"terms_wishlist_json":"[]","owner_carry":0}');

// ================= 10. Pre-listings: browse, detail, edit =================
exec(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, stay_after_days)
      VALUES (502, 2, 'No stay', 'Chula Vista', 'CA', '91915', 'Condo', 2, 2, 600000, 0)`);
const browse = async (who, qs = '', env = envLive) => (await callWith(env)(preApi.onRequestGet, 'GET', `/api/pre-listings${qs}`, who)).json;
let b = await browse(6, '?stay=1');
check('stay=1 keeps only homes whose owner would like to stay, for an approved agent', b.preListings.map(p => p.id).join() === '501', b.preListings.map(p => p.id).join());
b = await browse(6);
card = b.preListings.find(p => p.id === 501);
check('the full card carries stayAfterDays, and the financing flags while that tool is live', b.preListings.length === 2 && card.stayAfterDays === 14 && card.ownerCarry === 1 && card.assumable === 0 && b.preListings.find(p => p.id === 502).stayAfterDays === 0, JSON.stringify(card));
b = await browse(6, '', envShipped);
card = b.preListings.find(p => p.id === 501);
check('shipped gate: the full card has stayAfterDays (live) and no financing flags (dark)', card.stayAfterDays === 14 && !('ownerCarry' in card) && !('assumable' in card));
b = await browse(8, '?stay=1');
check('stay=1 is ignored for a teaser viewer', b.preListings.length === 2 && b.preListings.every(p => p.teaser === true));
check('the teaser has no stay, terms, flags or head start', !/stayAfterDays|stay_after|termsWishlist|terms_wishlist|ownerCarry|owner_carry|assumable|headStart|head_start/.test(JSON.stringify(b)), JSON.stringify(b.preListings[0]));
b = await browse(5, '?stay=1');
check('stay=1 works for an admin', b.preListings.map(p => p.id).join() === '501');
b = await browse(1, '?mine=1');
check('the owner\'s own list carries stayAfterDays', b.preListings.find(p => p.id === 501).stayAfterDays === 14);
// Detail.
let d = await call(preOne.onRequestGet, 'GET', '/api/pre-listings/501', 6, { id: '501' });
check('detail, an approved agent: terms (wish list + flags) and homeData; no head start time', d.status === 200 && JSON.stringify(d.json.preListing.terms) === '{"termsWishlist":["as_is","quick_close"],"ownerCarry":1,"assumable":0}' && typeof d.json.preListing.homeData === 'object' && !('headStartUntil' in d.json.preListing), JSON.stringify(d.json.preListing.terms));
d = await callShipped(preOne.onRequestGet, 'GET', '/api/pre-listings/501', 6, { id: '501' });
check('shipped gate, an approved agent: the wish list, no flags', JSON.stringify(d.json.preListing.terms) === '{"termsWishlist":["as_is","quick_close"]}', JSON.stringify(d.json.preListing.terms));
d = await callShipped(preOne.onRequestGet, 'GET', '/api/pre-listings/501', 1, { id: '501' });
check('the owner gets headStartUntil (null when there is none)', d.json.preListing.headStartUntil === null && 'terms' in d.json.preListing);
d = await call(preOne.onRequestGet, 'GET', '/api/pre-listings/501', 8, { id: '501' });
check('a member who isn\'t an agent still can\'t open the detail', d.status !== 200);
// Editing a flagged pre-listing's text.
const preEdit = { title: 'Canyon view', description: 'Monthly payments possible.', city: 'Chula Vista', state: 'CA', zip: '91915', propertyType: 'Condo', beds: 3, baths: 2, askingPrice: 700000 };
r = await call(preOne.onRequestPut, 'PUT', '/api/pre-listings/501', 1, { id: '501' }, preEdit);
check('a flagged pre-listing\'s edit can\'t add loan terms', r.status === 400 && r.json.error === lt.CREDIT_TERMS_ERROR, JSON.stringify(r.json));
r = await call(preOne.onRequestPut, 'PUT', '/api/pre-listings/501', 1, { id: '501' }, { ...preEdit, description: 'Quiet street, canyon view.' });
check('...a clean edit saves', r.status === 200);

// ================= 11. Head start: create, alerts, announceNewListing =================
// 9 owns a San Diego home that wants Chula Vista: a mutual match for Ana's new home. 4 has a plain saved search.
exec(`INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier) VALUES (900, 9, 'Match me', 'San Diego', 'CA', 'Condo', 2, 2, 700000, 'mid')`);
exec(`INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (900, 'Chula Vista', 'Any', 0, 0, 0, 2000000)`);
const counts = () => ({
  match: one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'match'").n,
  saved: one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'saved_search'").n,
  pulse: one("SELECT COUNT(*) AS n FROM market_events WHERE event_type = 'new_listing'").n,
  nearby: one("SELECT COUNT(*) AS n FROM notifications WHERE type = 'nearby'").n,
});
const diff = (a, c) => Object.fromEntries(Object.keys(a).map(k => [k, c[k] - a[k]]));
let before = counts();
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Normal create', zip: '91915' });
const normal = diff(before, counts());
check('a normal create sends the three alerts and no watcher notice', r.status === 201 && !('headStartUntil' in r.json) && normal.match >= 1 && normal.saved >= 1 && normal.pulse === 1 && normal.nearby === 0, JSON.stringify(normal));
before = counts();
reset();
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Head start home', zip: '91915', headStart: { hours: 24, noAgreement: true } });
const hsId = r.json && r.json.id;
row = one('SELECT status, head_start_until, zip FROM listings WHERE id = ?', hsId);
const hsDiff = diff(before, counts());
check('a head-start create is stored paused with its end time, in the INSERT', r.status === 201 && row.status === 'paused' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.head_start_until) && r.json.headStartUntil === row.head_start_until
  && stats.log.filter(s => /^(INSERT INTO|UPDATE) listings/.test(s.sql)).length === 1 && stats.log.find(s => s.sql.startsWith('INSERT INTO listings')).params === 33, JSON.stringify(r.json) + JSON.stringify(row));
check('...it sends none of the three alerts', hsDiff.match === 0 && hsDiff.saved === 0 && hsDiff.pulse === 0, JSON.stringify(hsDiff));
check('...and tells the ZIP\'s watchers in the app (one notice, to the member who watches 91915)', hsDiff.nearby === 1 && one("SELECT user_id FROM notifications WHERE type = 'nearby' ORDER BY id DESC").user_id === 7, JSON.stringify(hsDiff));
check('...claiming the head_start limit', one("SELECT COUNT(*) AS n FROM user_action_log WHERE user_id = 1 AND kind = 'head_start'").n === 1);
r = await call(directory.onRequestGet, 'GET', '/api/directory?limit=60', null);
check('...and it is not in the public directory', !r.json.listings.some(l => l.id === hsId));
// announceNewListing: nothing while paused; each alert once when it opens.
before = counts();
await listingsLib.announceNewListing({ env: envLive, waitUntil() {} }, hsId);
check('announceNewListing does nothing for a paused listing', JSON.stringify(diff(before, counts())) === '{"match":0,"saved":0,"pulse":0,"nearby":0}');
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${hsId}`, 1, { id: String(hsId) }, { status: 'active' });
row = one('SELECT status, head_start_until FROM listings WHERE id = ?', hsId);
const opened = diff(before, counts());
check('the owner makes it active: it opens (active, no head start)', r.status === 200 && row.status === 'active' && row.head_start_until === null, JSON.stringify(row));
check('...and each of the three alerts goes out once, the same as a normal create', opened.match === normal.match && opened.saved === normal.saved && opened.pulse === 1, `${JSON.stringify(opened)} vs ${JSON.stringify(normal)}`);
const pulseRow = one("SELECT headline, amount FROM market_events WHERE event_type = 'new_listing' AND entity_id = ?", hsId);
check('...with the create path\'s Market Pulse headline', !!pulseRow && pulseRow.headline === 'New listing: Single Family Home in Chula Vista, CA — $950,000' && pulseRow.amount === 950000, JSON.stringify(pulseRow));
before = counts();
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${hsId}`, 1, { id: String(hsId) }, { status: 'active' });
check('making it active again announces nothing', JSON.stringify(diff(before, counts())) === '{"match":0,"saved":0,"pulse":0,"nearby":0}');
// Pausing a head-start listing ends the head start for good.
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Head start, then paused', zip: '91915', headStart: { hours: 72, noAgreement: true } });
const hs2 = r.json.id;
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${hs2}`, 2, { id: String(hs2) }, { status: 'paused' });
row = one('SELECT status, head_start_until FROM listings WHERE id = ?', hs2);
check('pausing a head-start listing clears head_start_until (it never opens by itself)', r.status === 200 && row.status === 'paused' && row.head_start_until === null, JSON.stringify(row));
// Refusals.
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, headStart: { hours: 24, noAgreement: true } });
check('no ZIP -> the head start is refused', r.status === 400 && r.json.error === watch.HEAD_START_ZIP_ERROR, JSON.stringify(r.json));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, zip: '91915', headStart: { hours: 24 } });
check('no "haven\'t signed a listing agreement" tick -> refused', r.status === 400 && r.json.error === watch.HEAD_START_TICK_ERROR);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 6, {}, { ...trade, zip: '91915', headStart: { hours: 24, noAgreement: true } });
check('an approved agent\'s own post -> refused', r.status === 400 && r.json.error === watch.HEAD_START_AGENT_ERROR);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 6, {}, { ...trade, clientName: 'A Client', zip: '91915', headStart: { hours: 24, noAgreement: true } });
check('a home posted for a client -> refused', r.status === 400 && r.json.error === watch.HEAD_START_AGENT_ERROR);
before = counts();
r = await callShipped(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Shipped gate head start', zip: '91915', headStart: { hours: 24, noAgreement: true } });
row = one('SELECT status, head_start_until FROM listings WHERE id = ?', r.json.id);
check('shipped gate, a member: the head start is ignored (a normal, active listing with its alerts)', r.status === 201 && !('headStartUntil' in r.json) && row.status === 'active' && row.head_start_until === null && diff(before, counts()).pulse === 1 && diff(before, counts()).nearby === 0, JSON.stringify(row));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, isBuyerOnly: true, headStart: { hours: 24, noAgreement: true } });
check('a buyer-only profile never gets a head start', r.status === 201 && one('SELECT status, head_start_until FROM listings WHERE id = ?', r.json.id).head_start_until === null);
// Pre-listing head start.
const preBody = { title: 'Head start pre-listing', city: 'Chula Vista', state: 'CA', zip: '91915', propertyType: 'Condo', beds: 2, baths: 2, askingPrice: 610000 };
reset();
before = counts();
r = await call(preApi.onRequestPost, 'POST', '/api/pre-listings', 2, {}, { ...preBody, headStart: { hours: 24, noAgreement: true } });
const preHs = r.json && r.json.id;
const touching = stats.log.filter(s => /head_start_until/.test(s.sql) && /pre_listings/.test(s.sql));
check('a pre-listing\'s head start is written in the INSERT (no later UPDATE sets it)', r.status === 201 && !!r.json.headStartUntil && touching.length === 1 && touching[0].sql.startsWith('INSERT INTO pre_listings') && one('SELECT head_start_until FROM pre_listings WHERE id = ?', preHs).head_start_until === r.json.headStartUntil, touching.map(s => s.sql.slice(0, 50)).join(' | '));
check('...and the ZIP\'s watchers are told in the app', diff(before, counts()).nearby === 1);
const teaserIds = async (who) => (await browse(who)).preListings.map(p => p.id);
check('the teaser is held back from a member who doesn\'t watch the ZIP', !(await teaserIds(8)).includes(preHs) && (await teaserIds(8)).includes(501));
check('...shown to a member who watches the ZIP', (await teaserIds(7)).includes(preHs));
check('...shown to its owner', (await teaserIds(2)).includes(preHs));
check('...and approved agents and admins see the full card as always', (await teaserIds(6)).includes(preHs) && (await teaserIds(5)).includes(preHs));
exec("UPDATE pre_listings SET head_start_until = datetime('now', '-1 minute') WHERE id = ?", preHs);
check('once the time has passed the teaser opens to everyone, with no job', (await teaserIds(8)).includes(preHs));
d = await call(preOne.onRequestGet, 'GET', `/api/pre-listings/${preHs}`, 6, { id: String(preHs) });
check('detail: an agent never gets the head start time; the owner and an admin do', !('headStartUntil' in d.json.preListing)
  && typeof (await call(preOne.onRequestGet, 'GET', `/api/pre-listings/${preHs}`, 2, { id: String(preHs) })).json.preListing.headStartUntil === 'string'
  && typeof (await call(preOne.onRequestGet, 'GET', `/api/pre-listings/${preHs}`, 5, { id: String(preHs) })).json.preListing.headStartUntil === 'string');
r = await call(preApi.onRequestPost, 'POST', '/api/pre-listings', 6, {}, { ...preBody, headStart: { hours: 24, noAgreement: true } });
check('an approved agent can\'t use a head start on a pre-listing', r.status === 400 && r.json.error === watch.HEAD_START_AGENT_ERROR);
r = await callShipped(preApi.onRequestPost, 'POST', '/api/pre-listings', 2, {}, { ...preBody, title: 'Shipped', headStart: { hours: 24, noAgreement: true } });
check('shipped gate, a member: a pre-listing\'s head start is ignored', r.status === 201 && !('headStartUntil' in r.json) && one('SELECT head_start_until FROM pre_listings WHERE id = ?', r.json.id).head_start_until === null);

// ================= 12. Create without a head start: the same statements as before this batch =================
// Measured at HEAD a57bd09 with this exact fixture and this order (a scratch run of the HEAD tree, same D1 stand-in):
// trade 25, rental 21, buyer-only 19, pre-listing 7 statements, session included.
const got = {};
const seen = {};
for (const [label, extra] of [['shipped', {}], ['live', { NUANCED_ALL_LIVE: '1' }]]) {
  const fresh = makeDb();
  const run = (sql, ...a) => fresh.sqlite.prepare(sql).run(...a);
  for (const id of [1, 2, 3]) {
    run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, `u${id}@example.test`, `U${id}`, 'user', 'active');
    run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
  }
  run("INSERT INTO saved_searches (user_id, locations) VALUES (2, 'Chula Vista')");
  run("INSERT INTO listings (user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier) VALUES (3, 'Other', 'San Diego', 'CA', 'Condo', 2, 2, 700000, 'mid')");
  run("INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (1, 'Chula Vista', 'Any', 0, 0, 0, 2000000)");
  const base = { city: 'Chula Vista', state: 'CA', neighborhood: 'EastLake', propertyType: 'Single Family Home', estimatedValue: 950000, beds: 4, baths: 3,
    locations: 'San Diego', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0, title: 'T', description: 'D' };
  for (const [name, handler, path, body] of [
    ['trade', listingsApi.onRequestPost, '/api/listings', base],
    ['rental', listingsApi.onRequestPost, '/api/listings', { ...base, isRental: true, rentAmount: 9000 }],
    ['buyerOnly', listingsApi.onRequestPost, '/api/listings', { ...base, isBuyerOnly: true }],
    ['preListing', preApi.onRequestPost, '/api/pre-listings', { city: 'Chula Vista', state: 'CA', zip: '91915', propertyType: 'Condo', beds: 2, baths: 2, askingPrice: 600000 }],
  ]) {
    fresh.reset();
    const res = await callWith({ DB: fresh.DB, RESEND_API_KEY: 'k', ...extra })(handler, 'POST', path, 1, {}, body);
    got[`${name}/${label}`] = res.status === 201 ? fresh.stats.statements : `status ${res.status}`;
    seen[`${name}/${label}`] = fresh.stats.log.map(s => s.sql.slice(0, 48));
  }
}
{
  const want = { 'trade/shipped': 25, 'rental/shipped': 21, 'buyerOnly/shipped': 19, 'preListing/shipped': 7, 'trade/live': 25, 'rental/live': 21, 'buyerOnly/live': 19, 'preListing/live': 7 };
  check('a create without a head start runs the same number of statements as at HEAD (both gate states)', JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)}\n${Object.keys(want).filter(k => got[k] !== want[k]).map(k => `${k}:\n  ${(seen[k] || []).join('\n  ')}`).join('\n')}`);
}

// ================= 13. Trash: delete + restore =================
exec(`UPDATE listings SET run_costs_json = '{"electric":180}', fit_json = '{"rooms":[]}', signal_json = '{"asOf":"2026-11"}', step_down_json = '{"startPrice":950000,"stepAmount":10000,"stepDays":7,"steps":2,"startDate":"2026-11-10"}',
        step_next_at = '2099-01-01 17:00:00', head_start_until = NULL WHERE id = ?`, homeId);
await putTerms('listing', homeId, 1, { termsWishlist: ['as_is', 'items_stay'], ownerCarry: true, assumable: true });
const beforeTrash = one('SELECT * FROM listings WHERE id = ?', homeId);
r = await call(listingOne.onRequestDelete, 'DELETE', `/api/listings/${homeId}`, 1, { id: String(homeId) });
const trashRow = one('SELECT id FROM deleted_listings WHERE user_id = 1 ORDER BY id DESC');
reset();
r = await call(trashItem.onRequestPost, 'POST', `/api/listings/trash/${trashRow.id}`, 1, { id: String(trashRow.id) });
const restoreInsert = stats.log.find(s => s.sql.startsWith('INSERT INTO listings'));
check('restore binds 40 params in one listings INSERT', !!restoreInsert && restoreInsert.params === 40 && stats.log.filter(s => /^(INSERT INTO|UPDATE) listings/.test(s.sql)).length === 1, restoreInsert && String(restoreInsert.params));
const afterTrash = one('SELECT * FROM listings WHERE id = ?', r.json.id);
const keptCols = ['zip', 'terms_wishlist_json', 'owner_carry', 'assumable', 'run_costs_json', 'fit_json', 'signal_json'];
const lostCols = keptCols.filter(k => afterTrash[k] !== beforeTrash[k]);
check('restore keeps the ZIP, the wish list, both flags and the owner\'s bills, sizes and signal notes', r.status === 200 && lostCols.length === 0 && afterTrash.zip === '91915' && afterTrash.terms_wishlist_json === '["as_is","items_stay"]' && afterTrash.owner_carry === 1, lostCols.map(k => `${k}: ${beforeTrash[k]} -> ${afterTrash[k]}`).join('; '));
check('a price schedule is NOT restored', afterTrash.step_down_json === '{}' && afterTrash.step_next_at === null);
exec("UPDATE listings SET status = 'paused', head_start_until = '2099-01-01 00:00:00' WHERE id = ?", afterTrash.id);
await call(listingOne.onRequestDelete, 'DELETE', `/api/listings/${afterTrash.id}`, 1, { id: String(afterTrash.id) });
const trash2 = one('SELECT id FROM deleted_listings WHERE user_id = 1 ORDER BY id DESC');
r = await call(trashItem.onRequestPost, 'POST', `/api/listings/trash/${trash2.id}`, 1, { id: String(trash2.id) });
check('a head start is NOT restored', r.status === 200 && one('SELECT head_start_until FROM listings WHERE id = ?', r.json.id).head_start_until === null);
const oldListing = { ...one('SELECT * FROM listings WHERE id = ?', shippedId) };
for (const k of [...keptCols, 'head_start_until', 'step_down_json', 'step_next_at']) delete oldListing[k];
exec('INSERT INTO deleted_listings (user_id, snapshot) VALUES (2, ?)', JSON.stringify({ listing: oldListing, desiredCriteria: null, photos: [] }));
const oldTrash = one('SELECT id FROM deleted_listings WHERE user_id = 2 ORDER BY id DESC');
r = await call(trashItem.onRequestPost, 'POST', `/api/listings/trash/${oldTrash.id}`, 2, { id: String(oldTrash.id) });
const oldRow = r.json && one('SELECT zip, terms_wishlist_json, owner_carry, assumable, run_costs_json, fit_json, signal_json FROM listings WHERE id = ?', r.json.id);
check('an older snapshot (before v47) restores with the defaults', r.status === 200 && JSON.stringify(oldRow) === '{"zip":"","terms_wishlist_json":"[]","owner_carry":0,"assumable":0,"run_costs_json":"{}","fit_json":"{}","signal_json":"{}"}', JSON.stringify(oldRow));

// ================= 14. Where the new data never goes =================
for (const f of ['functions/_lib/structuredData.js', 'functions/listing/[id]/flyer.js', 'functions/_lib/matching.js', 'functions/_lib/matchNotify.js']) {
  const src = existsSync(`${root}/${f}`) ? readFileSync(`${root}/${f}`, 'utf8') : '';
  check(`${f} never reads the wish list, the flags, the schedule or the head start`, src !== '' && !/terms_wishlist|termsWishlist|owner_carry|ownerCarry|assumable|step_down|step_next|head_start/.test(src));
}
for (const f of ['functions/_lib/matching.js', 'functions/_lib/matchNotify.js']) {
  const head = headFile(f);
  check(`${f} is byte-identical to HEAD`, head === null ? true : head === readFileSync(`${root}/${f}`, 'utf8').replace(/\r\n/g, '\n'), head === null ? 'no git' : 'changed');
}
check('no alert or notice from these routes names financing', q("SELECT body FROM notifications").every(n => !/financing|assumable|carry/i.test(n.body)));

// ================= 15. The app script (listing-terms.js) prints the same strings =================
const clientSrc = readFileSync(`${root}/listing-terms.js`, 'utf8');
const makeBox = (tools) => {
  const box = { window: { NUANCED: tools }, console: { log() {} } };
  vm.createContext(box);
  // Top-level const/let stay out of the sandbox object, so the names the suite reads are handed over at the end.
  vm.runInContext(`${clientSrc}\n;Object.assign(globalThis, { LT: { LT_WISHLIST_ITEMS, LT_WISHLIST_MAX, LT_WISHLIST_HEADING, LT_WISHLIST_LINE, LT_WISHLIST_BUYER_LINE, LT_FINANCING_HEADING, LT_OWNER_CARRY_LINE, LT_ASSUMABLE_LINE, LT_SELL_STAY_NOTE } });`, box);
  return box;
};
const app = makeBox(ALL);
const appShipped = makeBox(SHIPPED);
check('client constants match the server lib', JSON.stringify(app.LT.LT_WISHLIST_ITEMS) === JSON.stringify(lt.WISHLIST_ITEMS) && app.LT.LT_WISHLIST_MAX === lt.WISHLIST_MAX && app.LT.LT_WISHLIST_HEADING === lt.WISHLIST_HEADING
  && app.LT.LT_WISHLIST_LINE === lt.WISHLIST_LINE && app.LT.LT_WISHLIST_BUYER_LINE === lt.WISHLIST_BUYER_LINE && app.LT.LT_FINANCING_HEADING === lt.FINANCING_HEADING
  && app.LT.LT_OWNER_CARRY_LINE === lt.OWNER_CARRY_LINE && app.LT.LT_ASSUMABLE_LINE === lt.ASSUMABLE_LINE && app.LT.LT_SELL_STAY_NOTE === lt.SELL_STAY_NOTE);
const FIXTURES = [
  ['a listing with a wish list', { terms_wishlist_json: '["as_is","quick_close"]', owner_carry: 0, assumable: 0 }, 'listing'],
  ['a listing with both flags', { terms_wishlist_json: '[]', owner_carry: 1, assumable: 1 }, 'listing'],
  ['a listing with everything', { terms_wishlist_json: JSON.stringify(KEYS), owner_carry: 1, assumable: 0 }, 'listing'],
  ['a listing with nothing', { terms_wishlist_json: '[]', owner_carry: 0, assumable: 0 }, 'listing'],
  ['a pre-listing with a stay item and a stay set', { terms_wishlist_json: '["stay_after","simple_handoff"]', owner_carry: 0, assumable: 1, stay_after_days: 29 }, 'pre_listing'],
  ['a rental', { terms_wishlist_json: '["as_is"]', owner_carry: 1, assumable: 1, is_rental: 1 }, 'listing'],
];
for (const [label, fixture, kind] of FIXTURES) {
  const server = lt.termsBlocksHtml(fixture, ALL, { kind });
  const client = app.ltDetailHtml(fixture, { kind });
  check(`ltDetailHtml === the server's financing + wish-list HTML: ${label}`, client === server.financing + server.wishlist, client);
  const serverShipped = lt.termsBlocksHtml(fixture, SHIPPED, { kind });
  check(`...and under the shipped gate: ${label}`, appShipped.ltDetailHtml(fixture, { kind }) === serverShipped.financing + serverShipped.wishlist);
}
// The API shape a pre-listing detail carries (terms + timing).
const apiPre = { id: 501, terms: { termsWishlist: ['stay_after', 'as_is'], ownerCarry: 1, assumable: 0 }, timing: { closeFrom: null, closeTo: null, stayAfterDays: 14 } };
const serverPre = lt.termsBlocksHtml({ terms_wishlist_json: '["stay_after","as_is"]', owner_carry: 1, assumable: 0, stay_after_days: 14 }, ALL, { kind: 'pre_listing' });
check('ltDetailHtml reads a pre-listing from the API (terms + timing) the same way', app.ltDetailHtml(apiPre, { kind: 'pre_listing' }) === serverPre.financing + serverPre.wishlist);
check('ltSellStayBadgeHtml: the server\'s badge text, with the note on the detail', app.ltSellStayBadgeHtml(apiPre) === `<span class="badge sell-stay-badge">${esc(lt.sellStayBadge(14))}</span><p class="tiny">${esc(lt.SELL_STAY_NOTE)}</p>`, app.ltSellStayBadgeHtml(apiPre));
check('...just the badge on a full card; nothing with no stay', app.ltSellStayBadgeHtml({ id: 1, stayAfterDays: 7 }) === `<span class="badge sell-stay-badge">${esc(lt.sellStayBadge(7))}</span>` && app.ltSellStayBadgeHtml({ id: 1, stayAfterDays: 0 }) === '' && app.ltSellStayBadgeHtml({ id: 1, teaser: true }) === '');
check('the Sell and Stay client copy has no dollar figure', !app.ltSellStayBadgeHtml(apiPre).includes('$') && !app.ltPreListingFilterHtml().includes('$'));
const form = app.ltFieldsHtml('lf', { terms_wishlist_json: '["as_is","quick_close"]', owner_carry: 1, assumable: 0 }, { kind: 'listing', isRental: false });
const wishField = (form.match(/<fieldset class="facts-group" id="lfLtWishlist"[\s\S]*?<\/fieldset>/) || [''])[0];
check('the wish-list form: eight tap chips, the picked ones ranked, no text input (no input at all)', (wishField.match(/data-action="lt-wish-toggle"/g) || []).length === 8 && !/<input|<textarea|<select|contenteditable/.test(wishField)
  && wishField.includes('data-picked="as_is,quick_close"') && wishField.includes(`aria-pressed="true">1. ${esc(lt.WISHLIST_ITEMS.as_is)}</button>`) && wishField.includes(`aria-pressed="true">2. ${esc(lt.WISHLIST_ITEMS.quick_close)}</button>`)
  && wishField.includes(`aria-pressed="false">${esc(lt.WISHLIST_ITEMS.items_stay)}</button>`), wishField.slice(0, 300));
check('the wish-list form copy', wishField.includes('Tap in order of importance, up to 5') && wishField.includes('data-action="lt-wish-clear">Clear</button>') && wishField.includes(esc("Pick the sale terms that matter to you besides price. It's about the sale, never about the buyer.")));
check('the financing form: the two checkboxes with their help, the saved one ticked', form.includes(`<label class="checkbox-row" for="lfLtOwnerCarry"><input type="checkbox" id="lfLtOwnerCarry" checked><span>${esc("I'm open to carrying a note (seller financing)")}</span></label>`)
  && form.includes('<label class="checkbox-row" for="lfLtAssumable"><input type="checkbox" id="lfLtAssumable"><span>My loan may be assumable (many FHA, VA and USDA loans are)</span></label>')
  && form.includes('Just a yes or no. Leave out any rate, amount, down payment, term or payment; those are worked out later with your agents and a licensed loan professional.')
  && form.includes('Your loan servicer decides. Leave the rate and balance out.'));
check('the financing form has only the two checkboxes: no number, text or select field', (form.match(/<input/g) || []).length === 2 && !/type="(number|text)"|<select|<textarea/.test(form));
check('nothing for a rental', app.ltFieldsHtml('lf', null, { kind: 'listing', isRental: true }) === '');
const formShipped = appShipped.ltFieldsHtml('lf', null, { kind: 'listing' });
check('shipped gate: the form has the wish list and no financing checkboxes', formShipped.includes('id="lfLtWishlist"') && !/LtOwnerCarry|LtAssumable|carrying a note|assumable/i.test(formShipped));
check('shipped gate: no saved-search fields, no price-schedule panel', appShipped.ltSavedSearchFieldsHtml() === '' && appShipped.ltStepDownPanelHtml({ id: 1, estimated_value: 900000 }) === '' && JSON.stringify(appShipped.ltReadSavedSearch()) === '{}');
check('with every tool dark, nothing renders at all', (() => { const off = makeBox({}); return off.ltFieldsHtml('lf', null, {}) === '' && off.ltDetailHtml(FIXTURES[2][1], { kind: 'listing' }) === '' && off.ltSellStayBadgeHtml(apiPre) === '' && off.ltPreListingFilterHtml() === '' && JSON.stringify(off.ltPreListingFilterParams()) === '{}'; })());
const ssFields = app.ltSavedSearchFieldsHtml();
check('saved-search fields: the two ticks, labelled as the owner\'s word', ssFields.includes('<label class="checkbox-row" for="ssOwnerCarry"><input type="checkbox" id="ssOwnerCarry"><span>Owner open to seller financing</span></label>')
  && ssFields.includes('<label class="checkbox-row" for="ssAssumable"><input type="checkbox" id="ssAssumable"><span>Loan may be assumable</span></label>') && ssFields.includes(esc(lt.FINANCING_HEADING)));
check('ltSavedSearchLabel', app.ltSavedSearchLabel({ deal_flags: 3 }) === ' · seller financing · assumable loan' && app.ltSavedSearchLabel({ deal_flags: 1 }) === ' · seller financing' && app.ltSavedSearchLabel({ deal_flags: 2 }) === ' · assumable loan' && app.ltSavedSearchLabel({}) === '' && app.ltSavedSearchLabel({ deal_flags: 0 }) === '');
check('the agent browse filter', app.ltPreListingFilterHtml() === '<label class="checkbox-row" for="ltStayFilter"><input type="checkbox" id="ltStayFilter" data-action="lt-stay-filter"><span>Seller would like to stay after closing</span></label>' && JSON.stringify(app.ltPreListingFilterParams()) === '{}');
check('listing-terms.js: no inline style or handler, every label has for=, no McKelvey', !/\sstyle=|\son[a-z]+=/i.test(clientSrc) && !/<label(?![^>]*\bfor=)/.test(clientSrc) && !/McKelvey|Patti|\bJeff\b/i.test(clientSrc));
check('listing-terms.js: no lender name, phone or rate anywhere', !/Point Mortgage|NMLS|tel:|\d\s?%/.test(clientSrc));
check('no \\x08 byte in the files this suite covers', ['listing-terms.js', 'functions/_lib/listingTerms.js', 'functions/_lib/listings.js', 'functions/_lib/savedSearches.js', 'functions/api/directory.js', 'page-home.js'].every(f => !readFileSync(`${root}/${f}`, 'utf8').includes('\x08')));

// ================= 16. Home page: the two financing filters and chips =================
const indexHtml = readFileSync(`${root}/index.html`, 'utf8').replace(/\r\n/g, '\n');
const row4 = (indexHtml.match(/<form id="directoryFilters4"[\s\S]*?<\/form>/) || [''])[0];
check('index.html: the two financing checkboxes in the fourth filter row, hidden until live', row4.includes('<fieldset class="hoa-includes hidden" id="filterDealFields">') && row4.includes('<legend class="label">Financing ideas (from the owner)</legend>')
  && row4.includes('<label class="checkbox-row" for="filterOwnerCarry"><input type="checkbox" id="filterOwnerCarry"><span>Owner open to seller financing</span></label>')
  && row4.includes('<label class="checkbox-row" for="filterAssumable"><input type="checkbox" id="filterAssumable"><span>Loan may be assumable</span></label>'));
check('index.html: no lender, rate or amount next to them', !/Point Mortgage|NMLS|%|\$/.test((row4.match(/<fieldset class="hoa-includes hidden"[\s\S]*?<\/fieldset>/) || [''])[0]));
const homeJs = readFileSync(`${root}/page-home.js`, 'utf8');
const lift = (src, name) => { const start = src.indexOf(`function ${name}(`); let i = src.indexOf('{', start); let depth = 0; for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; } return src.slice(start, i + 1); };
const homeBox = { escapeHtml: esc };
vm.createContext(homeBox);
vm.runInContext(lift(homeJs, 'ltDealChipsHtml'), homeBox);
check('card chips: the owner\'s word, exactly', homeBox.ltDealChipsHtml({ owner_carry: 1, assumable: 1 }) === '<div class="chip-row"><span class="chip">Open to seller financing (owner says)</span><span class="chip">Loan may be assumable (owner says)</span></div>'
  && homeBox.ltDealChipsHtml({ owner_carry: 0, assumable: 1 }) === '<div class="chip-row"><span class="chip">Loan may be assumable (owner says)</span></div>');
check('card chips: nothing when the flags are absent (dark) or 0', homeBox.ltDealChipsHtml({}) === '' && homeBox.ltDealChipsHtml({ owner_carry: 0, assumable: 0 }) === '' && homeBox.ltDealChipsHtml(undefined) === '');
check('page-home.js sends both params and shows the filters only when the directory says so', homeJs.includes("['filterOwnerCarry', 'ownerCarry'], ['filterAssumable', 'assumable']") && homeJs.includes('ltShowDealFilters(!!dealFilters)') && homeJs.includes("classList.toggle('hidden', !on)"));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
