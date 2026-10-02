import { json } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';

// Runs in front of every /api route only (Pages scopes a middleware file to its
// own directory), so static pages and images never pass through it.
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

  // Anything a route still lets escape becomes a JSON error the client can
  // show, rather than an HTML page it can't parse.
  try {
    return withSecurityHeaders(await context.next());
  } catch (err) {
    console.error(`Unhandled error in ${request.method} ${new URL(request.url).pathname}:`, (err && err.stack) || err);
    return withSecurityHeaders(json({ error: 'Something went wrong on our end. Please try again.' }, { status: 500 }));
  }
}
