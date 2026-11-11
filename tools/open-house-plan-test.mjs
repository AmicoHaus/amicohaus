// Open-house route (home facts batch, migration_v46) and bugs B1-B4, against an in-memory SQLite stand-in for D1:
// the Pacific-time reminder label (B1), ISO time comparisons (B2), the note checks (B3), the RSVP rules (B4: one row
// load, block check, active home/owner, ended open houses, 30 adds a day), the owner's address-sharing opt-in and its
// reveal rule (signed in, going, named, not blocked, active, 24 h before start until the end), the names an owner
// sees, GET /api/open-house-plan (2 statements, private, no-store, ordering, previews for approved agents only), the
// places the address must never appear, the export, and a scan of the browser code (open-house-plan.js,
// listing-actions.js). Emails are captured by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/open-house-plan-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.argv[2];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
let statements = 0;
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { statements++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { statements++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { statements++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => { statements++; return /^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
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
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const sent = [];
globalThis.fetch = async (url, opts) => { try { sent.push(JSON.parse(opts.body)); } catch { /* not an email */ } return new Response('{}', { status: 200 }); };
const call = async (handler, method, path, who, params = {}, body) => {
  const request = new Request(`https://amicohaus.com${path}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const pending = [];
  const before = statements;
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  const used = statements - before;
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, headers: res.headers, used, json: type.includes('json') ? await res.json() : null, text: type.includes('json') ? null : await res.text() };
};
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
console.log = () => {};

const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const at = (h) => iso(Date.now() + h * H);
// rsvp_named: 1 = RSVP'd after being told the owner sees their name (every RSVP the new code makes); 0 = an RSVP from
// before (counted, never named, no address). LATE is a created_at after the Terms date on an rsvp_named = 0 row: an RSVP
// made on the old live code after that day must still never be named (the flag decides, not the date).
const NAMED = 1;
const BEFORE = 0;
const LATE = '2026-11-20 09:00:00';
const ADDRESS = '123 Secret St';

// People: 1 owner A, 2 viewer V, 3 viewer W (blocked by A), 4 owner S (suspended), 5 demo owner D, 6 approved agent G,
// 7 plain user P (no agent profile), 8 viewer X (rate limits), 9 suspended RSVP-er, 10 demo RSVP-er,
// 11 viewer Y (blocks A from their side), 12 demo viewer.
const user = (id, extra = {}) => {
  run('INSERT INTO users (id, email, display_name, status) VALUES (?, ?, ?, ?)', id, extra.email || `u${id}@example.test`, `Person ${id}`, extra.status || 'active');
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
for (const id of [1, 2, 3, 6, 7, 8, 11]) user(id);
user(4, { status: 'active' }); // suspended after the fixtures are in
user(5, { email: 'd5@demo.amicohaus.local' });
user(9);
user(10, { email: 'd10@demo.amicohaus.local' });
user(12, { email: 'd12@demo.amicohaus.local' });
run("INSERT INTO agent_profiles (user_id, status) VALUES (6, 'approved')");
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 3)');
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (11, 1)');

const listing = (id, owner, extra = {}) => run(
  `INSERT INTO listings (id, user_id, title, address, neighborhood, city, state, property_type, beds, baths, estimated_value, price_tier, status)
   VALUES (?, ?, ?, ?, 'EastLake', 'Chula Vista', 'CA', 'Single Family Home', 3, 2, 800000, '600k-1m', ?)`,
  id, owner, extra.title || `Home ${id}`, extra.address ?? ADDRESS, extra.status || 'active');
const aug = (id, owner) => run(`INSERT INTO augmented_homes (id, user_id, title, address, city, state, property_type, beds, baths, asking_price)
  VALUES (?, ?, 'Aug home', ?, 'Chula Vista', 'CA', 'Condo', 2, 2, 600000)`, id, owner, ADDRESS);
const green = (id, owner) => run(`INSERT INTO green_homes (id, user_id, title, address, city, state, property_type, beds, baths, asking_price)
  VALUES (?, ?, 'Green home', ?, 'Bonita', 'CA', 'Townhouse', 3, 3, 700000)`, id, owner, ADDRESS);
const OH = { listing: ['open_houses', 'listing_id', 'open_house_rsvps'], augmented_home: ['augmented_home_open_houses', 'augmented_home_id', 'augmented_home_open_house_rsvps'], green_home: ['green_home_open_houses', 'green_home_id', 'green_home_open_house_rsvps'] };
const oh = (kind, homeId, startH, endH, share = 0, note = '') => Number(run(`INSERT INTO ${OH[kind][0]} (${OH[kind][1]}, starts_at, ends_at, note, share_address_with_rsvps) VALUES (?, ?, ?, ?, ?)`,
  homeId, at(startH), at(endH), note, share).lastInsertRowid);
const rsvp = (kind, ohId, userId, named = NAMED, createdAt = LATE) => run(`INSERT INTO ${OH[kind][2]} (open_house_id, user_id, rsvp_named, created_at) VALUES (?, ?, ?, ?)`, ohId, userId, named, createdAt);

const plan = await mod('functions/_lib/openHousePlan.js');
const pt = await mod('functions/_lib/pacificTime.js');
const rl = await mod('functions/_lib/rateLimits.js');
const reminders = await mod('functions/_lib/openHouseReminders.js');
const ohApi = {
  listing: { index: await mod('functions/api/listings/[id]/open-houses/index.js'), one: await mod('functions/api/listings/[id]/open-houses/[ohId].js'), rsvp: await mod('functions/api/listings/[id]/open-houses/[ohId]/rsvp.js'), base: '/api/listings' },
  augmented_home: { index: await mod('functions/api/augmented-homes/[id]/open-houses/index.js'), one: await mod('functions/api/augmented-homes/[id]/open-houses/[ohId].js'), rsvp: await mod('functions/api/augmented-homes/[id]/open-houses/[ohId]/rsvp.js'), base: '/api/augmented-homes' },
  green_home: { index: await mod('functions/api/green-homes/[id]/open-houses/index.js'), one: await mod('functions/api/green-homes/[id]/open-houses/[ohId].js'), rsvp: await mod('functions/api/green-homes/[id]/open-houses/[ohId]/rsvp.js'), base: '/api/green-homes' },
};
const planApi = await mod('functions/api/open-house-plan.js');
const KINDS = ['listing', 'augmented_home', 'green_home'];
const getOh = (kind, homeId, who) => call(ohApi[kind].index.onRequestGet, 'GET', `${ohApi[kind].base}/${homeId}/open-houses`, who, { id: String(homeId) });
const toggle = (kind, homeId, ohId, who) => call(ohApi[kind].rsvp.onRequestPost, 'POST', `${ohApi[kind].base}/${homeId}/open-houses/${ohId}/rsvp`, who, { id: String(homeId), ohId: String(ohId) }, {});
const getPlan = (who, q = '') => call(planApi.onRequestGet, 'GET', `/api/open-house-plan${q}`, who);

// Homes: listing 100 (A), aug 200 (A), green 300 (A); listing 101 (A, paused); listing 102 (S, suspended later);
// listing 103 (D, demo); listing 104 (A, second home for "wrong home" checks).
listing(100, 1); aug(200, 1); green(300, 1);
listing(101, 1, { status: 'paused' }); listing(102, 4); listing(103, 5); listing(104, 1, { address: '9 Other Rd' });
const HOME = { listing: 100, augmented_home: 200, green_home: 300 };

// ================= B1: Pacific time =================
const email = reminders.buildOpenHouseReminderEmail({ startsAt: '2026-11-14T21:00:00.000Z', endsAt: '2026-11-15T00:00:00.000Z', title: 'Home', city: 'Chula Vista', state: 'CA', href: 'https://amicohaus.com/listing/1' }, 'Pat');
check('B1: a 21:00Z start reads 1:00 PM, Pacific time', email.text.includes('Sat, Nov 14, 1:00 PM – 4:00 PM Pacific time') && email.html.includes('1:00 PM'), email.text);
check('B1: the label matches pacificWhenLabel', email.text.includes(pt.pacificWhenLabel('2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z')));
const emailNoEnd = reminders.buildOpenHouseReminderEmail({ startsAt: '2026-11-14T21:00:00.000Z', title: 'Home', city: 'Chula Vista', state: 'CA', href: 'x' }, 'Pat');
check('B1: without an end time it still says 1:00 PM Pacific time', emailNoEnd.text.includes('Sat, Nov 14, 1:00 PM Pacific time'), emailNoEnd.text);

// ================= B2: ISO vs datetime('now') =================
// An open house that ended earlier the SAME UTC day: datetime('now') text sorts before any ISO time that day.
const dayStart = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
const endedEnd = Math.max(Date.now() - H, dayStart + 1000);
const endedStart = Math.max(endedEnd - 2 * H, dayStart);
const ended = {};
for (const k of KINDS) {
  ended[k] = Number(run(`INSERT INTO ${OH[k][0]} (${OH[k][1]}, starts_at, ends_at, note) VALUES (?, ?, ?, '')`, HOME[k], iso(endedStart), iso(endedEnd)).lastInsertRowid);
  const r = await getOh(k, HOME[k], null);
  check(`B2 (${k}): an open house that ended earlier today is not listed`, r.status === 200 && !r.json.openHouses.some(o => o.id === ended[k]), JSON.stringify(r.json));
}
const soonL = oh('listing', 100, 2, 4);
let due = await reminders.fetchDueOpenHouseReminders(DB, 24);
check('B2: reminders skip open houses that already started today, and include one starting in 2 hours',
  !due.some(d => d.entityKind === 'listing' && d.openHouseId === ended.listing) && due.some(d => d.entityKind === 'listing' && d.openHouseId === soonL), JSON.stringify(due.map(d => [d.entityKind, d.openHouseId])));
check('B2: reminders for the 3 kinds never include an ended one', KINDS.every(k => !due.some(d => d.entityKind === k && d.openHouseId === ended[k])));
const remSrc = readFileSync(`${root}/functions/_lib/openHouseReminders.js`, 'utf8');
check("B2: openHouseReminders.js no longer compares starts_at with datetime('now')", !/starts_at\s*[<>]=?\s*datetime\('now'/.test(remSrc));
for (const f of ['openHouses.js', 'augmentedHomeOpenHouses.js', 'greenHomeOpenHouses.js', 'openHousePlan.js']) {
  check(`B2: ${f} has no datetime('now') next to an open-house time`, !/(starts_at|ends_at)\s*[<>]=?\s*datetime\('now'/.test(readFileSync(`${root}/functions/_lib/${f}`, 'utf8')));
}
run('DELETE FROM open_houses WHERE id = ?', soonL);

// ================= B3: notes and the share flag =================
const { STEERING_ERROR, ADDRESS_ERROR, CODE_ERROR } = await mod('functions/_lib/homeText.js');
for (const k of KINDS) {
  const post = (body) => call(ohApi[k].index.onRequestPost, 'POST', `${ohApi[k].base}/${HOME[k]}/open-houses`, 1, { id: String(HOME[k]) }, { startsAt: at(30), endsAt: at(32), ...body });
  const a = await post({ note: 'Walk to 123 Main Street' });
  const c = await post({ note: 'Gate code 4512' });
  const s = await post({ note: 'Steps from the school' });
  const es = await post({ note: 'Cerca de la escuela' });
  check(`B3 (${k}): a note with an address, a gate code or a school is refused (incl. Spanish)`,
    a.status === 400 && a.json.error === ADDRESS_ERROR && c.status === 400 && c.json.error === CODE_ERROR && s.status === 400 && s.json.error === STEERING_ERROR && es.status === 400 && es.json.error === STEERING_ERROR,
    JSON.stringify([a.json, c.json, s.json, es.json]));
  const ok = await post({ note: 'Cookies and lemonade!', shareAddressWithRsvps: true });
  const off = await post({ note: '' });
  const truthy = await post({ shareAddressWithRsvps: 'yes' });
  const row = (id) => one(`SELECT note, share_address_with_rsvps AS share FROM ${OH[k][0]} WHERE id = ?`, id);
  check(`B3 (${k}): a plain note saves; share = true stores 1, missing or non-boolean stores 0`,
    ok.status === 201 && row(ok.json.id).share === 1 && row(ok.json.id).note === 'Cookies and lemonade!' && row(off.json.id).share === 0 && row(truthy.json.id).share === 0,
    JSON.stringify([ok, off, truthy].map(r => r.json)));
  for (const r of [ok, off, truthy]) run(`DELETE FROM ${OH[k][0]} WHERE id = ?`, r.json.id);
}

// ================= Reveal rule (unit) =================
const base = { share: 1, going: true, named: true, address: ADDRESS, blocked: false, active: true };
const now0 = Date.parse('2026-11-14T12:00:00.000Z');
const win = (startH, endH) => ({ startsAt: iso(now0 + startH * H), endsAt: iso(now0 + endH * H) });
check('reveal: 23 h before the start -> address', plan.addressRevealed({ ...base, ...win(23, 26) }, now0));
check('reveal: 25 h before the start -> none, note opens_at', !plan.addressRevealed({ ...base, ...win(25, 28) }, now0) && plan.addressNote({ ...base, ...win(25, 28) }, now0) === 'opens_at');
check('reveal: after the end -> none', !plan.addressRevealed({ ...base, ...win(-3, -1) }, now0));
check('reveal: share off / not going / not named / blocked / inactive / no address -> none',
  ['share', 'going', 'named', 'address', 'active'].every(f => !plan.addressRevealed({ ...base, ...win(2, 4), [f]: f === 'share' ? 0 : false }, now0))
  && !plan.addressRevealed({ ...base, ...win(2, 4), blocked: true }, now0));
check('notes: not_shared / rsvp_to_get / rsvp_again / shared',
  plan.addressNote({ ...base, ...win(2, 4), share: 0 }, now0) === 'not_shared' && plan.addressNote({ ...base, ...win(2, 4), going: false }, now0) === 'rsvp_to_get'
  && plan.addressNote({ ...base, ...win(2, 4), named: false }, now0) === 'rsvp_again' && plan.addressNote({ ...base, ...win(2, 4) }, now0) === 'shared');
check('names flag: rsvpNamed reads rsvp_named (1 only), and there is no GOING_NAMES_FROM date', plan.rsvpNamed(1) && !plan.rsvpNamed(0) && !plan.rsvpNamed(null) && !plan.rsvpNamed('2026-11-20 00:00:00') && plan.GOING_NAMES_FROM === undefined
  && !/GOING_NAMES_FROM|created_at >= \?/.test(readFileSync(`${root}/functions/_lib/openHousePlan.js`, 'utf8')));
check('ADDRESS_WINDOW_HOURS is 24', plan.ADDRESS_WINDOW_HOURS === 24);

// ================= Reveal through GET open houses (3 kinds) =================
const fx = {};
for (const k of KINDS) {
  const h = HOME[k];
  fx[k] = {
    shareOff: oh(k, h, 2, 4, 0), // V going, named
    in23: oh(k, h, 23, 26, 1), // V going, named -> address
    in25: oh(k, h, 25, 28, 1), // V going, named -> opens_at
    notGoing: oh(k, h, 5, 7, 1), // nobody
    old: oh(k, h, 6, 8, 1), // V going but before names were shown
  };
  rsvp(k, fx[k].shareOff, 2); rsvp(k, fx[k].in23, 2); rsvp(k, fx[k].in25, 2); rsvp(k, fx[k].old, 2, BEFORE);
  rsvp(k, fx[k].in23, 3); // W is blocked by A
  rsvp(k, fx[k].in23, 11); // Y blocked A
  rsvp(k, fx[k].in23, 9); // suspended later
  rsvp(k, fx[k].in23, 10); // demo RSVP-er
  rsvp(k, fx[k].in23, 7, BEFORE); // P before names were shown
  rsvp(k, fx[k].in23, 1, BEFORE); // the owner's own RSVP, from before
  rsvp(k, fx[k].in23, 12, BEFORE); // a demo RSVP-er from before
}
run("UPDATE users SET status = 'suspended' WHERE id = 9");
for (const k of KINDS) {
  const v = await getOh(k, HOME[k], 2);
  const byId = (id) => v.json.openHouses.find(o => o.id === id) || {};
  check(`reveal (${k}): going + named + 23 h before -> the address`, byId(fx[k].in23).address === ADDRESS, JSON.stringify(byId(fx[k].in23)));
  check(`reveal (${k}): share off, 25 h before, not going, rsvp_named = 0 -> none`,
    [fx[k].shareOff, fx[k].in25, fx[k].notGoing, fx[k].old].every(id => byId(id).address === undefined), JSON.stringify(v.json.openHouses));
  check(`reveal (${k}): visitors never get goingNames; the share flag is a boolean`, v.json.openHouses.every(o => o.goingNames === undefined) && byId(fx[k].in23).shareAddressWithRsvps === true && byId(fx[k].shareOff).shareAddressWithRsvps === false);
  check(`reveal (${k}): GET is private, no-store`, v.headers.get('Cache-Control') === 'private, no-store');
  const anon = await getOh(k, HOME[k], null);
  check(`reveal (${k}): an anonymous GET never has an address or names`, anon.status === 200 && !JSON.stringify(anon.json).includes(ADDRESS) && anon.json.openHouses.every(o => !o.goingNames) && anon.headers.get('Cache-Control') === 'private, no-store');
  const w = await getOh(k, HOME[k], 3);
  const y = await getOh(k, HOME[k], 11);
  check(`reveal (${k}): blocked either way -> no address`, !JSON.stringify(w.json).includes(ADDRESS) && !JSON.stringify(y.json).includes(ADDRESS));
  check(`D1 (${k}): visitor GET with a reveal = session + home row + list + mine + reveal check (5)`, v.used === 5, `used ${v.used}`);
  // The owner: names of people going (named, active, not demo, not blocked), and goingBefore for the rest.
  const o = await getOh(k, HOME[k], 1);
  const ownIn23 = o.json.openHouses.find(x => x.id === fx[k].in23);
  check(`owner (${k}): goingNames = named, active, non-demo, not blocked RSVPs only`, JSON.stringify(ownIn23.goingNames) === JSON.stringify(['Person 2']), JSON.stringify(ownIn23));
  check(`owner (${k}): goingBefore counts only eligible rsvp_named = 0 RSVPs (not blocked, suspended, demo or the owner's own)`, ownIn23.rsvpCount === 8 && ownIn23.goingBefore === 1 && !ownIn23.goingNames.includes('Person 1'), JSON.stringify(ownIn23));
  const ownOld = o.json.openHouses.find(x => x.id === fx[k].old);
  check(`owner (${k}): an RSVP from before names were shown (rsvp_named = 0, created after the Terms date) is counted, never named`, ownOld.rsvpCount === 1 && ownOld.goingNames.length === 0 && ownOld.goingBefore === 1);
  check(`owner (${k}): the owner's own GET never carries the address field`, o.json.openHouses.every(x => x.address === undefined));
  check(`D1 (${k}): owner GET = session + home row + list + mine + names (5)`, o.used === 5, `used ${o.used}`);
}
// At most 50 names per open house; goingNamedCount has the full count.
const crowd = oh('listing', 100, 70, 72, 0);
for (let i = 0; i < 52; i++) { user(2000 + i); rsvp('listing', crowd, 2000 + i); }
const crowdRow = (await getOh('listing', 100, 1)).json.openHouses.find(x => x.id === crowd);
check('owner: at most 50 names, goingNamedCount 52, goingBefore 0', crowdRow.goingNames.length === 50 && crowdRow.goingNamedCount === 52 && crowdRow.goingBefore === 0, JSON.stringify({ n: crowdRow.goingNames.length, c: crowdRow.goingNamedCount, b: crowdRow.goingBefore }));
run('DELETE FROM open_houses WHERE id = ?', crowd);
// Paused home and suspended owner: no address in GET.
const pausedOh = oh('listing', 101, 3, 5, 1); rsvp('listing', pausedOh, 2);
const pv = await getOh('listing', 101, 2);
check('reveal: a paused home -> no address in GET', !JSON.stringify(pv.json).includes(ADDRESS), JSON.stringify(pv.json));
const suspOh = oh('listing', 102, 3, 5, 1); rsvp('listing', suspOh, 2);
run("UPDATE users SET status = 'suspended' WHERE id = 4");
const sv = await getOh('listing', 102, 2);
check("reveal: a suspended owner's home -> no address in GET", !JSON.stringify(sv.json).includes(ADDRESS), JSON.stringify(sv.json));
// fetchOpenHouses without the 4th argument behaves as before.
const { fetchOpenHouses } = await mod('functions/_lib/openHouses.js');
const legacy = await fetchOpenHouses(DB, 100, 2);
check('fetchOpenHouses without options: no address, no names', legacy.length > 0 && legacy.every(x => x.address === undefined && x.goingNames === undefined));

// ================= The plan =================
const anonPlan = await getPlan(null);
check('plan: anonymous -> 401', anonPlan.status === 401);
const vp = await getPlan(2);
const stops = vp.json.stops;
const stop = (k, id) => stops.find(s => s.kind === k && s.openHouseId === id);
check('plan: private, no-store', vp.headers.get('Cache-Control') === 'private, no-store');
check('plan: 2 D1 statements + the session', vp.used === 3, `used ${vp.used}`);
check('plan: days defaults to 7', vp.json.days === 7);
for (const k of KINDS) {
  const s23 = stop(k, fx[k].in23);
  check(`plan (${k}): going + named + 23 h -> address, note shared`, s23 && s23.address === ADDRESS && s23.addressNote === 'shared' && s23.going === true, JSON.stringify(s23));
  check(`plan (${k}): 25 h before -> no address, note opens_at`, stop(k, fx[k].in25).address === null && stop(k, fx[k].in25).addressNote === 'opens_at');
  check(`plan (${k}): share off -> not_shared, no address`, stop(k, fx[k].shareOff).address === null && stop(k, fx[k].shareOff).addressNote === 'not_shared');
  check(`plan (${k}): an rsvp_named = 0 RSVP (created after the Terms date) -> rsvp_again, no address`, stop(k, fx[k].old).address === null && stop(k, fx[k].old).addressNote === 'rsvp_again');
  check(`plan (${k}): not going and not saved -> not in the plan`, !stop(k, fx[k].notGoing));
}
check('plan: the photo, href, day and key fields', (() => { const s = stop('listing', fx.listing.in23); return s.href === '/listing/100' && s.key === `listing:100:${fx.listing.in23}` && s.day === pt.pacificDayKey(s.startsAt) && s.photoUrl === null; })());
check('plan: augmented and green hrefs', stop('augmented_home', fx.augmented_home.in23).href === '/augmented-home/200' && stop('green_home', fx.green_home.in23).href === '/green-home/300');
check('plan: a paused home or a suspended owner -> not in the plan', !stop('listing', pausedOh) && !stop('listing', suspOh));
const wp = await getPlan(3);
const yp = await getPlan(11);
check('plan: blocked either way -> the home is not in the plan', !wp.json.stops.some(s => s.homeId === 100 && s.kind === 'listing') && !yp.json.stops.some(s => s.homeId === 100 && s.kind === 'listing'), JSON.stringify(wp.json.stops));
// Saved homes without an RSVP.
run("INSERT INTO listing_feedback (user_id, listing_id, feedback) VALUES (2, 104, 'up')");
const savedOh = oh('listing', 104, 3, 5, 1);
run('INSERT INTO augmented_home_favorites (user_id, augmented_home_id) VALUES (8, 200)');
run('INSERT INTO green_home_favorites (user_id, green_home_id) VALUES (8, 300)');
const vp2 = (await getPlan(2)).json.stops;
const savedStop = vp2.find(s => s.openHouseId === savedOh && s.kind === 'listing');
check('plan: a saved home\'s open house shows with going false, no address, note rsvp_to_get', savedStop && savedStop.going === false && savedStop.saved === true && savedStop.address === null && savedStop.addressNote === 'rsvp_to_get', JSON.stringify(savedStop));
const xp = (await getPlan(8)).json.stops;
check('plan: saved augmented and green homes show their open houses (going false, no address)', xp.some(s => s.kind === 'augmented_home' && !s.going && s.saved && s.address === null) && xp.some(s => s.kind === 'green_home' && !s.going && s.saved && s.address === null));
run("INSERT INTO listing_feedback (user_id, listing_id, feedback) VALUES (2, 100, 'up')");
const vp3 = (await getPlan(2)).json.stops;
check('plan: a going + saved stop shows once, with both flags', vp3.filter(s => s.kind === 'listing' && s.openHouseId === fx.listing.in23).length === 1 && vp3.find(s => s.kind === 'listing' && s.openHouseId === fx.listing.in23).saved === true);
// Demo homes: hidden from real viewers, shown to demo viewers.
const demoOh = oh('listing', 103, 3, 5, 1); rsvp('listing', demoOh, 2); rsvp('listing', demoOh, 12);
check('plan: a demo home is hidden from a real viewer', !(await getPlan(2)).json.stops.some(s => s.openHouseId === demoOh && s.kind === 'listing'));
check('plan: a demo viewer sees the demo home', (await getPlan(12)).json.stops.some(s => s.openHouseId === demoOh && s.kind === 'listing'));
// Broker previews: approved agents only, never an address.
run(`INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address, status)
  VALUES (500, 1, 'Chula Vista', 'CA', '91913', 'Single Family Home', 4, 3, 900000, ?, 'open')`, ADDRESS);
const prev = Number(run('INSERT INTO pre_listing_previews (pre_listing_id, starts_at, ends_at, note) VALUES (500, ?, ?, ?)', at(4), at(6), 'Agents welcome').lastInsertRowid);
run('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (?, 6)', prev);
run('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (?, 7)', prev);
const gp = (await getPlan(6)).json.stops.find(s => s.kind === 'preview');
check('plan: an approved agent sees their broker preview, address null, note preview, pre-listing link', gp && gp.address === null && gp.addressNote === 'preview' && gp.href === '/app#pre-listing-500' && gp.going === true, JSON.stringify(gp));
check('plan: a non-agent never sees a preview stop', !(await getPlan(7)).json.stops.some(s => s.kind === 'preview'));
// Days: capped at 8; a stop at +7.5 days shows with days=8, not with the default.
const farOh = oh('listing', 100, 7.5 * 24, 7.5 * 24 + 2, 0); rsvp('listing', farOh, 2);
const tooFar = oh('listing', 100, 8.5 * 24, 8.5 * 24 + 2, 0); rsvp('listing', tooFar, 2);
const d8 = (await getPlan(2, '?days=20')).json;
check('plan: days is capped at 8', d8.days === 8 && d8.stops.some(s => s.openHouseId === farOh) && !d8.stops.some(s => s.openHouseId === tooFar));
check('plan: the default 7 days leaves out a stop 7.5 days out', !(await getPlan(2)).json.stops.some(s => s.openHouseId === farOh));
check('plan: days=0 or junk -> 1 or 7', (await getPlan(2, '?days=0')).json.days === 1 && (await getPlan(2, '?days=abc')).json.days === 7);
// Same start time: ordered by kind then id, never by RSVP count.
const sameStart = at(10);
const tA = Number(run("INSERT INTO open_houses (listing_id, starts_at, ends_at, note) VALUES (100, ?, ?, '')", sameStart, at(12)).lastInsertRowid);
const tB = Number(run("INSERT INTO open_houses (listing_id, starts_at, ends_at, note) VALUES (100, ?, ?, '')", sameStart, at(12)).lastInsertRowid);
const tAug = Number(run("INSERT INTO augmented_home_open_houses (augmented_home_id, starts_at, ends_at, note) VALUES (200, ?, ?, '')", sameStart, at(12)).lastInsertRowid);
rsvp('listing', tA, 2); rsvp('listing', tB, 2); rsvp('augmented_home', tAug, 2);
for (const u of [6, 7, 8]) rsvp('listing', tB, u); // tB is "more popular"
const order = (await getPlan(2)).json.stops.filter(s => s.startsAt === sameStart).map(s => `${s.kind}:${s.openHouseId}`);
check('plan: two stops at the same time are ordered by kind, then id (not by RSVP count)', JSON.stringify(order) === JSON.stringify([`listing:${tA}`, `listing:${tB}`, `augmented_home:${tAug}`]), JSON.stringify(order));
const allStops = (await getPlan(2)).json.stops;
check('plan: stops are in start-time order', allStops.every((s, i) => i === 0 || allStops[i - 1].startsAt <= s.startsAt));
// The SQL itself.
check('plan SQL: 7 UNION ALL terms handed to allUnionAll (d1-limits)', (await mod('functions/_lib/compoundSelect.js')).unionAllTerms(plan.PLAN_SQL).length === 7
  && /allUnionAll\(\s*db\s*,\s*PLAN_SQL\b/.test(readFileSync(`${root}/functions/_lib/openHousePlan.js`, 'utf8')));
const addrRefs = [...plan.PLAN_SQL.matchAll(/h\.address/g)].map(m => plan.PLAN_SQL.slice(Math.max(0, m.index - 70), m.index));
check('plan SQL: h.address only inside CASE ... share_address_with_rsvps = 1 AND r.rsvp_named = 1 THEN', addrRefs.length === 3 && addrRefs.every(b => /CASE WHEN oh\.share_address_with_rsvps = 1 AND r\.rsvp_named = 1 THEN $/.test(b)), JSON.stringify(addrRefs));
check('plan SQL: named is the rsvp_named flag in terms 1-3, never a created_at date; 5 parameters', (plan.PLAN_SQL.match(/\(r\.rsvp_named = 1\) AS named/g) || []).length === 3 && !/created_at|\?6/.test(plan.PLAN_SQL));
check('plan SQL: never orders by anything (sorting happens in JS by time, kind, id)', !/ORDER BY[^)]*(rsvp|count)/i.test(plan.PLAN_SQL));

// ================= B4: RSVP rules =================
// Blocked either way -> 404 like a missing open house.
const b4 = oh('listing', 100, 30, 32, 1);
const blockedTry = await toggle('listing', 100, b4, 3);
const blockedTry2 = await toggle('listing', 100, b4, 11);
check('B4: a blocked user\'s RSVP -> 404 "Open house not found." (both directions)', blockedTry.status === 404 && blockedTry.json.error === 'Open house not found.' && blockedTry2.status === 404);
for (const k of KINDS) {
  const id = oh(k, HOME[k], 30, 32, 1);
  const r = await toggle(k, HOME[k], id, 3);
  check(`B4 (${k}): blocked -> 404`, r.status === 404);
  const ok = await toggle(k, HOME[k], id, 2);
  check(`B4 (${k}): a plain RSVP works, response { going, address } private, no-store`, ok.status === 200 && ok.json.going === true && ok.json.address === null && ok.headers.get('Cache-Control') === 'private, no-store', JSON.stringify(ok.json));
  const wrongHome = await toggle(k, HOME[k] + 1, id, 2);
  check(`B4 (${k}): the open house id with another home's id -> 404`, wrongHome.status === 404);
}
check('B4: paused home -> 404', (await toggle('listing', 101, pausedOh, 8)).status === 404);
// Removing your own RSVP always works when the open house is that home's: a paused home, a suspended owner, a block.
const rmPaused = oh('listing', 101, 3, 5, 1); rsvp('listing', rmPaused, 8);
const rmP = await toggle('listing', 101, rmPaused, 8);
check('B4: removing your RSVP on a paused home works (200, going false, row gone)', rmP.status === 200 && rmP.json.going === false && rmP.headers.get('Cache-Control') === 'private, no-store'
  && !one('SELECT 1 AS x FROM open_house_rsvps WHERE open_house_id = ? AND user_id = 8', rmPaused), JSON.stringify(rmP.json));
check('B4: ...and adding it back on the paused home -> 404', (await toggle('listing', 101, rmPaused, 8)).status === 404);
for (const k of KINDS) {
  const rmB = oh(k, HOME[k], 33, 35, 1); rsvp(k, rmB, 3); rsvp(k, rmB, 11);
  const r3 = await toggle(k, HOME[k], rmB, 3);
  const r11 = await toggle(k, HOME[k], rmB, 11);
  check(`B4 (${k}): removing your RSVP across a block works, both directions`, r3.status === 200 && r3.json.going === false && r11.status === 200 && r11.json.going === false
    && !one(`SELECT 1 AS x FROM ${OH[k][2]} WHERE open_house_id = ?`, rmB), JSON.stringify([r3.json, r11.json]));
  check(`B4 (${k}): ...and adding it back across the block -> 404`, (await toggle(k, HOME[k], rmB, 3)).status === 404);
  const rmWrong = oh(k, HOME[k], 36, 38, 0); rsvp(k, rmWrong, 2);
  check(`B4 (${k}): removing with another home's id -> 404, the RSVP stays`, (await toggle(k, HOME[k] + 1, rmWrong, 2)).status === 404 && !!one(`SELECT 1 AS x FROM ${OH[k][2]} WHERE open_house_id = ? AND user_id = 2`, rmWrong));
}
check("B4: suspended owner's home -> 404", (await toggle('listing', 102, suspOh, 8)).status === 404);
const rmSusp = oh('listing', 102, 3, 5, 1); rsvp('listing', rmSusp, 8);
check("B4: removing your RSVP on a suspended owner's home works", (await toggle('listing', 102, rmSusp, 8)).json.going === false && !one('SELECT 1 AS x FROM open_house_rsvps WHERE open_house_id = ? AND user_id = 8', rmSusp));
const endedAdd = await toggle('listing', 100, ended.listing, 8);
check('B4: adding an RSVP to an ended open house -> 404', endedAdd.status === 404);
rsvp('listing', ended.listing, 8);
const endedRemove = await toggle('listing', 100, ended.listing, 8);
check('B4: removing an RSVP from an ended open house still works', endedRemove.status === 200 && endedRemove.json.going === false);
// Rate limit: 30 adds a day; removing never counts and is never refused.
check('B4: USER_LIMITS.open_house_rsvp = 30 a day, right after preview_rsvp', JSON.stringify(rl.USER_LIMITS.open_house_rsvp) === JSON.stringify([{ max: 30, minutes: 1440 }])
  && Object.keys(rl.USER_LIMITS).indexOf('open_house_rsvp') === Object.keys(rl.USER_LIMITS).indexOf('preview_rsvp') + 1);
const rlOh = oh('listing', 100, 40, 42, 0);
let adds = 0, statuses = [];
for (let i = 0; i < 59; i++) { const r = await toggle('listing', 100, rlOh, 8); statuses.push(r.status); if (r.json && r.json.going) adds++; }
check('B4: 30 adds (with 29 removes between) all go through', adds === 30 && statuses.every(s => s === 200), JSON.stringify(statuses));
const remove30 = await toggle('listing', 100, rlOh, 8);
check('B4: removing after 30 adds works (removing never counts)', remove30.status === 200 && remove30.json.going === false);
const add31 = await toggle('listing', 100, rlOh, 8);
check('B4: the 31st add in a day -> 429 rate_limited', add31.status === 429 && add31.json.code === 'rate_limited', JSON.stringify(add31));
check('B4: the refused add left no RSVP', !one('SELECT 1 AS x FROM open_house_rsvps WHERE open_house_id = ? AND user_id = 8', rlOh));
const addUsed = await toggle('listing', 100, oh('listing', 100, 44, 46, 0), 6);
check('D1: an RSVP add = session + at most 5', addUsed.used <= 6, `used ${addUsed.used}`);
// The RSVP response carries the address only when revealed now: a named RSVP (clock after the names date) inside the window.
const realNow = Date.now;
const fake = Date.parse('2026-11-14T12:00:00.000Z');
const inWin = Number(run("INSERT INTO open_houses (listing_id, starts_at, ends_at, note, share_address_with_rsvps) VALUES (100, ?, ?, '', 1)", iso(fake + 3 * H), iso(fake + 5 * H)).lastInsertRowid);
const outWin = Number(run("INSERT INTO open_houses (listing_id, starts_at, ends_at, note, share_address_with_rsvps) VALUES (100, ?, ?, '', 1)", iso(fake + 30 * H), iso(fake + 32 * H)).lastInsertRowid);
const offWin = Number(run("INSERT INTO open_houses (listing_id, starts_at, ends_at, note, share_address_with_rsvps) VALUES (100, ?, ?, '', 0)", iso(fake + 3 * H), iso(fake + 5 * H)).lastInsertRowid);
Date.now = () => fake;
let rIn, rOut, rOff, rUn;
try {
  rIn = await toggle('listing', 100, inWin, 6);
  rOut = await toggle('listing', 100, outWin, 6);
  rOff = await toggle('listing', 100, offWin, 6);
  rUn = await toggle('listing', 100, inWin, 6);
} finally { Date.now = realNow; }
check('RSVP response: shared + inside the window -> address', rIn.json.going === true && rIn.json.address === ADDRESS, JSON.stringify(rIn.json));
check('RSVP response: shared but 30 h out -> null; not shared -> null; un-RSVP -> null', rOut.json.address === null && rOff.json.address === null && rUn.json.going === false && rUn.json.address === null);
const nowOh = oh('listing', 100, 3, 5, 1);
const preDate = await toggle('listing', 100, nowOh, 6); // real clock, any day: the new code always shows the notice
check('RSVP response: a new RSVP is named on any day, so shared + in-window -> the address', preDate.json.going === true && preDate.json.address === ADDRESS, JSON.stringify(preDate.json));
check('RSVP add: the row is stored with rsvp_named = 1', one('SELECT rsvp_named FROM open_house_rsvps WHERE open_house_id = ? AND user_id = 6', nowOh).rsvp_named === 1);
for (const [i, k] of KINDS.entries()) {
  const who = 3000 + i; user(who); // a fresh person (8 used up the day's adds above)
  const again = oh(k, HOME[k], 3, 5, 1); rsvp(k, again, who, BEFORE);
  const off = await toggle(k, HOME[k], again, who);
  const on = await toggle(k, HOME[k], again, who);
  const row = one(`SELECT rsvp_named FROM ${OH[k][2]} WHERE open_house_id = ? AND user_id = ?`, again, who);
  check(`RSVP again (${k}): remove + add turns an rsvp_named = 0 RSVP into a named one, with the address`, off.json.going === false && on.json.going === true && on.json.address === ADDRESS && row && row.rsvp_named === 1, JSON.stringify([off.json, on.json, row]));
}
check('RSVP add SQL: every add sets rsvp_named = 1, and an upsert of an existing row does too', /INSERT INTO \$\{c\.rsvpTable\} \(open_house_id, user_id, rsvp_named\) VALUES \(\?, \?, 1\)\s+ON CONFLICT\(open_house_id, user_id\) DO UPDATE SET rsvp_named = 1/.test(readFileSync(`${root}/functions/_lib/openHousePlan.js`, 'utf8'))
  && !/INSERT OR IGNORE INTO \$\{c\.rsvpTable\}/.test(readFileSync(`${root}/functions/_lib/openHousePlan.js`, 'utf8')));
{
  // The upsert itself on node:sqlite: an rsvp_named = 0 row conflicting with an add ends named.
  const up = oh('listing', 100, 3, 5, 0); rsvp('listing', up, 7, BEFORE);
  run('INSERT INTO open_house_rsvps (open_house_id, user_id, rsvp_named) VALUES (?, ?, 1) ON CONFLICT(open_house_id, user_id) DO UPDATE SET rsvp_named = 1', up, 7);
  check('RSVP upsert: ON CONFLICT marks the existing row named (one row)', one('SELECT COUNT(*) AS n, MAX(rsvp_named) AS m FROM open_house_rsvps WHERE open_house_id = ? AND user_id = 7', up).n === 1
    && one('SELECT rsvp_named FROM open_house_rsvps WHERE open_house_id = ? AND user_id = 7', up).rsvp_named === 1);
}

// ================= PATCH share (owner only) =================
for (const k of KINDS) {
  const id = oh(k, HOME[k], 50, 52, 0);
  const patch = (who, homeId, body) => call(ohApi[k].one.onRequestPatch, 'PATCH', `${ohApi[k].base}/${homeId}/open-houses/${id}`, who, { id: String(homeId), ohId: String(id) }, body);
  const anonP = await patch(null, HOME[k], { shareAddressWithRsvps: true });
  const otherP = await patch(2, HOME[k], { shareAddressWithRsvps: true });
  const missing = await patch(1, 99999, { shareAddressWithRsvps: true });
  const bad = await patch(1, HOME[k], { shareAddressWithRsvps: 'yes' });
  const shareNow = () => one(`SELECT share_address_with_rsvps AS s FROM ${OH[k][0]} WHERE id = ?`, id).s;
  check(`PATCH (${k}): anon 401, other user 403, missing home 404, non-boolean 400, nothing changed`, anonP.status === 401 && otherP.status === 403 && missing.status === 404 && bad.status === 400 && shareNow() === 0,
    JSON.stringify([anonP.status, otherP.status, missing.status, bad.status]));
  const on = await patch(1, HOME[k], { shareAddressWithRsvps: true });
  check(`PATCH (${k}): the owner turns it on -> { ok, shareAddressWithRsvps: true }, private, no-store`, on.status === 200 && on.json.ok === true && on.json.shareAddressWithRsvps === true && shareNow() === 1 && on.headers.get('Cache-Control') === 'private, no-store');
  const offP = await patch(1, HOME[k], { shareAddressWithRsvps: false });
  check(`PATCH (${k}): ...and off again`, offP.json.shareAddressWithRsvps === false && shareNow() === 0);
}
// An open house of listing 100 patched through A's other listing 104 -> 404.
const cross = await call(ohApi.listing.one.onRequestPatch, 'PATCH', `/api/listings/104/open-houses/${fx.listing.in23}`, 1, { id: '104', ohId: String(fx.listing.in23) }, { shareAddressWithRsvps: false });
check("PATCH: another home's open house through the owner's other home -> 404, unchanged", cross.status === 404 && one('SELECT share_address_with_rsvps AS s FROM open_houses WHERE id = ?', fx.listing.in23).s === 1);

// ================= Places the address must never appear =================
run("INSERT INTO listing_feedback (user_id, listing_id, feedback) VALUES (7, 100, 'up')");
sent.length = 0;
const posted = await call(ohApi.listing.index.onRequestPost, 'POST', '/api/listings/100/open-houses', 1, { id: '100' }, { startsAt: at(60), endsAt: at(62), note: 'Fresh cookies', shareAddressWithRsvps: true });
check('notify: posting an open house still works (201)', posted.status === 201);
const noteRows = sqlite.prepare("SELECT body, link FROM notifications WHERE user_id = 7 AND body LIKE '%open house%'").all();
check('notify: the favoriter notification never has the address or the note', noteRows.length > 0 && noteRows.every(n => !n.body.includes(ADDRESS) && !n.body.includes('Fresh cookies')), JSON.stringify(noteRows));
check('notify: no email carries the address or the note', sent.every(m => !JSON.stringify(m).includes(ADDRESS) && !JSON.stringify(m).includes('Fresh cookies')));
const ev = sqlite.prepare("SELECT headline FROM market_events WHERE event_type = 'open_house_scheduled'").all();
check('market event: never the address or the note', ev.length > 0 && ev.every(e => !e.headline.includes(ADDRESS) && !e.headline.includes('Fresh cookies')), JSON.stringify(ev));
due = await reminders.fetchDueOpenHouseReminders(DB, 24 * 30);
const remText = due.map(d => JSON.stringify(reminders.buildOpenHouseReminderEmail(d, 'Pat'))).join('');
check('reminder email: never the address', due.length > 0 && !remText.includes(ADDRESS) && due.every(d => d.address === undefined));
try {
  const sitemap = await mod('functions/sitemap.xml.js');
  const sm = await call(sitemap.onRequestGet, 'GET', '/sitemap.xml', null);
  check('sitemap: never the address', sm.status === 200 && !String(sm.text).includes(ADDRESS));
} catch (err) { check('sitemap: never the address', false, String(err && err.stack || err)); }
try {
  const page = await mod('functions/listing/[id].js');
  const anonPage = await call(page.onRequestGet, 'GET', '/listing/100', null, { id: '100' });
  const plainPage = await call(page.onRequestGet, 'GET', '/listing/100', 8, { id: '100' }); // X: no RSVP to this home
  check('listing page (F renders): no address for an anonymous or non-RSVP viewer', anonPage.status === 200 && plainPage.status === 200 && !anonPage.text.includes(ADDRESS) && !plainPage.text.includes(ADDRESS));
  check('listing page (F\'s file): the RSVP name line is on the page for a signed-in visitor', plainPage.text.includes('When you RSVP, the owner sees your display name.'));
  check('listing page (F\'s file): times are Pacific (pacificWhenLabel)', plainPage.text.includes('Pacific time'));
} catch (err) { check('listing page renders', false, String(err && err.stack || err)); }
const mainSrc = readFileSync(`${root}/main.js`, 'utf8');
check("main.js (F's file): the Augmented/Green visitor rows carry the RSVP name line", (mainSrc.match(/When you RSVP, the owner sees your display name\./g) || []).length >= 1);
check("main.js (F's file): uses the 3 owner helpers and loads the plan in the Saved tab",
  /openHouseShareFieldHtml\(/.test(mainSrc) && /readOpenHouseShare\(/.test(mainSrc) && /openHouseOwnerExtrasHtml\(/.test(mainSrc) && /openHouseVisitorAddressHtml\(/.test(mainSrc) && /loadOpenHousePlan\(\)/.test(mainSrc));

// ================= Export =================
const exp = await mod('functions/api/account/export.js');
const ex = await call(exp.onRequestGet, 'GET', '/api/account/export', 2);
const exData = ex.json || JSON.parse(ex.text || '{}');
const rows = exData.openHouses || [];
check("export: the viewer's own RSVPs (3 kinds) are there", ['rsvp_listing', 'rsvp_augmented_home', 'rsvp_green_home'].every(k => rows.some(r => r.kind === k)), JSON.stringify(rows.slice(0, 3)));
const ownIds = new Set(sqlite.prepare('SELECT open_house_id AS id FROM open_house_rsvps WHERE user_id = 2').all().map(r => r.id));
check("export: no one else's RSVPs", rows.filter(r => r.kind === 'rsvp_listing').every(r => ownIds.has(r.open_house_id)));
const namedOf = (r) => { const d = typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json; return d && d.rsvp_named; };
check("export: each of your RSVPs says whether the owner sees your name (rsvp_named 1 or 0)", rows.filter(r => r.kind.startsWith('rsvp_')).every(r => namedOf(r) === 0 || namedOf(r) === 1)
  && rows.some(r => r.kind === 'rsvp_listing' && namedOf(r) === 0) && rows.some(r => r.kind === 'rsvp_listing' && namedOf(r) === 1), JSON.stringify(rows.slice(0, 3)));

// ================= Browser code =================
const clientSrc = readFileSync(`${root}/open-house-plan.js`, 'utf8');
const laSrc = readFileSync(`${root}/listing-actions.js`, 'utf8');
for (const [name, src] of [['open-house-plan.js', clientSrc], ['listing-actions.js', laSrc]]) {
  check(`${name}: never reads location`, !/geolocation/i.test(src));
  check(`${name}: no fetch( to a non-/api URL`, [...src.matchAll(/fetch\(\s*([`'"])([^`'"]*)/g)].every(m => m[2].startsWith('/api/')));
  check(`${name}: none of the banned words`, !/best route|optimi[sz]ed|fastest|most popular/i.test(src));
}
const mapUrls = [...clientSrc.matchAll(/`https:\/\/(?:www\.google\.com\/maps|maps\.apple\.com)[^`]*`/g)].map(m => m[0]);
check('open-house-plan.js: every map URL encodes its parts', mapUrls.length >= 3 && mapUrls.every(u => [...u.matchAll(/\$\{([^}]*)\}/g)].every(m => /encodeURIComponent\(|^waypoints$/.test(m[1]))), JSON.stringify(mapUrls));
check('open-house-plan.js: max 9 waypoints', /OHP_MAX_WAYPOINTS = 9\b/.test(clientSrc));
check('open-house-plan.js: no inline handlers or style attributes', !/\son[a-z]+=|style="/.test(clientSrc));
// Run the browser code in a sandbox.
const store = new Map();
const plainEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mount = { innerHTML: '' };
const sandbox = {
  console, Date, Intl, JSON, Math, Number, String, Array, Set, Map, Object, encodeURIComponent,
  escapeHtml: plainEsc, toast: () => {}, apiGet: async () => ({ stops: sandboxStops }), apiPost: async () => ({}), api: async () => ({}),
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  document: { getElementById: id => (id === 'openHousePlan' ? mount : null), addEventListener: () => {} },
  window: { print: () => {} },
};
let sandboxStops = [];
vm.createContext(sandbox);
vm.runInContext(clientSrc + '\n;this.__ohp = { ohpWhenLabel, ohpRouteHref, ohpDirectionsHref, ohpDayStops, ohpRender, setStops: s => { ohpStops = s; }, loadOpenHousePlan, openHouseShareFieldHtml, readOpenHouseShare, openHouseOwnerExtrasHtml, openHouseVisitorAddressHtml };', sandbox);
const C = sandbox.__ohp;
check('client: ohpWhenLabel matches the server label', C.ohpWhenLabel('2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z') === pt.pacificWhenLabel('2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z'));
const route = C.ohpRouteHref(Array.from({ length: 12 }, (_, i) => `${i + 1} A St, Chula Vista`));
const wps = new URL(route).searchParams.get('waypoints').split('|');
check('client: the whole route has at most 9 waypoints, destination = 10th stop in order', wps.length === 9 && new URL(route).searchParams.get('destination') === '10 A St, Chula Vista' && wps[0] === '1 A St, Chula Vista', route);
check('client: Apple directions link', C.ohpDirectionsHref('1 A St & B', 'apple') === 'https://maps.apple.com/?daddr=1%20A%20St%20%26%20B&dirflg=d');
const mk = (key, startH, extra = {}) => ({ key, kind: 'listing', homeId: 1, openHouseId: Number(key.split(':')[2]), title: `T${key}`, propertyType: 'Condo', beds: 2, baths: 2, neighborhood: '', city: 'Chula Vista', state: 'CA', startsAt: iso(Date.parse('2026-11-14T17:00:00Z') + startH * H), endsAt: iso(Date.parse('2026-11-14T17:00:00Z') + (startH + 2) * H), day: '2026-11-14', note: '', going: true, saved: false, href: '/listing/1', address: null, addressNote: 'not_shared', ...extra });
sandboxStops = [mk('listing:1:1', 0, { address: '1 A St', addressNote: 'shared' }), mk('listing:1:2', 1, { address: '2 B St', addressNote: 'shared' }), mk('listing:1:3', 4, { addressNote: 'rsvp_to_get', going: false, saved: true })];
await C.loadOpenHousePlan();
const html = mount.innerHTML;
check('client: plan renders heading, sub, overlap fact, route link, drive-time line, print', html.includes('<h2>Open-house plan</h2>') && html.includes('Move stops up or down; the order stays on this device.')
  && html.includes("This overlaps with the next stop's time.") && html.includes('Open the whole route in Google Maps ↗') && html.includes("Amico Haus doesn't estimate drive times.") && html.includes('Print plan'));
check('client: the I\'m Going button carries the name line', html.includes("I'm Going") && html.includes('When you RSVP, the owner sees your display name.'));
check('client: move buttons have aria-labels', html.includes('aria-label="Move Tlisting:1:1 up"') && html.includes('aria-label="Move Tlisting:1:3 down"'));
store.set('amico.ohPlan.v1:2026-11-14', JSON.stringify({ order: ['listing:1:3', 'listing:1:1', 'listing:1:2'], removed: ['listing:1:2'] }));
const ds = C.ohpDayStops('2026-11-14');
check('client: the saved order and removed stops apply', JSON.stringify(ds.kept.map(s => s.key)) === JSON.stringify(['listing:1:3', 'listing:1:1']) && ds.removedCount === 1);
C.ohpRender();
check('client: "Put back removed stops" shows when any are removed', mount.innerHTML.includes('Put back removed stops'));
store.clear();
sandboxStops = [];
await C.loadOpenHousePlan();
check('client: empty plan copy', mount.innerHTML.includes("No open houses in the next 7 days from your RSVPs or saved homes. RSVP on a home's page to add it here."));
const field = C.openHouseShareFieldHtml('lf');
check('client: share field (label for=, exact copy)', field.includes('for="lfOhShare"') && field.includes('id="lfOhShare"') && field.includes('Share the street address with people who RSVP (from 24 hours before it starts until it ends)')
  && field.includes("Only signed-in people who RSVP see it, and only in that window. You'll see who's going."));
const extras = C.openHouseOwnerExtrasHtml('listing', 100, { id: 5, shareAddressWithRsvps: true, goingNames: ['Ana <b>', 'Bo'], goingBefore: 2 });
check('client: owner extras (state, toggle, names escaped, goingBefore line)', extras.includes('Address shared with people going') && extras.includes('Stop sharing the address') && extras.includes('data-action="ohp-share-toggle"')
  && extras.includes('Going (2): Ana &lt;b&gt;, Bo') && extras.includes(" (plus 2 who RSVP&#39;d before names were shown; they don&#39;t get the address unless they RSVP again)"), extras);
const extrasMany = C.openHouseOwnerExtrasHtml('listing', 100, { id: 5, shareAddressWithRsvps: false, goingNames: ['Ana', 'Bo'], goingNamedCount: 5, goingBefore: 0 });
check('client: owner extras show the full named count when the list is capped', extrasMany.includes('Going (5): Ana, Bo, and 3 more') && !extrasMany.includes('plus'), extrasMany);
const extrasOff = C.openHouseOwnerExtrasHtml('green_home', 3, { id: 6, shareAddressWithRsvps: false });
check('client: owner extras when off', extrasOff.includes('Address not shared') && extrasOff.includes('Share address with people going') && !extrasOff.includes('Going ('));
check('client: visitor address line only with an address, escaped', C.openHouseVisitorAddressHtml({}) === '' && C.openHouseVisitorAddressHtml({ address: '1 <A> St' }).includes('Address for this open house (shared by the owner with people going): 1 &lt;A&gt; St'));
check('listing-actions.js: adds the address line on RSVP and removes it on un-RSVP', /oh-address/.test(laSrc) && /Address for this open house \(shared by the owner with people going\): \$\{address\}/.test(laSrc) && /textContent/.test(laSrc));

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
