import { json } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { runDueDecisionNights } from '../_lib/decisionNight.js';
import { runDueHeldEmails } from '../_lib/agentDuty.js';
import { runDueScorecards } from '../_lib/scorecard.js';
import { runDueReadyNudges } from '../_lib/readyMeter.js';
import { runDueWeeklyMessages } from '../_lib/contactPolicy.js';
import { runPruneActionLogs } from '../_lib/rateLimits.js';
import { runPurgeExpiredTrash } from '../_lib/trash.js';
import { runDueVisitFeedbackPrompts } from '../_lib/visitFeedback.js';
import { runDueSellerReports } from '../_lib/sellerReport.js';

// Runs in front of every /api route only (Pages scopes a middleware file to its
// own directory), so static pages and images never pass through it.
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// There's no scheduler, so time-based messages (a homeowner's Decision Night arriving) go out from here: at most
// every few minutes per running instance, in the background after the response, never slowing a request down.
// Each job claims its rows with a conditional UPDATE, so instances running it at the same time can't double-send.
const DUE_JOBS_EVERY_MS = 5 * 60 * 1000;
let lastDueJobsRun = 0;
// D1 Free allows about 50 statements per invocation, and the jobs share that with the request that started them.
// The jobs get a counting view of the database; once they have used JOB_STATEMENT_BUDGET between them, the jobs not
// started yet wait for the next run (their rows stay due, so nothing is lost or sent twice).
const JOB_STATEMENT_BUDGET = 30;
function countingDb(db, used) {
  const wrap = (stmt) => ({
    statement: stmt,
    bind: (...args) => wrap(stmt.bind(...args)),
    first: (...args) => { used.n++; return stmt.first(...args); },
    all: () => { used.n++; return stmt.all(); },
    run: () => { used.n++; return stmt.run(); },
    raw: (...args) => { used.n++; return stmt.raw(...args); },
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: (stmts) => { used.n += stmts.length; return db.batch(stmts.map(s => (s && s.statement) || s)); },
    exec: (sql) => { used.n++; return db.exec(sql); },
  };
}
function maybeRunDueJobs(context) {
  if (!context.env || !context.env.DB || typeof context.waitUntil !== 'function') return;
  // The data export runs 46 statements in one batch; the jobs run in the same invocation and would count against D1's
  // per-invocation query limit.
  if (new URL(context.request.url).pathname === '/api/account/export') return;
  const now = Date.now();
  if (now - lastDueJobsRun < DUE_JOBS_EVERY_MS) return;
  lastDueJobsRun = now;
  // One after another (the email provider allows about 2 a second, and the background work about 30 seconds).
  const used = { n: 0 };
  const jobContext = { ...context, env: { ...context.env, DB: countingDb(context.env.DB, used) } };
  context.waitUntil((async () => {
    // The weekly agent-message delivery runs right after held emails (its emails can be held by quiet hours too).
    // The weekly check-in nudge (in-app only, Thursday to Saturday) after the scorecards.
    // Visit feedback prompts (in-app only) after the nudges, then the Monday seller report (email, paced like the scorecards).
    // Then listings past their 7 days in the trash go for good (trash.js). Last: old per-person action and sign-in
    // attempt rows are pruned (rateLimits.js). Neither sends anything.
    for (const job of [runDueDecisionNights, runDueHeldEmails, runDueWeeklyMessages, runDueScorecards, runDueReadyNudges, runDueVisitFeedbackPrompts, runDueSellerReports, runPurgeExpiredTrash, runPruneActionLogs]) {
      if (Date.now() - now > 22000 || used.n >= JOB_STATEMENT_BUDGET) break;
      try { await job(jobContext); } catch (err) { console.log(`[due jobs failed] ${err && err.message}`); }
    }
  })());
}

export async function onRequest(context) {
  const { request } = context;

  // request.json() happily parses the literal `null` (or a bare number/string)
  // into a value that isn't an object, and nearly every route then reads
  // body.something, which throws and returns Cloudflare's HTML error page.
  // Reject those once here instead of guarding ~60 routes individually. Text
  // that isn't valid JSON at all is left alone so each route keeps returning
  // its own 400 for it.
  const type = request.headers.get('Content-Type') || '';
  if (BODY_METHODS.has(request.method) && type.includes('application/json')) {
    const text = await request.clone().text();
    if (text.trim()) {
      let parsed;
      let parseable = true;
      try { parsed = JSON.parse(text); } catch { parseable = false; }
      if (parseable && (parsed === null || typeof parsed !== 'object')) {
        return withSecurityHeaders(json({ error: 'Invalid request body.' }, { status: 400 }));
      }
    }
  }

  maybeRunDueJobs(context);

  // Anything a route still lets escape becomes a JSON error the client can
  // show, rather than an HTML page it can't parse.
  try {
    return withSecurityHeaders(await context.next());
  } catch (err) {
    console.error(`Unhandled error in ${request.method} ${new URL(request.url).pathname}:`, (err && err.stack) || err);
    return withSecurityHeaders(json({ error: 'Something went wrong on our end. Please try again.' }, { status: 500 }));
  }
}
