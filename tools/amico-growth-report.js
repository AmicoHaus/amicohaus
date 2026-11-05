/* Amico Haus weekly growth report. Reads (never writes) the production D1 database through wrangler, compares the
   last full week (Monday to Sunday, Los Angeles time) with the week before, and writes one self-contained HTML page
   plus a JSON copy of the numbers OUTSIDE this public repo, in sites/_content/reports/.
   Usage:  node tools/amico-growth-report.js [--end=YYYY-MM-DD]   (end = last day of the week; default yesterday, LA time)
           env AMICO_REPORT_OUT=<dir>  write the files there instead (tests)
   Counts only: no names, emails, addresses, message text or raw "came from" values ever reach the page or the JSON.
   Real accounts only: no demo, @resend.dev or @example.com test accounts, no admins, no rudypabloflores+… test
   addresses, active accounts only.
   Read-only by construction: every statement must start with SELECT or WITH and contain no write keyword, and
   wrangler is only ever called with --command (never --file). --file is never used because with --remote wrangler
   sends a file through the D1 import API: that returns no SELECT rows (the report would be empty) and leaves the
   database unable to serve queries while it runs. Instead the statements go out in small --command batches sized
   so the Windows command line stays under its limit (see estimatedCmdLength).
   Exit codes: 0 fine; 1 the report could not be made. Prints WEEK, "- note" lines and FILE at the end. */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, '..', 'sites', '_content', 'reports');
const SITES_DIR = path.join(ROOT, '..', 'sites');

// Same as functions/_lib/zipBoard.js (tools/launch-test.mjs checks they still agree).
const LAUNCH_ZIPS = { 91910: 'Chula Vista', 91911: 'Chula Vista', 91913: 'Chula Vista', 91914: 'Chula Vista', 91915: 'Chula Vista', 91902: 'Bonita' };
const FOUNDING_SPOTS = 3;

// ---------- dates (Los Angeles) ----------
const ymdLA = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pretty = (s, year) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', year: year ? 'numeric' : undefined });

// Minutes Los Angeles is ahead of UTC at that moment (-480 in winter, -420 in summer).
function laOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Math.round((Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs) / 60000);
}
// The UTC moment of midnight in Los Angeles on that date.
function laMidnightUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) t = Date.UTC(y, m - 1, d) - laOffsetMinutes(t) * 60000;
  return t;
}
// D1 timestamps are UTC datetime('now') text, so the edges are written the same way.
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// This week = the 7 LA days ending `end`; last week = the 7 before. from/to are UTC text edges, [from, to).
function weekWindow(end) {
  const start = addDays(end, -6), pEnd = addDays(end, -7), pStart = addDays(end, -13);
  return {
    start, end, pStart, pEnd,
    from: sqlTime(laMidnightUtc(start)), to: sqlTime(laMidnightUtc(addDays(end, 1))), pFrom: sqlTime(laMidnightUtc(pStart)),
  };
}

// ---------- SQL ----------
const TEST_EMAIL_GLOBS = ['*@demo.amicohaus.local', '*@resend.dev', '*@example.com', 'rudypabloflores+*@gmail.com'];
const notTestEmail = (col) => TEST_EMAIL_GLOBS.map((g) => `lower(${col}) NOT GLOB '${g}'`).join(' AND ');
const realUser = (u) => `${notTestEmail(`${u}.email`)} AND ${u}.role <> 'admin' AND ${u}.status = 'active'`;
// The ZIP board's own rule (approved, active, not demo), so these numbers match what agents see on /unlock-your-zip.
const boardAgent = (ap, u) => `${ap}.status = 'approved' AND ${u}.status = 'active' AND lower(${u}.email) NOT GLOB '*@demo.amicohaus.local'`;
const tag = (col, key) => `lower(COALESCE(CASE WHEN json_valid(${col}) THEN json_extract(${col}, '$.${key}') END, ''))`;

const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|TRUNCATE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
// Throws unless the text is one or more plain reads. No comments, no double quotes and no % (cmd.exe would read
// %…% as a variable), so nothing can hide or break out of the --command "…" quoting.
function assertReadOnly(sql) {
  const text = String(sql || '');
  if (/["%`]|--|\/\*/.test(text)) throw new Error('Read-only guard: no quotes, %, or comments allowed in report SQL.');
  const parts = text.split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Read-only guard: empty statement.');
  for (const p of parts) {
    if (!/^(SELECT|WITH)\b/i.test(p)) throw new Error('Read-only guard: every statement must start with SELECT or WITH.');
    if (WRITE_WORDS.test(p)) throw new Error('Read-only guard: write keyword found: ' + p.match(WRITE_WORDS)[0]);
  }
  return true;
}

// Every statement the report runs, in order; summarize() reads the results by name.
function buildQueries(w) {
  const zips = Object.keys(LAUNCH_ZIPS).map((z) => `'${z}'`).join(',');
  const wk = (col) => `CASE WHEN ${col} >= '${w.from}' THEN 'cur' ELSE 'prev' END`;
  const both = (col) => `${col} >= '${w.pFrom}' AND ${col} < '${w.to}'`;
  const cur = (col) => `${col} >= '${w.from}' AND ${col} < '${w.to}'`;
  const pair = (col) => `SUM(CASE WHEN ${col} >= '${w.from}' THEN 1 ELSE 0 END) AS cur, SUM(CASE WHEN ${col} < '${w.from}' THEN 1 ELSE 0 END) AS prev`;
  return [
    ['signups', `SELECT ${wk('u.created_at')} AS wk, ${tag('u.signup_source', 'utm_source')} AS utm, ${tag('u.signup_source', 'utm_medium')} AS medium, ${tag('u.signup_source', 'in_app')} AS in_app, ${tag('u.signup_source', 'referrer')} AS ref, COALESCE(u.signup_intent, 'unknown') AS intent, u.email_confirmation_pending AS pending, COUNT(*) AS n FROM users u WHERE ${realUser('u')} AND ${both('u.created_at')} GROUP BY 1, 2, 3, 4, 5, 6, 7`],
    ['campaignSignups', `SELECT ${tag('u.signup_source', 'utm_source')} AS utm, ${tag('u.signup_source', 'utm_campaign')} AS camp, ${tag('u.signup_source', 'utm_content')} AS content, COALESCE(u.signup_intent, 'unknown') AS intent, u.email_confirmation_pending AS pending, SUM(CASE WHEN ${cur('u.created_at')} THEN 1 ELSE 0 END) AS week, COUNT(*) AS total FROM users u WHERE ${realUser('u')} AND (${tag('u.signup_source', 'utm_campaign')} <> '' OR ${tag('u.signup_source', 'utm_content')} <> '') GROUP BY 1, 2, 3, 4, 5`],
    ['campaignLeads', `SELECT ${tag('l.source', 'utm_source')} AS utm, ${tag('l.source', 'utm_campaign')} AS camp, ${tag('l.source', 'utm_content')} AS content, SUM(CASE WHEN ${cur('l.created_at')} THEN 1 ELSE 0 END) AS week, COUNT(*) AS total FROM leads l WHERE ${notTestEmail('l.email')} AND lower(l.email) <> 'rudypabloflores@gmail.com' AND (${tag('l.source', 'utm_campaign')} <> '' OR ${tag('l.source', 'utm_content')} <> '') GROUP BY 1, 2, 3`],
    ['leads', `SELECT ${pair('l.created_at')} FROM leads l WHERE ${notTestEmail('l.email')} AND lower(l.email) <> 'rudypabloflores@gmail.com' AND ${both('l.created_at')}`],
    ['applied', `SELECT ${wk('ap.applied_at')} AS wk, ap.status AS status, COUNT(*) AS n FROM agent_profiles ap JOIN users u ON u.id = ap.user_id WHERE ${realUser('u')} AND ${both('ap.applied_at')} GROUP BY 1, 2`],
    ['approved', `SELECT ${pair('ap.reviewed_at')} FROM agent_profiles ap JOIN users u ON u.id = ap.user_id WHERE ${realUser('u')} AND ap.status = 'approved' AND ${both('ap.reviewed_at')}`],
    ['agentTotals', `SELECT ap.status AS status, COUNT(*) AS n FROM agent_profiles ap JOIN users u ON u.id = ap.user_id WHERE ${realUser('u')} GROUP BY 1`],
    ['neverApplied', `SELECT u.email_confirmation_pending AS pending, SUM(CASE WHEN ${cur('u.created_at')} THEN 1 ELSE 0 END) AS week, COUNT(*) AS total FROM users u WHERE ${realUser('u')} AND u.signup_intent = 'agent' AND NOT EXISTS (SELECT 1 FROM agent_profiles ap WHERE ap.user_id = u.id) GROUP BY 1`],
    ['zipAgents', `SELECT CAST(z.value AS TEXT) AS zip, COUNT(DISTINCT ap.user_id) AS n FROM agent_profiles ap JOIN users u ON u.id = ap.user_id, json_each(ap.service_zips_json) z WHERE ${boardAgent('ap', 'u')} AND CAST(z.value AS TEXT) IN (${zips}) GROUP BY 1`],
    // Mirrors LIVE_FOUNDERS_SQL in functions/_lib/zipBoard.js (GLOB instead of LIKE; tools/launch-test.mjs compares them).
    // The account that runs Amico Haus (an admin) never takes a founding spot.
    ['founders', `SELECT zip, COUNT(*) AS n FROM (SELECT fa.zip AS zip, ROW_NUMBER() OVER (PARTITION BY fa.zip ORDER BY fa.id) AS rn FROM founding_agents fa JOIN agent_profiles ap ON ap.user_id = fa.agent_user_id JOIN users u ON u.id = fa.agent_user_id WHERE ${boardAgent('ap', 'u')} AND u.role <> 'admin' AND EXISTS (SELECT 1 FROM json_each(ap.service_zips_json) sz WHERE CAST(sz.value AS TEXT) = fa.zip)) WHERE rn <= ${FOUNDING_SPOTS} GROUP BY zip`],
    ['preListings', `SELECT ${wk('pl.created_at')} AS wk, pl.zip AS zip, COUNT(*) AS n FROM pre_listings pl JOIN users u ON u.id = pl.user_id WHERE ${realUser('u')} AND ${both('pl.created_at')} GROUP BY 1, 2`],
    ['openPreListings', `SELECT COUNT(*) AS n FROM pre_listings pl JOIN users u ON u.id = pl.user_id WHERE ${realUser('u')} AND pl.status = 'open'`],
    ['proposals', `SELECT ${pair('sb.created_at')} FROM service_bids sb JOIN users u ON u.id = sb.agent_user_id WHERE ${realUser('u')} AND ${both('sb.created_at')}`],
    ['opinions', `SELECT ${pair('po.created_at')} FROM pre_listing_price_opinions po JOIN users u ON u.id = po.agent_user_id WHERE ${realUser('u')} AND ${both('po.created_at')}`],
    ['votes', `SELECT ${pair('pv.created_at')} FROM pre_listing_price_votes pv JOIN users u ON u.id = pv.agent_user_id WHERE ${realUser('u')} AND ${both('pv.created_at')}`],
    ['messages', `SELECT ${pair('m.created_at')}, COUNT(DISTINCT CASE WHEN m.created_at >= '${w.from}' THEN m.conversation_id END) AS convCur, COUNT(DISTINCT CASE WHEN m.created_at < '${w.from}' THEN m.conversation_id END) AS convPrev FROM messages m JOIN users u ON u.id = m.sender_id WHERE ${realUser('u')} AND ${both('m.created_at')}`],
    ['contactShares', `SELECT ${pair('cs.shared_at')} FROM contact_shares cs JOIN users u ON u.id = cs.owner_id WHERE ${realUser('u')} AND ${both('cs.shared_at')}`],
    ['interviews', `SELECT ${pair('iv.created_at')} FROM pre_listing_interviews iv JOIN pre_listings pl ON pl.id = iv.pre_listing_id JOIN users u ON u.id = pl.user_id WHERE ${realUser('u')} AND ${both('iv.created_at')}`],
    ['invites', `SELECT ${pair('ai.created_at')} FROM agent_invites ai JOIN users u ON u.id = ai.invited_by_user_id WHERE ${realUser('u')} AND ${both('ai.created_at')}`],
  ];
}

// ---------- production runner (wrangler, read-only) ----------
const TRANSIENT = /\b7403\b|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|\b50[234]\b/;
// cmd.exe caps a command line at 8191 characters, and on Windows npx goes through a .cmd shim that caret-escapes cmd
// metacharacters again (up to 3 extra characters each), which is what made "The command line is too long" happen with
// a plain length check. 140 covers the npx/wrangler words around the SQL.
const MAX_CMD = 7000;
function estimatedCmdLength(sql) { return 140 + sql.length + 3 * (sql.match(/[()<>&|^!"%]/g) || []).length; }
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
// Groups whole statements (in order) into ;-joined batches that each fit one wrangler --command call.
function wranglerBatches(statements) {
  for (const s of statements) assertReadOnly(s);
  const batches = [];
  for (const s of statements.map(oneLine)) {
    if (estimatedCmdLength(s) >= MAX_CMD) throw new Error('Read-only guard: a report statement is too long for one wrangler call.');
    const last = batches[batches.length - 1];
    if (last && estimatedCmdLength(last.concat(s).join('; ')) < MAX_CMD) last.push(s); else batches.push([s]);
  }
  return batches.map((b) => { const sql = b.join('; '); assertReadOnly(sql); return sql; });
}
function wranglerRunner(statements) {
  const out = [];
  for (const sql of wranglerBatches(statements)) {
    const expected = sql.split(';').filter((s) => s.trim()).length;
    const cmd = `npx wrangler d1 execute amicohaus --remote --json --command "${sql}"`;
    if (/--file/.test(cmd)) throw new Error('Read-only guard: --file is never allowed.');
    let raw;
    for (let attempt = 1; ; attempt++) {
      try {
        raw = execSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
        break;
      } catch (e) {
        if (attempt >= 4 || !TRANSIENT.test(`${e.stdout || ''} ${e.stderr || ''} ${e.message || ''}`)) throw new Error(String(e.stderr || e.message).slice(0, 400));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000 * attempt);
      }
    }
    const parsed = JSON.parse(raw.replace(/^[^[]*/, ''));
    if (!Array.isArray(parsed) || parsed.length !== expected) throw new Error(`Expected ${expected} result sets, got ${Array.isArray(parsed) ? parsed.length : 'none'}.`);
    for (const r of parsed) out.push(r.results || []);
  }
  return out;
}

// ---------- labels (never a raw value on the page) ----------
const PLATFORMS = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook', google: 'Google', rudy: 'Rudy (texts, emails, DMs)', homeowner_invite: 'Homeowner invites' };
// A utm value is shown only if it looks like a tag (lowercase letters, digits, - _ .), else "other tag".
function cleanTag(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  return /^[a-z0-9][a-z0-9_.-]{0,39}$/.test(s) ? s : 'other tag';
}
let rudySites = null;
function isRudySite(host) {
  if (rudySites === null) {
    try { rudySites = new Set(fs.readdirSync(SITES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && /^[a-z0-9-]+$/.test(e.name)).map((e) => e.name)); } catch { rudySites = new Set(); }
  }
  const base = host.replace(/^www\./, '').replace(/\.com$/, '');
  return rudySites.has(base);
}
// Referring sites are grouped, never printed: a host could be someone's own website.
function referrerBucket(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return '';
  const known = [[/(^|\.)google\./, 'Google search'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'], [/(^|\.)yahoo\./, 'Yahoo'],
    [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
    [/(^|\.)linktr\.ee$/, 'Linktree'], [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com)$/, 'AI assistant']];
  for (const [re, label] of known) if (re.test(h)) return label;
  return isRudySite(h) ? "Rudy's websites" : 'another website';
}
// utm_source first, then the app's built-in browser, then the referring site, else direct.
function sourceLabel(r) {
  const utm = cleanTag(r.utm);
  if (utm) return (PLATFORMS[utm] || utm) + (cleanTag(r.medium) === 'video' ? ' videos' : '');
  const inApp = cleanTag(r.in_app);
  if (inApp) return `${PLATFORMS[inApp] || inApp} app, no link tag`;
  const ref = referrerBucket(r.ref);
  return ref || 'direct';
}

// ---------- numbers ----------
const num = (v) => Number(v) || 0;
function summarize(names, results) {
  const R = Object.fromEntries(names.map((n, i) => [n, results[i] || []]));
  const one = (n) => R[n][0] || {};
  const pairOf = (n) => ({ cur: num(one(n).cur), prev: num(one(n).prev) });

  // Signups, this week and last, by intent, confirmed vs pending, and by source.
  const signups = {};
  for (const k of ['cur', 'prev']) signups[k] = { total: 0, confirmed: 0, pending: 0, byIntent: {}, bySource: {} };
  for (const r of R.signups) {
    const s = signups[r.wk === 'cur' ? 'cur' : 'prev'], n = num(r.n), intent = ['homeowner', 'agent'].includes(r.intent) ? r.intent : 'unknown';
    const src = sourceLabel(r);
    s.total += n;
    s[num(r.pending) ? 'pending' : 'confirmed'] += n;
    const bi = (s.byIntent[intent] = s.byIntent[intent] || { total: 0, confirmed: 0, pending: 0, bySource: {} });
    bi.total += n; bi[num(r.pending) ? 'pending' : 'confirmed'] += n;
    bi.bySource[src] = (bi.bySource[src] || 0) + n;
    const bs = (s.bySource[src] = s.bySource[src] || { total: 0, confirmed: 0, pending: 0, homeowner: 0, agent: 0, unknown: 0 });
    bs.total += n; bs[num(r.pending) ? 'pending' : 'confirmed'] += n; bs[intent] += n;
  }

  // Video campaigns: one row per platform + campaign + content, signups and contact messages.
  const camps = new Map();
  const campRow = (r) => {
    const key = [cleanTag(r.utm) || '(none)', cleanTag(r.camp) || '(none)', cleanTag(r.content) || ''].join('|');
    if (!camps.has(key)) { const [platform, campaign, content] = key.split('|'); camps.set(key, { platform, campaign, content, weekSignups: 0, weekPending: 0, totalSignups: 0, homeowner: 0, agent: 0, weekLeads: 0, totalLeads: 0 }); }
    return camps.get(key);
  };
  for (const r of R.campaignSignups) {
    const c = campRow(r);
    c.weekSignups += num(r.week); c.totalSignups += num(r.total);
    if (num(r.pending)) c.weekPending += num(r.week);
    if (r.intent === 'homeowner' || r.intent === 'agent') c[r.intent] += num(r.total);
  }
  for (const r of R.campaignLeads) { const c = campRow(r); c.weekLeads += num(r.week); c.totalLeads += num(r.total); }
  const campaigns = [...camps.values()].sort((a, b) => (b.weekSignups + b.weekLeads) - (a.weekSignups + a.weekLeads) || (b.totalSignups + b.totalLeads) - (a.totalSignups + a.totalLeads) || a.campaign.localeCompare(b.campaign));

  // Agents.
  const applied = { cur: 0, prev: 0 };
  for (const r of R.applied) applied[r.wk === 'cur' ? 'cur' : 'prev'] += num(r.n);
  const totals = Object.fromEntries(R.agentTotals.map((r) => [r.status, num(r.n)]));
  const never = { confirmed: 0, pending: 0, confirmedThisWeek: 0 };
  for (const r of R.neverApplied) { if (num(r.pending)) never.pending += num(r.total); else { never.confirmed += num(r.total); never.confirmedThisWeek += num(r.week); } }
  const zipAgents = new Map(R.zipAgents.map((r) => [String(r.zip), num(r.n)]));
  const founders = new Map(R.founders.map((r) => [String(r.zip), num(r.n)]));
  const zips = Object.keys(LAUNCH_ZIPS).map((zip) => ({ zip, city: LAUNCH_ZIPS[zip], agents: zipAgents.get(zip) || 0, foundingTaken: founders.get(zip) || 0, foundingOpen: Math.max(0, FOUNDING_SPOTS - (founders.get(zip) || 0)) }));

  // Pre-listings by ZIP.
  const preByZip = {};
  const pre = { cur: 0, prev: 0 };
  for (const r of R.preListings) {
    const k = r.wk === 'cur' ? 'cur' : 'prev', zip = /^\d{5}$/.test(String(r.zip)) ? String(r.zip) : 'no ZIP';
    pre[k] += num(r.n);
    preByZip[zip] = preByZip[zip] || { cur: 0, prev: 0, launch: Object.hasOwn(LAUNCH_ZIPS, zip) };
    preByZip[zip][k] += num(r.n);
  }

  const msg = one('messages');
  return {
    signups, campaigns,
    leads: pairOf('leads'),
    agents: { applied, approved: pairOf('approved'), pendingBacklog: totals.pending || 0, approvedTotal: totals.approved || 0, rejectedTotal: totals.rejected || 0, neverApplied: never },
    zips, foundingTaken: zips.reduce((a, z) => a + z.foundingTaken, 0), foundingSpots: zips.length * FOUNDING_SPOTS,
    preListings: { ...pre, byZip: preByZip, openNow: num(one('openPreListings').n) },
    activity: {
      proposals: pairOf('proposals'), opinions: pairOf('opinions'), votes: pairOf('votes'),
      messages: { cur: num(msg.cur), prev: num(msg.prev) }, conversations: { cur: num(msg.convCur), prev: num(msg.convPrev) },
      contactShares: pairOf('contactShares'), interviews: pairOf('interviews'), invites: pairOf('invites'),
    },
  };
}

// Last week's numbers: from last week's saved report when there is one (pending signups older than 7 days get
// deleted, so re-counting an old week reads low), else counted again now.
function lastWeekFrom(outDir, w, S) {
  const file = path.join(outDir, `amico-growth-${w.pEnd}.json`);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && saved.range && saved.range.end === w.pEnd && saved.thisWeek) {
      // Same fields as this week's, so an older report missing one still compares as 0.
      return { from: 'saved', week: Object.fromEntries(Object.keys(weekSlice(S, 'prev')).map((k) => [k, num(saved.thisWeek[k])])) };
    }
  } catch { /* no saved report for that week */ }
  return { from: 'recounted', week: weekSlice(S, 'prev') };
}
// The per-week numbers that get saved and compared.
function weekSlice(S, k) {
  const a = S.activity;
  return {
    signups: S.signups[k].total, signupsConfirmed: S.signups[k].confirmed, signupsPending: S.signups[k].pending,
    homeowners: (S.signups[k].byIntent.homeowner || { total: 0 }).total, agentSignups: (S.signups[k].byIntent.agent || { total: 0 }).total,
    leads: S.leads[k], applied: S.agents.applied[k], approved: S.agents.approved[k], preListings: S.preListings[k],
    proposals: a.proposals[k], opinions: a.opinions[k], votes: a.votes[k], messages: a.messages[k], conversations: a.conversations[k],
    contactShares: a.contactShares[k], interviews: a.interviews[k], invites: a.invites[k],
  };
}

// ---------- page ----------
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (x) => Math.round(num(x)).toLocaleString('en-US');
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + 's')}`;
function delta(c, p) {
  if (c === 0 && p === 0) return '<span class="d flat">–</span>';
  if (p === 0) return '<span class="d up">▲ new</span>';
  const diff = c - p;
  const txt = p < 10 ? (diff > 0 ? '+' : '') + diff : (diff > 0 ? '+' : '') + Math.round((diff / p) * 100) + '%';
  return `<span class="d ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '■'} ${txt}</span>`;
}
const vsLast = (c, p) => (c === p ? `the same as last week (${fmt(p)})` : `${c > p ? 'up' : 'down'} from ${fmt(p)} last week`);
const topOf = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function buildNotes(S, last) {
  const notes = [];
  const cur = S.signups.cur, L = last.week;
  const intentNote = (key, label) => {
    const bi = cur.byIntent[key];
    if (!bi || !bi.total) return null;
    const [src, n] = topOf(bi.bySource).find(([label]) => label !== 'direct') || [];
    const pend = bi.pending ? ` (${fmt(bi.pending)} still confirming their email)` : '';
    const from = src ? `, ${fmt(n)} from ${esc(src)}` : '';
    return `<strong>${plural(bi.total, 'new ' + label)}</strong> this week${pend}${from}.`;
  };
  const ho = intentNote('homeowner', 'homeowner'), ag = intentNote('agent', 'agent');
  if (ho) notes.push(ho);
  if (ag) notes.push(ag);
  if (cur.total) notes.push(`All signups: ${fmt(cur.total)}, ${vsLast(cur.total, L.signups)}.`);
  else notes.push(`No new signups this week (${fmt(L.signups)} last week). A fresh video or a few personal invites usually gets things moving.`);
  const ap = S.agents;
  if (ap.applied.cur || ap.approved.cur) notes.push(`Agents: ${plural(ap.applied.cur, 'application')} came in and ${fmt(ap.approved.cur)} ${ap.approved.cur === 1 ? 'was' : 'were'} approved.`);
  if (ap.pendingBacklog) notes.push(`<strong>${plural(ap.pendingBacklog, 'agent application')} waiting for review.</strong>`);
  if (ap.neverApplied.confirmed) notes.push(`${plural(ap.neverApplied.confirmed, 'person', 'people')} signed up as an agent but haven't applied yet${ap.neverApplied.confirmedThisWeek ? ` (${fmt(ap.neverApplied.confirmedThisWeek)} this week)` : ''}.`);
  const open = S.zips.filter((z) => z.foundingOpen > 0).map((z) => z.zip);
  notes.push(`Founding spots: ${fmt(S.foundingTaken)} of ${fmt(S.foundingSpots)} taken${open.length ? `; open in ${open.join(', ')}` : '; every launch ZIP is full'}.`);
  if (S.preListings.cur) {
    const zips = topOf(Object.fromEntries(Object.entries(S.preListings.byZip).map(([z, v]) => [z, v.cur]))).filter(([, n]) => n > 0).map(([z, n]) => `${z} (${n})`);
    notes.push(`<strong>${plural(S.preListings.cur, 'new pre-listing')}</strong>: ${zips.join(', ')}.`);
  } else notes.push('No new pre-listings this week.');
  const a = S.activity;
  const act = [[a.proposals.cur, 'proposal'], [a.opinions.cur, 'price opinion'], [a.messages.cur, 'message'], [a.contactShares.cur, 'contact share'], [a.interviews.cur, 'interview request']].filter(([n]) => n > 0).map(([n, w]) => plural(n, w));
  if (act.length) notes.push(`Activity: ${act.join(', ')}.`);
  const vid = S.campaigns.find((c) => c.weekSignups + c.weekLeads > 0);
  if (vid) notes.push(`Top campaign this week: <code>${esc(vid.campaign)}</code>${vid.platform !== '(none)' ? ` on ${esc(PLATFORMS[vid.platform] || vid.platform)}` : ''}, with ${plural(vid.weekSignups, 'signup')}${vid.weekLeads ? ` and ${plural(vid.weekLeads, 'contact message')}` : ''}.`);
  return notes;
}

function table(head, rows, empty) {
  const th = head.map((h, i) => `<th scope="col"${i > 0 ? ' class="num"' : ''}>${h}</th>`).join('');
  const body = rows.length ? rows.map((r) => '<tr>' + r.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${c}</td>`).join('') + '</tr>').join('') : `<tr><td colspan="${head.length}" class="none">${empty || 'Nothing this week.'}</td></tr>`;
  return `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const tile = (label, c, p, hint) => `<div class="tile"><p class="tl">${label}</p><p class="tn">${fmt(c)}</p><p class="tc">${delta(c, p)} <span class="vs">vs ${fmt(p)}</span></p>${hint ? `<p class="th">${hint}</p>` : ''}</div>`;

const CSS = `
:root { --bg: #f6f4ef; --surface: #ffffff; --ink: #182430; --muted: #5a6470; --line: #e2ddd2; --accent: #8a5f2c; --soft: #f3ece0; --up: #17713f; --down: #ac3b27; --flat: #5a6470; }
@media (prefers-color-scheme: dark) { :root { --bg: #11181f; --surface: #182430; --ink: #eef1f4; --muted: #9aa6b2; --line: #2a3846; --accent: #e0b57a; --soft: #1f2e3b; --up: #5fcf97; --down: #f2917b; --flat: #9aa6b2; color-scheme: dark; } }
body { background: var(--bg); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 15px; line-height: 1.55; margin: 0; }
.wrap { max-width: 1000px; margin-inline: auto; padding: 28px 16px 56px; display: flex; flex-direction: column; gap: 32px; }
h1, h2 { font-family: Georgia, "Times New Roman", serif; margin: 0; line-height: 1.15; }
h1 { font-size: clamp(28px, 6vw, 40px); }
h2 { font-size: 21px; margin-bottom: 12px; }
h3 { font-size: 13px; margin: 0 0 8px; color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase; }
p { margin: 0; }
.eyebrow { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); font-weight: 600; margin-bottom: 8px; }
.range { color: var(--muted); margin-top: 10px; max-width: 70ch; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 14px; }
.tl { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.tn { font-size: 32px; font-weight: 700; line-height: 1.1; margin-top: 6px; font-variant-numeric: tabular-nums; }
.tc { margin-top: 4px; font-size: 13px; } .th { margin-top: 6px; font-size: 12px; color: var(--muted); }
.d { font-weight: 600; white-space: nowrap; } .d.up { color: var(--up); } .d.down { color: var(--down); } .d.flat { color: var(--flat); }
.vs { color: var(--muted); font-size: 12px; }
.notes { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; max-width: 78ch; }
.notes li { padding-left: 16px; position: relative; }
.notes li::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; } .two > div { min-width: 0; }
.scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--line); }
th { font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); background: var(--soft); white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.none { color: var(--muted); text-align: left; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
.fine { color: var(--muted); font-size: 13.5px; max-width: 78ch; display: flex; flex-direction: column; gap: 8px; }
`;

function renderHtml(w, S, last, notes) {
  const T = weekSlice(S, 'cur'), L = last.week;
  const srcRows = topOf(Object.fromEntries(Object.entries(S.signups.cur.bySource).map(([k, v]) => [k, v.total]))).map(([src]) => {
    const v = S.signups.cur.bySource[src];
    return [esc(src), fmt(v.homeowner), fmt(v.agent), fmt(v.confirmed), fmt(v.pending)];
  });
  const campRows = S.campaigns.slice(0, 40).map((c) => [`<code>${esc(c.campaign)}</code>${c.content ? ` <span class="vs">${esc(c.content)}</span>` : ''}<br><span class="vs">${esc(PLATFORMS[c.platform] || c.platform)}</span>`, fmt(c.weekSignups), fmt(c.weekLeads), fmt(c.totalSignups), fmt(c.homeowner), fmt(c.agent), fmt(c.totalLeads)]);
  const zipRows = S.zips.map((z) => [`${z.zip} <span class="vs">${esc(z.city)}</span>`, fmt(z.agents), `${fmt(z.foundingTaken)} of ${FOUNDING_SPOTS}`, z.foundingOpen ? fmt(z.foundingOpen) : 'full', fmt((S.preListings.byZip[z.zip] || { cur: 0 }).cur)]);
  const otherZips = Object.entries(S.preListings.byZip).filter(([zip, v]) => !Object.hasOwn(LAUNCH_ZIPS, zip) && (v.cur || v.prev)).map(([zip, v]) => [esc(zip), fmt(v.cur), fmt(v.prev)]);
  const a = S.activity;
  const actRows = [['Proposals sent', a.proposals], ['Price opinions', a.opinions], ['Price votes', a.votes], ['Messages', a.messages], ['Conversations with a message', a.conversations], ['Contact shares (homeowner to agent)', a.contactShares], ['Interview requests', a.interviews], ['Agent invites', a.invites]].map(([label, p]) => [label, fmt(p.cur) + ' ' + delta(p.cur, p.prev), fmt(p.prev)]);
  const dateLine = `${pretty(w.start)} to ${pretty(w.end, true)} (Los Angeles time), compared with ${pretty(w.pStart)} to ${pretty(w.pEnd)}.`;
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Amico Haus Weekly Growth</title>\n<style>' + CSS + '</style>\n</head>\n<body>\n<main class="wrap">\n' +
    `<header><p class="eyebrow">Amico Haus · week ending ${esc(pretty(w.end, true))}</p><h1>Amico Haus Weekly Growth</h1><p class="range">${esc(dateLine)} Counts of real accounts only, straight from the Amico Haus database.</p></header>\n` +
    '<section aria-label="Headline numbers"><div class="tiles">' +
    tile('New homeowners', T.homeowners, L.homeowners) + tile('New agents', T.agentSignups, L.agentSignups) + tile('Agent applications', T.applied, L.applied) +
    tile('Agents approved', T.approved, L.approved) + tile('New pre-listings', T.preListings, L.preListings) + tile('Proposals', T.proposals, L.proposals) +
    tile('Price opinions', T.opinions, L.opinions) + tile('Contact messages', T.leads, L.leads, 'From the contact form') +
    '</div></section>\n' +
    `<section><h2>This week in plain English</h2><ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul></section>\n` +
    '<section><h2>Signups</h2><div class="two">' +
    `<div><h3>Where they came from</h3>${table(['Source', 'Homeowners', 'Agents', 'Confirmed', 'Still confirming'], srcRows, 'No signups this week.')}</div>` +
    `<div><h3>This week vs last</h3>${table(['', 'This week', 'Last week'], [['All signups', fmt(T.signups) + ' ' + delta(T.signups, L.signups), fmt(L.signups)], ['Confirmed', fmt(T.signupsConfirmed), fmt(L.signupsConfirmed)], ['Still confirming', fmt(T.signupsPending), fmt(L.signupsPending)], ['Homeowners', fmt(T.homeowners), fmt(L.homeowners)], ['Agents', fmt(T.agentSignups), fmt(L.agentSignups)]])}</div>` +
    '</div></section>\n' +
    `<section><h2>Videos and campaigns</h2>${table(['Campaign (video id)', 'Signups this week', 'Messages this week', 'Signups all time', 'Homeowners', 'Agents', 'Messages all time'], campRows, 'No tagged signups or messages yet.')}</section>\n` +
    '<section><h2>Agents</h2><div class="two">' +
    `<div><h3>Applications</h3>${table(['', 'Count'], [['Applied this week', fmt(S.agents.applied.cur) + ' ' + delta(S.agents.applied.cur, L.applied)], ['Approved this week', fmt(S.agents.approved.cur)], ['Waiting for review now', fmt(S.agents.pendingBacklog)], ['Approved agents in total', fmt(S.agents.approvedTotal)], ['Signed up as an agent, never applied', fmt(S.agents.neverApplied.confirmed)], ['...and still confirming their email', fmt(S.agents.neverApplied.pending)]])}</div>` +
    `<div><h3>Launch ZIPs</h3>${table(['ZIP', 'Approved agents', 'Founding taken', 'Open spots', 'New pre-listings'], zipRows)}</div>` +
    '</div></section>\n' +
    '<section><h2>Pre-listings and activity</h2><div class="two">' +
    `<div><h3>Activity</h3>${table(['', 'This week', 'Last week'], actRows)}</div>` +
    `<div><h3>Pre-listings</h3>${table(['', 'This week', 'Last week'], [['New pre-listings', fmt(S.preListings.cur) + ' ' + delta(S.preListings.cur, L.preListings), fmt(L.preListings)], ['Open right now', fmt(S.preListings.openNow), '']].concat(otherZips.map(([z, c, p]) => [`Outside the launch ZIPs: ${z}`, c, p])))}</div>` +
    '</div></section>\n' +
    '<section><h2>Notes on these numbers</h2><div class="fine">' +
    '<p>Real accounts only: demo accounts, test accounts (@resend.dev, @example.com and Rudy\'s + test addresses), admin accounts and suspended accounts are left out, so Rudy\'s own proposals and opinions don\'t count either.</p>' +
    '<p>"Still confirming" means they signed up but haven\'t opened the email link yet. Unconfirmed signups are deleted after 7 days, so they can disappear from older weeks.</p>' +
    `<p>${last.from === 'saved' ? 'Last week\'s numbers come from last week\'s saved report.' : 'There was no saved report for last week, so last week was counted again just now; it can read a little low because unconfirmed signups get cleared after 7 days.'}</p>` +
    '<p>Sources use the first tagged link a person arrived on in the 30 days before they signed up. "App, no link tag" means they came through TikTok\'s, Instagram\'s or Facebook\'s built-in browser without a tagged link (for example the bio link). Video short links (amicohaus.com/t/&lt;id&gt;, /i/, /y/, /f/) show up under their video id.</p>' +
    '<p>Agents by ZIP and founding spots use the same rule as the public ZIP board, so they match what agents see on /unlock-your-zip.</p>' +
    '<p>Applications count by the date of the latest application edit, so an applicant who edits a pending application moves to the week of that edit.</p>' +
    '</div></section>\n</main>\n</body>\n</html>\n';
}

// ---------- main ----------
// Runs the whole report. runSql(statements) -> array of row arrays (wrangler in production, SQLite in tests).
function run({ end, runSql = wranglerRunner, outDir = DEFAULT_OUT, now = new Date() } = {}) {
  const endDate = end || addDays(ymdLA(now), -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('--end must be YYYY-MM-DD');
  const w = weekWindow(endDate);
  const queries = buildQueries(w);
  for (const [, sql] of queries) assertReadOnly(sql);
  const results = runSql(queries.map(([, sql]) => sql));
  const S = summarize(queries.map(([name]) => name), results);
  const last = lastWeekFrom(outDir, w, S);
  const notes = buildNotes(S, last);
  const html = renderHtml(w, S, last, notes);
  const data = { title: 'Amico Haus Weekly Growth', generatedAt: now.toISOString(), range: { start: w.start, end: w.end, pStart: w.pStart, pEnd: w.pEnd }, lastWeekFrom: last.from, thisWeek: weekSlice(S, 'cur'), lastWeek: last.week, details: S };
  fs.mkdirSync(outDir, { recursive: true });
  const files = { html: path.join(outDir, `amico-growth-${w.end}.html`), latest: path.join(outDir, 'amico-growth-latest.html'), json: path.join(outDir, `amico-growth-${w.end}.json`) };
  fs.writeFileSync(files.html, html);
  fs.writeFileSync(files.latest, html);
  fs.writeFileSync(files.json, JSON.stringify(data, null, 1));
  return { w, S, last, notes, html, data, files };
}

if (require.main === module) {
  try {
    const arg = (process.argv.find((a) => a.startsWith('--end=')) || '').slice(6);
    const outDir = process.env.AMICO_REPORT_OUT ? path.resolve(process.env.AMICO_REPORT_OUT) : DEFAULT_OUT;
    const { w, notes, files } = run({ end: arg || undefined, outDir });
    const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    console.log(`WEEK ${w.start} to ${w.end} (vs ${w.pStart} to ${w.pEnd})`);
    notes.forEach((n) => console.log('- ' + strip(n)));
    console.log('FILE ' + files.latest);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  }
}

module.exports = { LAUNCH_ZIPS, FOUNDING_SPOTS, laMidnightUtc, sqlTime, weekWindow, realUser, assertReadOnly, buildQueries, wranglerBatches, estimatedCmdLength, cleanTag, referrerBucket, sourceLabel, summarize, buildNotes, renderHtml, run };
