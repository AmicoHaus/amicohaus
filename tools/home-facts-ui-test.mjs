// Home facts batch, role F: the PUT /api/home-facts route, the "Has" block on the listing, AugmentedHomes and GreenHomes
// pages (yard and sun, parking and garage, pets with the assistance-animal note), "Plan your drive", the open-house
// render (Pacific time, the owner's address-sharing labels, the RSVP name line), the client mirrors in client.js and
// main.js, and the CSP/label rules on everything F added. Runs the real handlers on an in-memory SQLite stand-in for D1
// (schema.sql) with a statement counter; client code runs in a vm sandbox. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/home-facts-ui-test.mjs "<project root>"
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) { console.error('Usage: node --disable-warning=ExperimentalWarning tools/home-facts-ui-test.mjs <projectRoot>'); process.exit(2); }
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mod = p => import(pathToFileURL(path.join(root, p)).href);

let passed = 0, failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${String(detail).slice(0, 400)}`}`); };
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran without crashing`, false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); } };

// ---- D1 stand-in with a statement counter (the abuse-test shim) ----
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(read('schema.sql'));
let statements = 0;
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { statements++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { statements++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { statements++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*(SELECT|WITH)/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : (() => { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; })()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) { statements++; out.push(await st.batchResult()); } return out; },
};
const env = { DB, PHOTOS: { put: async () => {}, get: async () => null, delete: async () => {} } };
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const call = async (handler, method, urlPath, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${urlPath}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const pending = [];
  statements = 0;
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  const counted = statements;
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  let json = null;
  if (type.includes('json')) { try { json = JSON.parse(text); } catch { json = null; } }
  return { status: res.status, headers: res.headers, text, json, statements: counted };
};
console.log = () => {};
console.warn = () => {};

// ---- People and homes ----
// 1 owner, 2 visitor (RSVP'd), 3 admin, 4 another member.
for (const [id, name, role] of [[1, 'Olive Owner', 'user'], [2, 'Vic Visitor', 'user'], [3, 'Ada Admin', 'admin'], [4, 'Max Member', 'user']]) {
  run('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)', id, `u${id}@example.test`, name, role);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
}
const ADDRESS = '1218 La Vida Ct';
const FULL_FACTS = {
  yard: { faces: 'sw', frontFaces: 'ne', outdoor: ['backyard', 'patio'], size: 'medium', fenced: 'yes', afternoonSun: 'part_shade', shade: ['pergola'], solar: 'owned', notes: 'Lemon tree & raised beds' },
  toy: { rv: 'yes', rvSpot: 'side_yard', sideAccess: 'yes', gateIn: 120, drivewayFt: 40, garage: 2, tandem: 'yes', workshop: 'no', ev240: 'yes' },
  pets: { notes: 'One dog under 40 lb' },
};
const HOA_LIMITED = { includes: ['pool'], rentals: 'allowed', pets: 'limited', parking: 'allowed', specialAssessment: '' };
const L = (id, extra = {}) => {
  run(`INSERT INTO listings (id, user_id, title, address, neighborhood, city, state, property_type, beds, baths, estimated_value, price_tier, is_rental, rent_amount,
         min_lease_months, is_portfolio, is_buyer_only, hoa_monthly, hoa_details_json, home_facts_json, plan_builder, plan_name, plan_community, plan_key, plan_twins)
       VALUES (?, 1, ?, ?, 'EastLake', 'Chula Vista', 'CA', 'Single Family Home', 3, 2, 800000, '600k-1m', ?, ?, 12, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, extra.title || `Home ${id}`, ADDRESS, extra.rental ? 1 : 0, extra.rental ? 4500 : 0, extra.portfolio ? 1 : 0, extra.buyerOnly ? 1 : 0,
    extra.hoa ?? null, JSON.stringify(extra.hoaDetails || {}), JSON.stringify(extra.facts || {}),
    extra.plan ? 'Lennar' : null, extra.plan ? 'Plan 3' : null, extra.plan ? 'Otay Ranch Village 11' : null, extra.plan ? 'lennar|otay ranch village 11|3' : null, extra.twins ? 1 : 0);
  if (!extra.rental) run(`INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (?, 'Chula Vista', 'Any', 0, 0, 0, 1000000)`, id);
};
L(101, { facts: FULL_FACTS, hoa: 250, hoaDetails: HOA_LIMITED });                                      // trade, every fact
L(102, { rental: true, facts: { pets: { rental: 'none', notes: 'Small dogs only' } }, hoa: 0 });          // rental
L(103, { facts: { pets: { rental: 'considered' }, yard: { size: 'small' } } });                          // stale rental value
L(104, { hoa: 300, hoaDetails: { includes: [], rentals: '', pets: 'limited', parking: '', specialAssessment: '' } }); // HOA pets only
L(105, { portfolio: true, facts: FULL_FACTS });
L(106, { buyerOnly: true, facts: FULL_FACTS });
L(107, { plan: true, twins: true });
L(108, { plan: true, twins: false });
L(109, { facts: { toy: { garage: 0 } } });
run(`INSERT INTO augmented_homes (id, user_id, title, address, neighborhood, city, state, zip, property_type, beds, baths, asking_price, adaptations_json, home_facts_json, hoa_monthly, hoa_details_json)
     VALUES (201, 1, 'Ramp home', ?, 'EastLake', 'Chula Vista', 'CA', '91915', 'Single Family Home', 3, 2, 650000, '["ramp"]', ?, 200, ?)`, ADDRESS, JSON.stringify(FULL_FACTS), JSON.stringify(HOA_LIMITED));
run(`INSERT INTO green_homes (id, user_id, title, address, neighborhood, city, state, zip, property_type, beds, baths, asking_price, home_facts_json)
     VALUES (301, 1, 'Solar home', ?, 'Bonita', 'Bonita', 'CA', '91902', 'Single Family Home', 3, 2, 680000, ?)`, ADDRESS, JSON.stringify({ yard: { solar: 'leased' } }));
run(`INSERT INTO pre_listings (id, user_id, title, address, neighborhood, city, state, zip, property_type, beds, baths, asking_price)
     VALUES (401, 1, 'Pre home', ?, 'EastLake', 'Chula Vista', 'CA', '91915', 'Condo', 2, 2, 600000)`, ADDRESS);

// Open houses on 101: one starting in 2 hours that the owner shares (visitor 2 RSVP'd after the notice: rsvp_named = 1), and one
// next November at 21:00Z (1:00 PM Pacific, standard time).
const iso = ms => new Date(ms).toISOString();
const NOV_YEAR = new Date().getUTCFullYear() + 1;
const NOV_START = `${NOV_YEAR}-11-20T21:00:00.000Z`, NOV_END = `${NOV_YEAR}-11-21T00:00:00.000Z`;
run('INSERT INTO open_houses (id, listing_id, starts_at, ends_at, note, share_address_with_rsvps) VALUES (501, 101, ?, ?, ?, 1)', iso(Date.now() + 2 * 3600e3), iso(Date.now() + 5 * 3600e3), 'Come by');
run('INSERT INTO open_houses (id, listing_id, starts_at, ends_at, note, share_address_with_rsvps) VALUES (502, 101, ?, ?, ?, 0)', NOV_START, NOV_END, '');
run("INSERT INTO open_house_rsvps (open_house_id, user_id, rsvp_named, created_at) VALUES (501, 2, 1, '2026-11-13 00:00:00')");

const homeFacts = await mod('functions/_lib/homeFacts.js');
const homeCosts = await mod('functions/_lib/homeCosts.js');
const homeText = await mod('functions/_lib/homeText.js');
const { escapeHtml } = await mod('functions/_lib/util.js');
const { pacificWhenLabel } = await mod('functions/_lib/pacificTime.js');
const { ASSISTANCE_ANIMAL_LINE: SHORT, ASSISTANCE_ANIMAL_LINE_LONG: LONG } = homeFacts;
const FAIR_HOUSING_OUT = /school|church|safe (area|neighborhood)|famil|kids|children|ideal for|perfect for|verified|checked|score|rating/i;
// The server pages' HTML shape (spec 4.3), from the server's own lines.
const serverFactsHtml = (facts, costs, { isRental = false, longNote = isRental } = {}) => {
  const g = homeFacts.homeFactsLines(facts, costs, { isRental, longNote });
  const p = (h, lines, extra) => lines.length ? `<p class="tiny home-facts"><span class="label">${escapeHtml(h)}</span> ${escapeHtml(lines.join(' · '))}</p>${extra ? `<p class="tiny">${escapeHtml(extra)}</p>` : ''}` : '';
  const pets = g.pets.length ? `<p class="tiny home-facts"><span class="label">${escapeHtml(homeFacts.PETS_HEADING)}</span> ${escapeHtml(g.pets.slice(0, -1).join(' · '))}</p><p class="tiny assist-note">${escapeHtml(g.pets.at(-1))}</p>` : '';
  return p(homeFacts.YARD_HEADING, g.yard, homeFacts.YARD_SEASON_LINE) + p(homeFacts.TOY_HEADING, g.toy, homeFacts.TOY_CONFIRM_LINE) + pets;
};
const factsBlocks = html => (html.match(/<p class="tiny (home-facts|assist-note)">[\s\S]*?<\/p>/g) || []).join('\n');
const jsonLdOf = html => (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || '';

// ===================== 1. PUT /api/home-facts/:kind/:id =====================
await section('route', async () => {
  const api = await mod('functions/api/home-facts/[kind]/[id].js');
  const put = (who, kind, id, body) => call(api.onRequestPut, 'PUT', `/api/home-facts/${kind}/${id}`, who, { kind, id: String(id) }, body);
  let r = await put(null, 'pre_listing', 401, { yard: { size: 'large' } });
  check('route: signed out -> 401', r.status === 401, r.status);
  r = await put(4, 'pre_listing', 401, { yard: { size: 'large' } });
  check('route: another member -> 403', r.status === 403, r.status);
  r = await put(1, 'users', 1, { yard: { size: 'large' } });
  const sessionOnly = r.statements;
  check('route: unknown kind -> 404 "Unknown kind of home."', r.status === 404 && r.json && r.json.error === 'Unknown kind of home.', r.text);
  r = await put(1, 'listing', 999, {});
  check('route: missing home -> 404 "Home not found."', r.status === 404 && r.json.error === 'Home not found.', r.text);
  for (const id of [105, 106]) {
    r = await put(1, 'listing', id, { yard: { size: 'large' } });
    check(`route: ${id === 105 ? 'portfolio' : 'buyer-only'} listing -> 400 facts_not_for_this_listing`, r.status === 400 && r.json.code === 'facts_not_for_this_listing' && r.json.error === 'Home facts are for a single home you own.', r.text);
  }
  const refused = [
    [{ yard: { notes: 'Great yard for the kids' } }, homeText.STEERING_ERROR, 'steering (kids)'],
    [{ yard: { notes: 'Zona segura' } }, homeText.STEERING_ERROR, 'steering (Spanish)'],
    [{ yard: { notes: ADDRESS } }, homeText.ADDRESS_ERROR, 'street address'],
    [{ toy: {}, yard: { notes: 'side gate code 1234' } }, homeText.CODE_ERROR, 'gate code'],
    [{ pets: { notes: 'No ESAs' } }, homeFacts.PET_ASSIST_ERROR, 'assistance animals (ESA)'],
    [{ pets: { notes: 'no emotional support animals' } }, homeFacts.PET_ASSIST_ERROR, 'assistance animals (support)'],
    [{ pets: { notes: '$500 pet deposit' } }, homeFacts.PET_FEE_ERROR, 'pet deposit'],
    [{ pets: { notes: 'pet rent 50' } }, homeFacts.PET_FEE_ERROR, 'pet rent'],
    [{ toy: { gateIn: 10 } }, 'Gate opening should be whole inches from 24 to 480.', 'gate out of range'],
    [{ plan: { name: 'Plan 3 near the school' } }, homeText.STEERING_ERROR, 'plan text steering'],
  ];
  for (const [body, error, what] of refused) {
    r = await put(1, 'pre_listing', 401, body);
    check(`route: refuses ${what} with the exact error`, r.status === 400 && r.json && r.json.error === error, r.text);
  }
  const before = sqlite.prepare('SELECT home_facts_json FROM pre_listings WHERE id = 401').get().home_facts_json;
  check('route: a refused save stores nothing', before === '{}', before);
  r = await put(1, 'pre_listing', 401, { yard: { faces: 's', size: '' }, toy: { garage: '2' }, plan: { builder: 'Lennar', name: 'Plan 3', community: 'Otay Ranch Village 11' }, pets: { rental: 'none' }, junk: { x: 1 } });
  const stored = JSON.parse(sqlite.prepare('SELECT home_facts_json FROM pre_listings WHERE id = 401').get().home_facts_json);
  check('route: pre-listing saved (plan kept, numbers as integers, "Not sure" and rental pets and junk dropped)', r.status === 200 && r.json.ok === true
    && JSON.stringify(stored) === JSON.stringify({ yard: { faces: 's' }, toy: { garage: 2 }, plan: { builder: 'Lennar', name: 'Plan 3', community: 'Otay Ranch Village 11' } }), JSON.stringify(stored));
  check('route: 2 statements + the session lookup', r.statements === sessionOnly + 2, `${r.statements} vs session ${sessionOnly}`);
  check('route: private, no-store', /private/.test(r.headers.get('Cache-Control') || '') && /no-store/.test(r.headers.get('Cache-Control') || ''));
  r = await put(1, 'listing', 102, { pets: { rental: 'some', notes: 'Cats welcome' } });
  check('route: a rental listing keeps the renters pet policy', r.status === 200 && r.json.facts.pets.rental === 'some', r.text);
  r = await put(1, 'listing', 103, { pets: { rental: 'some' } });
  check('route: a non-rental listing drops it', r.status === 200 && !r.json.facts.pets, r.text);
  run("UPDATE listings SET home_facts_json = ? WHERE id = 102", JSON.stringify({ pets: { rental: 'none', notes: 'Small dogs only' } }));
  run("UPDATE listings SET home_facts_json = ? WHERE id = 103", JSON.stringify({ pets: { rental: 'considered' }, yard: { size: 'small' } }));
  r = await put(1, 'augmented_home', 201, { plan: { name: 'Plan 3' }, yard: { solar: 'none' } });
  check('route: plan is dropped on an AugmentedHomes home', r.status === 200 && !r.json.facts.plan && r.json.facts.yard.solar === 'none', r.text);
  run('UPDATE augmented_homes SET home_facts_json = ? WHERE id = 201', JSON.stringify(FULL_FACTS));
});

// ===================== 2. API reads carry facts =====================
await section('api reads', async () => {
  const pre = await mod('functions/api/pre-listings/[id].js');
  let r = await call(pre.onRequestGet, 'GET', '/api/pre-listings/401', 1, { id: '401' });
  check('GET pre-listing: facts with the floor plan', r.status === 200 && r.json.preListing.facts && r.json.preListing.facts.plan.name === 'Plan 3', r.text.slice(0, 300));
  const aug = await mod('functions/api/augmented-homes/[id].js');
  r = await call(aug.onRequestGet, 'GET', '/api/augmented-homes/201', 2, { id: '201' });
  check('GET AugmentedHomes home: facts', r.status === 200 && r.json.home.facts.toy.gateIn === 120, r.text.slice(0, 300));
  const green = await mod('functions/api/green-homes/[id].js');
  r = await call(green.onRequestGet, 'GET', '/api/green-homes/301', 2, { id: '301' });
  check('GET GreenHomes home: facts', r.status === 200 && r.json.home.facts.yard.solar === 'leased', r.text.slice(0, 300));
});

// ===================== 3. Server pages =====================
const pages = {};
await section('pages', async () => {
  const listingPage = await mod('functions/listing/[id].js');
  const augPage = await mod('functions/augmented-home/[id].js');
  const greenPage = await mod('functions/green-home/[id].js');
  const listing = (id, who) => call(listingPage.onRequestGet, 'GET', `/listing/${id}`, who, { id: String(id) });
  for (const id of [101, 102, 103, 104, 105, 106, 109]) pages[id] = await listing(id, null);
  pages.aug = await call(augPage.onRequestGet, 'GET', '/augmented-home/201', null, { id: '201' });
  pages.green = await call(greenPage.onRequestGet, 'GET', '/green-home/301', null, { id: '301' });
  const t = pages[101].text;
  check('listing: the three headings, word for word', t.includes('<span class="label">Yard and sun (from the owner)</span>') && t.includes('<span class="label">Parking and garage (from the owner)</span>') && t.includes('<span class="label">Pets (from the owner)</span>'));
  check('listing: season line and confirm line', t.includes(escapeHtml(homeFacts.YARD_SEASON_LINE)) && t.includes(escapeHtml(homeFacts.TOY_CONFIRM_LINE)));
  const costs101 = homeCosts.homeCostsFromRow(sqlite.prepare('SELECT * FROM listings WHERE id = 101').get());
  check('listing: the facts HTML is the server shape (HOA parking in the toy block, HOA pets in the pets block)', t.includes(serverFactsHtml(FULL_FACTS, costs101)), factsBlocks(t));
  check('listing: "(owner measured)" on the gate and driveway', t.includes('Gate opening about 120 in. (owner measured)') && t.includes('Driveway about 40 ft long (owner measured)'));
  const costsLine = (t.match(/<span class="label">Costs \(from the owner\)<\/span>[^<]*/) || [''])[0];
  check('listing: the costs line has no "Pets:"', costsLine.includes('HOA $250/mo') && !/Pets:/.test(costsLine), costsLine);
  // The assistance-animal note right after every pet line (a rental gets the long one, with the cites).
  for (const [key, note] of [[101, SHORT], [102, LONG], [104, SHORT], ['aug', SHORT]]) {
    const html = pages[key].text;
    const m = html.match(/<p class="tiny home-facts"><span class="label">Pets \(from the owner\)<\/span>[^<]*<\/p>(<p class="tiny assist-note">[^<]*<\/p>)/);
    check(`page ${key}: the pets block is followed by the ${note === LONG ? 'long' : 'short'} assistance-animal note`, !!m && m[1] === `<p class="tiny assist-note">${escapeHtml(note)}</p>`, m ? m[1] : factsBlocks(html));
  }
  check('rental: the pets block sits in the Rent block, after the minimum lease', /<span class="label">Rent<\/span>[\s\S]*?12-month minimum lease\s*<p class="tiny home-facts"><span class="label">Pets \(from the owner\)<\/span> Renters: no pets · Owner&#39;s pet notes: Small dogs only<\/p>/.test(pages[102].text), factsBlocks(pages[102].text));
  check('HOA "limited" alone still renders the pets block and the note', pages[104].text.includes(`<span class="label">Pets (from the owner)</span> HOA pets: limited (see HOA rules)</p><p class="tiny assist-note">${escapeHtml(SHORT)}</p>`), factsBlocks(pages[104].text));
  check('a stored renters policy on a non-rental shows no "Renters:"', !pages[103].text.includes('Renters:') && pages[103].text.includes('Yard size: small') && !pages[103].text.includes('assist-note'), factsBlocks(pages[103].text));
  check('garage 0 reads "Garage: none"', pages[109].text.includes('Garage: none'));
  check('portfolio and buyer-only pages: no facts', ![105, 106].some(id => /home-facts|assist-note/.test(pages[id].text)));
  check('AugmentedHomes page: the same facts HTML', pages.aug.text.includes(serverFactsHtml(FULL_FACTS, homeCosts.homeCostsFromRow(sqlite.prepare('SELECT * FROM augmented_homes WHERE id = 201').get()))), factsBlocks(pages.aug.text));
  check('GreenHomes page: solar line', pages.green.text.includes('Solar panels: leased'));
  const allFacts = Object.values(pages).map(p => factsBlocks(p.text)).join('\n');
  check('fair housing: no rendered facts mention schools, safety, family, kids, "ideal/perfect for", verified, checked, score or rating', !FAIR_HOUSING_OUT.test(allFacts), (allFacts.match(FAIR_HOUSING_OUT) || [])[0]);
  check('jury: no line says verified, certified, guaranteed, best, ideal or perfect', !/verified|certif|guarantee|\bbest\b|ideal|perfect/i.test(allFacts));
  for (const key of [101, 102, 'aug', 'green']) {
    const ld = jsonLdOf(pages[key].text);
    check(`JSON-LD on page ${key}: no facts (Backyard, RV, Pets, Floor plan)`, !!ld && !/Backyard|RV|Pets|Floor plan/.test(ld), ld.slice(0, 200));
  }

  // Commute: the area only, never the street address, for anyone.
  const driveHref = html => { const m = html.match(/<p class="tiny drive-link"><a href="([^"]+)" target="_blank" rel="noopener noreferrer" data-drive-area="([^"]+)">Plan your drive ↗<\/a> ([^<]+)<\/p>/); return m ? { href: m[1].replace(/&amp;/g, '&'), area: m[2], caption: m[3] } : null; };
  const owner101 = await listing(101, 1), admin101 = await listing(101, 3);
  pages.owner101 = owner101; pages.admin101 = admin101;
  for (const [what, html, nbhd, city] of [['listing (signed out)', t, 'EastLake', 'Chula Vista'], ['listing (owner)', owner101.text, 'EastLake', 'Chula Vista'], ['listing (admin)', admin101.text, 'EastLake', 'Chula Vista'],
    ['AugmentedHomes', pages.aug.text, 'EastLake', 'Chula Vista'], ['GreenHomes', pages.green.text, 'Bonita', 'Bonita']]) {
    const d = driveHref(html);
    check(`drive link on ${what}: area (neighborhood + city), never the address`, !!d && d.href.startsWith('https://www.google.com/maps/dir/?api=1&destination=') && d.href.includes(encodeURIComponent(nbhd)) && d.href.includes(encodeURIComponent(city))
      && !d.href.includes('1218') && !/La%20Vida|La Vida/.test(d.href) && !d.area.includes('1218') && !d.href.includes('origin='), d ? d.href : 'no drive link');
    check(`drive link on ${what}: caption word for word`, !!d && d.caption === escapeHtml(homeFacts.PLAN_DRIVE_CAPTION));
  }
  check('GreenHomes drive area: city once (neighborhood = city) + state and zip', (driveHref(pages.green.text) || {}).area === 'Bonita, CA 91902', (driveHref(pages.green.text) || {}).area);
  check('no drive link on portfolio and buyer-only pages', ![105, 106].some(id => pages[id].text.includes('data-drive-area')));
  check('no <form> on any page points off-site', !Object.values(pages).some(p => /<form[^>]+action="https?:/i.test(p.text)));

  // Open houses: Pacific time, the RSVP name line, the address-sharing labels, Cache-Control.
  const nov = escapeHtml(pacificWhenLabel(NOV_START, NOV_END));
  check('open house: 21:00Z in November shows 1:00 PM, Pacific time', t.includes(`<strong>${nov}</strong>`) && nov.includes('1:00 PM') && nov.includes('Pacific time'), nov);
  const visitor = await listing(101, 2);
  pages.visitor101 = visitor;
  const rsvpButtons = (visitor.text.match(/data-action="rsvp-open-house"/g) || []).length;
  const nameLines = (visitor.text.match(/<\/button><p class="tiny">When you RSVP, the owner sees your display name\.<\/p>/g) || []).length;
  check('RSVP: the name line under every RSVP button for a signed-in visitor', rsvpButtons === 2 && nameLines === 2, `${rsvpButtons} buttons, ${nameLines} lines`);
  check('RSVP: no name line for the owner or a signed-out visitor', !owner101.text.includes('When you RSVP, the owner sees your display name.') && !t.includes('When you RSVP, the owner sees your display name.'));
  check('signed in -> Cache-Control: private, no-store', ['private', 'no-store'].every(w => (visitor.headers.get('Cache-Control') || '').includes(w)) && ['private', 'no-store'].every(w => (owner101.headers.get('Cache-Control') || '').includes(w)));
  check('signed out -> no private Cache-Control (unchanged)', !(pages[101].headers.get('Cache-Control') || '').includes('private'));
  check('owner sharing an upcoming open house: the owner label, exactly', owner101.text.includes(`${ADDRESS} <span class="tiny">(only you see this, and people going to an open house you share it with, from 24 hours before it starts until it ends)</span>`));
  check('admin: the sharing admin label, exactly', admin101.text.includes(`${ADDRESS} <span class="tiny">(private: only the owner, admins and people going to an open house the owner shares it with see this)</span>`));
  const owner104 = await listing(104, 1), admin104 = await listing(104, 3);
  check('owner with no sharing: "(only you see this)" unchanged', owner104.text.includes(`${ADDRESS} <span class="tiny">(only you see this)</span>`));
  check('admin with no sharing: unchanged label', admin104.text.includes(`${ADDRESS} <span class="tiny">(private: only the owner and admins see this)</span>`));
  check('signed out / visitor never see the street address in the Has block', !t.includes(ADDRESS) && !(visitor.text.split('<span class="label">Has</span>')[1] || '').split('</div>')[0].includes(ADDRESS));
  const shared = visitor.text.includes(`<p class="tiny oh-address">Address for this open house (shared by the owner with people going): ${ADDRESS}</p>`);
  check('a going, named visitor inside the window sees the open-house address line (openHouses.js reveal)', shared, (visitor.text.match(/oh-address[^<]*/) || ['none'])[0]);
  check('...and only on the shared open house', (visitor.text.match(/class="tiny oh-address"/g) || []).length === (shared ? 1 : 0));
  const other = await listing(101, 4);
  check('a member who did not RSVP gets no address', !other.text.includes(ADDRESS));

  // Twins: no twin query unless the owner opted in; exactly +1 when they did.
  const off = await listing(108, 4), on = await listing(107, 4);
  check('twins: +1 statement only when plan_twins = 1', on.statements === off.statements + 1, `${off.statements} -> ${on.statements}`);
  check('floor-plan line shows when opted in, owner-only note otherwise', on.text.includes('<span class="label">Floor plan (from the owner)</span> Plan 3 by Lennar, Otay Ranch Village 11') && !off.text.includes('Floor plan (from the owner)'));

  // Flyers carry no facts: the flyer is identical with and without them.
  const flyer = await mod('functions/listing/[id]/flyer.js');
  const f1 = await call(flyer.onRequestGet, 'GET', '/listing/101/flyer', 1, { id: '101' });
  run("UPDATE listings SET home_facts_json = '{}' WHERE id = 101");
  const f2 = await call(flyer.onRequestGet, 'GET', '/listing/101/flyer', 1, { id: '101' });
  run('UPDATE listings SET home_facts_json = ? WHERE id = 101', JSON.stringify(FULL_FACTS));
  check('flyer HTML is unchanged by home facts', f1.status === 200 && f1.text === f2.text && !/Backyard faces|RV or boat|Pets \(from the owner\)/.test(f1.text), f1.status);
});

// ===================== 4. client.js mirrors (vm) =====================
const noop = () => {};
const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, insertBefore: noop, setAttribute: noop, getAttribute: () => null, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, parentNode: { insertBefore: noop } });
const makeSandbox = (lang = 'en', pathname = '/app', store = {}) => {
  const sb = {
    console: { log: noop, warn: noop, error: noop }, URLSearchParams, URL, setTimeout, clearTimeout, atob, btoa, Notification: {}, Intl, Date, JSON,
    navigator: { userAgent: 'node' },
    window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname, host: 'amicohaus.com' } },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), readyState: 'complete', documentElement: { ...el(), lang }, referrer: '' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sb.window.document = sb.document;
  vm.createContext(sb);
  return sb;
};
const clientSrc = read('client.js');
const mainSrc = read('main.js');
await section('client', async () => {
  const sb = makeSandbox();
  vm.runInContext(clientSrc, sb, { filename: 'client.js' });
  vm.runInContext('this.__c = { homeFactsDetailHtml, homeCostsDetailHtml, savedSearchLabel, contactErrorMessage, HF_LANG, hfPlanDriveHref };', sb);
  const c = sb.__c;
  const fixtures = [
    ['every fact + HOA', FULL_FACTS, homeCosts.homeCostsFromRow({ hoa_monthly: 250, hoa_details_json: JSON.stringify(HOA_LIMITED) }), false],
    ['rental pets', { pets: { rental: 'none', notes: 'Small dogs only' } }, null, true],
    ['stale rental on a sale', { pets: { rental: 'considered' }, yard: { size: 'small' } }, null, false],
    ['HOA limited only', {}, homeCosts.homeCostsFromRow({ hoa_monthly: 300, hoa_details_json: JSON.stringify({ pets: 'limited' }) }), false],
    ['garage none + RV no', { toy: { garage: 0, rv: 'no', tandem: 'yes' } }, null, false],
    ['nothing', {}, null, false],
  ];
  for (const [what, facts, costs, isRental] of fixtures) {
    const shaped = homeFacts.homeFactsFromRow({ home_facts_json: JSON.stringify(facts) });
    const client = c.homeFactsDetailHtml(shaped, costs, { isRental });
    const server = serverFactsHtml(shaped, costs, { isRental });
    check(`client homeFactsDetailHtml === server HTML: ${what}`, client === server, `\nclient: ${client}\nserver: ${server}`);
  }
  check('client: nothing entered -> empty', c.homeFactsDetailHtml(null, null) === '' && c.homeFactsDetailHtml({}, { hoaDetails: {} }) === '');
  const costsDetail = c.homeCostsDetailHtml({ melloRoosAnnual: 0, hoaMonthly: 250, hoaDetails: { pets: 'limited', rentals: 'allowed' } });
  check('client costs detail: no "Pets:" (moved to the pets block)', !/Pets:/.test(costsDetail) && costsDetail.includes('Renting out: allowed'), costsDetail);
  check('saved search label: toy-box parts in order', c.savedSearchLabel({ property_type: 'Any', locations: 'EastLake', price_min: 0, price_max: 0, toy_flags: 15, min_gate_in: 120, min_garage: 2 })
    === 'Any type in EastLake · RV/boat parking · side access · workshop · 240V/EV outlet · gate 120+ in. · 2+ garage spaces');
  check('saved search label: unchanged without toy-box', c.savedSearchLabel({ property_type: 'Condo', locations: 'EastLake', price_min: 500000, price_max: 800000 }) === 'Condo in EastLake $500,000–$800,000');
  check('client drive href matches the server (with an origin)', c.hfPlanDriveHref('EastLake, Chula Vista, CA', 'San Diego, CA') === homeFacts.planDriveHref('EastLake, Chula Vista, CA', 'San Diego, CA'));
  check('English page: English shared strings', c.HF_LANG === 'en' && c.contactErrorMessage(null) === 'Something went wrong. Please try again.');
  const es = makeSandbox('es', '/es/registro');
  vm.runInContext(clientSrc, es, { filename: 'client.js' });
  vm.runInContext('this.__c = { contactErrorMessage, HF_LANG, HF_SHARED_COPY };', es);
  check('Spanish page: shared strings in Spanish', es.__c.HF_LANG === 'es' && es.__c.contactErrorMessage(null) === 'Algo salió mal. Inténtelo de nuevo.' && es.__c.HF_SHARED_COPY.showPassword === 'Mostrar contraseña' && es.__c.HF_SHARED_COPY.hidePassword === 'Ocultar contraseña');
  for (const [pathname, want] of [['/es/registro', '/signup'], ['/es/contacto', '/contact'], ['/es/otra-pagina', '/'], ['/es/', '/'], ['/es', '/'], ['/espanol-tips', '/espanol-tips'], ['/signup', '/signup']]) {
    const store = {};
    const sbx = makeSandbox(pathname.startsWith('/es') ? 'es' : 'en', pathname, store);
    vm.runInContext(clientSrc, sbx, { filename: 'client.js' });
    const landing = JSON.parse(store.ah_source || '{}').landing;
    check(`attribution landing ${pathname} -> ${want} (language stays out of lead records)`, landing === want, landing);
  }
  check('client.js: no geolocation, no sendBeacon', !/geolocation|sendBeacon/.test(clientSrc));
  const drive = clientSrc.slice(clientSrc.indexOf("const HF_DRIVE_PLACES_KEY"), clientSrc.indexOf('// (end of hfDrivePlaces)'));
  check('drive places: the code makes no network call (no fetch, no api helpers)', drive.length > 500 && !/fetch\(|apiGet|apiPost|apiPut|XMLHttpRequest|navigator\./.test(drive), drive.length);
  check('drive places: storage key, max 2, the exact copy, DOM nodes only', drive.includes("'amico.drivePlaces.v1'") && drive.includes('HF_DRIVE_PLACES_MAX = 2') && drive.includes('Places you go often (saved only in this browser):')
    && drive.includes("'Add a place'") && drive.includes("htmlFor: 'hfDrivePlace'") && drive.includes('maxLength: 80') && drive.includes("'e.g. a work address or a city'") && drive.includes('You can keep up to 2 places.')
    && drive.includes('`From ${place} ↗`') && drive.includes('`Remove ${place}`') && !/innerHTML/.test(drive) && /try \{[^}]*localStorage\.getItem/.test(drive) && /try \{ localStorage\.setItem/.test(drive));
  for (const [k, v] of [['HF_ASSISTANCE_ANIMAL_LINE', SHORT], ['HF_ASSISTANCE_ANIMAL_LINE_LONG', LONG], ['HF_YARD_HEADING', homeFacts.YARD_HEADING], ['HF_TOY_HEADING', homeFacts.TOY_HEADING], ['HF_PETS_HEADING', homeFacts.PETS_HEADING], ['HF_YARD_SEASON_LINE', homeFacts.YARD_SEASON_LINE], ['HF_TOY_CONFIRM_LINE', homeFacts.TOY_CONFIRM_LINE]]) {
    check(`client.js ${k} === homeFacts.js`, vm.runInContext(k, sb) === v);
  }
  for (const [k, v] of [['HF_DIRECTIONS', homeFacts.DIRECTIONS], ['HF_OUTDOOR', homeFacts.OUTDOOR], ['HF_YARD_SIZES', homeFacts.YARD_SIZES], ['HF_FENCED', homeFacts.FENCED], ['HF_AFTERNOON_SUN', homeFacts.AFTERNOON_SUN], ['HF_SHADE', homeFacts.SHADE], ['HF_SOLAR', homeFacts.SOLAR], ['HF_RV_SPOTS', homeFacts.RV_SPOTS], ['HF_RENTAL_PETS', homeFacts.RENTAL_PETS]]) {
    check(`client.js ${k} labels === homeFacts.js`, JSON.stringify(vm.runInContext(k, sb)) === JSON.stringify(v));
  }
});

// ===================== 5. main.js forms, times and the Spanish note (vm) =====================
function liftFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  let i = src.indexOf('{', start); let depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
await section('main', async () => {
  const sb = makeSandbox();
  for (const [f, src] of [['client.js', clientSrc], ['main.js', mainSrc]]) vm.runInContext(src, sb, { filename: f });
  vm.runInContext('this.__m = { homeFactsFieldsHtml, readHomeFacts, floorPlanFieldsHtml, readFloorPlan, hfRentalPetsFieldHtml, homeCostsFieldsHtml, readHomeCosts, hfPacificWhenLabel, hfPlanLineHtml, homeFactsDetailHtml };', sb);
  const m = sb.__m;
  const forms = {
    preListing: m.homeFactsFieldsHtml('plf', null, { kind: 'pre_listing' }),
    listing: m.homeFactsFieldsHtml('lf', FULL_FACTS, { kind: 'listing' }),
    plan: m.floorPlanFieldsHtml('lf', { plan_builder: 'Lennar', plan_name: 'Plan 3', plan_community: 'Otay', plan_twins: 1 }),
    rentalPets: m.hfRentalPetsFieldHtml('lf', { pets: { rental: 'some' } }),
    costs: m.homeCostsFieldsHtml('lc', null),
  };
  // The costs form is older markup (its HOA checkboxes wrap their inputs); the facts, plan and pet fields are new.
  const all = [forms.preListing, forms.listing, forms.plan, forms.rentalPets].join('\n');
  const labels = all.match(/<label\b[^>]*>/g) || [];
  check('forms: every <label> has for=, and it points at a field in the form', labels.length > 30 && labels.every(l => /\bfor="([^"]+)"/.test(l) && all.includes(`id="${l.match(/\bfor="([^"]+)"/)[1]}"`)), labels.find(l => !/\bfor=/.test(l)));
  check('forms: no inline style or on*= handler', !/\sstyle\s*=|\son[a-z]+\s*=/i.test(all));
  const copy = ['<summary>Yard, sun, parking and pets (optional)</summary>', '>Yard and sun</legend>', '>Backyard faces</label>', '>Front of the home faces</label>',
    "Stand at the back door looking out; your phone's compass shows the direction.", '>Outdoor space</legend>', "Yard size (as you&#39;d describe it)", '>Fenced</label>', '>Afternoon in the backyard</label>',
    '>Shade</legend>', '>Solar panels</label>', '>Anything else about the yard (optional)</label>', 'maxlength="160"', '>Parking and garage</legend>', '>RV or boat parking on the lot</label>', '>Where</label>',
    '>Side or back yard access for a vehicle or trailer</label>', '>Gate opening (inches, measured by you)</label>', 'min="24" max="480"', '>Driveway length (feet, measured by you)</label>', 'min="5" max="300"',
    '>Garage spaces</label>', 'min="0" max="10"', '>Tandem garage</label>', '>Workshop space</label>', '>240V or EV charger outlet at the parking</label>',
    'Only fill in what you know. "Not sure" is never shown and never matches a search.', '>Pets</legend>', '>Pet notes (optional)</label>', 'placeholder="e.g. one dog under 40 lb; HOA limits pets to two"',
    escapeHtml(homeFacts.PET_FORM_HELP), escapeHtml(homeText.HOME_TEXT_NOTE || 'Describe the home, not who should live there or who lives nearby.'),
    '>Floor plan (optional)</legend>', 'Agents see this with your pre-listing.', 'placeholder="e.g. Plan 3"', 'placeholder="e.g. Otay Ranch Village 11"'];
  const miss = copy.filter(s => !forms.preListing.includes(s));
  check('pre-listing facts form: the exact copy (spec 4.6)', !miss.length, miss.join(' | '));
  check('directions: Not sure + 8 directions in order', forms.preListing.includes('<option value="" selected>Not sure</option><option value="n">North</option><option value="ne">Northeast</option><option value="e">East</option><option value="se">Southeast</option><option value="s">South</option><option value="sw">Southwest</option><option value="w">West</option><option value="nw">Northwest</option>'));
  check('outdoor checkboxes: 9 in order, None last', (forms.preListing.match(/data-hf-outdoor="plf"/g) || []).length === 9 && /Rooftop<\/span><\/label><label class="checkbox-row" for="plfOutdoor-none">/.test(forms.preListing));
  check('listing form: no floor-plan text fields inside the facts (they are in floorPlanFieldsHtml), no rental pets', !forms.listing.includes('PlanBuilder') && !forms.listing.includes('PetsRental'));
  check('listing facts form starts filled and open for an edit', forms.listing.includes(' open>') && forms.listing.includes('<option value="sw" selected>Southwest</option>') && forms.listing.includes('value="120"') && /id="lfToyRvSpotField"(?! class="hidden")/.test(forms.listing));
  check('pre-listing form: "Where" starts hidden', forms.preListing.includes('<div id="plfToyRvSpotField" class="hidden">'));
  check('floor plan: the exact copy, datalist for the builder, checkbox ticked', forms.plan.includes('<datalist id="lfPlanBuilders">') && forms.plan.includes('>Plan name or number</label>') && forms.plan.includes('>Community or tract</label>')
    && forms.plan.includes('List my home with other homes on Amico Haus that share my floor plan') && forms.plan.includes('id="lfPlanTwins" checked')
    && forms.plan.includes("Type it the way your purchase papers or HOA show it. It's only shown when the box is ticked, and never as a price comparison.") && forms.plan.includes('maxlength="60"') && forms.plan.includes('maxlength="40"'));
  check('rental pets: "Pet policy for renters", Not set + 3 choices', forms.rentalPets.includes('>Pet policy for renters</label>') && forms.rentalPets.includes('<option value="">Not set</option><option value="considered">Pets considered</option><option value="some" selected>Some pets (see notes)</option><option value="none">No pets</option>'));
  check('costs form: HOA parking rule after the pets rule', /id="lcPets"[\s\S]*>HOA rule on RV, boat or work-truck parking<\/label><select id="lcParking"><option value="">Not sure<\/option><option value="allowed">Allowed<\/option><option value="limited">Limited \(see HOA rules\)<\/option>/.test(forms.costs));

  // readHomeFacts / readFloorPlan / readHomeCosts on a tiny fake DOM built from the form HTML.
  const fakeDom = (html, set = {}) => {
    const els = {};
    for (const mm of html.matchAll(/<(select|input|textarea)\b([^>]*)>/g)) {
      const attrs = mm[2];
      const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
      if (!id) continue;
      const data = {};
      for (const d of attrs.matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) data[d[1]] = d[2];
      // A select's value is its selected option (or its first one).
      const selectValue = () => {
        const body = html.slice(mm.index, html.indexOf('</select>', mm.index));
        return ((body.match(/<option value="([^"]*)" selected>/) || body.match(/<option value="([^"]*)"/) || [])[1]) || '';
      };
      els[id] = { id, value: mm[1] === 'select' ? selectValue() : (attrs.match(/\bvalue="([^"]*)"/) || [])[1] || '', checked: /\bchecked\b/.test(attrs), data, type: (attrs.match(/\btype="([^"]+)"/) || [])[1] || mm[1] };
    }
    for (const [id, v] of Object.entries(set)) { if (!els[id]) throw new Error(`no field ${id}`); if (typeof v === 'boolean') els[id].checked = v; else els[id].value = v; }
    sb.document.getElementById = id => els[id] || null;
    sb.document.querySelectorAll = sel => {
      const g = sel.match(/^\[data-(hf-[a-z]+)="([^"]+)"\]:checked$/) || sel.match(/^\[data-costs-prefix="([^"]+)"\] \[data-hoa-include\]:checked$/);
      if (!g) return [];
      if (g.length === 2) return [];
      return Object.values(els).filter(e => e.data[g[1]] === g[2] && e.checked);
    };
    return els;
  };
  fakeDom(forms.preListing, {
    plfYardFaces: 'w', 'plfOutdoor-none': true, 'plfOutdoor-deck': true, plfYardFenced: 'partly', 'plfShade-awning': true, plfYardNotes: '  Fig tree  ',
    plfToyRv: 'no', plfToyRvSpot: 'pad', plfToyGateIn: '96', plfToyGarage: '0', plfToyTandem: 'yes', plfPetsNotes: 'Two cats', plfFactsPlanBuilder: 'Lennar', plfFactsPlanName: 'Plan 3',
  });
  const read1 = m.readHomeFacts('plf');
  const v1 = homeFacts.validateHomeFacts(read1, { kind: 'pre_listing' });
  check('readHomeFacts -> validateHomeFacts round trip (pre-listing)', !v1.error && JSON.stringify(v1.data) === JSON.stringify({
    yard: { faces: 'w', outdoor: ['deck'], fenced: 'partly', shade: ['awning'], notes: 'Fig tree' },
    toy: { rv: 'no', gateIn: 96, garage: 0 }, pets: { notes: 'Two cats' }, plan: { builder: 'Lennar', name: 'Plan 3' } }), JSON.stringify(v1.data || v1.error));
  fakeDom(forms.preListing, { plfToyGateIn: '10' });
  let thrown = '';
  try { m.readHomeFacts('plf'); } catch (e) { thrown = e.message; }
  check('readHomeFacts stops a gate under 24 in. with the server\'s words', thrown === 'Gate opening should be whole inches from 24 to 480.', thrown);
  fakeDom(forms.preListing, { plfToyGarage: '2.5' });
  thrown = '';
  try { m.readHomeFacts('plf'); } catch (e) { thrown = e.message; }
  check('readHomeFacts stops a non-whole garage count', thrown === 'Garage spaces should be a whole number from 0 to 10.', thrown);
  fakeDom(forms.plan + forms.listing + forms.rentalPets, { lfPlanTwins: false, lfPlanCommunity: ' Otay Ranch ' });
  const plan = m.readFloorPlan('lf');
  check('readFloorPlan: the three fields + showTwins', JSON.stringify(plan) === JSON.stringify({ builder: 'Lennar', name: 'Plan 3', community: 'Otay Ranch', showTwins: false }), JSON.stringify(plan));
  const listingRead = m.readHomeFacts('lf');
  check('listing readHomeFacts picks up the renters policy from the rental terms', listingRead.pets.rental === 'some' && listingRead.toy.gateIn === 120 && !listingRead.plan, JSON.stringify(listingRead.pets));
  fakeDom(forms.costs, { lcHoaStatus: 'yes', lcHoa: '250', lcParking: 'limited', lcPets: 'allowed' });
  const costsRead = m.readHomeCosts('lc');
  check('readHomeCosts sends the HOA parking rule', costsRead.hoaDetails.parking === 'limited' && costsRead.hoaDetails.pets === 'allowed' && homeCosts.validateHomeCosts(costsRead).data.hoaDetails.parking === 'limited', JSON.stringify(costsRead));
  sb.document.getElementById = () => null;
  check('readHomeFacts/readFloorPlan: null when the form is not on the page', m.readHomeFacts('zz') === null && m.readFloorPlan('zz') === null);

  // Pacific time: main.js's copy === the server's (incl. the 2026-11-01 DST change).
  for (const [a, b] of [['2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z'], ['2026-11-01T08:30:00.000Z', '2026-11-01T10:30:00.000Z'], ['2026-07-04T17:00:00.000Z', '2026-07-04T19:30:00.000Z'], ['2027-03-14T09:30:00.000Z', '2027-03-14T11:00:00.000Z']]) {
    check(`hfPacificWhenLabel(${a}) === pacificWhenLabel`, m.hfPacificWhenLabel(a, b) === pacificWhenLabel(a, b), `${m.hfPacificWhenLabel(a, b)} vs ${pacificWhenLabel(a, b)}`);
  }
  check('hfPacificWhenLabel: "Sat, Nov 14, 1:00 PM – 4:00 PM Pacific time"', m.hfPacificWhenLabel('2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z') === 'Sat, Nov 14, 1:00 PM – 4:00 PM Pacific time');
  check('pre-listing floor-plan line: blank parts left out', m.hfPlanLineHtml({ plan: { name: 'Plan 3', builder: 'Lennar', community: 'Village 11' } }).includes('Floor plan (from the owner)</span> Plan 3 by Lennar, Village 11')
    && m.hfPlanLineHtml({ plan: { name: 'Plan 3' } }).includes('</span> Plan 3</p>') && m.hfPlanLineHtml({}) === '' && m.hfPlanLineHtml(null) === '');

  // The Spanish note: only for uiLang 'es', once per device.
  const banner = (uiLang, store = {}) => {
    const inserted = [];
    const host = { insertBefore: (n) => inserted.push(n), firstChild: null };
    const s2 = makeSandbox('en', '/app', store);
    s2.document.querySelector = sel => (sel === 'main' ? host : null);
    s2.document.createElement = () => ({ querySelector: () => ({ addEventListener: noop }), remove: noop });
    vm.runInContext(`const SPANISH_LIVE = ${store.__live === false ? 'false' : 'true'};\nconst HF_ES_BANNER_KEY = 'amico.esBanner.v1';\n${liftFunction(mainSrc, 'hfInitEsAppBanner')}\nthis.__b = hfInitEsAppBanner;`, s2);
    s2.__b({ uiLang });
    return inserted;
  };
  check('.es-app-banner stays hidden while the Spanish switch is off', banner('es', { __live: false }).length === 0);
  const shown = banner('es');
  check('.es-app-banner shows for uiLang es, in Spanish', shown.length === 1 && shown[0].className === 'card es-app-banner' && shown[0].lang === 'es'
    && shown[0].innerHTML.includes('La aplicación está en inglés por ahora.') && shown[0].innerHTML.includes('<a href="/es/">Páginas en español</a>') && shown[0].innerHTML.includes('>Cerrar</button>'), JSON.stringify(shown[0] || {}).slice(0, 300));
  check('.es-app-banner never shows for English (or no choice)', banner('en').length === 0 && banner(undefined).length === 0);
  check('.es-app-banner stays closed once dismissed on this device', banner('es', { 'amico.esBanner.v1': '1' }).length === 0);
  check('main.js: .es-app-banner only built in hfInitEsAppBanner, after a uiLang es check', (mainSrc.match(/es-app-banner/g) || []).length === 1 && /function hfInitEsAppBanner\(user\) \{\s*if \(!SPANISH_LIVE \|\| !user \|\| user\.uiLang !== 'es'\) return;/.test(mainSrc));
  check('app.html: no static es-app-banner', !read('app.html').includes('es-app-banner'));

  // Wiring in main.js (anchored on the spec's names).
  check('main.js: Saved tab loads the open-house plan', mainSrc.includes("if (name === 'saved') { loadFavorites(); loadHidden(); loadTrash(); loadOpenHousePlan(); }"));
  check('main.js: listing body sends homeFacts + floorPlan (not for a buyer profile), no saveHomeFacts for listings', mainSrc.includes('payload.homeFacts = homeFacts') && mainSrc.includes('payload.floorPlan = floorPlan') && mainSrc.includes('if (!payload.isBuyerOnly) {') && !/saveHomeFacts\('listing'/.test(mainSrc));
  check('main.js: the other kinds save facts right after their costs', ["saveHomeCosts('pre_listing', id, costs);\n    await saveHomeFacts('pre_listing', id, facts);", "await saveHomeFacts('pre_listing', id, facts);\n      resetHomeFactsFields('plFactsFields'",
    "await saveHomeFacts('augmented_home', id, facts);", "await saveHomeFacts('green_home', id, facts);"].every(s => mainSrc.includes(s)));
  check('main.js: in-place facts editor (save-home-facts) on AugmentedHomes and GreenHomes', (mainSrc.match(/data-action="save-home-facts" data-kind="(augmented_home|green_home)"/g) || []).length === 2 && mainSrc.includes(`closest('[data-action="save-home-facts"]')`));
  check('main.js: detail views show facts after costs (pre-listing, Augmented, Green)', (mainSrc.match(/homeFactsDetailHtml\((p|h)\.facts, \1\.costs, \{ isRental: false \}\)/g) || []).length === 3);
  check('main.js: open houses use the Pacific label (no dateStyle/timeStyle open-house renders left)', (mainSrc.match(/hfPacificWhenLabel\(oh\.startsAt, oh\.endsAt\)/g) || []).length === 3 && !/new Date\(oh\.startsAt\)\.toLocaleString/.test(mainSrc));
  check('main.js: owner forms get the share field and send shareAddressWithRsvps (3 kinds)', (mainSrc.match(/openHouseShareFieldHtml\(`/g) || []).length === 3 && (mainSrc.match(/shareAddressWithRsvps: readOpenHouseShare\(`/g) || []).length === 3);
  check('main.js: owner rows get the extras, visitor rows the address + RSVP name line', (mainSrc.match(/openHouseOwnerExtrasHtml\('(listing|augmented_home|green_home)'/g) || []).length === 3 && (mainSrc.match(/openHouseVisitorAddressHtml\(oh\)/g) || []).length === 2 && (mainSrc.match(/\$\{HF_RSVP_NAME_LINE\}/g) || []).length === 2);
  check('main.js: saved search sends toy { rv, sideAccess, workshop, ev240, minGateIn, minGarage }', /toy: \{\s*rv: [^,]+, sideAccess: [^,]+,\s*workshop: [^,]+, ev240: [^,]+,\s*minGateIn: [^\n]+\n\s*minGarage: /.test(mainSrc));
  check('main.js: Display language select (English / Español) + help, PUT /api/me { uiLang }', mainSrc.includes('<label for="uiLangSelect">Display language</label>') && mainSrc.includes('>English</option><option value="es" lang="es"')
    && mainSrc.includes('Only you see this. It sets the language of the Spanish pages and sign-up emails, and never changes which homes or agents you see.') && mainSrc.includes("apiPut('/api/me', { uiLang })"));
  check('main.js: no geolocation', !/geolocation/.test(mainSrc));
});

// ===================== 6. app.html hooks + CSP on everything F added =====================
await section('static', async () => {
  const app = read('app.html');
  for (const id of ['listingFactsFields', 'listingPlanFields', 'listingRentalPetsField', 'plFactsFields', 'augFactsFields', 'greenFactsFields', 'ssRv', 'ssSideAccess', 'ssWorkshop', 'ssEv240', 'ssGateMin', 'ssGarageMin', 'openHousePlan']) {
    check(`app.html has #${id}`, app.includes(`id="${id}"`));
  }
  const order = ['listingCostsFields', 'listingFactsFields', 'listingPlanFields'].map(id => app.indexOf(`id="${id}"`));
  check('app.html: facts then floor plan right after the listing costs', order[0] < order[1] && order[1] < order[2] && app.slice(order[0], order[2]).split('\n').length <= 3);
  const rental = app.slice(app.indexOf('id="rentalFieldset"'), app.indexOf('</fieldset>', app.indexOf('id="rentalFieldset"')));
  check('app.html: renters pet policy inside #rentalFieldset after the minimum lease', rental.indexOf('id="minLeaseMonths"') > 0 && rental.indexOf('id="listingRentalPetsField"') > rental.indexOf('id="minLeaseMonths"'));
  const ss = app.slice(app.indexOf('<form id="savedSearchForm">'), app.indexOf('</form>', app.indexOf('<form id="savedSearchForm">')));
  check('app.html: saved-search toy fields inside #savedSearchForm, exact copy', ['Parking and garage (optional)', '>RV or boat parking<', '>Side or back yard access<', '>Workshop space<', '>240V or EV outlet<', '>Min gate opening (inches)</label>', '>Min garage spaces</label>', 'Only homes whose owner shared these details can match.'].every(s => ss.includes(s)));
  check('app.html: "Notes for agents (pets, ...)" left exactly as it was', app.includes("Notes for agents (pets, sign preference, best showing times). Don't put lockbox, gate or alarm codes here."));
  check('app.html: open-house-plan.js loads before main.js', app.indexOf('<script src="open-house-plan.js"></script>') > 0 && app.indexOf('<script src="open-house-plan.js"></script>') < app.indexOf('<script src="main.js"></script>'));
  check('app.html: the Español link stays outside #tabs', !app.slice(app.indexOf('<nav class="tabs" id="tabs">'), app.indexOf('</nav>', app.indexOf('<nav class="tabs" id="tabs">'))).includes('tab-lang'));
  // Added lines only (git diff against HEAD), so older markup isn't judged by the new rule.
  const added = f => {
    try { execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', f], { stdio: 'ignore' }); } catch { return read(f).split('\n'); }
    return execFileSync('git', ['-C', root, 'diff', '--unified=0', 'HEAD', '--', f], { encoding: 'utf8' }).split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1));
  };
  const INLINE_HANDLER = /\son[a-z]+\s*=\s*["'`]/i;
  for (const f of ['app.html', 'main.js', 'client.js', 'styles.css', 'functions/listing/[id].js', 'functions/augmented-home/[id].js', 'functions/green-home/[id].js', 'functions/api/home-facts/[kind]/[id].js']) {
    const lines = added(f);
    check(`${f}: no inline style="" added`, !lines.some(l => /\sstyle\s*=\s*["'`]/i.test(l)), lines.find(l => /\sstyle\s*=/.test(l)));
    check(`${f}: no inline on*= handler added`, !lines.some(l => INLINE_HANDLER.test(l)), lines.find(l => INLINE_HANDLER.test(l)));
    if (!f.endsWith('.css')) check(`${f}: every added <label> has for=`, !lines.some(l => (l.match(/<label\b[^>]*>/g) || []).some(t => !/\bfor=/.test(t))), lines.find(l => (l.match(/<label\b[^>]*>/g) || []).some(t => !/\bfor=/.test(t))));
    check(`${f}: no McKelvey/Patti/Jeff, no FHEO, no "rules don't apply"`, !lines.some(l => /McKelvey|Patti|Jeff|FHEO|rules don't apply|generally don't apply/.test(l)));
  }
  const css = read('styles.css');
  for (const cls of ['home-facts', 'assist-note', 'drive-link', 'drive-places', 'drive-place-chip', 'tab-lang', 'es-app-banner', 'legal-summary-banner', 'plan-twins', 'plan-twin-card', 'toy-chip',
    'oh-address', 'oh-plan', 'oh-plan-day', 'oh-plan-stop', 'oh-plan-stop-actions', 'oh-overlap', 'oh-share-state', 'facts-group', 'home-facts-editor', 'drive-place-add']) {
    check(`styles.css has .${cls}`, new RegExp(`\\.${cls}\\b`).test(css));
  }
  check('styles.css: .oh-plan-day.active styled', css.includes('.oh-plan-day.active {'));
  check('styles.css: @media print keeps only #openHousePlan from the Saved tab', /@media print \{[^@]*#tab-saved\.active > :not\(#openHousePlan\) \{ display: none !important; \}/.test(css));
  const lastMedia = css.lastIndexOf('@media');
  check('styles.css: the final block is still @media (max-width: 720px)', css.slice(lastMedia).startsWith('@media (max-width: 720px)') && css.trimEnd().endsWith('}'));
  check('styles.css: .assist-note is not a warning style', !/\.assist-note \{[^}]*(danger|warn|#c|red)/.test(css));
});

console.log = realLog;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
