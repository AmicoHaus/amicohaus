import { SECURITY_HEADERS } from './securityHeaders.js';

// Cloudflare Pages applies the _headers file to static files only, so a
// response that a Function builds (the /listing/:id page, every /api/ answer,
// the sitemap) would otherwise go out without the site's security headers —
// no Content-Security-Policy, no clickjacking protection, no HSTS. This adds
// the same set. The values are generated from _headers by build-dist.js so the
// two can never drift apart.
export function withSecurityHeaders(response) {
  // Build a fresh Response so headers are always writable, and keep every
  // header the handler set (including multiple Set-Cookie values).
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  return out;
}
