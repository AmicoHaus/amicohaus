// Home facts batch (role T): toy-box (parking and garage) directory filters and card data, toy-box saved searches
// (stored on listing create, so a brand-new listing's alert sees its facts), listing storage of facts and the floor
// plan on create/edit, and the trash restore keeping costs, facts, plan and moving reasons. Real handlers on an
// in-memory SQLite stand-in for D1 (schema.sql). No network.
// Usage: node --disable-warning=ExperimentalWarning tools/toy-box-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
// Counts every statement D1 would run (first/all/run, and each one in a batch) and the most params bound to one.
const stats = { statements: 0, maxParams: 0 };
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; stats.maxParams = Math.max(stats.maxParams, a.length); return stmt; },
      first: async () => { stats.statements++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { stats.statements++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { stats.statements++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
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
globalThis.fetch = async () => new Response('{}', { status: 200 });
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
console.log = () => {};

const user = (id, name, extra = {}) => {
  exec('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, extra.email || `u${id}@example.test`, name, extra.role || 'user', extra.status || 'active');
  exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
// 1 owner Ana, 2 owner Bo, 3 searcher Sam (duplicate checks), 4 searcher Tess (no toy search), 5 searcher Uma
// (garage search), 6 searcher Rita (RV search only)
user(1, 'Ana Owner'); user(2, 'Bo Owner'); user(3, 'Sam Searcher'); user(4, 'Tess Searcher'); user(5, 'Uma Searcher');
user(6, 'Rita Searcher');

const { STEERING_ERROR } = await mod('functions/_lib/homeText.js');
const directory = await mod('functions/api/directory.js');
const savedApi = await mod('functions/api/saved-searches/index.js');
const listingsApi = await mod('functions/api/listings/index.js');
const listingOne = await mod('functions/api/listings/[id].js');
const trashItem = await mod('functions/api/listings/trash/[id].js');

// ---------------- Directory: "unknown never matches" ----------------
const home = (id, owner, facts, extra = {}) => {
  exec(`INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier,
          home_facts_json, hoa_monthly, hoa_details_json, created_at)
        VALUES (?, ?, ?, 'Chula Vista', 'CA', 'Single Family Home', 4, 3, 900000, 'mid', ?, ?, ?, datetime('now', ?))`,
  id, owner, `Home ${id}`, JSON.stringify(facts), extra.hoa === undefined ? null : extra.hoa, JSON.stringify(extra.hoaDetails || {}), `-${id} minutes`);
};
home(101, 1, { toy: { rv: 'yes', rvSpot: 'side_yard', gateIn: 144, garage: 2, workshop: 'yes' }, yard: { faces: 'w', notes: 'Big lemon tree' }, pets: { notes: 'One dog under 40 lb' } }, { hoa: 0 });
home(102, 1, { toy: { rv: 'no', garage: 1 } }, { hoa: 300, hoaDetails: { parking: 'allowed' } });
home(103, 2, {}, {});
home(104, 2, { toy: { rv: 'yes', sideAccess: 'yes', ev240: 'yes', gateIn: 100 } }, { hoa: 200, hoaDetails: { parking: 'limited' } });
home(105, 2, { toy: { sideAccess: 'no', workshop: 'no', ev240: 'no', garage: 0 } }, { hoa: 150 });

const ids = async (qs) => {
  const r = await call(directory.onRequestGet, 'GET', `/api/directory?${qs}`, null);
  return r.json.listings.map(l => l.id).sort((a, b) => a - b).join(',');
};
check('rv=1 returns only homes whose owner said yes (never {} or "no")', (await ids('rv=1')) === '101,104');
check('sideAccess=1 -> only "yes"', (await ids('sideAccess=1')) === '104');
check('workshop=1 -> only "yes"', (await ids('workshop=1')) === '101');
check('ev240=1 -> only "yes"', (await ids('ev240=1')) === '104');
check('minGateIn=120 excludes a home with no gate value and one under it', (await ids('minGateIn=120')) === '101');
check('minGateIn=100 -> 100 and 144', (await ids('minGateIn=100')) === '101,104');
check('minGarage=2 -> only the 2-space garage (0 and unknown never match)', (await ids('minGarage=2')) === '101');
check('minGarage=1 -> 1 and 2 spaces', (await ids('minGarage=1')) === '101,102');
check('hoaParking=1 matches no-HOA (0 dues) and "allowed", not "limited" or unknown dues', (await ids('hoaParking=1')) === '101,102');
check('out-of-range minimums are ignored (no filter, no error)', (await ids('minGateIn=5&minGarage=99')) === '101,102,103,104,105');
check('filters combine', (await ids('rv=1&minGateIn=120&hoaParking=1')) === '101');
check('no filter: every home', (await ids('')) === '101,102,103,104,105');

let r = await call(directory.onRequestGet, 'GET', '/api/directory', null);
const card = r.json.listings.find(l => l.id === 101);
check('cards carry the toy group only', JSON.stringify(card.toy) === JSON.stringify({ rv: 'yes', rvSpot: 'side_yard', gateIn: 144, garage: 2, workshop: 'yes' }), JSON.stringify(card.toy));
check('cards never carry home_facts_json, yard or pets', !('home_facts_json' in card) && !r.text.includes('lemon') && !r.text.includes('dog') && !/"yard"|"pets"/.test(r.text));
check('a home with no facts gets toy {}', JSON.stringify(r.json.listings.find(l => l.id === 103).toy) === '{}');

// Same rows either way (home 101 matches every filter here), so the batch lookups are the same too.
exec("UPDATE listings SET mello_roos_annual = 0, plan_key = 'a|b|c', plan_twins = 1 WHERE id = 101");
stats.statements = 0; stats.maxParams = 0;
r = await call(directory.onRequestGet, 'GET', '/api/directory?limit=60&city=Chula&state=CA&propertyType=Single+Family+Home&priceMin=1&priceMax=2000000&noMelloRoos=1&hoaMax=500&rv=1&workshop=1&hoaParking=1&minGateIn=120&minGarage=2&plan=a%7Cb%7Cc', 3);
const filteredCount = stats.statements;
check('every filter at once still finds the home that fits', r.json.listings.map(l => l.id).join() === '101', JSON.stringify(r.json.listings.map(l => l.id)));
stats.statements = 0; stats.maxParams = 0;
await call(directory.onRequestGet, 'GET', '/api/directory?limit=60&city=Chula&state=CA&propertyType=Single+Family+Home&priceMin=1&priceMax=2000000&noMelloRoos=1&hoaMax=500', 3);
check('directory statement count unchanged by the toy-box and plan filters', stats.statements === filteredCount, `${stats.statements} -> ${filteredCount}`);
stats.statements = 0; stats.maxParams = 0;
await call(directory.onRequestGet, 'GET', '/api/directory?limit=60&groupId=1&city=Chula&state=CA&propertyType=Condo&priceMin=1&priceMax=9&noMelloRoos=1&hoaMax=500&rv=1&sideAccess=1&workshop=1&ev240=1&hoaParking=1&minGateIn=120&minGarage=2&plan=a%7Cb%7Cc', 3);
check('bound params stay well under 100 with every filter on', stats.maxParams <= 100 && stats.maxParams > 0, String(stats.maxParams));
exec("UPDATE listings SET mello_roos_annual = NULL, plan_key = NULL, plan_twins = 0 WHERE id = 101");
const dirSrc = readFileSync(`${root}/functions/api/directory.js`, 'utf8');
check('directory.js keeps the "unknown isn\'t no" rule comment', dirSrc.includes('// Only homes whose owner shared these details can match (an unknown isn\'t "no").'));

// ---------------- Saved searches ----------------
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Chula Vista', toy: { rv: true } });
check('a toy-box saved search is saved', r.status === 201, JSON.stringify(r.json));
const toySearchRow = one('SELECT toy_flags, min_gate_in, min_garage FROM saved_searches WHERE user_id = 3');
check('rv -> toy_flags 1, no minimums', toySearchRow.toy_flags === 1 && toySearchRow.min_gate_in === null && toySearchRow.min_garage === null, JSON.stringify(toySearchRow));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'chula vista' });
check('the same criteria without the toy-box is a different search', r.status === 201, JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Chula Vista', toy: { rv: true } });
check('the same toy-box search again is a duplicate', r.status === 400 && r.json.code === 'saved_search_duplicate', JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Chula Vista', toy: { rv: true, minGateIn: '120' } });
check('a different gate minimum is a different search', r.status === 201, JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Chula Vista', toy: { rv: true, minGateIn: '120' } });
check('...and the same one again is a duplicate (NULL-safe compare)', r.status === 400 && r.json.code === 'saved_search_duplicate', JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Otay', toy: { minGateIn: 10 } });
check('a gate minimum under 24 inches is refused', r.status === 400 && /24 to 480/.test(r.json.error), JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 3, {}, { locations: 'Otay', toy: { minGarage: 0 } });
check('a garage minimum of 0 is refused', r.status === 400 && /1 to 10/.test(r.json.error), JSON.stringify(r.json));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 5, {}, { locations: 'Chula Vista', toy: { sideAccess: true, workshop: 1, ev240: 'yes', minGarage: 2 } });
check('every flag bit is stored', r.status === 201 && one('SELECT toy_flags, min_garage FROM saved_searches WHERE user_id = 5').toy_flags === 14 && one('SELECT min_garage FROM saved_searches WHERE user_id = 5').min_garage === 2);
r = await call(savedApi.onRequestGet, 'GET', '/api/saved-searches', 3);
check('GET returns the toy columns, private, no-store', r.headers.get('Cache-Control') === 'private, no-store' && r.json.searches.every(s => 'toy_flags' in s && 'min_gate_in' in s && 'min_garage' in s), JSON.stringify(r.json.searches[0]));
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 4, {}, { locations: 'Chula Vista' });
r = await call(savedApi.onRequestPost, 'POST', '/api/saved-searches', 6, {}, { locations: 'Chula Vista', toy: { rv: 'on' } });
check('an RV-only searcher', r.status === 201 && one('SELECT toy_flags FROM saved_searches WHERE user_id = 6').toy_flags === 1);

// ---------------- Listing create: the race is gone ----------------
const trade = { city: 'Chula Vista', state: 'CA', neighborhood: 'EastLake', propertyType: 'Single Family Home', estimatedValue: 950000, beds: 4, baths: 3,
  locations: 'San Diego', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0 };
const notes = uid => q("SELECT id FROM notifications WHERE user_id = ? AND type = 'saved_search'", uid).length;
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'RV home', homeFacts: { toy: { rv: 'yes', gateIn: '144' }, yard: { faces: 'w' } } });
const rvId = r.json && r.json.id;
check('a listing with toy facts is created', r.status === 201 && !!rvId, JSON.stringify(r.json));
check('its facts are stored from the same request', JSON.parse(one('SELECT home_facts_json FROM listings WHERE id = ?', rvId).home_facts_json).toy.gateIn === 144);
check('...and an rv search (toy_flags 1) is alerted at once', notes(6) === 1, String(notes(6)));
check('...a plain search too', notes(4) === 1);
check('...but not a search needing side access, workshop, EV and 2 garage spaces', notes(5) === 0);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'No facts' });
check('a listing with no toy facts never alerts a toy search (the plain one still is)', r.status === 201 && notes(6) === 1 && notes(4) === 2, `${notes(6)} ${notes(4)}`);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Says no', homeFacts: { toy: { rv: 'no' } } });
check('"rv: no" never alerts an rv search', notes(6) === 1 && notes(4) === 3);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 2, {}, { ...trade, title: 'Garage home', homeFacts: { toy: { sideAccess: 'yes', workshop: 'yes', ev240: 'yes', garage: 3 } } });
check('the full match alerts the garage search', notes(5) === 1);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, isBuyerOnly: true, homeFacts: { toy: { rv: 'yes' } }, floorPlan: { builder: 'Lennar', name: 'Plan 3', showTwins: true } });
const buyerId = r.json && r.json.id;
const buyerRow = one('SELECT home_facts_json, plan_key, plan_twins FROM listings WHERE id = ?', buyerId);
check('a buyer-only POST stores {} and no floor plan', r.status === 201 && buyerRow.home_facts_json === '{}' && buyerRow.plan_key === null && buyerRow.plan_twins === 0, JSON.stringify(buyerRow));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, homeFacts: { yard: { notes: 'Great yard for the kids' } } });
check('a steering yard note in the POST -> 400 with STEERING_ERROR', r.status === 400 && r.json.error === STEERING_ERROR, JSON.stringify(r.json));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, homeFacts: { toy: { gateIn: 10 } } });
check('a bad gate number in the POST -> 400 with the gate error', r.status === 400 && r.json.error === 'Gate opening should be whole inches from 24 to 480.', JSON.stringify(r.json));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, isRental: true, rentAmount: 3000, homeFacts: { pets: { rental: 'none' } } });
check('a rental keeps its renters\' pet policy', JSON.parse(one('SELECT home_facts_json FROM listings WHERE id = ?', r.json.id).home_facts_json).pets.rental === 'none');
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, homeFacts: { pets: { rental: 'none' }, plan: { builder: 'X', name: 'Y' } } });
check('a trade listing drops a renters\' pet policy and the pre-listing plan group', one('SELECT home_facts_json FROM listings WHERE id = ?', r.json.id).home_facts_json === '{}');

// ---------------- Listing edit ----------------
const editBody = { ...trade, title: 'RV home, edited', action: 'edit' };
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${rvId}`, 1, { id: String(rvId) }, editBody);
check('an edit without homeFacts keeps the stored facts', r.status === 200 && JSON.parse(one('SELECT home_facts_json FROM listings WHERE id = ?', rvId).home_facts_json).toy.rv === 'yes');
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${rvId}`, 1, { id: String(rvId) }, { ...editBody, floorPlan: { builder: 'Lennar', community: 'Otay Ranch Village 11', name: 'Plan 3', showTwins: true } });
let planRow = one('SELECT plan_builder, plan_name, plan_community, plan_key, plan_twins, home_facts_json FROM listings WHERE id = ?', rvId);
check('an edit with floorPlan stores it (and keeps the facts)', planRow.plan_key === 'lennar|otay ranch village 11|3' && planRow.plan_twins === 1 && planRow.plan_name === 'Plan 3' && JSON.parse(planRow.home_facts_json).toy.rv === 'yes', JSON.stringify(planRow));
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${rvId}`, 1, { id: String(rvId) }, { ...editBody, homeFacts: { toy: { workshop: 'yes' } } });
planRow = one('SELECT plan_key, plan_twins, home_facts_json FROM listings WHERE id = ?', rvId);
check('an edit with homeFacts replaces them and keeps the floor plan', JSON.stringify(JSON.parse(planRow.home_facts_json)) === '{"toy":{"workshop":"yes"}}' && planRow.plan_twins === 1, JSON.stringify(planRow));
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${rvId}`, 1, { id: String(rvId) }, { ...editBody, homeFacts: { yard: { notes: 'Zona segura' } } });
check('a steering note (Spanish) on edit -> 400, nothing changed', r.status === 400 && r.json.error === STEERING_ERROR && JSON.parse(one('SELECT home_facts_json FROM listings WHERE id = ?', rvId).home_facts_json).toy.workshop === 'yes');
r = await call(listingOne.onRequestPut, 'PUT', `/api/listings/${rvId}`, 2, { id: String(rvId) }, { ...editBody, homeFacts: {} });
check("someone else can't edit the facts", r.status === 403);

// ---------------- matching.js / matchNotify.js unchanged (toy-box stays out of the match %) ----------------
for (const f of ['functions/_lib/matching.js', 'functions/_lib/matchNotify.js']) {
  let head = null;
  try { head = execFileSync('git', ['-C', root, 'show', `HEAD:${f}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* no git */ }
  const now = readFileSync(`${root}/${f}`, 'utf8');
  check(`${f} is byte-identical to HEAD`, head === null ? true : head.replace(/\r\n/g, '\n') === now.replace(/\r\n/g, '\n'), head === null ? 'no git' : 'changed');
  check(`${f} never reads home facts`, !/home_facts|toy_flags|plan_key/.test(now));
}

// ---------------- Trash: delete + restore keeps costs, facts, plan, moving reasons ----------------
exec(`UPDATE listings SET mello_roos_annual = 1800, hoa_monthly = 220, hoa_details_json = ?, life_event_tags_json = ? WHERE id = ?`,
  JSON.stringify({ pets: 'limited', parking: 'allowed' }), JSON.stringify(['downsizing']), rvId);
const before = one('SELECT * FROM listings WHERE id = ?', rvId);
r = await call(listingOne.onRequestDelete, 'DELETE', `/api/listings/${rvId}`, 1, { id: String(rvId) });
check('the owner deletes the listing (to the trash)', r.status === 200 && !one('SELECT id FROM listings WHERE id = ?', rvId));
const trashRow = one('SELECT id FROM deleted_listings WHERE user_id = 1 ORDER BY id DESC');
stats.statements = 0; stats.maxParams = 0;
r = await call(trashItem.onRequestPost, 'POST', `/api/listings/trash/${trashRow.id}`, 1, { id: String(trashRow.id) });
check('restore binds 40 params in one listings INSERT (33 + the 7 nuanced-ideas columns, migration_v47)', stats.maxParams === 40, String(stats.maxParams));
const after = one('SELECT * FROM listings WHERE id = ?', r.json.id);
const kept = ['home_facts_json', 'mello_roos_annual', 'hoa_monthly', 'hoa_details_json', 'life_event_tags_json', 'plan_builder', 'plan_name', 'plan_community', 'plan_key', 'plan_twins'];
const lost = kept.filter(k => after[k] !== before[k]);
check('restore keeps facts, costs, moving reasons and the 5 plan columns', r.status === 200 && lost.length === 0, lost.map(k => `${k}: ${before[k]} -> ${after[k]}`).join('; '));
// An older snapshot (before v46) has none of the new columns: the restore still works with the defaults.
const oldListing = { ...one('SELECT * FROM listings WHERE id = 103') };
for (const k of kept) delete oldListing[k];
exec('INSERT INTO deleted_listings (user_id, snapshot) VALUES (1, ?)', JSON.stringify({ listing: oldListing, desiredCriteria: null, photos: [] }));
const oldTrash = one('SELECT id FROM deleted_listings WHERE user_id = 1 ORDER BY id DESC');
r = await call(trashItem.onRequestPost, 'POST', `/api/listings/trash/${oldTrash.id}`, 1, { id: String(oldTrash.id) });
const oldRow = r.json && one('SELECT home_facts_json, life_event_tags_json, hoa_details_json, plan_twins, plan_key FROM listings WHERE id = ?', r.json.id);
check('an older snapshot restores with the defaults', r.status === 200 && oldRow.home_facts_json === '{}' && oldRow.life_event_tags_json === '[]' && oldRow.hoa_details_json === '{}' && oldRow.plan_twins === 0 && oldRow.plan_key === null, JSON.stringify(oldRow));

// ---------------- Browse UI: index.html filters + page-home.js chips ----------------
const indexHtml = readFileSync(`${root}/index.html`, 'utf8').replace(/\r\n/g, '\n');
const row4 = (indexHtml.match(/<form id="directoryFilters4"[\s\S]*?<\/form>/) || [''])[0];
check('index.html: the 4th filter row with its heading', row4.includes('class="form-row three-col"') && row4.includes('Parking and garage (from the owner)'));
for (const [id, label] of [['filterRv', 'RV or boat parking'], ['filterSideAccess', 'Side or back yard access'], ['filterWorkshop', 'Workshop space'], ['filterEv240', '240V or EV outlet'], ['filterHoaParking', 'HOA allows RV/boat parking (or no HOA)']]) {
  check(`index.html: checkbox ${id} "${label}" with a label for=`, row4.includes(`<label class="checkbox-row" for="${id}"><input type="checkbox" id="${id}"><span>${label}</span></label>`));
}
check('index.html: min gate number (placeholder Any) and min garage select Any/1+/2+/3+/4+', row4.includes('<label for="filterGateMin">Min gate opening (inches)</label><input type="number" id="filterGateMin"') && row4.includes('placeholder="Any"')
  && /<select id="filterGarageMin">\s*<option value="">Any<\/option>\s*<option value="1">1\+<\/option>\s*<option value="2">2\+<\/option>\s*<option value="3">3\+<\/option>\s*<option value="4">4\+<\/option>\s*<\/select>/.test(row4));
check('index.html: the owner-measurements line right under the filters', indexHtml.includes(`${row4}\n      <p class="tiny">These filters only show homes whose owner shared these details, and they use the owner's own measurements. Measure and confirm on your visit; HOA and city parking rules vary.</p>`));
check('index.html: every label in the new row has for=, no inline style or handlers', !/<label(?![^>]*\bfor=)/.test(row4) && !/\sstyle=|\son[a-z]+=/i.test(row4));
check('index.html: a mount for the "Same floor plan" chip', indexHtml.includes('<div id="directoryPlanFilter" class="hidden"></div>'));
const homeJs = readFileSync(`${root}/page-home.js`, 'utf8');
const lift = (src, name) => { const start = src.indexOf(`function ${name}(`); let i = src.indexOf('{', start); let depth = 0; for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; } return src.slice(start, i + 1); };
const vm = await import('node:vm');
const box = { escapeHtml: s2 => String(s2 ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
vm.createContext(box);
vm.runInContext(homeJs.match(/const TOY_TWINS_NOT_COMPS_LINE = .*;/)[0].replace('const ', 'var '), box);
vm.runInContext(lift(homeJs, 'toyChipsHtml') + lift(homeJs, 'toyPlanFilterHtml'), box);
const chips = box.toyChipsHtml({ rv: 'yes', gateIn: 144, garage: 2, workshop: 'yes', ev240: 'yes' });
check('card chips: max 3, in order, all "(owner)", class toy-chip', chips === '<div class="chip-row"><span class="chip toy-chip">RV/boat parking (owner)</span><span class="chip toy-chip">Gate about 144 in. (owner)</span><span class="chip toy-chip">2-car garage (owner)</span></div>', chips);
check('card chips: "no" and 0 never show; nothing -> no chips', box.toyChipsHtml({ rv: 'no', garage: 0, workshop: 'no' }) === '' && box.toyChipsHtml(undefined) === '');
check('card chips: workshop and 240V when nothing above them', box.toyChipsHtml({ workshop: 'yes', ev240: 'yes' }).includes('Workshop (owner)</span><span class="chip toy-chip">240V/EV outlet (owner)'));
const { TWINS_NOT_COMPS_LINE } = await mod('functions/_lib/planTwins.js');
check('page-home.js copy of the not-comparable-sales line matches planTwins.js', box.TOY_TWINS_NOT_COMPS_LINE === TWINS_NOT_COMPS_LINE);
const planChip = box.toyPlanFilterHtml();
check('the "Same floor plan ×" chip is a button, and the not-comps line always shows under it', planChip.includes('<button type="button" class="chip" id="toyPlanClear"') && planChip.includes('Same floor plan ×</button>') && planChip.includes(box.escapeHtml(TWINS_NOT_COMPS_LINE)));
check('page-home.js sends every toy-box param and plan', ['rv', 'sideAccess', 'workshop', 'ev240', 'hoaParking'].every(p => homeJs.includes(`'${p}']`)) && homeJs.includes("params.set('minGateIn'") && homeJs.includes("params.set('minGarage'") && homeJs.includes("params.set('plan', toyPlanKey)"));
const newTop = [...homeJs.matchAll(/^(?:function|const|let|var) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]).filter(n => /toy|TOY/.test(n));
check('page-home.js: new top-level names are toy/TOY-prefixed', newTop.length >= 5 && newTop.every(n => /^(toy|TOY_)/.test(n)), newTop.join());

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
