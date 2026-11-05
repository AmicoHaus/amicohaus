// Checks the L1 launch kit: the video short links (/t/ /i/ /y/ /f/ and their /agents variant), the sitemap (new pages
// in, FinderMine /project/ pages out), the new /for-agents and /accessibility pages and the copy changes on the home
// page, Unlock your ZIP, privacy and llms.txt, the weekly growth report (LA week window, read-only guard, real-account
// counts on an in-memory SQLite copy of the schema, saved-week comparison, no personal data in its files), and the
// outreach drafts and skill notes kept outside the repo. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/launch-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

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
const read = (p) => readFileSync(`${root}/${p}`, 'utf8');
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
globalThis.fetch = async () => new Response('{}', { status: 200 });

// ---------------------------------------------------------------- short links
const shortLinks = await mod('functions/_lib/shortLinks.js');
const routes = { t: await mod('functions/t/[[path]].js'), i: await mod('functions/i/[[path]].js'), y: await mod('functions/y/[[path]].js'), f: await mod('functions/f/[[path]].js') };
const hit = async (path, method = 'GET') => {
  const letter = path.split('/')[1];
  const res = await routes[letter].onRequest({ request: new Request(`https://amicohaus.com${path}`, { method }), env, params: {} });
  const loc = res.headers.get('Location') || '';
  let rel = loc;
  try { const u = new URL(loc); rel = u.origin === 'https://amicohaus.com' ? u.pathname + u.search : loc; } catch { /* relative */ }
  return { status: res.status, loc: rel, cache: res.headers.get('Cache-Control'), headers: res.headers };
};
const SOURCES = { t: 'tiktok', i: 'instagram', y: 'youtube', f: 'facebook' };
for (const [letter, source] of Object.entries(SOURCES)) {
  let r = await hit(`/${letter}/mv4`);
  check(`/${letter}/mv4 -> 302 to /?utm_source=${source}&utm_medium=video&utm_campaign=mv4`, r.status === 302 && r.loc === `/?utm_source=${source}&utm_medium=video&utm_campaign=mv4`, JSON.stringify(r.loc));
  check(`/${letter}/mv4 redirect is Cache-Control: no-store`, r.cache === 'no-store', r.cache);
  r = await hit(`/${letter}/mv4/agents`);
  check(`/${letter}/mv4/agents -> /for-agents with the same tags`, r.status === 302 && r.loc === `/for-agents?utm_source=${source}&utm_medium=video&utm_campaign=mv4`, r.loc);
}
let r = await hit('/t/MV4');
check('uppercase id is lowercased (/t/MV4 -> utm_campaign=mv4)', r.loc === '/?utm_source=tiktok&utm_medium=video&utm_campaign=mv4', r.loc);
r = await hit('/i/Toon12/AGENTS');
check('uppercase /AGENTS works too', r.loc === '/for-agents?utm_source=instagram&utm_medium=video&utm_campaign=toon12', r.loc);
r = await hit('/y/iz2/');
check('a trailing slash is fine (/y/iz2/)', r.loc === '/?utm_source=youtube&utm_medium=video&utm_campaign=iz2', r.loc);
r = await hit('/t/mv4/agents/');
check('a trailing slash after /agents is fine', r.loc === '/for-agents?utm_source=tiktok&utm_medium=video&utm_campaign=mv4', r.loc);
r = await hit('/f/amico-tomorrow-ep-12');
check('hyphenated ids work', r.loc === '/?utm_source=facebook&utm_medium=video&utm_campaign=amico-tomorrow-ep-12', r.loc);
r = await hit(`/t/${'a'.repeat(40)}`);
check('a 40-character id is allowed', r.loc === `/?utm_source=tiktok&utm_medium=video&utm_campaign=${'a'.repeat(40)}`, r.loc);
for (const bad of [`/t/${'a'.repeat(41)}`, '/t/-mv4', '/t/mv_4', '/t/mv.4', '/t/mv4%3Cscript%3E', '/t/%E2%9C%93', '/t/', '/t', '/t//mv4', '/t/mv4/other', '/t/mv4/agents/extra', '/t/mv4%26utm_source%3Devil', '/t/a%20b']) {
  r = await hit(bad);
  check(`bad link ${bad} -> 302 to / with no tags`, r.status === 302 && r.loc === '/' && r.cache === 'no-store', `${r.status} ${r.loc}`);
}
r = await hit('/y/mv4', 'HEAD');
check('HEAD gets the same redirect', r.status === 302 && r.loc === '/?utm_source=youtube&utm_medium=video&utm_campaign=mv4');
check('the redirect carries the site security headers', !!r.headers.get('Strict-Transport-Security') && !!r.headers.get('X-Content-Type-Options'));
check('shortLinkTarget: unknown letter falls back to /', (await shortLinks.shortLinkRedirect({ request: new Request('https://amicohaus.com/z/mv4') }, 'z')).headers.get('Location') === 'https://amicohaus.com/');
check('shortLinkTarget pure helper', shortLinks.shortLinkTarget('tiktok', ['MV4', 'Agents']) === '/for-agents?utm_source=tiktok&utm_medium=video&utm_campaign=mv4' && shortLinks.shortLinkTarget('tiktok', []) === '/');

// ---------------------------------------------------------------- sitemap
sqlite.prepare("INSERT INTO users (id, email, display_name) VALUES (900, 'owner900@example.org', 'Owner')").run();
sqlite.prepare("INSERT INTO listings (id, user_id, city, state, property_type, estimated_value, price_tier) VALUES (900, 900, 'Chula Vista', 'CA', 'House', 700000, '600k-1m')").run();
sqlite.prepare("INSERT INTO dev_projects (id, user_id, title, city, state, project_type, status) VALUES (901, 900, 'Duplex', 'Chula Vista', 'CA', 'new_construction', 'open')").run();
const sitemap = await mod('functions/sitemap.xml.js');
const smRes = await sitemap.onRequestGet({ env, request: new Request('https://amicohaus.com/sitemap.xml') });
const sm = await smRes.text();
check('sitemap lists /for-agents', sm.includes('<loc>https://amicohaus.com/for-agents</loc>'));
check('sitemap lists /accessibility', sm.includes('<loc>https://amicohaus.com/accessibility</loc>'));
check('sitemap leaves out FinderMine /project/ pages', !sm.includes('/project/'), sm.match(/project\/\d+/)?.[0]);
check('sitemap still lists active listings', sm.includes('<loc>https://amicohaus.com/listing/900</loc>'));
check('sitemap is still well-formed XML-ish', sm.startsWith('<?xml') && sm.trim().endsWith('</urlset>'));

// ---------------------------------------------------------------- pages
const index = read('index.html'), unlock = read('unlock-your-zip.html'), forAgents = read('for-agents.html'), access = read('accessibility.html'), privacy = read('privacy.html'), llms = read('llms.txt');
const FOOTER_LEGAL = '<p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>';
const navOf = (html) => (html.match(/<nav class="tabs"[^>]*>([\s\S]*?)<\/nav>/) || [])[1]?.trim();
const authOf = (html) => (html.match(/<div class="auth-cta" id="authCta">([\s\S]*?)<\/div>/) || [])[1]?.trim();
const footerOf = (html) => (html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/) || [])[1] || '';
for (const [name, html] of [['for-agents.html', forAgents], ['accessibility.html', access]]) {
  check(`${name}: same top menu as index.html`, navOf(html) === navOf(index) && authOf(html) === authOf(index) && html.includes('<a class="agent-strip" href="/about">Presented by <strong>Rudy Flores</strong> &middot; Coldwell Banker West &middot; DRE #02257808</a>'));
  check(`${name}: same footer links as the other pages`, footerOf(html).split('\n')[1] === footerOf(unlock).split('\n')[1]);
  check(`${name}: no inline style, no on*= handlers, no inline <script>`, !/\sstyle=/i.test(html) && !/\son[a-z]+=/i.test(html) && !/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/i.test(html));
  check(`${name}: every local script and stylesheet exists`, [...html.matchAll(/(?:src|href)="((?!https?:|\/\/|\/|#|mailto|tel)[^"?#]+\.(?:js|css))"/g)].every(m => existsSync(`${root}/${m[1]}`)));
  check(`${name}: canonical URL`, html.includes(`<link rel="canonical" href="https://amicohaus.com/${name.replace('.html', '')}">`));
}
for (const [name, html] of [['index.html', index], ['unlock-your-zip.html', unlock], ['for-agents.html', forAgents], ['accessibility.html', access], ['privacy.html', privacy]]) {
  check(`${name}: footer has the Equal Housing Opportunity + Accessibility line`, footerOf(html).includes(FOOTER_LEGAL));
  check(`${name}: no McKelvey, Patti or Jeff`, !/mckelvey|patti|\bjeff\b/i.test(html));
}
// The classes the new pages use already exist in styles.css (footer-legal is B4's, added in this batch).
const css = read('styles.css');
for (const [name, html] of [['for-agents.html', forAgents], ['accessibility.html', access]]) {
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  const missing = [...classes].filter(c => c !== 'footer-legal' && !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}\\b`).test(css));
  check(`${name}: uses only classes styles.css already has`, missing.length === 0, missing.join(', '));
}

// for-agents: facts the site already states, CTAs, identity, printable
check('for-agents: free to apply in about 3 minutes', /free to apply, in about 3 minutes/i.test(forAgents));
check('for-agents: DRE license lookup before approval', forAgents.includes("Before approving an agent, Amico Haus looks up their license on the California DRE's public license lookup."));
check('for-agents: founding agents are recognition only, no leads promised, same-moment alerts', forAgents.includes('Founding is recognition only: no agent is promised leads, clients or business.') && forAgents.includes('at the same moment as everyone else'));
check('for-agents: founding caption wording', forAgents.includes('"Among the first 3 approved agents in 91913; recognition only"'));
check('for-agents: sealed price opinions', forAgents.includes("agents never see each other's numbers"));
check('for-agents: homeowners choose on strategy and track record', /strateg(y|ies) and track records?/.test(forAgents));
check('for-agents: no payments through Amico Haus + market test', forAgents.includes('No payments run through Amico Haus.') && forAgents.includes('Amico Haus is currently a market test.'));
check('for-agents: the operator line', forAgents.includes('Amico Haus is run by Rudy Flores, a Coldwell Banker West agent who may compete for the same homes.'));
check('for-agents: fee line', forAgents.includes('Each agent sets their own fees; commissions are negotiable and not set by law or by Amico Haus.'));
check('for-agents: CTAs to /signup?as=agent and /unlock-your-zip', forAgents.includes('href="/signup?as=agent"') && forAgents.includes('href="/unlock-your-zip"'));
check('for-agents: Terms of Use link for the agent rules', forAgents.includes('href="/terms#agent-rules"'));
check('for-agents: identity line printed inside the page (the footer is hidden in print)', /<main[\s\S]*Presented by Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West[\s\S]*<\/main>/.test(forAgents));
check('for-agents: buttons are hidden in print, a print button is wired by page-for-agents.js', forAgents.includes('flyer-noprint') && forAgents.includes('data-print-page') && read('page-for-agents.js').includes('window.print()'));
const JURY = /\b(vetted|verified|guarantee[sd]?|best agents?|top[- ]rated|#1|number one|leads? (are|is) guaranteed|you'?ll net|win rate)\b/i;
check('for-agents: no vouching/ranking words', !JURY.test(forAgents.replace(/<[^>]+>/g, ' ')), (forAgents.match(JURY) || [])[0]);
check('accessibility: how to ask for help via /contact', access.includes('href="/contact"') && /ask/i.test(access));
check('accessibility: no conformance claim', !/\b(fully|100%) (accessible|compliant)|is compliant|conforms to\b/i.test(access));

// index.html
const forAgentsSection = (index.match(/<div class="card audience-card" id="for-agents">([\s\S]*?)<\/div>/) || [])[1] || '';
check('index: "Why join →" link to /for-agents inside #for-agents', /<a href="\/for-agents">Why join →<\/a>/.test(forAgentsSection));
check('index: license line adds the current-status sentence with a DRE lookup link', index.includes("Check an agent's current license status anytime on the <a href=\"https://www2.dre.ca.gov/PublicASP/pplinfo.asp\""));
check('index: filter reads "Owner says no Mello-Roos"', index.includes('<option value="none">Owner says no Mello-Roos</option>') && !index.includes('No Mello-Roos only'));
check('index: the tagline stays', index.includes("Amico Haus: the real estate marketplace of tomorrow! Everything that's missing from the real estate market for the homeowner!"));
check('index: no "vetted", win rates or two-way reviews left', !/vetted|win rates?|review each other/i.test(index));

// unlock-your-zip.html
check('unlock: "agreeing to the Amico Haus Terms of Use" linking /terms', /agreeing to the <a href="\/terms(#agent-rules)?">Amico Haus Terms of Use<\/a>/.test(unlock) && !/following the Amico Haus agent rules/.test(unlock));
check('unlock: founding caption wording', unlock.includes('"Among the first 3 approved agents in 91913; recognition only"'));

// privacy.html
const ptext = privacy.replace(/<[^>]+>/g, '');
check('privacy: the "reveal your exact address after a match" promise is gone', !/reveal your exact address/i.test(ptext) && !/after a match/i.test(ptext));
check('privacy: pre-listings are shared only with approved agents', /Pre-listings are shared only with approved agents/.test(ptext));
check('privacy: blocking is described', /Blocking\./.test(ptext) && /works both ways/.test(ptext));
check('privacy: decision 2, sentence 1 verbatim', ptext.includes("When you post a pre-listing, Rudy Flores, who runs Amico Haus and also works as a real estate agent, gets an email with your name, email and the home's basics so he can run the site. He doesn't use it to contact you about your home unless you share your contact info with him, the same as any agent."));
check('privacy: decision 2, sentence 2 verbatim', ptext.includes('Amico Haus admins can see account details to run the site.'));
check('privacy: Last updated November 5, 2026', ptext.includes('Last updated November 5, 2026.'));
check('privacy: Do Not Track line', /Do Not Track/.test(ptext));
check('privacy: public pages are on the open web and indexed', /Public pages are on the open web/.test(ptext) && /index/.test(ptext));
check('privacy: §5 names members (per §3) and service providers', /5\. Data sharing<\/h2>\s*<p>We don't sell your data\. We share it only with other members as described in §3/.test(privacy) && /Cloudflare/.test(ptext));
for (const [what, re] of [['past-client review fields', /review an agent you worked with outside Amico Haus/], ['life-event tags', /why you're moving/i], ['preferred language', /a language you'd like them to speak/], ['saved searches', /Saved searches/], ['interview notes', /interview times, scorecard and notes/], ['license photos', /photo of your license/], ['accessibility alerts', /home adaptations you need/]]) check(`privacy: mentions ${what}`, re.test(ptext));
check('privacy: requests go through /contact', /requests to access, correct or delete your data, can be sent through the contact form/.test(ptext) && privacy.includes('href="/contact"'));
check('privacy: the IP sentence no longer says "used only for rate-limiting"', !/used only for rate-limiting/.test(ptext) && /Records of login and signup attempts are deleted after about two days/.test(ptext));
check('privacy: no "vetted"', !/vetted/i.test(ptext));
check('privacy: no inline style or handlers', !/\sstyle=/i.test(privacy) && !/\son[a-z]+=/i.test(privacy));

// llms.txt
check('llms: stale "self-reported, not independently verified" wording is gone', !/self-reported|not independently verified/i.test(llms));
check('llms: license lookup wording', llms.includes("license numbers are looked up on the California DRE's public lookup before approval; check current status there"));
check('llms: launch ZIPs', ['91910', '91911', '91913', '91914', '91915', '91902'].every(z => llms.includes(z)) && /Chula Vista/.test(llms) && /Bonita/.test(llms));
check('llms: founding agents are recognition only', /Founding agents[\s\S]{0,120}recognition only/i.test(llms));
check('llms: links /unlock-your-zip, /for-agents, /whats-new, /accessibility', ['/unlock-your-zip', '/for-agents', '/whats-new', '/accessibility'].every(p => llms.includes(`https://amicohaus.com${p}`)));
check('llms: free for homeowners + contact controls', /free for homeowners/i.test(llms) && /Share my contact info/.test(llms) && /Open, Weekly or Quiet/.test(llms));
check('llms: /signup and /login, never .html', llms.includes('https://amicohaus.com/signup)') && !/signup\.html|login\.html/.test(llms));
check('llms: trade-listing address is never shown to other members', llms.includes('the exact street address is never shown to other members'));
check('llms: FinderMine reframed, no investment language', /FinderMine\*\*: members post projects looking for a builder, partner or co-buyer/.test(llms) && !/invest|\bIRR\b|target return|minimum investment|fully funded|express interest|securit/i.test(llms));
check('llms: no "verified"/"vetted" claims, Equal Housing Opportunity', !/verified|vetted/i.test(llms) && llms.includes('Equal Housing Opportunity'));
check('llms: no win rate or two-way reviews', !/win rate|review each other/i.test(llms));

// build-dist publishes the new pages and script as-is (root .html/.js are copied; functions/ never is).
const build = read('build-dist.js');
check('build-dist: root .html/.js are copied and functions/ + tools/ skipped (no change needed)', /'functions', 'tools'/.test(build) && !/'for-agents|accessibility/.test(build));

// ---------------------------------------------------------------- growth report
const require = createRequire(import.meta.url);
const report = require(`${root}/tools/amico-growth-report.js`);
const zipBoard = await mod('functions/_lib/zipBoard.js');
check('report: LAUNCH_ZIPS and FOUNDING_SPOTS match functions/_lib/zipBoard.js', JSON.stringify(report.LAUNCH_ZIPS) === JSON.stringify(zipBoard.LAUNCH_ZIPS) && report.FOUNDING_SPOTS === zipBoard.FOUNDING_SPOTS);

// LA week window, across the Nov 1 2026 daylight-saving change
const w = report.weekWindow('2026-11-08');
check('report: week Nov 2-8 2026 (PST) edges in UTC', w.start === '2026-11-02' && w.from === '2026-11-02 08:00:00' && w.to === '2026-11-09 08:00:00', JSON.stringify(w));
check('report: last week Oct 26 - Nov 1 starts at PDT midnight', w.pStart === '2026-10-26' && w.pEnd === '2026-11-01' && w.pFrom === '2026-10-26 07:00:00', JSON.stringify(w));
check('report: summer midnight is 07:00 UTC, winter 08:00 UTC', report.sqlTime(report.laMidnightUtc('2026-07-04')) === '2026-07-04 07:00:00' && report.sqlTime(report.laMidnightUtc('2026-01-15')) === '2026-01-15 08:00:00');
check('report: spring-forward day midnight is still PST', report.sqlTime(report.laMidnightUtc('2026-03-08')) === '2026-03-08 08:00:00' && report.sqlTime(report.laMidnightUtc('2026-03-09')) === '2026-03-09 07:00:00');

// read-only guard
const rejects = (sql) => { try { report.assertReadOnly(sql); return false; } catch { return true; } };
for (const bad of ['DELETE FROM users', 'SELECT 1; DELETE FROM users', 'WITH x AS (SELECT 1) DELETE FROM users', 'select 1; drop table users', 'PRAGMA table_info(users)', 'UPDATE users SET role = 1', "SELECT * FROM users WHERE email LIKE '%x'", 'SELECT 1 -- hi', 'SELECT 1 /* hi */', 'SELECT "x"', 'INSERT INTO leads VALUES (1)', 'SELECT 1; ATTACH DATABASE x AS y', '', ';']) {
  check(`report guard rejects: ${bad || '(empty)'}`, rejects(bad));
}
check('report guard accepts a plain SELECT and a WITH', !rejects('SELECT COUNT(*) AS n FROM users') && !rejects('WITH a AS (SELECT 1 AS n) SELECT n FROM a'));
const queries = report.buildQueries(w);
check('report: every built statement passes the guard, uses GLOB not LIKE, and has no % or "', queries.every(([, s]) => !rejects(s) && !/\bLIKE\b/i.test(s) && !/[%"]/.test(s)));
check('report: real-account filter excludes demo, resend.dev, example.com, rudypabloflores+ tests, admins and suspended', ['*@demo.amicohaus.local', '*@resend.dev', '*@example.com', 'rudypabloflores+*@gmail.com', "role <> 'admin'", "status = 'active'"].every(p => report.realUser('u').includes(p)));
const src = readFileSync(`${root}/tools/amico-growth-report.js`, 'utf8');
check('report: never passes --file to wrangler, no McKelvey line', !/['"`]--file/.test(src.replace(/if \(\/--file\/\.test\(cmd\)\)/, '')) && !/mckelvey|patti/i.test(src));
check('report: source labels never print a raw referrer', report.referrerBucket('www.google.com') === 'Google search' && report.referrerBucket('janes-blog.example') === 'another website' && report.sourceLabel({ utm: 'TikTok', medium: 'video' }) === 'TikTok videos' && report.sourceLabel({ in_app: 'instagram' }) === 'Instagram app, no link tag' && report.sourceLabel({}) === 'direct' && report.cleanTag('<b>hi</b>') === 'other tag');

// Fixture: week Oct 26 - Nov 1, 2026 (LA). this = Oct 28, last = Oct 21, edges on both sides.
const THIS = '2026-10-28 18:00:00', LAST = '2026-10-21 18:00:00', OLD = '2026-09-01 12:00:00';
const src2 = (o) => JSON.stringify(o);
const people = [
  // id, email, name, role, status, pending, intent, source, created
  [1, 'ho1@mail.test', 'Zelda Secretname', 'user', 'active', 0, 'homeowner', src2({ utm_source: 'tiktok', utm_medium: 'video', utm_campaign: 'mv4', landing: '/' }), THIS],
  [2, 'ho2@mail.test', 'Hidden Person', 'user', 'active', 1, 'homeowner', src2({ in_app: 'instagram', landing: '/' }), '2026-11-02 07:30:00'], // Nov 1, 11:30 pm LA
  [3, 'ag3@mail.test', 'Agent Three', 'user', 'active', 0, 'agent', src2({ utm_source: 'youtube', utm_medium: 'video', utm_campaign: 'iz2', landing: '/for-agents' }), THIS],
  [4, 'ag4@mail.test', 'Agent Four', 'user', 'active', 0, 'agent', src2({ referrer: 'www.google.com', landing: '/' }), THIS],
  [5, 'ho5@mail.test', 'Last Week', 'user', 'active', 0, 'homeowner', null, LAST],
  [6, 'ho6@mail.test', 'Edge Case', 'user', 'active', 0, 'homeowner', 'not json', '2026-10-26 06:30:00'], // Oct 25, 11:30 pm LA -> last week
  [7, 'demo7@demo.amicohaus.local', 'Demo', 'user', 'active', 0, 'homeowner', src2({ utm_source: 'tiktok' }), THIS],
  [8, 'delivered+authz-1@resend.dev', 'Test', 'user', 'active', 0, 'homeowner', src2({ utm_source: 'tiktok' }), THIS],
  [9, 'test-x@example.com', 'Test', 'user', 'active', 0, 'homeowner', null, THIS],
  [10, 'rudypabloflores+snap@gmail.com', 'TEST Claude Snapshot', 'user', 'active', 0, 'homeowner', null, THIS],
  [11, 'operator@mail.test', 'Operator', 'admin', 'active', 0, 'agent', null, THIS],
  [12, 'sus12@mail.test', 'Suspended', 'user', 'suspended', 0, 'homeowner', null, THIS],
  [13, 'ag13@mail.test', 'Agent Approved', 'user', 'active', 0, 'agent', null, OLD],
  [14, 'ag14@mail.test', 'Agent Pending', 'user', 'active', 0, 'agent', null, OLD],
  [15, 'ag15@mail.test', 'Agent Old', 'user', 'active', 0, 'agent', null, OLD],
  [16, 'ag16@demo.amicohaus.local', 'Demo Agent', 'user', 'active', 0, 'agent', null, OLD],
  [17, 'ag17@mail.test', 'Agent Rejected', 'user', 'active', 0, 'agent', null, OLD],
];
for (const [id, email, name, role, status, pending, intent, source, created] of people) {
  sqlite.prepare('INSERT INTO users (id, email, display_name, role, status, email_confirmation_pending, signup_intent, signup_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, email, name, role, status, pending, intent, source, created);
}
const agent = (id, status, zips, applied, reviewed) => sqlite.prepare('INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name, service_zips_json, applied_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, status, `0123${String(id).padStart(4, '0')}`, 'Bay Realty', JSON.stringify(zips), applied, reviewed);
agent(13, 'approved', ['91913', '91915'], '2026-08-01 10:00:00', '2026-10-29 10:00:00');
agent(14, 'pending', ['91910'], '2026-10-30 12:00:00', null);
agent(15, 'approved', ['91913'], '2026-08-01 10:00:00', '2026-08-02 10:00:00');
agent(16, 'approved', ['91913'], '2026-08-01 10:00:00', '2026-08-02 10:00:00');
agent(11, 'approved', ['91913'], '2026-08-01 10:00:00', '2026-08-02 10:00:00');
agent(17, 'rejected', ['91902'], '2026-10-22 10:00:00', '2026-10-23 10:00:00');
// Founding: the demo agent was granted first but never holds a live spot; then 15, 13, 11 (since L1.1 the operator, an
// admin, never holds a spot either: same rule as the site's LIVE_FOUNDERS_SQL), then 13 in 91915.
for (const [zip, uid] of [['91913', 16], ['91913', 15], ['91913', 13], ['91913', 11], ['91915', 13]]) sqlite.prepare('INSERT INTO founding_agents (zip, agent_user_id) VALUES (?, ?)').run(zip, uid);
const pl = (id, uid, zip, created) => sqlite.prepare("INSERT INTO pre_listings (id, user_id, city, state, zip, property_type, asking_price, address, created_at) VALUES (?, ?, 'Chula Vista', 'CA', ?, 'House', 800000, '1 Private Way', ?)").run(id, uid, zip, created);
pl(50, 1, '91913', THIS); pl(51, 5, '91902', LAST); pl(52, 7, '91913', THIS); pl(53, 1, '92101', THIS);
const bid = (uid, plId, created) => sqlite.prepare("INSERT INTO service_bids (request_type, request_id, agent_user_id, created_at) VALUES ('pre_listing', ?, ?, ?)").run(plId, uid, created);
bid(13, 50, THIS); bid(15, 51, LAST); bid(11, 50, THIS);
sqlite.prepare('INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, created_at) VALUES (50, 13, 810000, ?)').run(THIS);
sqlite.prepare("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote, created_at) VALUES (50, 15, 'just_right', ?)").run(THIS);
sqlite.prepare("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote, created_at) VALUES (50, 16, 'too_high', ?)").run(THIS);
sqlite.prepare('INSERT INTO conversations (id, user_a_id, user_b_id) VALUES (70, 1, 13), (71, 5, 15), (72, 1, 11)').run();
const msg = (conv, uid, created) => sqlite.prepare("INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, 'Secret message text', ?)").run(conv, uid, created);
msg(70, 1, THIS); msg(70, 1, THIS); msg(70, 13, THIS); msg(70, 13, LAST); msg(71, 5, THIS); msg(72, 11, THIS);
sqlite.prepare('INSERT INTO contact_shares (pre_listing_id, owner_id, agent_id, shared_at) VALUES (50, 1, 13, ?)').run(THIS);
sqlite.prepare('INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, created_at) VALUES (50, 13, ?)').run(THIS);
sqlite.prepare("INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id, created_at) VALUES ('pre_listing', 50, 15, 1, ?)").run(THIS);
const lead = (email, source, created) => sqlite.prepare("INSERT INTO leads (name, email, message, ip, source, created_at) VALUES ('Lead Name', ?, 'Call me', '203.0.113.9', ?, ?)").run(email, source, created);
lead('lead@mail.test', src2({ utm_source: 'tiktok', utm_medium: 'video', utm_campaign: 'mv4' }), THIS);
lead('delivered+x@resend.dev', src2({ utm_source: 'tiktok', utm_campaign: 'mv4' }), THIS);
lead('rudypabloflores@gmail.com', null, THIS);

const outDir = mkdtempSync(join(tmpdir(), 'amico-growth-'));
const runSql = (stmts) => stmts.map((s) => { report.assertReadOnly(s); return sqlite.prepare(s).all(); });
const one = report.run({ end: '2026-11-01', runSql, outDir, now: new Date('2026-11-02T17:00:00Z') });
const T = one.data.thisWeek, Lw = one.data.lastWeek, D = one.S;
check('report: signups this week = 4 real (3 confirmed, 1 pending), test/demo/admin/suspended left out', T.signups === 4 && T.signupsConfirmed === 3 && T.signupsPending === 1, JSON.stringify(T));
check('report: 2 homeowners + 2 agents this week; 2 homeowners last week (incl. the 11:30 pm edge)', T.homeowners === 2 && T.agentSignups === 2 && Lw.homeowners === 2 && one.data.lastWeekFrom === 'recounted', JSON.stringify(Lw));
check('report: sources bucketed (TikTok videos, Instagram app, YouTube videos, Google search)', ['TikTok videos', 'Instagram app, no link tag', 'YouTube videos', 'Google search'].every(k => D.signups.cur.bySource[k] && D.signups.cur.bySource[k].total === 1), JSON.stringify(Object.keys(D.signups.cur.bySource)));
const mv4 = D.campaigns.find(c => c.campaign === 'mv4'), iz2 = D.campaigns.find(c => c.campaign === 'iz2');
check('report: video campaigns (mv4: 1 signup + 1 contact message on TikTok; iz2: 1 agent signup on YouTube)', mv4 && mv4.platform === 'tiktok' && mv4.weekSignups === 1 && mv4.weekLeads === 1 && iz2 && iz2.platform === 'youtube' && iz2.agent === 1, JSON.stringify(D.campaigns));
check('report: contact messages = 1 real (test and Rudy\'s own left out)', T.leads === 1);
check('report: agent applications (1 applied, 1 approved this week, 1 waiting, 2 approved in total)', D.agents.applied.cur === 1 && D.agents.applied.prev === 1 && D.agents.approved.cur === 1 && D.agents.pendingBacklog === 1 && D.agents.approvedTotal === 2, JSON.stringify(D.agents));
check('report: 2 signed up as agents but never applied', D.agents.neverApplied.confirmed === 2 && D.agents.neverApplied.confirmedThisWeek === 2);
const z13 = D.zips.find(z => z.zip === '91913'), z15 = D.zips.find(z => z.zip === '91915');
check('report: launch ZIP agents + founding spots (91913: 3 agents, 2 of 3 taken since the operator never holds one; 91915: 1 of 3)', z13.agents === 3 && z13.foundingTaken === 2 && z13.foundingOpen === 1 && z15.agents === 1 && z15.foundingTaken === 1 && D.foundingTaken === 3 && D.foundingSpots === 18, JSON.stringify(D.zips));
const board = await zipBoard.fetchZipBoard(DB);
check('report: founding and agent counts match the live ZIP board for every ZIP', board.every(b => { const z = D.zips.find(x => x.zip === String(b.zip)); return z && z.foundingTaken === b.foundingTaken && z.agents === b.agents; }), JSON.stringify(board.map(b => [b.zip, b.agents, b.foundingTaken])));
check('report: new pre-listings by ZIP (91913 + 92101 this week, 91902 last week; demo left out)', T.preListings === 2 && Lw.preListings === 1 && D.preListings.byZip['91913'].cur === 1 && D.preListings.byZip['92101'].cur === 1 && D.preListings.openNow === 3, JSON.stringify(D.preListings));
check('report: activity counts (operator and demo left out)', T.proposals === 1 && Lw.proposals === 1 && T.opinions === 1 && T.votes === 1 && T.messages === 4 && Lw.messages === 1 && T.conversations === 2 && T.contactShares === 1 && T.interviews === 1 && T.invites === 1, JSON.stringify(T));
const plainNotes = one.notes.join(' | ').replace(/<[^>]+>/g, '');
check('report: plain-English notes at the top', plainNotes.includes('2 new homeowners this week (1 still confirming their email), 1 from') && plainNotes.includes('Founding spots: 3 of 18 taken') && plainNotes.includes('Top campaign this week: mv4 on TikTok'), plainNotes);
check('report: files written (dated html, latest, dated json)', existsSync(join(outDir, 'amico-growth-2026-11-01.html')) && existsSync(join(outDir, 'amico-growth-latest.html')) && existsSync(join(outDir, 'amico-growth-2026-11-01.json')));
const html = readFileSync(join(outDir, 'amico-growth-latest.html'), 'utf8'), jsonText = readFileSync(join(outDir, 'amico-growth-2026-11-01.json'), 'utf8');
check('report: title "Amico Haus Weekly Growth", no McKelvey line', html.includes('<title>Amico Haus Weekly Growth</title>') && !/mckelvey|patti/i.test(html + jsonText));
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
check('report: no emails, names, addresses, message text, IPs or raw referrers in the html or json', !EMAIL.test(html.replace(/@media/g, '')) && !EMAIL.test(jsonText) && !/Zelda|Secretname|Hidden Person|Private Way|Secret message|203\.0\.113|www\.google\.com|Lead Name/.test(html + jsonText));
// A week later, last week's numbers come from the saved report.
sqlite.prepare("DELETE FROM users WHERE id = 2").run(); // the pending signup expired, so a recount would read low
const two = report.run({ end: '2026-11-08', runSql, outDir, now: new Date('2026-11-09T17:00:00Z') });
check('report: next week compares with last week\'s saved JSON, not a recount', two.data.lastWeekFrom === 'saved' && two.data.lastWeek.homeowners === 2 && two.data.lastWeek.signups === 4, JSON.stringify(two.data.lastWeek));
rmSync(outDir, { recursive: true, force: true });

// ---------------------------------------------------------------- outside the repo: drafts and skills
const launchDir = join(root, '..', 'outputs', 'amico-launch');
const ID_LINE = 'Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West';
if (existsSync(launchDir)) {
  const agentMd = readFileSync(join(launchDir, 'agent-invite.md'), 'utf8'), homeMd = readFileSync(join(launchDir, 'homeowner-invite.md'), 'utf8'), readme = readFileSync(join(launchDir, 'README.md'), 'utf8');
  const section = (md, h) => (md.split(/^## /m).find(s => s.startsWith(h)) || '').split('\n').slice(1).join('\n').replace(/\n---\s*$/, '').trim();
  const agentText = section(agentMd, 'Text');
  check(`drafts: agent text is 320 characters or less (${agentText.length})`, agentText.length > 0 && agentText.length <= 320);
  for (const [name, md, sections] of [['agent', agentMd, ['Text', 'Email', 'Short DM']], ['homeowner', homeMd, ['Text', 'Email', 'Social post']]]) {
    for (const h of sections) check(`drafts: ${name} ${h} carries the identity line`, section(md, h).includes(ID_LINE));
    check(`drafts: ${name} links carry the right tags`, name === 'agent'
      ? ['text', 'email', 'dm'].every(m => md.includes(`https://amicohaus.com/for-agents?utm_source=rudy&utm_medium=${m}&utm_campaign=founding-agents`))
      : ['text', 'email', 'social'].every(m => md.includes(`https://amicohaus.com/?utm_source=rudy&utm_medium=${m}&utm_campaign=homeowners`)));
    check(`drafts: ${name} has no McKelvey, rewards, income or lead promises, or fair-housing slips`, !/mckelvey|patti|\bjeff\b|gift card|reward|referral fee|bonus|\bearn\b|income|guarantee|family-friendly|school|safe neighborhood/i.test(md.replace(/no agent is promised leads, clients or business/g, '')));
  }
  check('drafts: README explains the short-link format', /amicohaus\.com\/t\/<video-id>/.test(readme) && /\/agents/.test(readme));
} else check('drafts: outputs/amico-launch exists', false, launchDir);
const skillPath = join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'skills', 'yuploadingz', 'SKILL.md');
if (existsSync(skillPath)) {
  const skill = readFileSync(skillPath, 'utf8');
  check('yuploadingz: Amico short-link rules', skill.includes('https://amicohaus.com/y/<video-id>') && skill.includes('amicohaus.com/t/<video-id>') && skill.includes('amicohaus.com/i/<video-id>') && skill.includes('amico-links.json'));
  check('yuploadingz: compliance lines and the no-McKelvey rule untouched', skill.includes('**Amico Haus exception (Rudy 2026-10-26):** anything about Amico Haus, on ANY account, never mentions Patti, Jeff or the McKelvey Team.') && skill.includes('`Presented by Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West · Responsible Broker CalDRE #01481919 · Equal Housing Opportunity` on @amicohaus'));
  const prep = readFileSync(join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'scheduled-tasks', 'daily-youtube-short-prep', 'SKILL.md'), 'utf8');
  check('daily-youtube-short-prep: Amico exception + current ffmpeg path', prep.includes('Amico Haus videos never carry the McKelvey team line') && prep.includes('skills\\videoultimaeditz\\engine\\node_modules\\ffmpeg-static\\ffmpeg.exe') && !prep.includes('madskillzvideditz'));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
