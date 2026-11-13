// Runs the real code for the Monday seller report (owner tools batch) against an in-memory SQLite stand-in for D1:
// the Monday 07:00 to Wednesday Pacific window, who gets it, the claim-once-per-week and retry rules, scorecards going
// first, the email's wording (activity on Amico Haus only: no price, value, address, ZIP, agent names or tagline),
// the one-click stop (GET shows a button, POST stops it, no login), the account setting, quiet-hour holds (sent on
// their own, re-checked for the opt-out) and the lazy-job order. Emails are captured by a stubbed fetch. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/seller-report-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const read = (f) => readFileSync(`${root}/${f}`, 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON;');
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
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? stmt.all() : stmt.run()),
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
let failSends = false;
globalThis.fetch = async (url, opts) => {
  if (failSends) return new Response('{}', { status: 500 });
  sent.push(JSON.parse(opts.body));
  return new Response('{}', { status: 200 });
};
const ctx = { env, request: new Request('https://amicohaus.com/api/x'), waitUntil() {} };
const call = async (handler, method, path, who, body) => {
  const request = new Request(`https://amicohaus.com${path}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler({ request, env, params: {}, waitUntil() {} });
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: type.includes('json') && text ? JSON.parse(text) : null };
};
const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const noStore = (r) => /private/.test(r.headers.get('Cache-Control') || '') && /no-store/.test(r.headers.get('Cache-Control') || '');
console.log = () => {};

const duty = await mod('functions/_lib/agentDuty.js');
const lib = await mod('functions/_lib/sellerReport.js');
const scorecard = await mod('functions/_lib/scorecard.js');
const { EMAIL_POSTAL_LINE } = await mod('functions/_lib/email.js');
const reportApi = await mod('functions/api/account/seller-report.js');
const unsub = await mod('functions/api/account/seller-report-unsubscribe.js');
const auth = await mod('functions/_lib/auth.js');

const user = (id, extra = {}) => {
  run('INSERT INTO users (id, email, display_name, status, email_confirmation_pending, seller_report_opt_out, quiet_start, quiet_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, extra.email ?? `u${id}@example.test`, extra.name ?? `Owner ${id}`, extra.status ?? 'active', extra.pending ?? 0, extra.optOut ?? 0, extra.quietStart ?? null, extra.quietEnd ?? null);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
const home = (id, owner, extra = {}) => run(
  `INSERT INTO pre_listings (id, user_id, title, city, state, zip, property_type, beds, baths, asking_price, address, status, proposals_due_at, video_r2_key, awarded_at, created_at)
   VALUES (?, ?, 'Home', 'Chula Vista', 'CA', '91913', ?, 3, 2, 750000, '1218 La Vida Ct', ?, ?, ?, ?, ?)`,
  id, owner, extra.type ?? 'Single Family Home', extra.status ?? 'open', extra.due ?? null, extra.video ?? null, extra.awardedAt ?? null, extra.createdAt ?? '2026-10-01 00:00:00');

// The next Monday 9am Pacific from now (this week's activity, made "now", falls inside its 7-day window).
const at = duty.pacificToUtcMs;
let mondayMs = Date.now();
while (duty.pacificParts(mondayMs).weekday !== 1) mondayMs += 86400000;
const mp = duty.pacificParts(mondayMs);
const monday7 = at(mp.year, mp.month, mp.day, 7, 0) >= Date.now() - 6 * 86400000 ? at(mp.year, mp.month, mp.day, 7, 0) : at(mp.year, mp.month, mp.day + 7, 7, 0);
const monday9 = monday7 + 2 * 3600000;
const week = scorecard.scorecardWeek(monday9);

// Quiet hours that cover the real "now" (sendOrHoldEmail decides on the real clock).
const nowH = duty.pacificParts().hour;
const hh = (h) => `${String((h + 24) % 24).padStart(2, '0')}:00`;

// People: 1 owner with lots going on, 2 approved agent "Alice Agentname", 3 agent the owner blocked "Bob Blocked",
// 4 demo owner, 5 suspended owner, 6 test (@resend.dev) owner, 7 unconfirmed email, 8 opted out, 9 only a closed home,
// 12 owner hired 2 days ago (checklist), 13 open home with nothing new, 14 owner in quiet hours right now.
user(1, { name: 'Pat Owner' });
user(2, { name: 'Alice Agentname' }); user(3, { name: 'Bob Blocked' });
user(4, { email: 'o4@demo.amicohaus.local' }); user(5, { status: 'suspended' }); user(6, { email: 'authz-x@Resend.dev' });
user(7, { pending: 1 }); user(8, { optOut: 1 }); user(9); user(12); user(13); user(14, { quietStart: hh(nowH - 1), quietEnd: hh(nowH + 2) });
for (const id of [2, 3]) run("INSERT INTO agent_profiles (user_id, status, license_number, brokerage_name) VALUES (?, 'approved', ?, 'Agent Realty')", id, `0${id}000000`.slice(0, 8));
run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 3)');

const dueIso = new Date(monday9 + 3 * 86400000).toISOString();
home(10, 1, { due: dueIso });                       // sealed Decision Night, no video
home(11, 1, { type: 'Condo', video: 'k/v.mp4' });     // a second home
for (const [id, owner] of [[40, 4], [50, 5], [60, 6], [70, 7], [80, 8]]) home(id, owner);
home(90, 9, { status: 'closed' });
home(120, 12, { status: 'awarded', awardedAt: '2026-01-01 00:00:00' });
run("UPDATE pre_listings SET awarded_at = datetime('now', '-2 days') WHERE id = 120");
home(130, 13, { video: 'k/x.mp4' });
home(140, 14);
// Activity on home 10 this week.
run("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (10, 2, 'too_high'), (10, 3, 'too_low')");
run("INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion) VALUES (10, 2, 765000), (10, 3, 700000)");
run("INSERT INTO service_bids (request_type, request_id, agent_user_id, commission_pct, status) VALUES ('pre_listing', 10, 2, 2.5, 'pending'), ('pre_listing', 10, 3, 2.0, 'pending')");
run('INSERT INTO pre_listing_showings (pre_listing_id, agent_user_id, proposed_at, status) VALUES (10, 2, ?, ?)', new Date(monday9 + 2 * 86400000).toISOString(), 'pending');
run("INSERT INTO pre_listing_visit_feedback (pre_listing_id, agent_user_id, visit_kind, visit_id, visit_at, price, condition, top_prep) VALUES (10, 2, 'showing', 1, '2026-11-01T18:00:00.000Z', 'high', 'ready', 'none')");
run("INSERT INTO pre_listing_visit_feedback (pre_listing_id, agent_user_id, visit_kind, visit_id, visit_at, skipped) VALUES (10, 2, 'showing', 2, '2026-11-01T18:00:00.000Z', 1)");
// Home 11: one RSVP and one scheduled interview.
run("INSERT INTO pre_listing_previews (id, pre_listing_id, starts_at, ends_at) VALUES (1, 11, '2026-12-01T18:00:00.000Z', '2026-12-01T19:00:00.000Z')");
run('INSERT INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (1, 2)');
run("INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, status) VALUES (11, 2, 'scheduled')");
// Home 120: hired, 2 of 5 steps checked (one this week).
for (let i = 0; i < 5; i++) run("INSERT INTO bid_milestones (request_type, request_id, label, is_done, done_at) VALUES ('pre_listing', 120, ?, ?, ?)", `Step ${i}`, i < 2 ? 1 : 0, i === 0 ? one("SELECT datetime('now') AS t").t : i === 1 ? '2026-01-01 00:00:00' : null);
// Activity on every "never gets it" home, so only the who-rules keep them out.
for (const id of [40, 50, 60, 70, 80, 90, 140]) run("INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote) VALUES (?, 2, 'just_right')", id);

// ---- 1. The report itself ----
statements = 0;
let report = await lib.buildSellerReport(DB, 1, monday9);
// 5 since 11.05: the 11-term counts query runs as 3 chunks of at most 5 terms (D1's compound SELECT limit, compoundSelect.js).
check('buildSellerReport runs at most 5 statements', statements <= 5, String(statements));
const h10 = report.homes.find(h => h.id === 10);
const h11 = report.homes.find(h => h.id === 11);
check('home 10: one vote (the blocked agent left out), one opinion, sealed proposals waiting, a showing request, a visit with feedback',
  h10.lines.join('|') === `1 new price feedback vote from agents|1 agent shared a price opinion|1 proposal waiting for your Decision Night on ${new Date(dueIso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })}|1 showing request waiting for your answer|1 agent left quick feedback after a visit. See what they said in the app.`, JSON.stringify(h10.lines));
check('home 10: next step is the showing request', h10.nextStep === 'Answer your showing request.');
check('home 11: RSVP and interview lines; next step none (it has a video)', h11.lines.join('|') === "1 agent RSVP'd to your broker preview|1 interview scheduled" && h11.nextStep === '', JSON.stringify(h11));
const r12 = await lib.buildSellerReport(DB, 12, monday9);
check('a home hired in the last 30 days: the hire checklist line and "Start your handoff binder."', r12 && r12.homes[0].lines.join() === 'Hire checklist: 2 of 5 steps checked' && r12.homes[0].nextStep === 'Start your handoff binder.' && r12.homes[0].news === true, JSON.stringify(r12));
check('only closed homes: no report', (await lib.buildSellerReport(DB, 9, monday9)) === null);
check('a demo owner: no report', (await lib.buildSellerReport(DB, 4, monday9)) === null);
check('a suspended owner: no report', (await lib.buildSellerReport(DB, 5, monday9)) === null);
check('nothing new on home 13: the report says so (news false)', (await lib.buildSellerReport(DB, 13, monday9)).homes[0].news === false);
run("UPDATE pre_listings SET proposals_due_at = ? WHERE id = 10", new Date(monday9 - 86400000).toISOString());
run("UPDATE pre_listing_showings SET status = 'declined' WHERE pre_listing_id = 10");
let rr = await lib.buildSellerReport(DB, 1, monday9);
check('after Decision Night: new proposals counted, next step "Compare your proposals."', rr.homes.find(h => h.id === 10).lines.includes('1 new proposal') && rr.homes.find(h => h.id === 10).nextStep === 'Compare your proposals.', JSON.stringify(rr.homes[0]));
run("UPDATE service_bids SET status = 'withdrawn' WHERE request_id = 10 AND agent_user_id = 2");
rr = await lib.buildSellerReport(DB, 1, monday9);
check('no live proposal and no video: "Add a walkthrough video."', rr.homes.find(h => h.id === 10).nextStep === 'Add a walkthrough video.');
run("UPDATE service_bids SET status = 'pending' WHERE request_id = 10 AND agent_user_id = 2");
run("UPDATE pre_listing_showings SET status = 'pending' WHERE pre_listing_id = 10");
run("UPDATE pre_listings SET proposals_due_at = ? WHERE id = 10", dueIso);

const mail = await lib.sellerReportEmail(ctx, 1, report, monday9);
const token = await lib.sellerReportUnsubscribeToken(env, 1);
check('subject: "Your week on Amico Haus (<week>)"', /^Your week on Amico Haus \([A-Z][a-z]{2} \d{1,2} to [A-Z][a-z]{2} \d{1,2}\)$/.test(mail.subject), mail.subject);
check('the email: greeting, the "on Amico Haus only" line, both homes with their links', mail.text.startsWith('Hi Pat Owner,\n') && mail.text.includes('Everything below is activity on Amico Haus only.')
  && mail.text.includes('Single Family Home in Chula Vista') && mail.text.includes('Condo in Chula Vista') && mail.text.includes('Open your home: https://amicohaus.com/app#pre-listing-10') && mail.text.includes('Open your home: https://amicohaus.com/app#pre-listing-11'), mail.text);
check('the email: the unsubscribe link with a valid token, then the postal line last', mail.text.includes(`Stop these emails: https://amicohaus.com/api/account/seller-report-unsubscribe?u=1&t=${token}`) && /^[0-9a-f]{32}$/.test(token) && mail.text.trimEnd().endsWith(EMAIL_POSTAL_LINE));
check('the email: no $, price, median, average, worth, value or appraisal', !/\$|\bprice\b \$|median|average|worth|value|appraisal/i.test(mail.text + mail.subject), mail.text);
check('the email: no street address or ZIP', !/1218|La Vida|91913/.test(mail.text));
check('the email: no agent names', !/Alice|Agentname|Bob|Blocked|Agent Realty|DRE #0[23]000000/.test(mail.text));
check('the email: no tagline', !/marketplace of tomorrow|missing from the real estate market/i.test(mail.text));
check('the email: no buyer-demand trend', !/buyers?|demand/i.test(mail.text));
check('the email: only nonzero lines', !/(^|\n)- 0 /.test(mail.text));

// ---- 2. The window ----
check('Sunday: nothing', (await lib.runDueSellerReports(ctx, { nowMs: monday7 - 86400000, limit: 20 })) === 0 && !q('SELECT id FROM users WHERE seller_report_week IS NOT NULL').length);
check('Monday 06:59: nothing', (await lib.runDueSellerReports(ctx, { nowMs: monday7 - 60000, limit: 20 })) === 0 && !q('SELECT id FROM users WHERE seller_report_week IS NOT NULL').length);
check('Thursday: nothing', (await lib.runDueSellerReports(ctx, { nowMs: monday7 + 3 * 86400000, limit: 20 })) === 0 && !q('SELECT id FROM users WHERE seller_report_week IS NOT NULL').length);

// ---- 3. Scorecards go first ----
statements = 0;
let n = await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 });
check("while this week's scorecards are unclaimed: nothing claimed, one statement", n === 0 && statements === 1 && !q('SELECT id FROM users WHERE seller_report_week IS NOT NULL').length, `${n} ${statements}`);
run("UPDATE agent_profiles SET scorecard_sent_week = ? WHERE user_id = 2", week);
n = await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 });
check('still one unsent scorecard (agent 3): still nothing', n === 0);
run("UPDATE agent_profiles SET scorecard_sent_week = ? WHERE user_id = 3", week);

// ---- 4. Sending ----
sent.length = 0;
const t0 = Date.now();
n = await lib.runDueSellerReports(ctx, { nowMs: monday7 + 1000, limit: 20, budgetMs: 60000 });
const to = sent.map(m => m.to).sort();
check('Monday 07:00: owners with news get it (1 and 12); 14 is held for quiet hours', n === 3 && to.join() === 'u12@example.test,u1@example.test', `${n} ${to.join()}`);
check('who never gets it: demo, suspended, @resend.dev, unconfirmed, opted out, only closed homes', !q('SELECT id FROM users WHERE id IN (4, 5, 6, 7, 8, 9) AND seller_report_week IS NOT NULL').length);
check('nothing new (owner 13): claimed for the week, not emailed', one('SELECT seller_report_week AS w FROM users WHERE id = 13').w === week && !sent.some(m => m.to === 'u13@example.test'));
check('the held copy for the quiet-hours owner is kind seller_report', one("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 14 AND kind = 'seller_report' AND sent_at IS NULL").n === 1);
check('agents never get the seller report', !sent.some(m => /u[23]@/.test(m.to)));
check('the sent email is the real one (unsubscribe + postal line)', sent.some(m => m.to === 'u1@example.test' && m.text.includes('seller-report-unsubscribe?u=1&t=') && m.text.includes(EMAIL_POSTAL_LINE)));
check('sends are paced about 600 ms apart', Date.now() - t0 >= 2 * 550, String(Date.now() - t0));
sent.length = 0;
check('once per person per week', (await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 })) === 0 && sent.length === 0);

// A failed send releases the week, up to 3 tries.
run('UPDATE users SET seller_report_week = NULL WHERE id = 1');
failSends = true;
await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 });
check('a failed send releases the week for a later run (1 failure counted)', one('SELECT seller_report_week AS w, seller_report_failures AS f FROM users WHERE id = 1').w === null && one('SELECT seller_report_failures AS f FROM users WHERE id = 1').f === 1);
await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 });
await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 });
let u1 = one('SELECT seller_report_week AS w, seller_report_failures AS f FROM users WHERE id = 1');
check('after 3 failed tries it stays claimed for the week (no 4th try) and the counter resets', u1.w === week && u1.f === 0, JSON.stringify(u1));
failSends = false;
run('UPDATE users SET seller_report_week = NULL WHERE id = 1');
sent.length = 0;
check('...and a later week (here: released) goes out again', (await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 })) === 1 && sent[0].to === 'u1@example.test');

// Budget: with budgetMs ~0, one person is started, the rest stay unclaimed.
run("UPDATE users SET seller_report_week = NULL WHERE id IN (1, 12)");
sent.length = 0;
n = await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20, budgetMs: 300 });
check('the job stops starting new people after budgetMs', n === 1 && q("SELECT id FROM users WHERE id IN (1, 12) AND seller_report_week IS NULL").length === 1, String(n));
run("UPDATE users SET seller_report_week = ? WHERE id IN (1, 12)", week);

// Statements for one report: candidates, claim, build (3), reset = 6.
run('UPDATE users SET seller_report_week = NULL WHERE id = 1');
statements = 0;
await lib.runDueSellerReports(ctx, { nowMs: monday9, limit: 20 });
check('one seller report costs at most 8 statements (counts query in 3 chunks)', statements <= 8, String(statements));

// ---- 5. Held copies ----
run("UPDATE held_emails SET deliver_after = '2000-01-01T00:00:00.000Z' WHERE user_id = 14");
run("INSERT INTO held_emails (user_id, kind, subject, text_body, deliver_after) VALUES (14, 'owner_alert', 'New proposal on Amico Haus', 'A new proposal came in.', '2000-01-01T00:00:00.000Z')");
sent.length = 0;
await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
const toOwner14 = sent.filter(m => m.to === 'u14@example.test');
const sr = toOwner14.find(m => /^Your week on Amico Haus/.test(m.subject));
check('a held seller report goes out on its own, never bundled with an owner alert', toOwner14.length === 2 && sr && !/updates from Amico Haus/.test(sr.subject) && sr.text.includes('seller-report-unsubscribe?u=14&t=') && sr.text.trimEnd().endsWith(EMAIL_POSTAL_LINE), JSON.stringify(toOwner14.map(m => m.subject)));
run("INSERT INTO held_emails (user_id, kind, subject, text_body, deliver_after) VALUES (14, 'seller_report', 'Your week on Amico Haus (x)', 'Hi', '2000-01-01T00:00:00.000Z')");
run('UPDATE users SET seller_report_opt_out = 1 WHERE id = 14');
sent.length = 0;
await duty.runDueHeldEmails(ctx, { budgetMs: 60000 });
check('opted out since it was held: dropped (claimed, not sent)', sent.length === 0 && one("SELECT COUNT(*) AS n FROM held_emails WHERE user_id = 14 AND sent_at IS NULL").n === 0);
check('seller_report is a person hold kind (waits for quiet hours, re-timed with them)', duty.PERSON_HOLD_KINDS.includes('seller_report') && !duty.AGENT_HOLD_KINDS.includes('seller_report'));

// ---- 6. The stop link (no login) ----
let r = await call(unsub.onRequestGet, 'GET', `/api/account/seller-report-unsubscribe?u=1&t=${token}`, null);
check('opening the link shows the question and a button, and changes nothing', r.status === 200 && r.text.includes('<h1>Stop the Monday email?</h1>') && r.text.includes("You won&#39;t get the Monday summary about your home anymore. You can turn it back on in your account settings.")
  && r.text.includes('<button type="submit" class="btn btn-primary">Stop the Monday email</button>') && r.text.includes('method="post"') && one('SELECT seller_report_opt_out AS o FROM users WHERE id = 1').o === 0, r.text);
check('the page is noindex, private no-store, with the security headers (CSP)', /noindex/.test(r.text) && noStore(r) && /default-src 'self'/.test(r.headers.get('Content-Security-Policy') || ''));
check('the page has no inline style, handler or script', !/\sstyle\s*=|\son[a-z]+\s*=|<script/i.test(r.text));
r = await call(unsub.onRequestGet, 'GET', `/api/account/seller-report-unsubscribe?u=1&t=${'0'.repeat(32)}`, null);
check("a bad token: \"This link didn't work\" page, nothing changes", r.text.includes("This link didn&#39;t work. You can turn the Monday email off in your account settings.") && one('SELECT seller_report_opt_out AS o FROM users WHERE id = 1').o === 0);
r = await call(unsub.onRequestPost, 'POST', `/api/account/seller-report-unsubscribe?u=1&t=${'0'.repeat(32)}`, null);
check('a bad token POST changes nothing', one('SELECT seller_report_opt_out AS o FROM users WHERE id = 1').o === 0);
const token12 = await lib.sellerReportUnsubscribeToken(env, 12);
r = await call(unsub.onRequestPost, 'POST', `/api/account/seller-report-unsubscribe?u=1&t=${token12}`, null);
check("one person's token can't stop another's email", one('SELECT seller_report_opt_out AS o FROM users WHERE id = 1').o === 0);
r = await call(unsub.onRequestPost, 'POST', `/api/account/seller-report-unsubscribe?u=1&t=${token}`, null);
check('the button (POST, no login) stops it', r.status === 200 && r.text.includes('Done. The Monday email about your home is off.') && one('SELECT seller_report_opt_out AS o FROM users WHERE id = 1').o === 1 && noStore(r));

// ---- 7. The account setting ----
r = await call(reportApi.onRequestGet, 'GET', '/api/account/seller-report', 1);
check('GET /api/account/seller-report: optOut and this week\'s report, without the email address or the send window', r.status === 200 && r.json.optOut === true && r.json.report && !('email' in r.json.report) && !('duty' in r.json.report) && noStore(r), r.text.slice(0, 200));
r = await call(reportApi.onRequestPut, 'PUT', '/api/account/seller-report', 1, { optOut: false });
check('PUT { optOut: false } turns it back on', r.status === 200 && r.json.ok === true && r.json.optOut === false && one('SELECT seller_report_opt_out AS o FROM users WHERE id = 1').o === 0);
r = await call(reportApi.onRequestPut, 'PUT', '/api/account/seller-report', 1, { optOut: 'yes' });
check('PUT with a non-boolean is a 400', r.status === 400);
r = await call(reportApi.onRequestGet, 'GET', '/api/account/seller-report', null);
check('signed out: 401', r.status === 401);
r = await call(reportApi.onRequestGet, 'GET', '/api/account/seller-report', 9);
check('someone with only a closed home: report null', r.status === 200 && r.json.report === null);
const pu = auth.publicUser({ id: 1, seller_report_opt_out: 1 });
check('publicUser carries sellerReportOptOut', pu.sellerReportOptOut === true && auth.publicUser({ id: 2, seller_report_opt_out: 0 }).sellerReportOptOut === false);
const acct = read('account-security.html');
check('account page: the Monday email checkbox with its label and hint', acct.includes('<div class="field"><label class="checkbox-row" for="sellerReportToggle"><input type="checkbox" id="sellerReportToggle"><span>Monday email about my home</span></label><p class="tiny field-hint">A short Monday summary of activity on your home, on Amico Haus only.</p></div>'));
const pas = read('page-account-security.js');
check("account page script: checked = !sellerReportOptOut, PUT on change, revert on error", pas.includes("document.getElementById('sellerReportToggle').checked = !user.sellerReportOptOut;") && pas.includes("apiPut('/api/account/seller-report', { optOut })") && pas.includes('e.target.checked = !user.sellerReportOptOut;'));

// ---- 8. Lazy jobs ----
const mw = read('functions/api/_middleware.js');
check('_middleware.js job order exact', mw.includes('[runDueDecisionNights, runDueHeldEmails, runDueWeeklyMessages, runDueScorecards, runDueReadyNudges, runDueVisitFeedbackPrompts, runDueSellerReports, runDueHeadStarts, runDueStepDowns, runPurgeExpiredTrash, runPruneActionLogs]'));
check('_middleware.js: the jobs share a statement budget (D1 Free ~50 per invocation) and run on a counting view',
  mw.includes('const JOB_STATEMENT_BUDGET = 30;') && mw.includes('if (Date.now() - now > 22000 || used.n >= JOB_STATEMENT_BUDGET) break;') &&
  mw.includes('try { await job(jobContext); }') && mw.includes('batch: (stmts) => { used.n += stmts.length;'));
check('default batch sizes: 2 seller reports and 3 scorecards a run',
  read('functions/_lib/sellerReport.js').includes('export async function runDueSellerReports(context, { limit = 2,') &&
  read('functions/_lib/scorecard.js').includes('export async function runDueScorecards(context, { limit = 3,'));
// The counting view passes statements through unchanged (bind, first/all/run, batch of wrapped statements).
{
  const mwMod = await mod('functions/api/_middleware.js');
  let waited = null;
  const seen = [];
  const fakeDb = {
    prepare: (sql) => { const st = { sql, bind: () => st, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }), raw: async () => [] }; return st; },
    batch: async (stmts) => { seen.push(stmts.every(s => typeof s.sql === 'string')); return stmts.map(() => ({ results: [] })); },
  };
  const res = await mwMod.onRequest({ request: new Request('https://amicohaus.com/api/me'), env: { DB: fakeDb }, waitUntil: (p) => { waited = p; }, next: async () => new Response('{}'), data: {}, params: {} });
  let jobsOk = true;
  const quiet = console.log;
  console.log = (m) => { if (/due jobs failed/.test(String(m))) jobsOk = false; };
  try { await waited; } catch { jobsOk = false; }
  console.log = quiet;
  check('the lazy jobs run through the counting view without errors, and batches get the real statements', res.status === 200 && waited && jobsOk && seen.every(Boolean));
}
const src = read('functions/_lib/sellerReport.js');
check('the seller report never reads a price column or the address', !/asking_price|price_opinion\b(?! IS NOT NULL)|commission|flat_fee|\baddress\b|\bzip\b/.test(src.replace(/\/\/.*$/gm, '')), src.match(/asking_price|commission|flat_fee|\baddress\b|\bzip\b/));

console.log = realLog;
console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
