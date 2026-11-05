// Batch L1.1 "compliance fixes" (compliance report 2: F1-F20, Y1-Y6, plus the L1 recheck leftovers). Runs the real
// route handlers against an in-memory SQLite stand-in for D1 (schema.sql), with a stubbed fetch (no email goes out,
// every email is captured) and a fake R2 bucket, then checks the copy on the static pages and in the app's source.
// Covers: unlisted test / reviewer accounts (sitemap, public counts, directory, noindex), the authz target guard and
// the growth report's wrangler batches, dual agency wording, license/broker changes after approval, rentals and
// source of income, report paths, the operator label, agent identity on offers, privacy wording, Terms re-accept,
// FinderMine investment terms, payment widget / escrow / footers / email footer / CSP / Press, approved-agent-only
// client posts + bulk, operator parity on pre-listings, no founding spot for the operator, the content license and
// robots.txt, Duplicate on a paused listing, review reveal while a report is open, blocks closing trade requests,
// and the notice on an admin's direct listing pause.
// Usage: node --disable-warning=ExperimentalWarning tools/compliance2-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = process.argv[2];
if (!root) { console.error('Usage: node --disable-warning=ExperimentalWarning tools/compliance2-test.mjs <projectRoot>'); process.exit(2); }
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
const PHOTOS = {
  async put(key, body) { r2.set(key, body); },
  async get(key) { return r2.has(key) ? { body: new Uint8Array([1, 2, 3]) } : null; },
  async delete(keys) { for (const k of [].concat(keys)) r2.delete(k); },
};
const env = { DB, RESEND_API_KEY: 'test-key', PHOTOS };
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
const read = (p) => readFileSync(`${root}/${p}`, 'utf8');
const readIf = (p) => (existsSync(`${root}/${p}`) ? read(p) : '');
let failed = 0;
let passed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + String(detail).slice(0, 400)}`); };
// A section whose module isn't there yet (another builder's file) fails its checks instead of stopping the run.
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran without crashing`, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); } };
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
  const text = await res.text();
  let json = null;
  if (type.includes('json')) { try { json = JSON.parse(text); } catch { json = null; } }
  return { status: res.status, headers: res.headers, text, json };
};
const ctx = () => { const pending = []; return { c: { env, request: new Request('https://amicohaus.com/x'), waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } }, done: () => Promise.all(pending) }; };
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const notes = (uid, like) => q('SELECT body FROM notifications WHERE user_id = ? AND body LIKE ? ORDER BY id', uid, like);
const NOINDEX_META = '<meta name="robots" content="noindex">';
const robotsHeader = (r) => r.headers.get('X-Robots-Tag') || '';
console.log = () => {};

// ---------------- Exact strings (spec section 2, C5) ----------------
const DUAL = "One agent for both homes, or two agents under the same brokerage, is dual agency and needs both owners' written consent. Each of you can choose your own agent.";
const OPERATOR_LABEL = 'Platform operator: runs Amico Haus';
const OWNER_CONFIRM_TEXT = "I own this home, or I'm its trustee, executor or attorney-in-fact, or I'm a California-licensed agent with the owner's written permission to post it here.";
const OWNER_CONFIRM_BULK_TEXT = "For every home in this file: I own it, or I'm its trustee, executor or attorney-in-fact, or I'm a California-licensed agent with the owner's written permission to post it here.";
const OWNER_CONFIRM_REQUIRED = "Please confirm you own this home or have the owner's written permission to post it.";
const CLEAR_COOP_NOTE = "Agents: if this home is under your listing agreement, posting it here counts as public marketing under your MLS's Clear Cooperation rule (CRMLS Rule 7.9), which can require MLS entry within one business day. Check your MLS rules before posting.";
const AGENT_TEXT_NOTE = 'Keep it to your work and the homes: no talk about schools, crime or who lives in an area (fair housing).';
const HOME_TEXT_NOTE = 'Describe the home, not who should live there or who lives nearby.';
const OFFER_MESSAGE_NOTE = 'Stick to price, terms and timing. Leave out personal details like family, religion, age or background.';
const OFFER_OWNER_NOTE = 'Weigh offers on price, terms and timing only, not on who the buyer is (fair housing).';
const SOI_ERROR = "Listings can't limit renters by source of income, such as housing vouchers (California law).";
const SOI_FORM_NOTE = 'California fair housing law covers rentals, including a renter\'s source of income (such as a Section 8 or VASH voucher). Don\'t post limits like "no vouchers."';
const SOI_PAGE_LINE = "Under California law, a renter's source of income (including a Section 8 or VASH voucher) is protected.";
const INVESTMENT_ERROR = "FinderMine posts can't include investment terms (returns, minimums, investors, shares). Describe the project and the builder, partner or co-buyer you're looking for.";
const FOUNDING_OPERATOR_LINE = 'The account that runs Amico Haus never takes a founding spot.';
const EMAIL_POSTAL_LINE = 'Amico Haus · Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West, 2300 Boswell Rd, Suite 100, Chula Vista, CA 91914';
const FOOTER_LEGAL_APP = '<p class="footer-legal"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>';
const MC_NO_LENDER_CLOSE = 'Rough math from the numbers you type: not a loan offer, pre-qualification, or guarantee of terms. Excludes property taxes, insurance, and HOA dues.';
const TRADE_CONFIRM_TEXT = "Confirm this trade request? Approved agents who serve your area can then see it and send proposals. One agent for both homes, or two agents under the same brokerage, is dual agency and needs both owners' written consent; each of you can choose your own agent.";
const REPORT_CONCERN_LINK = '<a class="link-btn" href="/contact">Report a concern</a>';

// ---------------- People ----------------
// 1 homeowner, 2 authz test agent (@resend.dev), 3 Google Play reviewer, 4 demo, 5 approved agent G, 6 homeowner buyer,
// 7 homeowner B, 8 pure admin (no agent profile), 9 operator (admin + approved agent), 10 pending applicant,
// 11 an admin who applies (founding test), 12 a new agent applicant, 13 a member who files reports.
const user = (id, name, email = `u${id}@example.test`, role = 'user') => {
  run('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)', id, email, name, role);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
user(1, 'Hana Home'); user(2, 'Authz Agent', 'delivered+authz-a-x@resend.dev'); user(3, 'Play Reviewer', 'playstore-review@amicohaus.com');
user(4, 'Demo Owner', 'd4@demo.amicohaus.local'); user(5, 'Gina Agent'); user(6, 'Casey Buyer'); user(7, 'Blake Partner');
user(8, 'Rudy Admin', 'u8@example.test', 'admin'); user(9, 'Rudy Operator', 'u9@example.test', 'admin'); user(10, 'Pat Pending');
user(11, 'Opal Admin', 'u11@example.test', 'admin'); user(12, 'Nora New'); user(13, 'Mo Member');
const agentRow = (id, status, lic, brok, zips = '["92104"]') => run(
  "INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, license_verified, license_verified_at, reviewed_at, service_zips_json, notify_new_requests) VALUES (?, ?, ?, ?, 1, '2026-10-30 18:00:00', '2026-10-29 17:00:00', ?, 1)",
  id, status, lic, brok, zips);
agentRow(2, 'approved', '09999901', 'Authz Realty One'); agentRow(5, 'approved', '01234567', 'Pacific Realty'); agentRow(9, 'approved', '02257808', 'Coldwell Banker West');
for (const [zip, lat, lng] of [['91910', 32.637, -117.06], ['91911', 32.607, -117.05], ['91913', 32.62, -116.99], ['91914', 32.66, -116.96], ['91915', 32.62, -116.95], ['91902', 32.67, -117.01], ['92104', 32.74, -117.13]]) {
  run('INSERT OR IGNORE INTO zip_codes (zip, lat, lng) VALUES (?, ?, ?)', zip, lat, lng);
}
const L = (id, uid, extra = {}) => {
  run(`INSERT INTO listings (id, user_id, title, city, state, property_type, beds, baths, estimated_value, price_tier, is_rental, rent_amount, description)
       VALUES (?, ?, ?, 'Chula Vista', 'CA', 'Single Family Home', 3, 2, ?, '600k-1m', ?, ?, ?)`,
    id, uid, extra.title || `Home ${id}`, extra.value || 700000, extra.rental ? 1 : 0, extra.rent || 0, extra.description || '');
  if (!extra.rental) run(`INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (?, 'Chula Vista', 'Any', 0, 0, 0, 1000000)`, id);
};
const trade = { city: 'Chula Vista', state: 'CA', neighborhood: 'Eastlake', propertyType: 'Condo', estimatedValue: 750000, beds: 2, baths: 2,
  locations: 'San Diego', desiredType: 'Any', priceMin: 0, priceMax: 2000000, minBeds: 0, minBaths: 0 };
const rental = { isRental: true, city: 'Chula Vista', state: 'CA', propertyType: 'Condo', estimatedValue: 600000, beds: 2, baths: 2, rentAmount: 3000 };

const listingsLib = await mod('functions/_lib/listings.js').catch(() => null);
const listingsApi = await mod('functions/api/listings/index.js');
const listingOne = await mod('functions/api/listings/[id].js');
const bulkApi = await mod('functions/api/listings/bulk.js');
const listingPage = await mod('functions/listing/[id].js');
const profilePage = await mod('functions/profile/[id].js');
const augPage = await mod('functions/augmented-home/[id].js');
const greenPage = await mod('functions/green-home/[id].js');
const projectPage = await mod('functions/project/[id].js');

// ===================== S1 (F1, Y2): unlisted accounts =====================
await section('S1', async () => {
  L(101, 1); L(102, 2); L(103, 3); L(104, 4);
  for (const [id, uid] of [[201, 2], [202, 1]]) run(`INSERT INTO augmented_homes (id, user_id, title, city, state, property_type, beds, baths, asking_price, adaptations_json) VALUES (?, ?, 'Ramp home', 'Chula Vista', 'CA', 'Single Family Home', 3, 2, 650000, '["ramp"]')`, id, uid);
  for (const [id, uid] of [[301, 2], [302, 1]]) run(`INSERT INTO green_homes (id, user_id, title, city, state, property_type, beds, baths, asking_price) VALUES (?, ?, 'Solar home', 'Chula Vista', 'CA', 'Single Family Home', 3, 2, 680000)`, id, uid);
  const sitemap = await mod('functions/sitemap.xml.js');
  let r = await call(sitemap.onRequestGet, 'GET', '/sitemap.xml', null);
  check('sitemap: a real listing is in', r.status === 200 && r.text.includes('/listing/101<'), r.text.slice(0, 200));
  check('sitemap: the @resend.dev test listing, the reviewer sample and the demo listing are out', !r.text.includes('/listing/102<') && !r.text.includes('/listing/103<') && !r.text.includes('/listing/104<'));
  check('sitemap: the test agent profile and its AugmentedHomes/GreenHomes pages are out; a real agent is in',
    !r.text.includes('/profile/2<') && !r.text.includes('/augmented-home/201<') && !r.text.includes('/green-home/301<') && r.text.includes('/profile/5<') && r.text.includes('/augmented-home/202<') && r.text.includes('/green-home/302<'));
  const stats = await mod('functions/api/public-stats.js');
  r = await call(stats.onRequestGet, 'GET', '/api/public-stats', null);
  check('public-stats: listings counts only the real listing (test, reviewer and demo left out)', r.status === 200 && r.json.listings === 1, r.text);
  check('public-stats: agents leaves out the @resend.dev test agent (5 and the operator 9 count)', r.json && r.json.agents === 2, r.text);
  const directory = await mod('functions/api/directory.js');
  r = await call(directory.onRequestGet, 'GET', '/api/directory?limit=60', null);
  const ids = (r.json && r.json.listings || []).map(l => l.id);
  check('/api/directory keeps the authz test listing (its suite checks it) but not the reviewer sample or the demo', ids.includes(101) && ids.includes(102) && !ids.includes(103) && !ids.includes(104), JSON.stringify(ids));
  r = await call(listingPage.onRequestGet, 'GET', '/listing/103', null, { id: '103' });
  check("the reviewer's listing still opens by direct link, noindex (meta + X-Robots-Tag)", r.status === 200 && r.text.includes(NOINDEX_META) && /noindex/.test(robotsHeader(r)), `${r.status} ${robotsHeader(r)}`);
  r = await call(listingPage.onRequestGet, 'GET', '/listing/102', null, { id: '102' });
  check('a @resend.dev test listing page is noindex too', r.status === 200 && r.text.includes(NOINDEX_META) && /noindex/.test(robotsHeader(r)));
  r = await call(listingPage.onRequestGet, 'GET', '/listing/101', null, { id: '101' });
  check('a real listing page has neither', r.status === 200 && !r.text.includes(NOINDEX_META) && !/noindex/.test(robotsHeader(r)), robotsHeader(r));
  r = await call(profilePage.onRequestGet, 'GET', '/profile/2', null, { id: '2' });
  check("the test agent's profile page is noindex (meta + header)", r.status === 200 && r.text.includes(NOINDEX_META) && /noindex/.test(robotsHeader(r)), `${r.status}`);
  r = await call(profilePage.onRequestGet, 'GET', '/profile/5', null, { id: '5' });
  check("a real agent's profile page stays indexable", r.status === 200 && !r.text.includes(NOINDEX_META) && !/noindex/.test(robotsHeader(r)));
  r = await call(augPage.onRequestGet, 'GET', '/augmented-home/201', null, { id: '201' });
  check("the test account's AugmentedHomes page is noindex", r.status === 200 && r.text.includes(NOINDEX_META) && /noindex/.test(robotsHeader(r)), `${r.status}`);
  r = await call(greenPage.onRequestGet, 'GET', '/green-home/301', null, { id: '301' });
  check("the test account's GreenHomes page is noindex", r.status === 200 && r.text.includes(NOINDEX_META) && /noindex/.test(robotsHeader(r)), `${r.status}`);
  r = await call(augPage.onRequestGet, 'GET', '/augmented-home/202', null, { id: '202' });
  check('a real AugmentedHomes page stays indexable', r.status === 200 && !r.text.includes(NOINDEX_META));
  const util = await mod('functions/_lib/util.js');
  check('util: TEST_EMAIL_PATTERN, REVIEW_SAMPLE_EMAIL and unlistedOwnerSql (C4)', util.TEST_EMAIL_PATTERN === '%@resend.dev' && util.REVIEW_SAMPLE_EMAIL === 'playstore-review@amicohaus.com'
    && util.unlistedOwnerSql('users.email') === "(lower(users.email) LIKE '%@resend.dev' OR lower(users.email) = 'playstore-review@amicohaus.com')");
});

// ===================== S1b (F1): the authz suite needs an explicit, non-production target =====================
const require = createRequire(import.meta.url);
await section('S1b', async () => {
  const { resolveAuthzTarget } = require(`${root}/tools/authz-target.js`);
  const throws = (e, o) => { try { resolveAuthzTarget(e, o); return false; } catch { return true; } };
  const PREVIEW = 'https://authz-preview.amicohaus.pages.dev';
  check('authz target: no env at all is refused', throws({}));
  check('authz target: AUTHZ_BASE alone is refused (AUTHZ_D1 required)', throws({ AUTHZ_BASE: PREVIEW }));
  check('authz target: amicohaus.com is refused', throws({ AUTHZ_BASE: 'https://amicohaus.com', AUTHZ_D1: 'amicohaus-test' }) && throws({ AUTHZ_BASE: 'https://www.amicohaus.com/', AUTHZ_D1: 'amicohaus-test' }));
  check('authz target: amicohaus.com with a trailing dot, a port or a subdomain is refused', throws({ AUTHZ_BASE: 'https://AmicoHaus.com.', AUTHZ_D1: 'amicohaus-test' }) && throws({ AUTHZ_BASE: 'https://amicohaus.com:443/', AUTHZ_D1: 'amicohaus-test' }) && throws({ AUTHZ_BASE: 'https://app.amicohaus.com', AUTHZ_D1: 'amicohaus-test' }) && throws({ AUTHZ_BASE: 'https://amicohaus.pages.dev', AUTHZ_D1: 'amicohaus-test' }));
  check('authz target: the production database is refused even on a preview URL', throws({ AUTHZ_BASE: PREVIEW, AUTHZ_D1: 'amicohaus' }));
  check('authz target: the production photo bucket is refused', throws({ AUTHZ_BASE: PREVIEW, AUTHZ_D1: 'amicohaus-test', AUTHZ_R2: 'amicohaus-photos' }, { needR2: true }));
  let t = null; try { t = resolveAuthzTarget({ AUTHZ_BASE: PREVIEW + '/', AUTHZ_D1: 'amicohaus-test' }); } catch { /* fails below */ }
  check('authz target: a preview URL + amicohaus-test works, base without a trailing slash', !!t && t.base === PREVIEW && t.d1 === 'amicohaus-test', JSON.stringify(t));
  t = null; try { t = resolveAuthzTarget({ AUTHZ_BASE: 'https://amicohaus.com', AUTHZ_D1: 'amicohaus', AUTHZ_ALLOW_PROD: '1' }); } catch { /* fails below */ }
  check('authz target: AUTHZ_ALLOW_PROD=1 lets production through (emergency only)', !!t && t.base === 'https://amicohaus.com');
  check('authz target: a database name with shell characters is refused', throws({ AUTHZ_BASE: PREVIEW, AUTHZ_D1: 'x;rm' }) && throws({ AUTHZ_BASE: PREVIEW, AUTHZ_D1: 'a b' }));
  check('authz target: http:// is refused', throws({ AUTHZ_BASE: 'http://authz-preview.amicohaus.pages.dev', AUTHZ_D1: 'amicohaus-test' }));
  check('authz target: cleanup (needR2) without AUTHZ_R2 is refused', throws({ AUTHZ_BASE: PREVIEW, AUTHZ_D1: 'amicohaus-test' }, { needR2: true }));
  const authz = read('tools/authz-test.js');
  const reqAt = authz.indexOf("require('./authz-target')");
  check('authz-test.js: no production default and no hard-coded database', !authz.includes("const BASE = 'https://amicohaus.com'") && !authz.includes('execute amicohaus --remote') && authz.includes('execute ${D1} --remote'));
  check('authz-test.js: resolves the target before any fetch( or sql(', reqAt > 0 && reqAt < authz.indexOf('fetch(') && reqAt < authz.indexOf('sql(') && authz.includes('resolveAuthzTarget(process.env, { needR2: true })'));
  check('authz-test.js: runs authz-cleanup.js itself at the end and after a crash', /execSync\(`node "\$\{path\.join\(__dirname, 'authz-cleanup\.js'\)\}"/.test(authz) && (authz.match(/runCleanup\(\);/g) || []).length >= 2 && authz.includes('CLEANUP FAILED'));
  check('authz-test.js: a homeowner posting for a client is expected to be refused (Y1)', authz.includes("'a homeowner cannot post a home for a client (approved agents only)'") && authz.includes('laClient.status === 403'));
  check("authz-test.js: the public-stats truth query leaves out unlisted accounts (mirrors C4)", authz.includes("AND NOT (lower(users.email) LIKE '%@resend.dev' OR lower(users.email) = 'playstore-review@amicohaus.com')"));
  const cleanup = read('tools/authz-cleanup.js');
  check('authz-cleanup.js: target from AUTHZ_* (needR2), never the production database or bucket', cleanup.includes("resolveAuthzTarget(process.env, { needR2: true })") && !cleanup.includes('amicohaus-photos/') && !cleanup.includes('execute amicohaus --remote') && cleanup.includes('if (!info.d1)') && cleanup.includes('info.d1 !== D1'));
  const testing = readIf('tools/TESTING.md');
  check('tools/TESTING.md covers the test database, the preview-only bindings and every AUTHZ_* variable', ['amicohaus-test', '[env.preview]', 'AUTHZ_BASE', 'AUTHZ_D1', 'AUTHZ_R2', 'AUTHZ_ALLOW_PROD', 'amicohaus-test-photos'].every(s => testing.includes(s)));
  check('README: the authz suite runs against a preview deployment and test database', read('README.md').includes('runs against a separate preview deployment and test database') && !read('README.md').includes('runs against production'));
});

// ===================== S1c: the growth report's wrangler batches (command line too long) =====================
await section('S1c', async () => {
  const report = require(`${root}/tools/amico-growth-report.js`);
  const queries = report.buildQueries(report.weekWindow('2026-11-08')).map(([, s]) => s);
  const batches = report.wranglerBatches(queries);
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  check('growth report: the statements split into 2+ batches', Array.isArray(batches) && batches.length >= 2, batches && batches.length);
  check('growth report: every batch stays under the 7000 budget (cmd.exe 8191 with npx caret-escaping)', batches.every(b => report.estimatedCmdLength(b) < 7000), batches.map(report.estimatedCmdLength).join());
  check('growth report: every batch passes the read-only guard', batches.every(b => { try { return report.assertReadOnly(b); } catch { return false; } }));
  check('growth report: the batches hold every statement, whole and in order', batches.join('; ') === queries.map(flat).join('; '));
  check('growth report: estimatedCmdLength counts cmd metacharacters 3 extra each', report.estimatedCmdLength('SELECT (1)') === 140 + 10 + 6);
  let tooLong = false; try { report.wranglerBatches(['SELECT ' + '(1) + '.repeat(800) + '1']); } catch (e) { tooLong = /too long/.test(e.message); }
  check('growth report: a single statement over the budget is refused, never cut', tooLong);
  let writeRefused = false; try { report.wranglerBatches(['SELECT 1', 'DELETE FROM users']); } catch { writeRefused = true; }
  check('growth report: a write anywhere in the list is refused before anything runs', writeRefused);
  const founders = report.buildQueries(report.weekWindow('2026-11-08')).find(([n]) => n === 'founders')[1];
  check("growth report: founders leaves out the operator (role <> 'admin', mirrors LIVE_FOUNDERS_SQL)", founders.includes("u.role <> 'admin'"));
  const src = read('tools/amico-growth-report.js');
  check('growth report: never passes --file to wrangler (only the guard mentions it)', !/['"`]--file/.test(src.replace(/if \(\/--file\/\.test\(cmd\)\)/, '')) && /if \(\/--file\/\.test\(cmd\)\)/.test(src) && src.includes('--command'));
});

// ===================== S2 (F2): dual agency wording =====================
await section('S2', async () => {
  const tx = await mod('functions/_lib/transactions.js');
  check('transactions.js DUAL_AGENCY_LINE is the new wording', tx.DUAL_AGENCY_LINE === DUAL, tx.DUAL_AGENCY_LINE);
  check('main.js trade confirm text is the new wording', read('main.js').includes(TRADE_CONFIRM_TEXT));
  check('terms.html §9 uses the new wording', read('terms.html').includes(DUAL));
  check('demo.html uses the new wording', read('demo.html').includes("each of them can choose their own agent: one agent for both homes, or two agents under the same brokerage, is dual agency and needs both owners' written consent."));
  const skip = new Set(['tools', 'dist', '.wrangler', 'node_modules', '.git', 'Press']);
  const stale = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = dir ? `${dir}/${name}` : name;
      if (skip.has(name) && !dir) continue;
      if (name === 'node_modules' || name === '.git') continue;
      const st = statSync(join(root, rel));
      if (st.isDirectory()) walk(rel);
      else if (/\.(js|html|txt|md)$/.test(name) && readFileSync(join(root, rel), 'utf8').includes('One agent for both homes is dual')) stale.push(rel);
    }
  };
  walk('');
  check('no file (outside tools/dist/.wrangler) still has the old "One agent for both homes is dual" line', stale.length === 0, stale.join(', '));
});

// ===================== client.js constants (run in a stubbed browser) =====================
const noop = () => {};
const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, insertBefore: noop, setAttribute: noop, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, parentNode: { insertBefore: noop } });
const sandbox = {
  console: { log: noop, warn: noop, error: noop }, URLSearchParams, setTimeout, clearTimeout, atob, btoa, Notification: {}, navigator: { userAgent: 'node' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), readyState: 'complete', documentElement: el(), referrer: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
sandbox.window.document = sandbox.document;
let C = {};
try {
  vm.createContext(sandbox);
  vm.runInContext(read('client.js'), sandbox, { filename: 'client.js' });
  const names = ['DUAL_AGENCY_NOTE', 'OFFER_MESSAGE_NOTE', 'OFFER_OWNER_NOTE', 'AGENT_TEXT_NOTE', 'HOME_TEXT_NOTE', 'OWNER_CONFIRM_TEXT', 'OWNER_CONFIRM_BULK_TEXT',
    'OWNER_CONFIRM_REQUIRED', 'CLEAR_COOP_NOTE', 'PLATFORM_OPERATOR_LABEL', 'contentAuthorLabel', 'blockConfirmText'];
  vm.runInContext(`this.__c = { ${names.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ')} };`, sandbox);
  C = sandbox.__c;
} catch (e) { check('client.js loads in a stubbed browser', false, e.message); }

// ===================== S3 (F3): license or broker changes after approval; approval needs the DRE check =====================
await section('S3', async () => {
  const apply = await mod('functions/api/agents/apply.js');
  const decide = await mod('functions/api/admin/agent-applications/[id].js');
  const verify = await mod('functions/api/admin/agent-applications/[id]/verify-license.js');
  const agentsLib = await mod('functions/_lib/agents.js');
  sent.length = 0;
  let r = await call(apply.onRequestPost, 'POST', '/api/agents/apply', 5, {}, { acceptRules: true, brokerageName: 'Pacific Realty West', licenseNumber: '01234567', serviceZips: ['92104'] });
  const p5 = one('SELECT status, license_verified, license_verified_at FROM agent_profiles WHERE user_id = 5');
  check('an approved agent who changes only their broker loses the DRE check (and its date), stays approved', r.status === 201 && p5.status === 'approved' && p5.license_verified === 0 && p5.license_verified_at === null, r.text + JSON.stringify(p5));
  const prof = await agentsLib.getAgentProfile(DB, 5);
  check("...so the profile's 'checked' date comes off", prof && prof.licenseCheckedAt === null, JSON.stringify(prof && prof.licenseCheckedAt));
  const alert = sent.find(m => /^License or broker changed:/.test(m.subject || ''));
  check('...and Rudy gets a "License or broker changed:" email with the old and new broker', !!alert && JSON.stringify(alert.to).includes('rudypabloflores@gmail.com') && /Pacific Realty → Pacific Realty West/.test(alert.text || ''), JSON.stringify(sent.map(m => m.subject)));
  run("UPDATE agent_profiles SET license_verified = 1, license_verified_at = '2026-10-30 18:00:00' WHERE user_id = 5");
  r = await call(apply.onRequestPost, 'POST', '/x', 10, {}, { acceptRules: true, brokerageName: 'Pending Realty', licenseNumber: '01000010', serviceZips: ['92104'] });
  r = await call(decide.onRequestPut, 'PUT', '/x', 8, { id: '10' }, { decision: 'approve', licenseNumber: '01000010' });
  check('approving before the license is checked on the DRE is refused (409 license_not_checked)', r.status === 409 && r.json && r.json.code === 'license_not_checked' && one('SELECT status FROM agent_profiles WHERE user_id = 10').status === 'pending', r.text);
  await call(verify.onRequestPut, 'PUT', '/x', 8, { id: '10' }, { verified: true, licenseNumber: '01000010' });
  r = await call(decide.onRequestPut, 'PUT', '/x', 8, { id: '10' }, { decision: 'approve', licenseNumber: '01000010' });
  check('...once checked, approving works', r.status === 200 && one('SELECT status FROM agent_profiles WHERE user_id = 10').status === 'approved', r.text);
  const app = read('app.html');
  check('app.html: responsible broker label + the "checked date comes off" hint', app.includes('Responsible broker (as shown on your DRE license record) <span class="required-mark">*</span>') && app.includes("<p class=\"tiny field-hint\">Changing your license number or broker takes the 'checked' date off your profile until an admin looks it up again.</p>"));
  const terms = read('terms.html');
  check('terms §8: brokerage + license only, broker change clears the date, stats self-reported', terms.includes('reviewed what the agent reported on their application (brokerage name and license number)')
    && terms.includes("If an approved agent later changes their license number or broker, the 'checked' date comes off their profile until an admin looks it up again. Years of experience and other stats on an agent's profile are self-reported.")
    && terms.includes('Approval is not a certification') && !terms.includes('brokerage name, license number, years of experience'));
});

// ===================== S4 (F4): rentals and source of income =====================
await section('S4', async () => {
  const v = (body) => listingsLib.validateListingInput(body);
  check('a rental saying "No Section 8" is refused with the source-of-income message', v({ ...rental, description: 'No Section 8' }).error === SOI_ERROR, JSON.stringify(v({ ...rental, description: 'No Section 8' })));
  check('..."We don\'t accept vouchers" and "Vouchers not accepted" too', v({ ...rental, description: "We don't accept vouchers" }).error === SOI_ERROR && v({ ...rental, title: 'Vouchers not accepted' }).error === SOI_ERROR);
  check('..."no vouchers" in must-haves or the neighborhood too', v({ ...rental, mustHaves: 'no vouchers' }).error === SOI_ERROR && v({ ...rental, neighborhood: 'no section 8 please' }).error === SOI_ERROR);
  check('"Section 8 welcome" is fine', !v({ ...rental, description: 'Section 8 welcome' }).error);
  check('the rule is for rentals only (a trade listing is not checked)', !v({ ...trade, description: 'no vouchers' }).error);
  L(110, 1, { rental: true, rent: 3000 });
  let r = await call(listingOne.onRequestPut, 'PUT', '/x', 1, { id: '110' }, { description: 'Nice place, no vouchers' });
  check('editing a rental description to "no vouchers" is refused (400)', r.status === 400 && r.json.error === SOI_ERROR && one('SELECT description FROM listings WHERE id = 110').description === '', r.text);
  r = await call(bulkApi.onRequestPost, 'POST', '/api/listings/bulk', 5, {}, { listings: [{ ...rental, description: 'No Section 8 tenants' }, { ...trade, title: 'Bulk OK' }] });
  check('a bulk rental row with a source-of-income limit is refused, the good row saves', r.status === 200 && r.json.results[0].ok === false && r.json.results[0].error === SOI_ERROR && r.json.results[1].ok === true, r.text);
  r = await call(listingPage.onRequestGet, 'GET', '/listing/110', null, { id: '110' });
  check('the public rental page says source of income is protected', r.status === 200 && r.text.includes(SOI_PAGE_LINE));
  const tmpl = read('functions/api/listings/bulk-template.js').replace(/\\"/g, '"'); // the NOTE lines are JS strings
  check('bulk template NOTE: the voucher line and the fair housing line', tmpl.includes('# Rentals: California protects a renter\'s source of income (including Section 8 and VASH vouchers). Don\'t write limits like "no vouchers".')
    && tmpl.includes('# Fair housing: in Title, Neighborhood and Must Haves, describe the home, not who should live there or who lives nearby.'));
  check('app.html: the rental box note', read('app.html').includes(`<p class="tiny composer-note">${SOI_FORM_NOTE}</p>`));
});

// ===================== S5 (F5): a report path everywhere =====================
await section('S5', async () => {
  const terms = read('terms.html');
  check('terms §4: how to report a fair housing concern (Report, contact form, CRD, HUD)', terms.includes('<p>Base a price opinion or proposal on the home and comparable sales only. To report a fair housing concern, use Report and choose "Fair housing concern." If you don\'t see a Report button, or you aren\'t signed in, use the <a href="/contact">contact form</a> and start your message with "Fair housing concern." You can also contact the California Civil Rights Department (calcivilrights.ca.gov, 800-884-1684) or HUD (hud.gov/fairhousing/fileacomplaint, 800-669-9777).</p>'));
  let r = await call(listingPage.onRequestGet, 'GET', '/listing/101', 6, { id: '101' });
  check('listing page: a signed-in non-owner gets Report (report-listing)', r.text.includes(`<span data-report-host><button type="button" class="link-btn" data-action="report-listing" data-id="101">Report</button></span>`));
  r = await call(listingPage.onRequestGet, 'GET', '/listing/101', null, { id: '101' });
  check('listing page: signed out gets "Report a concern" (contact form)', r.text.includes(REPORT_CONCERN_LINK) && !r.text.includes('data-action="report-listing"'));
  r = await call(listingPage.onRequestGet, 'GET', '/listing/101', 1, { id: '101' });
  check('listing page: the owner gets neither', !r.text.includes('data-action="report-listing"') && !r.text.includes(REPORT_CONCERN_LINK));
  r = await call(profilePage.onRequestGet, 'GET', '/profile/5', 6, { id: '5' });
  check('agent profile: a signed-in visitor gets Report (report-user)', r.text.includes('data-action="report-user" data-id="5"'));
  r = await call(profilePage.onRequestGet, 'GET', '/profile/1', 6, { id: '1' });
  check('homeowner profile: a signed-in visitor gets Report (report-user)', r.text.includes('data-action="report-user" data-id="1"'));
  r = await call(profilePage.onRequestGet, 'GET', '/profile/5', 5, { id: '5' });
  check('...never on your own profile', !r.text.includes('data-action="report-user"'));
  r = await call(profilePage.onRequestGet, 'GET', '/profile/5', null, { id: '5' });
  check('...signed out: "Report a concern"', r.text.includes(REPORT_CONCERN_LINK));
  r = await call(augPage.onRequestGet, 'GET', '/augmented-home/202', 6, { id: '202' });
  check('AugmentedHomes page: report-owner with its prefill, and /report-actions.js', r.text.includes('data-action="report-owner" data-id="1" data-prefill="AugmentedHomes home #202: "') && r.text.includes('/report-actions.js'));
  r = await call(greenPage.onRequestGet, 'GET', '/green-home/302', 6, { id: '302' });
  check('GreenHomes page: report-owner with its prefill, and /report-actions.js', r.text.includes('data-action="report-owner" data-id="1" data-prefill="GreenHomes home #302: "') && r.text.includes('/report-actions.js'));
  run("INSERT INTO dev_projects (id, user_id, title, city, state, project_type, status) VALUES (401, 1, 'Backyard ADU', 'Chula Vista', 'CA', 'new_construction', 'open')");
  r = await call(projectPage.onRequestGet, 'GET', '/project/401', 6, { id: '401' });
  check('FinderMine page: report-owner with its prefill, and /report-actions.js', r.status === 200 && r.text.includes('data-action="report-owner" data-id="1" data-prefill="FinderMine project #401: "') && r.text.includes('/report-actions.js'), `${r.status}`);
  r = await call(projectPage.onRequestGet, 'GET', '/project/401', 1, { id: '401' });
  check('...not for the poster', !r.text.includes('data-action="report-owner"'));
  check('build-dist.js versions /report-actions.js', read('build-dist.js').includes("'/report-actions.js'"));
  const ra = readIf('report-actions.js');
  check('report-actions.js: inline report form for the owner, send and cancel, no inline handlers', ra.includes("inlineReportFormHtml('user'") && ra.includes('send-report') && ra.includes('cancel-report') && ra.includes('report-owner') && !/\son[a-z]+=/.test(ra));
  check('listing-actions.js handles report-listing; profile-actions.js handles report-user', read('listing-actions.js').includes('report-listing') && read('profile-actions.js').includes('report-user'));
  check('app.html: thread Report button; main.js: report-user buttons', read('app.html').includes('id="threadReportBtn"') && read('main.js').includes('data-action="report-user"'));
});

// ===================== S6 (F6): the operator label =====================
await section('S6', async () => {
  const cp = await mod('functions/_lib/contactPolicy.js');
  check('fetchAgentIdentity: the operator (admin + approved agent) isOperator, a plain agent not', (await cp.fetchAgentIdentity(DB, 9)).isOperator === true && (await cp.fetchAgentIdentity(DB, 5)).isOperator === false);
  check('fetchAgentIdentity: a pure admin with no agent profile is not "the operator"', (await cp.fetchAgentIdentity(DB, 8)).isOperator === false);
  check('identityLine ends with the operator label', cp.identityLine({ name: 'R', licenseNumber: '02257808', brokerageName: 'CBW', isOperator: true }).endsWith(`· ${OPERATOR_LABEL}`) && cp.OPERATOR_LABEL === OPERATOR_LABEL);
  check('identityParens carries "platform operator: runs Amico Haus"', cp.identityParens({ name: 'R', licenseNumber: '02257808', brokerageName: 'CBW', isOperator: true }).includes('platform operator: runs Amico Haus'));
  check('...and a plain agent carries neither', !cp.identityLine({ name: 'G', licenseNumber: '01234567', brokerageName: 'P' }).includes('operator'));
  const mn = await mod('functions/_lib/marketplaceNotify.js');
  const k = ctx();
  await mn.notifyNewBid(k.c, 'pre_listing', 900, [1], 9);
  await k.done();
  check('a proposal alert from the operator carries the label', notes(1, `%${OPERATOR_LABEL}%`).length === 1, JSON.stringify(q('SELECT body FROM notifications WHERE user_id = 1')));
  const posts = await mod('functions/api/posts/index.js');
  run("INSERT INTO posts (id, user_id, body) VALUES (700, 9, 'Operator post'), (701, 5, 'Agent post')");
  let r = await call(posts.onRequestGet, 'GET', '/api/posts', 6);
  const p700 = r.json && r.json.posts.find(p => p.id === 700), p701 = r.json && r.json.posts.find(p => p.id === 701);
  check("the operator's feed post: authorAgent.isPlatformOperator true; a plain agent's false", p700 && p700.authorAgent && p700.authorAgent.isPlatformOperator === true && p701 && p701.authorAgent && p701.authorAgent.isPlatformOperator === false, JSON.stringify([p700 && p700.authorAgent, p701 && p701.authorAgent]));
  const thread = await mod('functions/api/conversations/[id]/messages.js');
  run('INSERT INTO conversations (id, user_a_id, user_b_id) VALUES (50, 1, 9)');
  run("INSERT INTO messages (conversation_id, sender_id, body) VALUES (50, 9, 'Hi from the operator')");
  r = await call(thread.onRequestGet, 'GET', '/x', 1, { id: '50' });
  check('messages GET: other.agent.isPlatformOperator for the operator', r.status === 200 && r.json.other && r.json.other.agent && r.json.other.agent.isPlatformOperator === true, r.text.slice(0, 300));
  check('client.js: contentAuthorLabel adds the operator label', typeof C.contentAuthorLabel === 'function' && C.contentAuthorLabel('A', { licenseNumber: '01234567', brokerageName: 'B', isPlatformOperator: true }).endsWith(`· ${OPERATOR_LABEL}`) && C.PLATFORM_OPERATOR_LABEL === OPERATOR_LABEL);
  check('main.js: the thread header adds the operator label', read('main.js').includes('other.agent.isPlatformOperator') && read('main.js').includes(' · ${PLATFORM_OPERATOR_LABEL}'));
  check('for-agents.html: who runs Amico Haus, and the label', read('for-agents.html').includes('<li>Amico Haus is run by Rudy Flores, a Coldwell Banker West agent who may compete for the same homes. His proposals, price opinions, messages and posts, and the alerts about them, are labeled "Platform operator: runs Amico Haus".</li>'));
});

// ===================== S7 (F7): agent identity on offers =====================
await section('S7', async () => {
  run('INSERT INTO listing_offers (listing_id, buyer_user_id, offer_price) VALUES (101, 5, 690000), (101, 6, 680000)');
  run('INSERT INTO augmented_home_offers (augmented_home_id, buyer_user_id, offer_price) VALUES (202, 5, 640000), (202, 6, 630000)');
  run('INSERT INTO green_home_offers (green_home_id, buyer_user_id, offer_price) VALUES (302, 5, 670000), (302, 6, 660000)');
  for (const [label, path, id] of [['listing', 'functions/api/listings/[id]/offers/index.js', '101'], ['AugmentedHomes', 'functions/api/augmented-homes/[id]/offers/index.js', '202'], ['GreenHomes', 'functions/api/green-homes/[id]/offers/index.js', '302']]) {
    const h = await mod(path);
    const r = await call(h.onRequestGet, 'GET', '/x', 1, { id });
    const ag = r.json && r.json.offers && r.json.offers.find(o => o.offerPrice > 0 && (o.buyerLicense || '') === '01234567');
    const ho = r.json && r.json.offers && r.json.offers.find(o => o.buyerLicense === null);
    check(`${label} offers (owner view): an agent buyer carries buyerLicense + buyerBrokerage, a homeowner buyer null`, r.status === 200 && !!ag && !!ag.buyerBrokerage && !!ho && ho.buyerBrokerage === null, r.text.slice(0, 300));
  }
  const mn = await mod('functions/_lib/marketplaceNotify.js');
  const k = ctx();
  await mn.notifyNewOffer(k.c, '/listing/101', 1, 5);
  await k.done();
  check('a new-offer alert from an agent buyer names their DRE #', notes(1, '%made an offer on your listing.').some(n => n.body.includes('DRE #01234567')), JSON.stringify(notes(1, '%offer%')));
  check('main.js: the owner offer rows show the buyer agent\'s DRE # on file', read('main.js').includes('buyerLicense') && read('main.js').includes('on file'));
});

// ===================== S8 (F8, F9, F10, F13, F14): copy =====================
await section('S8', async () => {
  const main = read('main.js'), app = read('app.html');
  check('client.js: the C5 constants', C.DUAL_AGENCY_NOTE === DUAL && C.OFFER_MESSAGE_NOTE === OFFER_MESSAGE_NOTE && C.OFFER_OWNER_NOTE === OFFER_OWNER_NOTE && C.AGENT_TEXT_NOTE === AGENT_TEXT_NOTE
    && C.OWNER_CONFIRM_TEXT === OWNER_CONFIRM_TEXT && C.OWNER_CONFIRM_BULK_TEXT === OWNER_CONFIRM_BULK_TEXT && C.OWNER_CONFIRM_REQUIRED === OWNER_CONFIRM_REQUIRED && C.CLEAR_COOP_NOTE === CLEAR_COOP_NOTE && C.HOME_TEXT_NOTE === HOME_TEXT_NOTE,
  JSON.stringify(Object.fromEntries(Object.entries(C).filter(([, v]) => typeof v !== 'function'))).slice(0, 300));
  check('client.js: the block confirm adds the "not for turning away a buyer or renter" line', typeof C.blockConfirmText === 'function' && C.blockConfirmText('Ana').endsWith('Blocking is for spam, harassment or safety, not for turning away a buyer or renter because of who they are.'));
  check('F8 main.js: phone and exact address stay private until Share', main.includes('You decide. Your phone number and exact address stay private until you tap Share on an agent you like.'));
  check('F8 whats-new.html: the new first sentence', read('whats-new.html').includes('Your phone number and exact address stay private until you tap "Share my contact info" on an agent you like, and you can stop sharing anytime.'));
  check('F9: years of experience is "(self-reported)" in the app and agent cards, "(agent-reported)" on the two filters', main.includes('yrs experience (self-reported)') && read('agent-cards.js').includes('yrs experience (self-reported)') && (app.match(/Min\. years of experience \(agent-reported\)/g) || []).length === 2 && main.includes('Min. years of experience (agent-reported)'));
  let r = await call(profilePage.onRequestGet, 'GET', '/profile/5', null, { id: '5' });
  run('UPDATE agent_profiles SET years_experience = 7 WHERE user_id = 5');
  r = await call(profilePage.onRequestGet, 'GET', '/profile/5', null, { id: '5' });
  const meta = (r.text.match(/<meta name="description" content="[^"]*"/) || [''])[0];
  check('F9 profile page: the chip is "(self-reported)", the meta description has no years', r.text.includes('7 yrs experience (self-reported)') && !/years experience|yrs experience/i.test(meta), meta);
  check('F9 terms §8: stats are self-reported', read('terms.html').includes("Years of experience and other stats on an agent's profile are self-reported."));
  check('F10 app.html: Clear Cooperation note on the client name and bulk upload', (app.match(new RegExp(CLEAR_COOP_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2);
  check('F10 app.html: the invite line leaves out homes under a listing agreement', app.includes('Invite past clients and homeowners thinking about selling to post a pre-listing (not a home you already have under a listing agreement).'));
  check('F13 main.js: offer note + owner note by constant', main.includes('Note about your terms (optional)') && main.includes('escapeHtml(OFFER_MESSAGE_NOTE)') && main.includes('escapeHtml(OFFER_OWNER_NOTE)'));
  const lsrc = read('functions/listing/[id].js');
  check('F13 listing page offer box: "Note about your terms" + the offer note', lsrc.includes('<label for="offerMessage">Note about your terms (optional)</label>') && lsrc.includes(OFFER_MESSAGE_NOTE));
  check('F14 app.html: agent text note on bio, video and case study (3+)', (app.match(new RegExp(AGENT_TEXT_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 3);
  check('F14 main.js: agent text note on the package description', main.includes('escapeHtml(AGENT_TEXT_NOTE)'));
  check('F14 bios: the new placeholder + the home note (page-profile.js, profile-actions.js)', ['page-profile.js', 'profile-actions.js'].every(f => read(f).includes('What kind of home you have and what you\'re hoping to find…') && read(f).includes('escapeHtml(HOME_TEXT_NOTE)')));
  check('Y3 main.js: "Only the homeowner" copy is softened', !main.includes('Only the homeowner') && main.includes('The homeowner you send them to. Other agents never do, and Amico Haus has no staff screen for your proposals, price opinions, pitch reels or files.')
    && main.includes('The homeowner sees your suggested price, comps, note and file; other agents never do. Other agents see only how many agents shared an opinion.'));
  check('Y3 privacy §3: shown only to the homeowner, never to other agents', read('privacy.html').includes("An agent's price opinion, comps, notes and presentation file are shown only to the homeowner, never to other agents"));
});

// ===================== S9 (F11): one new Terms version + the "We updated our Terms" prompt =====================
await section('S9', async () => {
  const terms = await mod('functions/_lib/terms.js');
  check('terms.js: version 2026-11-05, label November 5, 2026', terms.CURRENT_TERMS_VERSION === '2026-11-05' && terms.TERMS_UPDATED_LABEL === 'November 5, 2026');
  const signup = await mod('functions/api/auth/signup.js');
  let r = await call(signup.onRequestPost, 'POST', '/api/auth/signup', null, {}, { email: 'fresh.person@example.test', displayName: 'Fresh Person', intent: 'homeowner' });
  const fresh = one("SELECT terms_version, terms_accepted_at FROM users WHERE email = 'fresh.person@example.test'");
  check('a fresh signup records 2026-11-05', [201, 202].includes(r.status) && fresh && fresh.terms_version === '2026-11-05' && !!fresh.terms_accepted_at, r.text);
  check('signup.js keeps no local TERMS_VERSION', !/const TERMS_VERSION\s*=/.test(read('functions/api/auth/signup.js')));
  const me = await mod('functions/api/me.js');
  run("UPDATE users SET terms_version = '2026-11-04' WHERE id = 6");
  r = await call(me.onRequestGet, 'GET', '/api/me', 6);
  check('/api/me: an account on the 11-04 Terms -> termsCurrent false, current version + label, private no-store',
    r.status === 200 && r.json.user.termsCurrent === false && r.json.user.termsVersion === '2026-11-04' && r.json.user.currentTermsVersion === '2026-11-05' && r.json.user.termsUpdatedLabel === 'November 5, 2026' && /private/.test(r.headers.get('Cache-Control') || '') && /no-store/.test(r.headers.get('Cache-Control') || ''), r.text.slice(0, 300));
  r = await call(me.onRequestGet, 'GET', '/api/me', 13);
  check('/api/me: an account with no recorded version (NULL) is not current either', r.json.user.termsCurrent === false && r.json.user.termsVersion === null);
  r = await call(me.onRequestGet, 'GET', '/api/me', null);
  check('/api/me signed out: { user: null }, private no-store', r.status === 200 && r.json.user === null && /no-store/.test(r.headers.get('Cache-Control') || ''));
  const accept = await mod('functions/api/account/accept-terms.js');
  r = await call(accept.onRequestPost, 'POST', '/api/account/accept-terms', 6, {}, { version: '2026-11-04' });
  check('accepting an old version -> 409 terms_changed, nothing stored', r.status === 409 && r.json.code === 'terms_changed' && one('SELECT terms_version FROM users WHERE id = 6').terms_version === '2026-11-04' && /no-store/.test(r.headers.get('Cache-Control') || ''), r.text);
  r = await call(accept.onRequestPost, 'POST', '/api/account/accept-terms', 6, {}, { version: '2026-11-05' });
  const row6 = one('SELECT terms_version, terms_accepted_at FROM users WHERE id = 6');
  check("accepting the current version stores it with a datetime('now')-shaped time", r.status === 200 && r.json.ok === true && row6.terms_version === '2026-11-05' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row6.terms_accepted_at || '') && /no-store/.test(r.headers.get('Cache-Control') || ''), JSON.stringify(row6));
  r = await call(me.onRequestGet, 'GET', '/api/me', 6);
  check('...and /api/me is current after that', r.json.user.termsCurrent === true);
  r = await call(accept.onRequestPost, 'POST', '/api/account/accept-terms', null, {}, { version: '2026-11-05' });
  check('accept-terms signed out -> 401', r.status === 401);
  const termsHtml = read('terms.html'), privacy = read('privacy.html');
  check('terms.html carries the same version, privacy.html the same date', termsHtml.includes(`(version ${terms.CURRENT_TERMS_VERSION})`) && privacy.includes(`Last updated ${terms.TERMS_UPDATED_LABEL}.`));
  check('terms §19: notice + request to agree, no "continued use"', termsHtml.includes("<p>If we make a material change, we'll update the date and version at the top and, the next time account holders open the app, show them a notice asking them to agree to the updated Terms. For visitors without an account, the Terms dated at the top apply.</p>")
    && !/continued use/i.test(termsHtml));
  check('privacy §9: notice in the app, no "continued use"', privacy.includes("<p>If we make a material change to this policy, we'll update the date at the top and show account holders a notice in the app the next time they open it.</p>") && !/continued use/i.test(privacy));
  const app = read('app.html'), main = read('main.js');
  check('app.html: the banner and its ids (C12)', ['termsUpdateBanner', 'termsUpdateDate', 'termsAgreeBtn', 'termsLaterBtn'].every(id => app.includes(`id="${id}"`)) && /id="termsUpdateBanner" class="[^"]*terms-update-banner[^"]*hidden/.test(app));
  check('main.js: shows it when termsCurrent is false, "I agree" posts to /api/account/accept-terms, "Not now" waits for the session', main.includes('/api/account/accept-terms') && main.includes('termsCurrent') && main.includes('amicohaus_terms_later') && main.includes('termsAgreeBtn') && main.includes('termsLaterBtn'));
});

// ===================== S10 (F12): FinderMine free text =====================
await section('S10', async () => {
  const dp = await mod('functions/_lib/devProjects.js');
  const base = { title: 'Project', city: 'Chula Vista', state: 'CA', projectType: 'new_construction' };
  for (const bad of ['seeking equity partner, 18% IRR, $50k minimum', 'Looking for investors', 'min investment 25k']) {
    check(`FinderMine refuses "${bad}"`, dp.validateDevProjectInput({ ...base, description: bad }).error === INVESTMENT_ERROR, JSON.stringify(dp.validateDevProjectInput({ ...base, description: bad })));
  }
  for (const ok of ['ADU in our backyard, looking for a licensed builder', 'new irrigation', 'investment property next door']) {
    check(`FinderMine accepts "${ok}"`, !dp.validateDevProjectInput({ ...base, description: ok }).error);
  }
  check('FinderMine checks the title too', dp.validateDevProjectInput({ ...base, title: 'Accredited investors wanted' }).error === INVESTMENT_ERROR);
  check('F12 app.html: the new placeholder', read('app.html').includes('e.g. ADU in our backyard, looking for a licensed builder'));
});

// ===================== S11 (F15-F20) =====================
await section('S11', async () => {
  const mc = await mod('functions/_lib/mortgageCalc.js');
  const plain = mc.mortgageCalcHtml(1, { lenderNote: false });
  check('F15 payment widget without the lender note: no Point Mortgage, the rough-math close', !plain.includes('Point Mortgage') && plain.includes(MC_NO_LENDER_CLOSE));
  const dflt = mc.mortgageCalcHtml(650000);
  check('F15 the default widget keeps the lender line and has a price field', dflt.includes('Point Mortgage') && dflt.includes('id="mcPrice"') && dflt.includes('for="mcPrice"') && dflt.includes('class="mc-price"'));
  const r = await call(listingPage.onRequestGet, 'GET', '/listing/101', 6, { id: '101' });
  check('F15 a trade listing page names Point Mortgage exactly once', (r.text.match(/Point Mortgage/g) || []).length === 1, (r.text.match(/Point Mortgage/g) || []).length);
  check('F15 client.js: the calculator reads the price field', read('client.js').includes("querySelector('.mc-price')"));
  const terms = read('terms.html');
  check('F16 terms: the escrow line, "title and escrow are cleared" gone', terms.includes('We recommend a licensed real estate agent on every sale or trade, and a licensed escrow holder and title company to handle the funds, title and recording on every closing.') && !terms.includes('title and escrow are cleared'));
  const privacy = read('privacy.html');
  check('F17 privacy: notifications on your device, invite links, quiet hours, push service, Recently Deleted',
    privacy.includes("<li><strong>Notifications on your device:</strong> if you turn on notifications, we store the address your browser gives us for sending them. They carry no details, and they're delivered through your browser maker's push service (such as Google, Apple or Mozilla).</li>")
    && privacy.includes("If you join from a member's invite link, we record who invited you; they see only a count.")
    && privacy.includes("With <strong>quiet hours</strong> set, emails wait until your quiet hours end and phone and browser notifications aren't sent; in-app alerts still arrive right away.")
    && privacy.includes(", and your browser maker's push service if you turn on notifications")
    && privacy.includes("A deleted listing stays in Recently Deleted for 7 days so you can restore it, then it's removed for good.")
    && privacy.includes("<p>We don't sell your data. We share it only with other members as described in §3"));
  check('F17 privacy §3: blocking closes open trade requests', privacy.includes('pending showing requests, upcoming interviews and pending invites between you, and closes any open trade request between the two of you.'));
  check('F17 footers: app.html and login.html carry Terms + Privacy', read('app.html').includes(FOOTER_LEGAL_APP) && read('login.html').includes(FOOTER_LEGAL_APP));
  const email = await mod('functions/_lib/email.js');
  check('F18 email.js: EMAIL_POSTAL_LINE', email.EMAIL_POSTAL_LINE === EMAIL_POSTAL_LINE);
  const sc = await mod('functions/_lib/scorecard.js');
  const card = { name: 'Gina', counts: { proposals: 1, opinions: 0, interviews: 0, hires: 0, feedback: 0, newNearby: 2, answered: 1 }, nextStep: 'Send a price opinion.' };
  const mail = await sc.scorecardEmail({ env, request: new Request('https://amicohaus.com/x') }, 5, card);
  check('F18 the Monday scorecard email ends with the postal line (still DRE #02257808), after the stop link', mail.text.includes(EMAIL_POSTAL_LINE) && mail.text.includes('DRE #02257808') && mail.text.indexOf('Stop these emails') < mail.text.indexOf(EMAIL_POSTAL_LINE));
  const duty = read('functions/_lib/agentDuty.js');
  check('F18 agentDuty bundles append the postal line and the email settings link', duty.includes('EMAIL_POSTAL_LINE') && duty.includes('https://amicohaus.com/account-security'));
  const headers = read('_headers').split(/\r?\n/);
  check('F19 _headers CSP (line 2) exactly', headers[1] === "  Content-Security-Policy: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/ https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/; style-src 'self' https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/; img-src 'self' data: https://cdnjs.cloudflare.com https://*.tile.openstreetmap.org; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'", headers[1]);
  check('F19 no images.pexels.com in _headers', !read('_headers').includes('images.pexels.com'));
  const home = read('page-home.js');
  check('F19 page-home.js: Leaflet css + js with SRI and crossOrigin anonymous', home.includes('sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==') && home.includes('sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==') && home.includes("crossOrigin: 'anonymous'"));
  check('F19 admin-seed.html: Chart.js with SRI', read('admin-seed.html').includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.js" integrity="sha512-T/Zt9dXFrr8cLjWcDkt8WRUVNzj6c7K5y2G8xAAh1kGKcM+LdolRrNJR1bWwuulykpaNuRfFJKCKTzcsWTbKaw==" crossorigin="anonymous"></script>'));
  if (existsSync(`${root}/Press`)) {
    const PRESS_BAD = /brokerage regulation|brokerage and escrow|licensing exposure|handled directly|direct arrangement|every step|placement|subscription|monetiz(e|ation) would|fee charged/i;
    const bad = readdirSync(`${root}/Press`).filter(f => f.endsWith('.md') && PRESS_BAD.test(read(`Press/${f}`)));
    check('F20 Press drafts: no brokerage-regulation, fee or placement ideas (Y6)', bad.length === 0, bad.join(', '));
    const nar = readIf('Press/nar-reach-application.md');
    check('F20 nar-reach: the two new answers', nar.includes('No payments run through the platform. Any commission is set in the homeowner\'s written agreement with the agent\'s brokerage and is normally paid through escrow at closing.') && nar.includes('Not monetized, and no payments run through the platform. No agent, lender or other provider pays Amico Haus for leads or referrals, or to be shown first, and agents pay nothing to join.'));
  } else check('F20 Press/ exists on this machine', false, 'no Press folder');
});

// ===================== S12 (Y1): client posts and bulk upload are for approved agents =====================
await section('S12', async () => {
  let r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'For a client', clientName: 'Jane Smith' });
  check('a homeowner posting with a client name -> 403 (C10), nothing saved', r.status === 403 && r.json.error === 'Only approved agents can post a home for a client.' && !one("SELECT 1 AS x FROM listings WHERE title = 'For a client'"), r.text);
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 5, {}, { ...trade, title: 'Agent for a client', clientName: 'Jane Smith' });
  check('an approved agent posting for a client -> 201', r.status === 201, r.text);
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'My own home' });
  check('a homeowner posting their own home -> 201', r.status === 201, r.text);
  r = await call(listingOne.onRequestPut, 'PUT', '/x', 1, { id: '101' }, { action: 'edit', ...trade, title: 'Edited', clientName: 'Jane Smith' });
  check('a homeowner adding a client name on edit -> 403', r.status === 403 && one('SELECT title FROM listings WHERE id = 101').title !== 'Edited', r.text);
  r = await call(bulkApi.onRequestPost, 'POST', '/api/listings/bulk', 1, {}, { listings: [{ ...trade, title: 'Bulk homeowner' }] });
  check("a homeowner's bulk upload -> 403 (C10)", r.status === 403 && r.json.error === 'Bulk upload is for approved agents.' && !one("SELECT 1 AS x FROM listings WHERE title = 'Bulk homeowner'"), r.text);
  r = await call(bulkApi.onRequestPost, 'POST', '/api/listings/bulk', 10, {}, { listings: [{ ...trade, title: 'Bulk agent' }] });
  check("an approved agent's bulk upload -> 200", r.status === 200 && r.json.created === 1, r.text);
  const terms = read('terms.html');
  check('terms §3: who may post a home for someone else', terms.includes("If you post a home for someone else, you must be its trustee, executor or attorney-in-fact, or a California-licensed agent with the owner's written permission; a home an agent posts shows the agent's DRE number and broker."));
  check('terms §7: portfolios are your own homes, or one client\'s for an approved agent', terms.includes('(your own homes, or, for an approved agent, the homes of one client who agreed in writing to trade them together)') && !terms.includes("(the same client, or the user's own home)"));
  const app = read('app.html');
  check('app.html: 4 single-home ownership checkboxes + 1 bulk', (app.split(OWNER_CONFIRM_TEXT).length - 1) === 4 && (app.split(OWNER_CONFIRM_BULK_TEXT).length - 1) === 1
    && ['ownerConfirmListing', 'ownerConfirmBulk', 'ownerConfirmPreListing', 'ownerConfirmAugmented', 'ownerConfirmGreen', 'ownerConfirmListingRow'].every(id => app.includes(`id="${id}"`)));
  check('app.html: bulk upload and the client name start hidden (approved agents only)', /<details id="bulkUploadWrap" class="[^"]*\bhidden\b/.test(app) && /<div class="field hidden" id="clientNameField">/.test(app));
  const main = read('main.js');
  check('main.js: agent-only tools toggle, and every ownership box is required', main.includes('applyAgentOnlyListingTools') && main.includes('OWNER_CONFIRM_REQUIRED') && ['ownerConfirmListing', 'ownerConfirmBulk', 'ownerConfirmPreListing', 'ownerConfirmAugmented', 'ownerConfirmGreen'].every(id => main.includes(`'${id}'`)));
  const missing = ['termsUpdateBanner', 'termsUpdateDate', 'termsAgreeBtn', 'termsLaterBtn', 'clientNameField', 'ownerConfirmListingRow', 'ownerConfirmListing', 'ownerConfirmBulk', 'ownerConfirmPreListing', 'ownerConfirmAugmented', 'ownerConfirmGreen', 'threadReportBtn']
    .filter(id => !app.includes(`id="${id}"`) || !main.includes(id));
  check('C12: every new app id is in app.html and used in main.js', missing.length === 0, missing.join(', '));
});

// ===================== S13 (Y3): the operator sees what any agent sees =====================
await section('S13', async () => {
  const plOne = await mod('functions/api/pre-listings/[id].js');
  run(`INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, special_instructions, status) VALUES
    (800, 1, 'Open home', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 700000, 'Gate code 4321', 'open'),
    (801, 1, 'Closed home', 'Chula Vista', 'CA', '91913', 'Condo', 2, 2, 700000, 'Gate code 9999', 'closed')`);
  let r = await call(plOne.onRequestGet, 'GET', '/x', 8, { id: '800' });
  check('a pure admin (no agent profile) still sees the notes for agents', r.status === 200 && r.json.preListing.specialInstructions === 'Gate code 4321', r.text.slice(0, 200));
  r = await call(plOne.onRequestGet, 'GET', '/x', 9, { id: '800' });
  check('the operator (admin + approved agent, not hired, not shared) does not', r.status === 200 && r.json.preListing.specialInstructions === undefined, JSON.stringify(r.json && r.json.preListing && r.json.preListing.specialInstructions));
  r = await call(plOne.onRequestGet, 'GET', '/x', 5, { id: '800' });
  check('...the same as a plain approved agent', r.status === 200 && r.json.preListing.specialInstructions === undefined);
  r = await call(plOne.onRequestGet, 'GET', '/x', 8, { id: '801' });
  check('a closed pre-listing: a pure admin can open it', r.status === 200);
  r = await call(plOne.onRequestGet, 'GET', '/x', 9, { id: '801' });
  check('...the operator who never took part gets a 404, like any agent', r.status === 404, `${r.status}`);
});

// ===================== S14 (Y4): the operator never takes a founding spot =====================
await section('S14', async () => {
  const apply = await mod('functions/api/agents/apply.js');
  const decide = await mod('functions/api/admin/agent-applications/[id].js');
  const verify = await mod('functions/api/admin/agent-applications/[id]/verify-license.js');
  const zb = await mod('functions/_lib/zipBoard.js');
  const approve = async (id, lic) => {
    await call(verify.onRequestPut, 'PUT', '/x', 8, { id: String(id) }, { verified: true, licenseNumber: lic });
    return call(decide.onRequestPut, 'PUT', '/x', 8, { id: String(id) }, { decision: 'approve', licenseNumber: lic });
  };
  await call(apply.onRequestPost, 'POST', '/x', 11, {}, { acceptRules: true, brokerageName: 'Admin Realty', licenseNumber: '01100011', serviceZips: ['91913'] });
  let r = await approve(11, '01100011');
  check("approving an admin's application in a launch ZIP grants no founding spot", r.status === 200 && one('SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 11').n === 0, r.text);
  check('...and grantFoundingSpots gives the admin nothing either', (await zb.grantFoundingSpots(DB, 11)).length === 0);
  run("INSERT INTO founding_agents (zip, agent_user_id) VALUES ('91913', 11)");
  check('a founding row held by an admin is not a live founder (LIVE_FOUNDERS_SQL)', !q(zb.LIVE_FOUNDERS_SQL).some(x => x.agent_user_id === 11));
  await zb.releaseFoundingSpots(DB, 11);
  check('releaseFoundingSpots(admin) deletes it', one('SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 11').n === 0);
  await call(apply.onRequestPost, 'POST', '/x', 12, {}, { acceptRules: true, brokerageName: 'New Realty', licenseNumber: '01200012', serviceZips: ['91913'] });
  r = await approve(12, '01200012');
  check('a normal agent still gets the spot', r.status === 200 && one("SELECT COUNT(*) AS n FROM founding_agents WHERE agent_user_id = 12 AND zip = '91913'").n === 1, r.text);
  const board = await zb.fetchZipBoard(DB);
  const z = board.find(b => String(b.zip) === '91913');
  check('the ZIP board counts 1 founder in 91913 (the admin-held row never counted)', z && z.foundingTaken === 1, JSON.stringify(z));
  for (const f of ['for-agents.html', 'unlock-your-zip.html', 'llms.txt']) check(`${f}: "${FOUNDING_OPERATOR_LINE}"`, read(f).includes(FOUNDING_OPERATOR_LINE));
});

// ===================== S15 (Y5): content license + robots.txt =====================
await section('S15', async () => {
  const terms = read('terms.html');
  check('terms §3: the wider license sentence (public pages, search engines, link previews, flyers)', terms.includes('You keep ownership of anything you post (listings, posts, comments, messages, photos and videos). You give Amico Haus, and the service providers that host it, a non-exclusive, royalty-free license to store, copy, resize and reformat it (for example, to remove location data from photos) and to show it the way the features you use intend: to other members, and on public pages (active listings, AugmentedHomes and GreenHomes pages, member profiles and the community feed) to anyone, including search engines and the link previews that appear when someone shares a page, and on flyers made for your home. The license ends when you delete it, apart from copies in backups and caches until they clear.'));
  const robots = read('robots.txt');
  check('robots.txt: no AI-training crawler groups', !/GPTBot|ClaudeBot|anthropic-ai|Google-Extended|CCBot/.test(robots), robots);
  check('robots.txt: keeps *, ChatGPT-User, PerplexityBot and the sitemap', /User-agent: \*\r?\nAllow: \//.test(robots) && /User-agent: ChatGPT-User\r?\nAllow: \//.test(robots) && /User-agent: PerplexityBot\r?\nAllow: \//.test(robots) && robots.includes('Sitemap: https://amicohaus.com/sitemap.xml'));
});

// ===================== S16 (L1 a): Duplicate on a moderation-paused listing =====================
await section('S16', async () => {
  L(105, 1);
  run("UPDATE listings SET status = 'paused', hidden_at = datetime('now'), hidden_reason = 'Rules' WHERE id = 105");
  let r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Copy of paused', cloneOf: 105 });
  check('copying a listing Amico Haus paused -> 409 moderation_paused, nothing saved', r.status === 409 && r.json.code === 'moderation_paused' && r.json.error === "This listing was paused by Amico Haus, so it can't be copied. Questions? Use Contact." && !one("SELECT 1 AS x FROM listings WHERE title = 'Copy of paused'"), r.text);
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 1, {}, { ...trade, title: 'Copy of normal', cloneOf: 101 });
  check('copying a normal listing -> 201', r.status === 201, r.text);
  r = await call(listingsApi.onRequestPost, 'POST', '/api/listings', 7, {}, { ...trade, title: 'Copy of someone else', cloneOf: 105 });
  check("cloneOf someone else's paused listing is just ignored (it isn't theirs to copy anyway)", r.status === 201, r.text);
  const main = read('main.js');
  check('main.js: Duplicate is hidden on a paused listing and the POST carries cloneOf', /!l\.is_portfolio && !l\.hidden_at/.test(main) && main.includes('cloneOf') && main.includes('cloneSourceListingId'));
});

// ===================== S17 (L1 b): a review's email/address show only while a member's report is open =====================
await section('S17', async () => {
  const pcrAdmin = await mod('functions/api/admin/past-client-reviews/index.js');
  const reportsAdmin = await mod('functions/api/admin/reports/[id].js');
  run("INSERT INTO past_client_reviews (id, agent_user_id, reviewer_user_id, rating, client_side, sale_year, sale_city, sale_address) VALUES (900, 5, 6, 5, 'sold', 2022, 'Bonita', '12 Elm Street')");
  const rv = async () => (await call(pcrAdmin.onRequestGet, 'GET', '/x', 8)).json.reviews.find(x => x.id === 900 || x.reviewerUserId === 6);
  run("INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (9001, 13, 'past_client_review', 900, 'Fake review')");
  let x = await rv();
  check("a member's open report reveals the reviewer email and the address", x && x.reported === true && x.reviewerEmail === 'u6@example.test' && x.saleAddress === '12 Elm Street', JSON.stringify(x));
  let r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '9001' }, { action: 'dismiss' });
  x = await rv();
  check('dismissing that report hides them again', r.status === 200 && x.reported === false && x.reviewerEmail === null && x.saleAddress === null, JSON.stringify(x));
  run("INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (9002, 7, 'past_client_review', 900, 'Fake review')");
  x = await rv();
  check('a second open report shows them again', x.reported === true && x.reviewerEmail === 'u6@example.test');
  r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '9002' }, { action: 'resolve' });
  x = await rv();
  check('resolving it hides them too', r.status === 200 && x.reported === false && x.reviewerEmail === null && x.saleAddress === null, JSON.stringify(x));
});

// ===================== S18 (L1 c): a block closes open trade requests between the two =====================
await section('S18', async () => {
  const blocks = await mod('functions/api/blocks/index.js');
  const unblock = await mod('functions/api/blocks/[userId].js');
  const tx = await mod('functions/_lib/transactions.js');
  L(120, 1); L(121, 7);
  run("INSERT INTO transaction_requests (id, opened_by_user_id, listing_a_id, listing_b_id, user_a_id, user_b_id, status, partner_confirmed_at) VALUES (5000, 1, 120, 121, 1, 7, 'open', datetime('now'))");
  const before = one('SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (1, 7)').n;
  let r = await call(blocks.onRequestPost, 'POST', '/api/blocks', 1, {}, { userId: 7 });
  check('blocking closes the open trade request between them', r.status === 200 || r.status === 201 ? one('SELECT status FROM transaction_requests WHERE id = 5000').status === 'closed' : false, `${r.status} ${r.text}`);
  check('...and notifies neither of them', one('SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (1, 7)').n === before);
  r = await call(unblock.onRequestDelete, 'DELETE', '/api/blocks/7', 1, { userId: '7' });
  const again = await tx.openTransactionRequest(DB, 1, 120, 121, 'Trying again');
  const row = one('SELECT status, partner_confirmed_at, opened_by_user_id FROM transaction_requests WHERE id = 5000');
  check('after unblocking, asking again reopens it and the partner confirms again', !again.error && again.id === 5000 && again.isNew === true && row.status === 'open' && row.partner_confirmed_at === null && row.opened_by_user_id === 1, JSON.stringify({ again, row }));
});

// ===================== S19 (L1 d): an admin's direct moderation tells the owner =====================
await section('S19', async () => {
  L(107, 6);
  let r = await call(listingOne.onRequestPut, 'PUT', '/x', 8, { id: '107' }, { status: 'paused', reason: 'Rules' });
  const l107 = one('SELECT status, hidden_at FROM listings WHERE id = 107');
  check("an admin pausing someone's listing directly tells the owner, same notice as the report queue", r.status === 200 && l107.status === 'paused' && !!l107.hidden_at && notes(6, 'Your listing was paused by Amico Haus: Rules').length === 1, r.text + JSON.stringify(l107));
  await call(listingOne.onRequestPut, 'PUT', '/x', 8, { id: '107' }, { status: 'paused', reason: 'Rules' });
  check('...pausing it again adds no second notice', notes(6, 'Your listing was paused by Amico Haus: %').length === 1);
  const mod1 = await mod('functions/_lib/moderation.js');
  check('moderation.js: pauseListingForModeration is the one shared helper', typeof mod1.pauseListingForModeration === 'function');
  L(106, 7);
  const reportsAdmin = await mod('functions/api/admin/reports/[id].js');
  run("INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (9100, 13, 'listing', 106, 'Fair housing concern')");
  r = await call(reportsAdmin.onRequestPost, 'POST', '/x', 8, { id: '9100' }, { action: 'hide_target', reason: 'Describes who should live there' });
  check('a report-queue takedown of a listing still notifies once', r.status === 200 && notes(7, 'Your listing was paused by Amico Haus: Describes who should live there').length === 1);
  const postHide = await mod('functions/api/posts/[id]/hide.js');
  const commentHide = await mod('functions/api/comments/[id]/hide.js');
  run("INSERT INTO posts (id, user_id, body) VALUES (710, 6, 'A post')");
  run("INSERT INTO comments (id, post_id, user_id, body) VALUES (7100, 710, 7, 'A comment')");
  r = await call(postHide.onRequestPost, 'POST', '/x', 8, { id: '710' }, { reason: 'Spam' });
  check("an admin hiding a post directly tells its author", r.status === 200 && notes(6, 'Your post was hidden: Spam').length === 1, r.text);
  r = await call(commentHide.onRequestPost, 'POST', '/x', 8, { id: '7100' }, { reason: 'Off topic' });
  check('an admin hiding a comment directly tells its author', r.status === 200 && notes(7, 'Your comment was hidden: Off topic').length === 1, r.text);
});

// ===================== S20: house rules =====================
await section('S20', async () => {
  const pages = ['app.html', 'terms.html', 'privacy.html', 'for-agents.html', 'unlock-your-zip.html', 'whats-new.html', 'demo.html', 'login.html', 'admin-seed.html'];
  const bad = pages.filter(f => /\sstyle="|\son[a-z]+="/i.test(read(f)));
  check('no style="" or on*= handlers on the pages this batch touched', bad.length === 0, bad.join(', '));
  const css = read('styles.css');
  const lastMedia = css.lastIndexOf('@media');
  const tail = css.slice(lastMedia);
  let depth = 0, end = -1;
  for (let i = tail.indexOf('{'); i < tail.length; i++) { if (tail[i] === '{') depth++; else if (tail[i] === '}' && --depth === 0) { end = i; break; } }
  check('styles.css: the last @media block is (max-width: 720px) and nothing but its closing brace follows', tail.startsWith('@media (max-width: 720px)') && end > 0 && tail.slice(end + 1).replace(/\/\*[\s\S]*?\*\//g, '').trim() === '');
  const banner = css.indexOf('.terms-update-banner');
  check('styles.css: .terms-update-banner is defined before it', banner > 0 && banner < lastMedia);
  const touched = ['terms.html', 'privacy.html', 'robots.txt', 'llms.txt', 'for-agents.html', 'unlock-your-zip.html', 'whats-new.html', 'demo.html', 'login.html', '_headers', 'page-home.js', 'admin-seed.html',
    'build-dist.js', 'listing-actions.js', 'profile-actions.js', 'report-actions.js', 'main.js', 'app.html', 'client.js', 'page-profile.js', 'agent-cards.js', 'styles.css', 'README.md',
    'functions/_lib/util.js', 'functions/_lib/mortgageCalc.js', 'functions/sitemap.xml.js', 'functions/api/public-stats.js', 'functions/api/directory.js', 'functions/listing/[id].js', 'functions/profile/[id].js',
    'functions/augmented-home/[id].js', 'functions/green-home/[id].js', 'functions/project/[id].js', 'functions/_lib/terms.js', 'functions/api/account/accept-terms.js', 'functions/api/me.js', 'functions/api/auth/signup.js',
    'functions/_lib/agents.js', 'functions/api/agents/apply.js', 'functions/api/admin/agent-applications/[id].js', 'functions/_lib/listings.js', 'functions/api/listings/index.js', 'functions/api/listings/[id].js',
    'functions/api/listings/bulk.js', 'functions/api/listings/bulk-template.js', 'functions/_lib/devProjects.js', 'functions/_lib/contactPolicy.js', 'functions/_lib/moderation.js', 'functions/_lib/marketplaceNotify.js',
    'functions/_lib/listingOffers.js', 'functions/_lib/augmentedHomeOffers.js', 'functions/_lib/greenHomeOffers.js', 'functions/api/conversations/[id]/messages.js', 'functions/_lib/email.js', 'functions/_lib/scorecard.js',
    'functions/_lib/agentDuty.js', 'functions/_lib/zipBoard.js', 'functions/api/pre-listings/[id].js', 'functions/_lib/visibility.js', 'functions/api/blocks/index.js', 'functions/_lib/transactions.js',
    'functions/api/transactions/[id]/bids/[bidId].js', 'functions/api/transactions/[id]/confirm.js', 'functions/api/admin/past-client-reviews/index.js', 'functions/api/admin/reports/[id].js',
    'tools/authz-target.js', 'tools/authz-test.js', 'tools/authz-cleanup.js', 'tools/amico-growth-report.js', 'tools/TESTING.md'];
  const names = touched.filter(f => existsSync(`${root}/${f}`) && /mckelvey|\bpatti\b|\bjeff\b/i.test(read(f)));
  check('no McKelvey / Patti / Jeff in any file this batch touched', names.length === 0, names.join(', '));
  // L1.1 has no schema change (spec decision): when a later batch adds migration_v44, update these two checks.
  const s = new DatabaseSync(':memory:');
  s.exec(read('schema.sql'));
  const tables = s.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const cols = tables.reduce((n, t) => n + s.prepare(`PRAGMA table_info(${t.name})`).all().length, 0);
  const userCols = s.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  check('schema.sql: no new tables or columns (86 tables, 747 columns, as at v43); users has terms_version + terms_accepted_at', tables.length === 86 && cols === 747 && userCols.includes('terms_version') && userCols.includes('terms_accepted_at'), `${tables.length} tables, ${cols} columns`);
  check('no migration_v44.sql in this batch', !existsSync(`${root}/migration_v44.sql`));
});

console.log = realLog;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(Math.min(failed, 125));
