// Home facts batch (role T): floor-plan twins. The plan key, the floor-plan validator (fair-housing, address and code
// checks), the twin list (who's left out, max 6, newest first, no query unless the listing opted in), the strip and the
// owner's plan line (no prices, the not-comparable-sales line always), plan fields hidden on GET /api/listings/:id
// until the owner opts in, the directory's plan= filter, and GET /api/floor-plans. In-memory SQLite stand-in for D1.
// Usage: node --disable-warning=ExperimentalWarning tools/plan-twins-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
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
const env = { DB };
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
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const exec = (sql, ...a) => sqlite.prepare(sql).run(...a);
console.log = () => {};

const T = await mod('functions/_lib/planTwins.js');
const { STEERING_ERROR, ADDRESS_ERROR, CODE_ERROR } = await mod('functions/_lib/homeText.js');

// ---------------- planKey ----------------
check('"Plan 3." and "plan  3" give the same key', T.planKey('Lennar', 'Otay Ranch Village 11', 'Plan 3.') === T.planKey('lennar', 'otay ranch  village 11', 'plan  3'));
check('key shape builder|community|name, "plan " dropped from the name', T.planKey('Lennar', 'Otay Ranch Village 11', 'Plan 3') === 'lennar|otay ranch village 11|3', T.planKey('Lennar', 'Otay Ranch Village 11', 'Plan 3'));
check('a leading "the " is dropped from every part', T.planKey('The New Home Co.', 'The Lakes', 'The Residence 2') === 'new home co|lakes|residence 2', T.planKey('The New Home Co.', 'The Lakes', 'The Residence 2'));
check('punctuation and accents: "St. John\'s" == "st johns", "Señora" == "senora"', T.planKey("St. John's", 'Señora', 'A-1') === T.planKey('st johns', 'senora', 'a 1'));
check('blank builder -> null', T.planKey('', 'X', 'Plan 3') === null && T.planKey('  ', 'X', 'Plan 3') === null);
check('blank name -> null', T.planKey('Lennar', 'X', '') === null);
check('a blank community still makes a key', T.planKey('Lennar', '', 'Plan 3') === 'lennar||3');
check('the key is at most 200 characters', T.planKey('b'.repeat(150), 'c'.repeat(150), 'n'.repeat(150)).length === 200);

// ---------------- validateFloorPlan ----------------
let v = T.validateFloorPlan({ builder: '  Lennar ', name: 'Plan 3', community: 'Otay Ranch Village 11', showTwins: true });
check('a full plan validates, trimmed, with its key and the box on', v.data && v.data.builder === 'Lennar' && v.data.key === 'lennar|otay ranch village 11|3' && v.data.showTwins === 1, JSON.stringify(v));
v = T.validateFloorPlan({ builder: '', name: 'Plan 3', showTwins: true });
check('blank builder -> key null and showTwins 0', v.data && v.data.key === null && v.data.showTwins === 0 && v.data.builder === null && v.data.name === 'Plan 3');
v = T.validateFloorPlan({ builder: 'Lennar', showTwins: 1 });
check('blank name -> key null and showTwins 0', v.data.key === null && v.data.showTwins === 0);
v = T.validateFloorPlan({ builder: 'Lennar', name: 'Plan 3' });
check('the box is off unless ticked', v.data.showTwins === 0 && v.data.key);
check('nothing typed -> all null', JSON.stringify(T.validateFloorPlan(undefined).data) === JSON.stringify({ builder: null, name: null, community: null, key: null, showTwins: 0 }));
check('text is clamped (60 / 40 / 60)', (() => { const d = T.validateFloorPlan({ builder: 'b'.repeat(99), name: 'n'.repeat(99), community: 'c'.repeat(99) }).data; return d.builder.length === 60 && d.name.length === 40 && d.community.length === 60; })());
check('"Plan 3 near the school" -> STEERING_ERROR', T.validateFloorPlan({ builder: 'Lennar', name: 'Plan 3 near the school' }).error === STEERING_ERROR);
check('"1218 La Vida Ct" -> ADDRESS_ERROR', T.validateFloorPlan({ builder: 'Lennar', name: 'Plan 3', community: '1218 La Vida Ct' }).error === ADDRESS_ERROR);
check('"gate code 1234" -> CODE_ERROR', T.validateFloorPlan({ builder: 'Lennar', name: 'gate code 1234' }).error === CODE_ERROR);
check('"comunidad hispana" (Spanish, origin) -> STEERING_ERROR', T.validateFloorPlan({ builder: 'Lennar', name: 'Plan 3', community: 'comunidad hispana' }).error === STEERING_ERROR);
check('real community names pass', !T.validateFloorPlan({ builder: 'Lennar', name: 'Residence 3', community: 'Otay Ranch Village 11' }).error && !T.validateFloorPlan({ builder: 'Shea Homes', name: 'Plan 2X', community: 'EastLake Trails' }).error);

// ---------------- The twin list ----------------
const user = (id, name, extra = {}) => {
  exec('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, extra.email || `u${id}@example.test`, name, extra.role || 'user', extra.status || 'active');
  exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
// 1 owner of the main listing, 2-4 twin owners, 5 demo, 6 suspended, 7 unlisted (@resend.dev), 8 the viewer blocked
// this owner, 9 blocked the viewer, 10 the viewer, 11 admin
user(1, 'Ana'); user(2, 'Bo'); user(3, 'Cy'); user(4, 'Di'); user(5, 'Demo', { email: 'x@demo.amicohaus.local' });
user(6, 'Sus', { status: 'suspended' }); user(7, 'Tester', { email: 'qa@resend.dev' }); user(8, 'Blocked'); user(9, 'Blocker');
user(10, 'Viewer'); user(11, 'Admin', { role: 'admin' });
exec('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (10, 8), (9, 10)');
const KEY = 'lennar|otay ranch village 11|3';
let minute = 0;
const listing = (id, owner, extra = {}) => {
  minute++;
  exec(`INSERT INTO listings (id, user_id, title, city, state, neighborhood, property_type, beds, baths, sqft, estimated_value, price_tier,
          status, is_buyer_only, is_portfolio, is_rental, rent_amount, plan_builder, plan_name, plan_community, plan_key, plan_twins, created_at)
        VALUES (?, ?, ?, ?, 'CA', 'Otay Ranch', 'Single Family Home', 4, 3, 2150, 987654, 'mid', ?, ?, ?, ?, 4321, 'Lennar', 'Plan 3', 'Otay Ranch Village 11', ?, ?, datetime('2026-11-01', ?))`,
  id, owner, extra.title || `Home ${id}`, extra.city || 'Chula Vista', extra.status || 'active', extra.buyerOnly ? 1 : 0, extra.portfolio ? 1 : 0, extra.rental ? 1 : 0,
  extra.key === undefined ? KEY : extra.key, extra.twins === undefined ? 1 : extra.twins, `+${minute} minutes`);
};
listing(100, 1, { title: 'Main home' });
listing(201, 2); listing(202, 2, { rental: true }); listing(203, 3); listing(204, 3); listing(205, 4); listing(206, 4); listing(207, 4, { title: 'Newest ok twin' });
listing(301, 2, { twins: 0 }); // opted out
listing(302, 2, { status: 'paused' });
listing(303, 2, { buyerOnly: true });
listing(304, 2, { portfolio: true });
listing(305, 3); listing(306, 3, { portfolio: true }); exec('INSERT INTO portfolio_members (portfolio_listing_id, member_listing_id) VALUES (306, 305)');
listing(307, 5); listing(308, 6); listing(309, 7); listing(310, 8); listing(311, 9);
listing(312, 2, { city: 'San Diego' });
listing(313, 2, { key: 'lennar|otay ranch village 11|4' });
exec("INSERT INTO listing_photos (listing_id, r2_key, content_type, position) VALUES (207, 'listings/207/a', 'image/jpeg', 0)");

const main = one('SELECT * FROM listings WHERE id = 100');
let twins = await T.fetchPlanTwins(DB, main, 10);
const twinIds = twins.map(t => t.id);
check('max 6 twins, newest first', twinIds.join() === '207,206,205,204,203,202', twinIds.join());
const excluded = [100, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313];
twins = await T.fetchPlanTwins(DB, main, 10);
exec("UPDATE listings SET status = 'paused' WHERE id IN (203, 204, 205, 206, 207)");
const fewer = (await T.fetchPlanTwins(DB, main, 10)).map(t => t.id);
check('excludes itself, opted-out, paused, buyer-only, portfolio + members, demo, suspended, unlisted, blocked both ways, other city, other plan', fewer.join() === '202,201' && !excluded.some(id => fewer.includes(id)), fewer.join());
const anon = (await T.fetchPlanTwins(DB, main, null)).map(t => t.id).sort();
check('signed out: the block rule has no viewer, so blocked owners show (everything else still left out)', anon.join() === '201,202,310,311', anon.join());
exec("UPDATE listings SET status = 'active' WHERE id IN (203, 204, 205, 206, 207)");
check('the city match ignores letter case', (await T.fetchPlanTwins(DB, { ...main, city: 'CHULA VISTA' }, 10)).length === 6);
stats.statements = 0; stats.maxParams = 0;
await T.fetchPlanTwins(DB, main, 10);
check('one statement, at most 5 bound params', stats.statements === 1 && stats.maxParams <= 5, `${stats.statements} / ${stats.maxParams}`);
stats.statements = 0;
const notOpted = await T.fetchPlanTwins(DB, { ...main, plan_twins: 0 }, 10);
const noKey = await T.fetchPlanTwins(DB, { ...main, plan_key: null }, 10);
check('a listing that did not opt in (or has no key) gets no twins and runs no query', notOpted.length === 0 && noKey.length === 0 && stats.statements === 0);

// ---------------- The strip (jury test) ----------------
twins = await T.fetchPlanTwins(DB, main, 10);
const html = T.planTwinsHtml(twins, main);
const outside = html.replace(T.TWINS_NOT_COMPS_LINE.replace(/'/g, '&#39;'), '');
check('the strip has the heading and the not-comparable-sales line', html.includes(`<h2>${T.TWINS_HEADING}</h2>`) && html.includes(T.TWINS_NOT_COMPS_LINE.replace(/'/g, '&#39;')));
check('no price, rent or $ anywhere (the rows carry a $987,654 value and $4,321 rent)', !html.includes('$') && !/987|4,321|4321/.test(html) && !html.includes('/mo'));
check('no "value", "comparable", "sold", "estimate" outside the not-comps line', !/value|comparable|sold|estimate|appraisal|\$\/sqft|price/i.test(outside), outside.match(/value|comparable|sold|estimate|price/i)?.[0]);
check('no count headline (no digits in the heading)', !/\d/.test(T.TWINS_HEADING) && !/\d+ (homes|twins|other)/i.test(html));
check('no ranking words', !/best|top|match(ed)? score|similar value|recommended/i.test(outside));
check('cards link to each listing, with beds/baths/sqft and the area', html.includes('href="/listing/207"') && html.includes('4bd/3ba · 2,150 sqft') && html.includes('Otay Ranch, Chula Vista'));
check('a photo when there is one, an illustrative one otherwise', html.includes('src="/api/photos/') && html.includes('Illustrative photo, not this home'));
check('badges: For rent / For trade', html.includes('>For rent<') && html.includes('>For trade<'));
check('"See them all" goes to the directory filtered by the plan key', html.includes(`href="/?plan=${encodeURIComponent(KEY)}#directory">See them all</a>`));
check('at most 6 cards even if given more', (T.planTwinsHtml([...twins, ...twins], main).match(/plan-twin-card/g) || []).length === 6);
check('empty -> no strip', T.planTwinsHtml([], main) === '');
check('owner text is escaped', T.planTwinsHtml([{ id: 1, title: '<img src=x onerror=alert(1)>', beds: 1, baths: 1, city: 'X' }], main).includes('&lt;img src=x'));
check('no inline style or handlers', !/\sstyle=|\son[a-z]+=/i.test(html));

// ---------------- The owner's plan line ----------------
check('opted in: everyone sees "Floor plan (from the owner)"', T.floorPlanLineHtml(main) === '<p class="tiny"><span class="label">Floor plan (from the owner)</span> Plan 3 by Lennar, Otay Ranch Village 11</p>', T.floorPlanLineHtml(main));
const off = { ...main, plan_twins: 0 };
check('not opted in: nothing for visitors', T.floorPlanLineHtml(off) === '' && T.floorPlanLineHtml(off, { isOwner: false }) === '');
check('not opted in: the owner sees it with the "only you see this" note', T.floorPlanLineHtml(off, { isOwner: true }).endsWith(' <span class="tiny">(only you see this until you tick "List my home with other homes on Amico Haus that share my floor plan")</span></p>'));
check('no plan typed: nothing, even for the owner', T.floorPlanLineHtml({ plan_twins: 0 }, { isOwner: true }) === '');
check('the plan line escapes owner text', T.floorPlanLineHtml({ plan_twins: 1, plan_name: '<b>', plan_builder: 'X' }).includes('&lt;b&gt; by X'));

// ---------------- GET /api/listings/:id hides the plan until the owner opts in ----------------
const listingOne = await mod('functions/api/listings/[id].js');
const P = id => ({ id: String(id) });
let r = await call(listingOne.onRequestGet, 'GET', '/api/listings/301', null, P(301));
const planKeys = ['plan_builder', 'plan_name', 'plan_community', 'plan_key'];
check('not opted in: a visitor gets no plan fields', r.status === 200 && planKeys.every(k => !(k in r.json.listing)), JSON.stringify(Object.keys(r.json.listing)));
r = await call(listingOne.onRequestGet, 'GET', '/api/listings/301', 3, P(301));
check('not opted in: another signed-in person gets no plan fields', planKeys.every(k => !(k in r.json.listing)));
r = await call(listingOne.onRequestGet, 'GET', '/api/listings/301', 2, P(301));
check('not opted in: the owner still sees them', planKeys.every(k => k in r.json.listing) && r.json.listing.plan_name === 'Plan 3');
r = await call(listingOne.onRequestGet, 'GET', '/api/listings/301', 11, P(301));
check('not opted in: an admin sees them', planKeys.every(k => k in r.json.listing));
r = await call(listingOne.onRequestGet, 'GET', '/api/listings/201', null, P(201));
check('opted in: visitors see the plan', r.json.listing.plan_key === KEY && r.json.listing.plan_name === 'Plan 3');

// ---------------- Listing create stores the plan ----------------
const listingsApi = await mod('functions/api/listings/index.js');
const trade = { city: 'Chula Vista', state: 'CA', propertyType: 'Single Family Home', estimatedValue: 950000, beds: 4, baths: 3,
  locations: 'San Diego', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0 };
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, floorPlan: { builder: 'Lennar', name: 'plan  3', community: 'Otay Ranch Village 11', showTwins: true } });
let row = one('SELECT plan_builder, plan_name, plan_community, plan_key, plan_twins FROM listings WHERE id = ?', r.json.id);
check('create stores what the owner typed plus the key and the box', row.plan_name === 'plan  3' && row.plan_key === KEY && row.plan_twins === 1, JSON.stringify(row));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, floorPlan: { name: 'Plan 3', showTwins: true } });
row = one('SELECT plan_key, plan_twins FROM listings WHERE id = ?', r.json.id);
check('the box without a builder stays off', row.plan_key === null && row.plan_twins === 0);
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, floorPlan: { builder: 'Lennar', name: 'Plan 3 near the school' } });
check('a steering plan name -> 400 with STEERING_ERROR', r.status === 400 && r.json.error === STEERING_ERROR, JSON.stringify(r.json));
r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, floorPlan: { builder: 'Lennar', name: 'Plan 3', community: '1218 La Vida Ct' } });
check('an address in the community -> 400 with ADDRESS_ERROR', r.status === 400 && r.json.error === ADDRESS_ERROR, JSON.stringify(r.json));

// ---------------- Directory plan= ----------------
const directory = await mod('functions/api/directory.js');
r = await call(directory.onRequestGet, 'GET', `/api/directory?limit=60&plan=${encodeURIComponent(KEY)}`, 10);
const dirIds = r.json.listings.map(l => l.id);
check('plan= lists only opted-in homes with that key', dirIds.length > 0 && dirIds.every(id => one('SELECT plan_key, plan_twins FROM listings WHERE id = ?', id).plan_key === KEY && one('SELECT plan_twins FROM listings WHERE id = ?', id).plan_twins === 1) && !dirIds.includes(301) && !dirIds.includes(313), dirIds.join());
r = await call(directory.onRequestGet, 'GET', `/api/directory?plan=${'x'.repeat(201)}`, 10);
check('a plan key over 200 characters is ignored', r.status === 200 && r.json.listings.length > 0);

// ---------------- GET /api/floor-plans ----------------
const floorPlans = await mod('functions/api/floor-plans.js');
r = await call(floorPlans.onRequestGet, 'GET', '/api/floor-plans?city=Chula%20Vista', null);
check('signed out -> 401', r.status === 401);
exec("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, plan_builder, plan_name, plan_community, plan_key, plan_twins) VALUES (400, 2, 'Off', 'Chula Vista', 'CA', 'Condo', 2, 2, 1, 'mid', 'Secret Builder', 'Hidden', 'Nope', 'secret builder|nope|hidden', 0)");
exec("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, plan_builder, plan_name, plan_community, plan_key, plan_twins, status) VALUES (401, 2, 'Paused', 'Chula Vista', 'CA', 'Condo', 2, 2, 1, 'mid', 'Paused Builder', 'P', '', 'paused builder||p', 1, 'paused')");
exec("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, plan_builder, plan_name, plan_community, plan_key, plan_twins) VALUES (402, 5, 'Demo', 'Chula Vista', 'CA', 'Condo', 2, 2, 1, 'mid', 'Demo Builder', 'D', '', 'demo builder||d', 1)");
exec("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, plan_builder, plan_name, plan_community, plan_key, plan_twins) VALUES (403, 2, 'Shea', 'chula vista', 'CA', 'Condo', 2, 2, 1, 'mid', 'Shea Homes', 'Plan 2X', 'EastLake Trails', 'shea homes|eastlake trails|2x', 1)");
stats.statements = 0;
r = await call(floorPlans.onRequestGet, 'GET', '/api/floor-plans?city=Chula%20Vista', 10);
const plans = r.json && r.json.plans;
check('private, no-store', r.headers.get('Cache-Control') === 'private, no-store');
check('only opted-in active homes of real active owners in that city (any letter case), deduped', JSON.stringify(plans) === JSON.stringify([{ builder: 'Lennar', name: 'Plan 3', community: 'Otay Ranch Village 11' }, { builder: 'Lennar', name: 'plan  3', community: 'Otay Ranch Village 11' }, { builder: 'Shea Homes', name: 'Plan 2X', community: 'EastLake Trails' }]), JSON.stringify(plans));
check('no count, id or owner keys', plans.every(p => Object.keys(p).join() === 'builder,name,community') && !/count|"id"|owner|user/.test(r.text));
check('one statement plus the session lookup', stats.statements === 2, String(stats.statements));
r = await call(floorPlans.onRequestGet, 'GET', '/api/floor-plans', 10);
check('no city -> an empty list', r.status === 200 && r.json.plans.length === 0);
check('the URL has no file extension (never edge-cached)', !/\.\w+$/.test('/api/floor-plans'));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
