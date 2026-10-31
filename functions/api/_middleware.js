import { json } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { runDueDecisionNights } from '../_lib/decisionNight.js';
import { runDueHeldEmails } from '../_lib/agentDuty.js';
import { runDueScorecards } from '../_lib/scorecard.js';

// Runs in front of every /api route only (Pages scopes a middleware file to its
// own directory), so static pages and images never pass through it.
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// There's no scheduler, so time-based messages (a homeowner's Decision Night arriving) go out from here: at most
// every few minutes per running instance, in the background after the response, never slowing a request down.
// Each job claims its rows with a conditional UPDATE, so instances running it at the same time can't double-send.
const DUE_JOBS_EVERY_MS = 5 * 60 * 1000;
let lastDueJobsRun = 0;
function maybeRunDueJobs(context) {
  if (!context.env || !context.env.DB || typeof context.waitUntil !== 'function') return;
  const now = Date.now();
  if (now - lastDueJobsRun < DUE_JOBS_EVERY_MS) return;
  lastDueJobsRun = now;
  // One after another (the email provider allows about 2 a second, and the background work about 30 seconds).
  context.waitUntil((async () => {
    for (const job of [runDueDecisionNights, runDueHeldEmails, runDueScorecards]) {
      if (Date.now() - now > 22000) break;
      try { await job(context); } catch (err) { console.log(`[due jobs failed] ${err && err.message}`); }
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
