// Runs the real code for batch R3-1a's privacy fixes against an in-memory SQLite stand-in for D1: a phone number is
// private unless its owner turns on "Show my phone number" (or shares their contact with that agent), on every
// public page and API; suspended accounts aren't served and are signed out everywhere; homeowner profiles carry
// noindex, agent profiles don't. Also loads the legacy /profile.html script against the real API. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/privacy-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

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
globalThis.fetch = async () => new Response('{}', { status: 200 });
const call = async (handler, method, path, who, body, params = {}) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const pending = [];
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  return { status: res.status, text, json: type.includes('json') ? JSON.parse(text) : null, headers: res.headers };
};
console.log = () => {};

// 1 homeowner A (private phone), 2 signed-in stranger, 3 agent B (A shared contact with B), 4 agent D (no share),
// 5 homeowner E (phone public), 6 suspended homeowner, 7 agent G (private phone), 8 admin, 9 suspended agent,
// 10 agent H (phone public)
const PHONES = { 1: '(619) 555-0101', 5: '(619) 555-0105', 6: '(619) 555-0106', 7: '(619) 555-0107', 8: '(619) 555-0108', 9: '(619) 555-0109', 10: '(619) 555-0110' };
const people = [
  [1, 'Ana Owner', 'user', 'active', 0], [2, 'Sam Stranger', 'user', 'active', 0], [3, 'Bea Agent', 'user', 'active', 0],
  [4, 'Dan Agent', 'user', 'active', 0], [5, 'Eve Public', 'user', 'active', 1], [6, 'Sid Suspended', 'user', 'suspended', 1],
  [7, 'Gus Agent', 'user', 'active', 0], [8, 'Ada Admin', 'admin', 'active', 0], [9, 'Zed Suspended Agent', 'user', 'suspended', 1],
  [10, 'Hal Agent', 'user', 'active', 1],
];
for (const [id, name, role, status, pub] of people) {
  sqlite.prepare('INSERT INTO users (id, email, display_name, role, status, phone, phone_public) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, `u${id}@example.test`, name, role, status, PHONES[id] || null, pub);
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
}
sqlite.prepare("INSERT INTO users (id, email, display_name, phone, phone_public) VALUES (11, 'demo11@demo.amicohaus.local', 'Demo Person', '(619) 555-0111', 1)").run();
for (const id of [3, 4, 7, 9, 10]) sqlite.prepare("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', ?, 'Bay Realty')").run(id, `0123456${id % 10}`);
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, address) VALUES (20, 1, 'Chula Vista', 'CA', '91913', 'House', 3, 2, 800000, '123 Secret St')").run();
sqlite.prepare('INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (20, 1, 3)').run();
// A public listing (and an augmented home, a green home and a project) for A, E, the suspended homeowner and the demo account.
for (const [lid, uid] of [[30, 1], [31, 5], [32, 6], [33, 11]]) {
  sqlite.prepare("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier) VALUES (?, ?, 'Nice home', 'Chula Vista', 'CA', 'House', 3, 2, 750000, '600k-1m')").run(lid, uid);
  sqlite.prepare("INSERT INTO augmented_homes (id, user_id, title, city, state, property_type, beds, baths, asking_price) VALUES (?, ?, 'Step-free home', 'Chula Vista', 'CA', 'House', 3, 2, 750000)").run(lid, uid);
  sqlite.prepare("INSERT INTO green_homes (id, user_id, title, city, state, property_type, beds, baths, asking_price) VALUES (?, ?, 'Solar home', 'Chula Vista', 'CA', 'House', 3, 2, 750000)").run(lid, uid);
  sqlite.prepare("INSERT INTO dev_projects (id, user_id, title, city, state, project_type) VALUES (?, ?, 'Duplex build', 'Chula Vista', 'CA', 'new_construction')").run(lid, uid);
}

const auth = await mod('functions/_lib/auth.js');
const usersApi = await mod('functions/api/users/[id].js');
const agentsApi = await mod('functions/api/agents/[id].js');
const meApi = await mod('functions/api/me.js');
const profilePage = await mod('functions/profile/[id].js');
const pages = {
  listing: await mod('functions/listing/[id].js'),
  'augmented-home': await mod('functions/augmented-home/[id].js'),
  'green-home': await mod('functions/green-home/[id].js'),
  project: await mod('functions/project/[id].js'),
};
const digits = (p) => p.replace(/\D/g, '').slice(-7); // matches the number however it's formatted (text or tel: link)
const shows = (text, id) => text.includes(digits(PHONES[id])) || text.includes(PHONES[id]);

// --- getSessionUser: a suspended account is signed out everywhere ---
const ctxFor = (who) => ({ env, request: new Request('https://amicohaus.com/x', { headers: { Cookie: `ah_session=t${who}` } }) });
check('getSessionUser: an active account is signed in', (await auth.getSessionUser(ctxFor(1)))?.id === 1);
check('getSessionUser: a suspended account counts as signed out', (await auth.getSessionUser(ctxFor(6))) === null && (await auth.getSessionUser(ctxFor(9))) === null);
let r = await call(meApi.onRequestGet, 'GET', '/api/me', 6);
check('...so /api/me shows them signed out', r.status === 200 && r.json.user === null, r.text);
r = await call(meApi.onRequestPut, 'PUT', '/api/me', 6, { bio: 'still here?' });
check('...and they can no longer change anything', r.status === 401);

// --- /api/users/:id ---
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', null, null, { id: '1' });
check('/api/users/:id anonymous: no phone (phone_public is off)', r.status === 200 && r.json.user.phone === '' && !shows(r.text, 1), r.text.slice(0, 200));
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 2, null, { id: '1' });
check('/api/users/:id another signed-in user: no phone', r.status === 200 && r.json.user.phone === '' && !shows(r.text, 1));
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 4, null, { id: '1' });
check('/api/users/:id an agent they did NOT share with: no phone', r.status === 200 && !shows(r.text, 1));
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 8, null, { id: '1' });
check('/api/users/:id an admin on the public API: no phone either (admin screens only)', r.status === 200 && !shows(r.text, 1));
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 3, null, { id: '1' });
check('/api/users/:id the agent they shared their contact info with: sees the phone', r.status === 200 && r.json.user.phone === PHONES[1]);
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 1, null, { id: '1' });
check('/api/users/:id themselves: their own phone, and whether it is public', r.status === 200 && r.json.user.phone === PHONES[1] && r.json.user.phonePublic === false);
r = await call(usersApi.onRequestGet, 'GET', '/api/users/5', null, null, { id: '5' });
check('/api/users/:id phone_public = 1: anyone sees it', r.status === 200 && r.json.user.phone === PHONES[5] && !('phonePublic' in r.json.user));
r = await call(usersApi.onRequestGet, 'GET', '/api/users/6', null, null, { id: '6' });
check('/api/users/:id a suspended account is a 404, like a missing one', r.status === 404 && !shows(r.text, 6));
r = await call(usersApi.onRequestGet, 'GET', '/api/users/11', null, null, { id: '11' });
check('/api/users/:id demo accounts stay hidden', r.status === 404);

// --- /api/agents/:id ---
r = await call(agentsApi.onRequestGet, 'GET', '/api/agents/7', null, null, { id: '7' });
check('/api/agents/:id an approved agent is served, with no phone in it', r.status === 200 && r.json.profile.displayName === 'Gus Agent' && !shows(r.text, 7));
r = await call(agentsApi.onRequestGet, 'GET', '/api/agents/9', null, null, { id: '9' });
check('/api/agents/:id a suspended agent (profile still approved) is a 404', r.status === 404);

// --- /profile/:id ---
r = await call(profilePage.onRequestGet, 'GET', '/profile/1', null, null, { id: '1' });
check('/profile/:id homeowner, anonymous: no phone anywhere in the page (text or data attribute)', r.status === 200 && !shows(r.text, 1) && !/data-phone=/.test(r.text), (r.text.match(/phoneSection[\s\S]{0,200}/) || [''])[0]);
check('...it points to Amico Haus messages instead', /Sign up to message Ana Owner directly through Amico Haus/.test(r.text));
check('...and a homeowner profile carries noindex', /<meta name="robots" content="noindex">/.test(r.text));
r = await call(profilePage.onRequestGet, 'GET', '/profile/1', 2, null, { id: '1' });
check('/profile/:id homeowner, another signed-in user: no phone, "Message ... through Amico Haus"', !shows(r.text, 1) && /Message Ana Owner directly through Amico Haus/.test(r.text));
r = await call(profilePage.onRequestGet, 'GET', '/profile/1', 8, null, { id: '1' });
check('/profile/:id homeowner, an admin: no phone on the public page', !shows(r.text, 1));
r = await call(profilePage.onRequestGet, 'GET', '/profile/1', 3, null, { id: '1' });
check('/profile/:id homeowner, the agent they shared with: sees the phone', shows(r.text, 1));
r = await call(profilePage.onRequestGet, 'GET', '/profile/1', 1, null, { id: '1' });
check('/profile/:id their own profile: their phone, the edit box data, and the "private unless" note', shows(r.text, 1) && /data-phone="\(619\) 555-0101"/.test(r.text) && /Private unless you turn on &#39;Show my phone number&#39; in You&#39;re in Control\./.test(r.text));
r = await call(profilePage.onRequestGet, 'GET', '/profile/5', null, null, { id: '5' });
check('/profile/:id phone_public = 1: anonymous sees it', r.status === 200 && shows(r.text, 5) && /noindex/.test(r.text));
r = await call(profilePage.onRequestGet, 'GET', '/profile/6', null, null, { id: '6' });
check('/profile/:id suspended homeowner: 404', r.status === 404 && !shows(r.text, 6));
r = await call(profilePage.onRequestGet, 'GET', '/profile/9', null, null, { id: '9' });
check('/profile/:id suspended agent: 404', r.status === 404 && !shows(r.text, 9));
r = await call(profilePage.onRequestGet, 'GET', '/profile/7', null, null, { id: '7' });
check('/profile/:id agent profile: indexable (no noindex), no private phone', r.status === 200 && !/noindex/.test(r.text) && !shows(r.text, 7) && /Gus Agent/.test(r.text));
check('...and it shows their DRE number with the brokerage', /DRE #01234567 · Bay Realty/.test(r.text), (r.text.match(/DRE #[^<]{0,40}/) || [''])[0]);
r = await call(profilePage.onRequestGet, 'GET', '/profile/7', 7, null, { id: '7' });
check('/profile/:id an agent viewing their own page: phone not shown while it is private', !shows(r.text, 7));
r = await call(profilePage.onRequestGet, 'GET', '/profile/10', null, null, { id: '10' });
check('/profile/:id an agent who turned on "Show my phone number": shown', r.status === 200 && shows(r.text, 10));

// --- /listing/:id, /augmented-home/:id, /green-home/:id, /project/:id ---
for (const [name, page] of Object.entries(pages)) {
  r = await call(page.onRequestGet, 'GET', `/${name}/30`, null, null, { id: '30' });
  check(`/${name}/:id anonymous: no owner phone, "Sign up to message" instead`, r.status === 200 && !shows(r.text, 1) && /Sign up to message Ana Owner directly through Amico Haus/.test(r.text), `status ${r.status}`);
  r = await call(page.onRequestGet, 'GET', `/${name}/30`, 4, null, { id: '30' });
  check(`/${name}/:id an agent without a share: no owner phone, "Message" instead`, r.status === 200 && !shows(r.text, 1) && /Message Ana Owner directly through Amico Haus/.test(r.text));
  r = await call(page.onRequestGet, 'GET', `/${name}/30`, 8, null, { id: '30' });
  check(`/${name}/:id an admin on the public page: no owner phone`, !shows(r.text, 1));
  r = await call(page.onRequestGet, 'GET', `/${name}/30`, 3, null, { id: '30' });
  check(`/${name}/:id the agent the owner shared with: sees it`, shows(r.text, 1));
  r = await call(page.onRequestGet, 'GET', `/${name}/30`, 1, null, { id: '30' });
  check(`/${name}/:id the owner: sees their own`, shows(r.text, 1));
  r = await call(page.onRequestGet, 'GET', `/${name}/31`, null, null, { id: '31' });
  check(`/${name}/:id an owner with phone_public = 1: shown as a call link`, r.status === 200 && shows(r.text, 5) && /href="tel:/.test(r.text));
  r = await call(page.onRequestGet, 'GET', `/${name}/32`, null, null, { id: '32' });
  check(`/${name}/:id a suspended owner: 404`, r.status === 404 && !shows(r.text, 6), `status ${r.status}`);
}
r = await call(pages.listing.onRequestGet, 'GET', '/listing/33', null, null, { id: '33' });
check('/listing/:id demo listings still have no public page', r.status === 404);

// --- An agent who posts a home carries their DRE identity line at the point of contact ---
// 7 = Gus Agent (approved, DRE #01234567, Bay Realty) owns home 34 on each of the four pages.
sqlite.prepare("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, client_name) VALUES (34, 7, 'Client home', 'Chula Vista', 'CA', 'House', 3, 2, 750000, '600k-1m', 'A Client')").run();
sqlite.prepare("INSERT INTO augmented_homes (id, user_id, title, city, state, property_type, beds, baths, asking_price) VALUES (34, 7, 'Step-free home', 'Chula Vista', 'CA', 'House', 3, 2, 750000)").run();
sqlite.prepare("INSERT INTO green_homes (id, user_id, title, city, state, property_type, beds, baths, asking_price) VALUES (34, 7, 'Solar home', 'Chula Vista', 'CA', 'House', 3, 2, 750000)").run();
sqlite.prepare("INSERT INTO dev_projects (id, user_id, title, city, state, project_type) VALUES (34, 7, 'Duplex build', 'Chula Vista', 'CA', 'new_construction')").run();
const GUS_LINE = 'Gus Agent · DRE #01234567 · Bay Realty';
for (const [name, page] of Object.entries(pages)) {
  r = await call(page.onRequestGet, 'GET', `/${name}/34`, null, null, { id: '34' });
  const byLine = (r.text.match(/(?:Listed|Posted) by <a[^>]*>([^<]*)<\/a>/) || [])[1] || '';
  const contactCard = (r.text.match(/<h2>Contact Gus Agent<\/h2>[\s\S]{0,400}/) || [''])[0];
  check(`/${name}/:id an agent's home: "Listed by" carries their DRE number and brokerage`, r.status === 200 && byLine === GUS_LINE, `status ${r.status} "${byLine}"`);
  check(`/${name}/:id ...and so does the Contact card`, contactCard.includes(`<p class="tiny">${GUS_LINE}</p>`), contactCard.slice(0, 200));
  r = await call(page.onRequestGet, 'GET', `/${name}/30`, null, null, { id: '30' });
  check(`/${name}/:id a homeowner's home keeps the plain name (no DRE line)`, /(?:Listed|Posted) by <a[^>]*>Ana Owner<\/a>/.test(r.text) && !/Ana Owner · DRE/.test(r.text));
}
sqlite.prepare("UPDATE agent_profiles SET status = 'pending' WHERE user_id = 10").run();
sqlite.prepare("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier) VALUES (35, 10, 'Hal home', 'Chula Vista', 'CA', 'House', 3, 2, 750000, '600k-1m')").run();
r = await call(pages.listing.onRequestGet, 'GET', '/listing/35', null, null, { id: '35' });
check('/listing/:id an agent profile that is not approved adds no DRE line', r.status === 200 && /Listed by <a[^>]*>Hal Agent<\/a>/.test(r.text), (r.text.match(/Listed by <a[^>]*>[^<]*<\/a>/) || [''])[0]);
sqlite.prepare("UPDATE agent_profiles SET status = 'approved' WHERE user_id = 10").run();

// --- /api/listings/:id: the exact address stays with the owner, even with "Reveal exact address" ticked ---
const listingApi = await mod('functions/api/listings/[id].js');
sqlite.prepare("INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, address, show_exact_address, client_name) VALUES (36, 1, 'Reveal home', 'Chula Vista', 'CA', 'House', 3, 2, 750000, '600k-1m', '77 Hidden Ln', 1, 'Private Client')").run();
for (const [who, label] of [[null, 'anonymous'], [2, 'another signed-in user'], [3, 'an agent (even one she shared her contact with)'], [4, 'another agent']]) {
  r = await call(listingApi.onRequestGet, 'GET', '/api/listings/36', who, null, { id: '36' });
  check(`/api/listings/:id ${label}: no exact address, even with "Reveal exact address" on`, r.status === 200 && r.json.listing && !('address' in r.json.listing) && !r.text.includes('77 Hidden Ln') && !r.text.includes('Private Client') && r.json.isOwner === false, `status ${r.status} ${r.text.slice(0, 160)}`);
}
check('/api/listings/:id is never kept by a shared cache (private, no-store)', /private/.test(r.headers.get('cache-control') || '') && /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
r = await call(listingApi.onRequestGet, 'GET', '/api/listings/36', 1, null, { id: '36' });
check('/api/listings/:id the owner still gets the address (for the edit form)', r.status === 200 && r.json.listing.address === '77 Hidden Ln' && r.json.isOwner === true);
r = await call(listingApi.onRequestGet, 'GET', '/api/listings/36', 8, null, { id: '36' });
check('/api/listings/:id an admin still gets it too', r.status === 200 && r.json.listing.address === '77 Hidden Ln');
sqlite.prepare("UPDATE listings SET status = 'paused' WHERE id = 36").run();
r = await call(listingApi.onRequestGet, 'GET', '/api/listings/36', null, null, { id: '36' });
const pausedB = await call(listingApi.onRequestGet, 'GET', '/api/listings/36', 2, null, { id: '36' });
const pausedOwner = await call(listingApi.onRequestGet, 'GET', '/api/listings/36', 1, null, { id: '36' });
check('/api/listings/:id a paused listing is a 404 for others, still there for its owner', r.status === 404 && pausedB.status === 404 && pausedOwner.status === 200);
r = await call(listingApi.onRequestGet, 'GET', '/api/listings/32', null, null, { id: '32' });
check("/api/listings/:id a suspended owner's listing is a 404", r.status === 404 && !shows(r.text, 6));
r = await call(listingApi.onRequestGet, 'GET', '/api/listings/31', null, null, { id: '31' });
check('/api/listings/:id an active listing still loads for anonymous visitors', r.status === 200 && r.json.listing.title === 'Nice home');

// --- A contact share shows the phone only while that home is still open or awarded ---
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, status) VALUES (21, 1, 'Chula Vista', 'CA', '91913', 'House', 3, 2, 800000, 'closed')").run();
sqlite.prepare('INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (21, 1, 4)').run();
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 4, null, { id: '1' });
check('a share on a CLOSED home no longer shows that agent the phone', r.status === 200 && !shows(r.text, 1), r.text.slice(0, 160));
r = await call(pages.listing.onRequestGet, 'GET', '/listing/30', 4, null, { id: '30' });
check('...on the public pages either', r.status === 200 && !shows(r.text, 1));
sqlite.prepare("UPDATE pre_listings SET status = 'awarded' WHERE id = 21").run();
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 4, null, { id: '1' });
check('...while an awarded home still counts', r.status === 200 && r.json.user.phone === PHONES[1]);
sqlite.prepare("UPDATE pre_listings SET status = 'closed' WHERE id = 20").run();
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 3, null, { id: '1' });
check('...and closing the shared home hides it from that agent again', r.status === 200 && !shows(r.text, 1));
sqlite.prepare("UPDATE pre_listings SET status = 'open' WHERE id = 20").run();
sqlite.prepare('DELETE FROM contact_shares WHERE pre_listing_id = 21').run();
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 3, null, { id: '1' });
const sharedBefore = r.status === 200 && r.json.user.phone === PHONES[1];
sqlite.prepare("UPDATE agent_profiles SET status = 'rejected' WHERE user_id = 3").run();
r = await call(usersApi.onRequestGet, 'GET', '/api/users/1', 3, null, { id: '1' });
check('...and an agent who is no longer approved stops seeing it too', sharedBefore && r.status === 200 && !shows(r.text, 1), r.text.slice(0, 160));
sqlite.prepare("UPDATE agent_profiles SET status = 'approved' WHERE user_id = 3").run();

// --- A suspended agent's intro video and portfolio photos aren't served ---
const agentVideoApi = await mod('functions/api/agent-video/[id].js');
const agentPhotoApi = await mod('functions/api/agent-photos/[id].js');
sqlite.prepare("UPDATE agent_profiles SET video_r2_key = 'v/9', video_content_type = 'video/mp4' WHERE user_id = 9").run();
sqlite.prepare("INSERT INTO agent_portfolio_photos (id, agent_user_id, r2_key, content_type) VALUES (900, 9, 'p/9', 'image/jpeg')").run();
// (No storage in this test: an active agent's media gets past the account check and stops at "not configured", so
// the error text shows which check answered.)
sqlite.prepare("UPDATE agent_profiles SET video_r2_key = 'v/7', video_content_type = 'video/mp4' WHERE user_id = 7").run();
sqlite.prepare("INSERT INTO agent_portfolio_photos (id, agent_user_id, r2_key, content_type) VALUES (700, 7, 'p/7', 'image/jpeg')").run();
r = await call(agentVideoApi.onRequestGet, 'GET', '/api/agent-video/9', null, null, { id: '9' });
let r2 = await call(agentPhotoApi.onRequestGet, 'GET', '/api/agent-photos/900', null, null, { id: '900' });
check("a suspended agent's intro video and portfolio photos are a 404 (as if they don't exist)",
  r.status === 404 && r.json.error === 'No video for this agent.' && r2.status === 404 && r2.json.error === 'Photo not found.', `${r.text} ${r2.text}`);
r = await call(agentVideoApi.onRequestGet, 'GET', '/api/agent-video/7', null, null, { id: '7' });
r2 = await call(agentPhotoApi.onRequestGet, 'GET', '/api/agent-photos/700', null, null, { id: '700' });
check("...while an active agent's media gets past that check", /not configured/.test(r.json.error) && /not configured/.test(r2.json.error), `${r.text} ${r2.text}`);

// --- The legacy /profile.html page (page-profile.js) against the real API ---
async function renderLegacy(profileId, who) {
  const elements = {};
  const el = (id) => (elements[id] ||= { id, innerHTML: '', dataset: {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {} });
  const head = { children: [], appendChild(n) { this.children.push(n); } };
  const routes = { '/api/me': [meApi.onRequestGet, {}], [`/api/users/${profileId}`]: [usersApi.onRequestGet, { id: String(profileId) }] };
  const sandbox = {
    console: { log() {}, error() {}, warn() {} }, navigator: {}, URLSearchParams, setTimeout, clearTimeout, atob, btoa,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      const [handler, params] = routes[url] || [];
      if (!handler) return new Response('{}', { status: 404 });
      const res = await call(handler, 'GET', url, who, null, params);
      return new Response(res.text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
    },
    document: {
      head, body: el('body'), documentElement: el('html'), readyState: 'complete', addEventListener() {},
      getElementById: el, querySelector: () => null, querySelectorAll: () => [],
      createElement: (tag) => ({ tag, setAttribute() {}, classList: { add() {} }, style: {}, dataset: {} }),
    },
    window: { location: { search: `?id=${profileId}`, href: '', pathname: '/profile.html', hash: '' }, matchMedia: () => ({ matches: false }), addEventListener() {} },
  };
  sandbox.window.document = sandbox.document;
  sandbox.location = sandbox.window.location;
  vm.createContext(sandbox);
  for (const f of ['client.js', 'page-profile.js']) vm.runInContext(readFileSync(`${root}/${f}`, 'utf8'), sandbox, { filename: f });
  for (let i = 0; i < 50 && !/Recent Activity|empty-state">[^L]/.test(el('profileContent').innerHTML); i++) await new Promise(res => setTimeout(res, 5));
  return { html: el('profileContent').innerHTML, head };
}
let legacy = await renderLegacy(1, null);
check("legacy /profile.html anonymous: no phone, message-through-Amico text instead", /Ana Owner/.test(legacy.html) && !shows(legacy.html, 1) && /Sign up to message Ana Owner directly through Amico Haus/.test(legacy.html), legacy.html.slice(0, 300));
check('legacy /profile.html adds noindex', legacy.head.children.some(n => n.name === 'robots' && n.content === 'noindex'));
legacy = await renderLegacy(1, 2);
check('legacy /profile.html another user: no phone', /Ana Owner/.test(legacy.html) && !shows(legacy.html, 1) && /Message Ana Owner directly through Amico Haus/.test(legacy.html));
legacy = await renderLegacy(1, 1);
check('legacy /profile.html their own: their phone with the "private unless" note', shows(legacy.html, 1) && /Private unless you turn on &#39;Show my phone number&#39;|Private unless you turn on 'Show my phone number'/.test(legacy.html), legacy.html.slice(0, 600));
legacy = await renderLegacy(5, null);
check('legacy /profile.html phone_public = 1: shown', shows(legacy.html, 5));

// The phone edit box on the server-rendered page (profile-actions.js) carries the note.
const actions = readFileSync(`${root}/profile-actions.js`, 'utf8');
check("profile-actions.js: the phone edit box says it's private unless turned on", actions.includes("Private unless you turn on 'Show my phone number' in You're in Control."));

// Changing a public number keeps it public; removing it turns "Show my phone number" off, so a number added later
// starts private again.
const pub5 = () => sqlite.prepare('SELECT phone, phone_public FROM users WHERE id = 5').get();
r = await call(meApi.onRequestPut, 'PUT', '/api/me', 5, { phone: '(619) 555-0155' });
check('a new number keeps "Show my phone number" on', r.status === 200 && pub5().phone_public === 1, JSON.stringify(pub5()));
r = await call(meApi.onRequestPut, 'PUT', '/api/me', 5, { phone: '' });
check('removing the number turns "Show my phone number" off', r.status === 200 && pub5().phone_public === 0, JSON.stringify(pub5()));
r = await call(meApi.onRequestPut, 'PUT', '/api/me', 5, { phone: '(619) 555-0105' });
check('...so a number added back starts private', r.status === 200 && pub5().phone_public === 0 && pub5().phone === '(619) 555-0105', JSON.stringify(pub5()));

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
