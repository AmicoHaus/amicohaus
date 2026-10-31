// Runs the real handlers for batch B2 (Bring Your Reviews, Brag Cards and the live badge) against an in-memory SQLite
// stand-in for D1. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/agent-growth-test.mjs <projectRoot>
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
const env = { DB };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (!ok) failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const call = async (handler, method, path, who, params, body) => {
  const request = new Request(`https://amicohaus.com${path}`, { method, headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const pending = [];
  const res = await handler({ request, env, params: params || {}, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, text: type.includes('json') ? null : await res.text() };
};
console.log = () => {};

// 1 admin, 2 approved agent, 3 pending agent, 4-8 past clients, 9 demo, 10 demo agent
for (const [id, role, email] of [[1, 'admin', 'a@example.test'], [2, 'user', 'agent@example.test'], [3, 'user', 'pending@example.test'],
  [4, 'user', 'c4@example.test'], [5, 'user', 'c5@example.test'], [6, 'user', 'c6@example.test'], [7, 'user', 'c7@example.test'], [8, 'user', 'c8@example.test'],
  [9, 'user', 'd9@demo.amicohaus.local'], [10, 'user', 'd10@demo.amicohaus.local']]) {
  sqlite.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(id, email, id === 2 ? 'Jordan <b>Ellis</b>' : `User ${id}`, role);
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(`t${id}`, id);
}
sqlite.prepare("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (2, 'approved', '01234567', 'Bay Realty'), (3, 'pending', '07654321', 'X'), (10, 'approved', '01111111', 'Demo')").run();

const invite = await mod('functions/api/agents/review-invite.js');
const reviews = await mod('functions/api/past-client-reviews/index.js');
const adminList = await mod('functions/api/admin/past-client-reviews/index.js');
const adminOne = await mod('functions/api/admin/past-client-reviews/[id].js');
const bragApi = await mod('functions/api/agents/brag.js');
const badge = await mod('functions/badge/[file].js');
const profile = await mod('functions/profile/[id].js');
const thisYear = new Date().getFullYear();

// --- The agent's review link ---
let r = await call(invite.onRequestPut, 'PUT', '/x', 3, null, { fromYear: 2020, toYear: 2023, attest: true });
check('a pending agent has no review link', r.status === 403);
r = await call(invite.onRequestPut, 'PUT', '/x', 2, null, { fromYear: 2020, toYear: 2023 });
check('the link needs the "every client, no incentives" promise', r.status === 400 && /every client/.test(r.json.error));
r = await call(invite.onRequestPut, 'PUT', '/x', 2, null, { fromYear: 2024, toYear: 2020, attest: true });
check('years must be in order and not in the future', r.status === 400);
r = await call(invite.onRequestPut, 'PUT', '/x', 2, null, { fromYear: 2020, toYear: thisYear, attest: true });
check('an approved agent gets a link for the years they pick', r.status === 200 && /^\/past-client-review\?t=[a-z0-9]{8,}$/.test(r.json.link), JSON.stringify(r.json));
const token = r.json.link.split('t=')[1];

// --- The review page ---
r = await call(reviews.onRequestGet, 'GET', `/x?t=${token}`, null);
check('anyone with the link sees who it is for and the years', r.status === 200 && r.json.agent.name === 'Jordan <b>Ellis</b>' && r.json.fromYear === 2020 && r.json.signedIn === false);
r = await call(reviews.onRequestGet, 'GET', '/x?t=nope', null);
check('a wrong link says it is no longer active', r.status === 404);
const good = { token, rating: 5, clientSide: 'sold', saleYear: 2022, saleCity: 'Chula Vista', saleAddress: '123 Example St', comment: 'Great pricing plan.' };
r = await call(reviews.onRequestPost, 'POST', '/x', null, null, good);
check('posting a review takes an account', r.status === 401);
r = await call(reviews.onRequestPost, 'POST', '/x', 2, null, good);
check('an agent cannot review themselves', r.status === 400);
r = await call(reviews.onRequestPost, 'POST', '/x', 4, null, { ...good, saleYear: 2019 });
check("a year outside the agent's chosen years is refused", r.status === 400);
r = await call(reviews.onRequestPost, 'POST', '/x', 4, null, { ...good, saleAddress: '' });
check('the street address is required (it stays private)', r.status === 400);
r = await call(reviews.onRequestPost, 'POST', '/x', 9, null, good);
check('demo accounts cannot leave reviews', r.status === 400);
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, status) VALUES (60, 5, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 500000, 'awarded')").run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 60, 2, 'x', 2, 'accepted')").run();
r = await call(reviews.onRequestPost, 'POST', '/x', 5, null, good);
check('someone who hired the agent on Amico Haus reviews them there instead', r.status === 400 && /hired this agent on Amico Haus/.test(r.json.error), JSON.stringify(r.json));
sqlite.prepare("DELETE FROM service_bids WHERE request_id = 60").run();
sqlite.prepare("DELETE FROM pre_listings WHERE id = 60").run();
r = await call(reviews.onRequestPost, 'POST', '/x', 4, null, good);
check('a past client posts a review', r.status === 201);
r = await call(reviews.onRequestPost, 'POST', '/x', 4, null, good);
check('one review per person per agent', r.status === 400 && /already reviewed/.test(r.json.error));
check('the agent is told', sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 2 AND body LIKE 'A past client left you a review%'").get().n === 1);
check('the admin heads-up is marked sent for this agent today', !!sqlite.prepare('SELECT review_alert_sent_at FROM agent_profiles WHERE user_id = 2').get().review_alert_sent_at);
r = await call(reviews.onRequestGet, 'GET', `/x?t=${token}`, 4);
check('the page knows they already reviewed', r.json.alreadyReviewed === true && r.json.signedIn === true);
for (const [who, rating] of [[5, 4], [6, 2]]) await call(reviews.onRequestPost, 'POST', '/x', who, null, { ...good, rating, comment: `Review from ${who}` });

// Daily limit for one reviewer across agents: give user 7 three reviews of other agents first.
sqlite.prepare("INSERT INTO users (id, email, display_name) VALUES (11, 'o11@example.test', 'Other 11'), (12, 'o12@example.test', 'Other 12'), (13, 'o13@example.test', 'Other 13')").run();
for (const a of [11, 12, 13]) sqlite.prepare("INSERT INTO past_client_reviews (agent_user_id, reviewer_user_id, rating, client_side, sale_year, sale_city, sale_address) VALUES (?, 7, 5, 'sold', 2021, 'X', 'Y St 1')").run(a);
r = await call(reviews.onRequestPost, 'POST', '/x', 7, null, good);
check('one account can leave only a few past-client reviews a day', r.status === 400 && /come back tomorrow/.test(r.json.error));

// --- Profile: its own section, labeled, never the address; name escaped ---
r = await call(profile.onRequestGet, 'GET', '/profile/2', null, { id: '2' });
const html = r.text;
check('the profile shows a separate "Past clients, outside Amico Haus" section', /Past clients, outside Amico Haus/.test(html) && /Reviews from homeowners who hired them on Amico Haus/.test(html));
check('it shows the year and city but never the street address', /Sold a home in 2022, Chula Vista/.test(html) && !/123 Example St/.test(html));
check('the past-client average sits with the not-verified, self-reported stats', /Past clients \(outside Amico, not verified\)/.test(html) && /★ 3\.7 \(3\)/.test(html) && /from 2020 to \d{4}/.test(html), (html.match(/Past clients[^<]{0,80}/g) || []).join(' | '));

// --- Admin moderation ---
const reviewId = sqlite.prepare("SELECT id FROM past_client_reviews WHERE reviewer_user_id = 6").get().id;
r = await call(adminOne.onRequestPut, 'PUT', '/x', 2, { id: String(reviewId) }, { action: 'remove', reason: 'x' });
check('the agent cannot remove a review', r.status === 403);
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: String(reviewId) }, { action: 'remove' });
check('an admin removal needs a reason', r.status === 400);
sqlite.prepare("INSERT INTO past_client_reviews (agent_user_id, reviewer_user_id, rating, client_side, sale_year, sale_city, sale_address) VALUES (1, 4, 1, 'sold', 2021, 'X', 'Y St 2')").run();
const ownId = sqlite.prepare('SELECT id FROM past_client_reviews WHERE agent_user_id = 1').get().id;
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: String(ownId) }, { action: 'remove', reason: 'unfair' });
check("an admin can't remove a review of their own agent profile", r.status === 403 && sqlite.prepare('SELECT status FROM past_client_reviews WHERE id = ?').get(ownId).status === 'published');
r = await call(adminOne.onRequestPut, 'PUT', '/x', 1, { id: String(reviewId) }, { action: 'remove', reason: 'Not about the agent' });
check('an admin can remove one, and it is logged', r.status === 200 && sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'remove_past_client_review'").get().n === 1);
r = await call(profile.onRequestGet, 'GET', '/profile/2', null, { id: '2' });
check('a removed review leaves the profile and the average', !/Review from 6/.test(r.text) && /★ 4\.5 \(2\)/.test(r.text));
r = await call(adminList.onRequestGet, 'GET', '/x', 1);
check('the admin list shows the private address and removed reviews', r.json.reviews.some(x => x.saleAddress === '123 Example St') && r.json.reviews.some(x => x.status === 'removed') && r.json.more === false);
const oldest = r.json.reviews[r.json.reviews.length - 1].id;
r = await call(adminList.onRequestGet, 'GET', `/x?before=${oldest}`, 1);
check('older reviews page back with ?before=', r.status === 200 && r.json.reviews.every(x => x.id < oldest));
r = await call(adminList.onRequestGet, 'GET', '/x', 2);
check('only admins see that list', r.status === 403);

// --- Turning the link off ---
r = await call(invite.onRequestDelete, 'DELETE', '/x', 2);
check('turning the link off keeps the reviews', r.json.link === null && r.json.reviewCount === 2);
r = await call(reviews.onRequestGet, 'GET', `/x?t=${token}`, null);
check('...and the old link stops working', r.status === 404);

// --- Brag Card stats and the badge ---
r = await call(bragApi.onRequestGet, 'GET', '/x', 2);
check('no stats yet means nothing to brag about', r.status === 200 && r.json.brag.items.length === 0, JSON.stringify(r.json));
await call(reviews.onRequestPost, 'POST', '/x', 8, null, good).catch(() => {});
sqlite.prepare("INSERT INTO past_client_reviews (agent_user_id, reviewer_user_id, rating, client_side, sale_year, sale_city, sale_address) VALUES (2, 8, 5, 'bought', 2021, 'Bonita', 'Z St 9')").run();
sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, beds, baths, asking_price, status) VALUES (50, 4, 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 500000, 'awarded')").run();
sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, status) VALUES ('pre_listing', 50, 2, 'x', 2, 'accepted')").run();
r = await call(bragApi.onRequestGet, 'GET', '/x', 2);
const items = r.json.brag.items.join(' | ');
check('Amico Haus records only: hires yes, unverified past-client ratings never', /Hired 1 time on Amico Haus/.test(items) && !/past clients/.test(items) && !/#1/.test(items), items);
check('the card carries the DRE number, brokerage and a date', r.json.brag.licenseNumber === '01234567' && r.json.brag.brokerage === 'Bay Realty' && /\d{4}/.test(r.json.brag.asOf));
r = await call(bragApi.onRequestGet, 'GET', '/x', 3);
check('pending agents have no Brag Card', r.status === 403);
r = await call(badge.onRequestGet, 'GET', '/badge/2.svg', null, { file: '2.svg' });
check('the live badge is an SVG with the stats, DRE number and an escaped name', r.status === 200 && /image\/svg\+xml/.test(r.headers.get('Content-Type')) && /DRE #01234567/.test(r.text) && r.text.includes('Jordan &lt;b&gt;Ellis&lt;/b&gt;') && !r.text.includes('<b>'), r.text.slice(0, 200));
check('nothing in the badge can run', /default-src 'none'/.test(r.headers.get('Content-Security-Policy')) && !/<script/i.test(r.text));
sqlite.prepare("UPDATE agent_profiles SET brokerage_name = 'The Very Long Name Realty Group of Southern California and the Greater San Diego Bay Area, Inc.' WHERE user_id = 2").run();
sqlite.prepare("UPDATE users SET display_name = 'Maria Guadalupe Fernandez-Rodriguez de la Cruz Montenegro' WHERE id = 2").run();
r = await call(badge.onRequestGet, 'GET', '/badge/2.svg', null, { file: '2.svg' });
const badgeText = r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('a long name and brokerage wrap onto more lines instead of being cut', badgeText.includes('Montenegro') && badgeText.includes('Area, Inc.') && /From Amico Haus records, as of/.test(badgeText), badgeText.slice(0, 300));
r = await call(badge.onRequestGet, 'GET', '/badge/3.svg', null, { file: '3.svg' });
const r10 = await call(badge.onRequestGet, 'GET', '/badge/10.svg', null, { file: '10.svg' });
const rBad = await call(badge.onRequestGet, 'GET', '/badge/x.svg', null, { file: '../x.svg' });
check('no badge for pending or demo agents, or a bad path', r.status === 404 && r10.status === 404 && rBad.status === 404);

const signup = await mod('functions/api/auth/signup.js');
let sentMail = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { sentMail = JSON.parse(opts.body); return new Response('{}', { status: 200 }); };
const signupCall = (body) => signup.onRequestPost({ request: new Request('https://amicohaus.com/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.77' }, body: JSON.stringify(body) }), env: { DB, RESEND_API_KEY: 'k' }, waitUntil() {} });
await signupCall({ displayName: 'New Reviewer', email: 'newrev@example.test', next: '/past-client-review?t=abcdefgh12345678' });
check('signing up from a review link carries it in the emailed link', sentMail && sentMail.text.includes('&next=%2Fpast-client-review%3Ft%3Dabcdefgh12345678'), sentMail && sentMail.text.slice(0, 200));
await signupCall({ displayName: 'Other Person', email: 'other@example.test', next: 'https://evil.example/' });
check('...and nothing else can ride along', sentMail && !sentMail.text.includes('next='));
globalThis.fetch = realFetch;

console.log = realLog;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
