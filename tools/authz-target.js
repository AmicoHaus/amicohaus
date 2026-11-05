'use strict';
// Where the authz suite may run. No default: AUTHZ_BASE (the site URL) and AUTHZ_D1 (the wrangler database name) are
// required, plus AUTHZ_R2 (the photo bucket) for cleanup. Production is refused unless AUTHZ_ALLOW_PROD=1. See TESTING.md.
const PROD_HOSTS = new Set(['amicohaus.com', 'www.amicohaus.com', 'amicohaus.pages.dev']);
const PROD_D1 = 'amicohaus', PROD_R2 = 'amicohaus-photos';
// Names go straight into a wrangler command line, so they must be plain (no spaces, quotes or shell characters).
const NAME = /^[A-Za-z0-9_-]{1,63}$/;
const MISSING = 'set AUTHZ_BASE (a preview deployment URL), AUTHZ_D1 and AUTHZ_R2; see tools/TESTING.md';
const PROD_REFUSED = 'Refusing to run against production (amicohaus.com). Use a preview deployment and the amicohaus-test database, or set AUTHZ_ALLOW_PROD=1.';

function resolveAuthzTarget(env = process.env, { needR2 = false } = {}) {
  const e = env || {};
  const rawBase = String(e.AUTHZ_BASE || '').trim();
  const d1 = String(e.AUTHZ_D1 || '').trim();
  const r2 = String(e.AUTHZ_R2 || '').trim();
  if (!rawBase || !d1 || (needR2 && !r2)) throw new Error(MISSING);

  let url;
  try { url = new URL(rawBase); } catch { throw new Error(`AUTHZ_BASE is not a URL: ${rawBase}`); }
  if (url.protocol !== 'https:') throw new Error('AUTHZ_BASE must be an https:// URL.');
  if (!NAME.test(d1)) throw new Error('AUTHZ_D1 must be a plain database name (letters, digits, - and _).');
  if (r2 && !NAME.test(r2)) throw new Error('AUTHZ_R2 must be a plain bucket name (letters, digits, - and _).');

  // A trailing dot ("amicohaus.com.") and any subdomain of amicohaus.com still reach production.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  const isProd = PROD_HOSTS.has(host) || host.endsWith('.amicohaus.com') || d1 === PROD_D1 || r2 === PROD_R2;
  if (isProd && e.AUTHZ_ALLOW_PROD !== '1') throw new Error(PROD_REFUSED);

  return { base: url.origin.replace(/\/+$/, ''), d1, r2: r2 || null };
}

module.exports = { resolveAuthzTarget, PROD_HOSTS, PROD_D1, PROD_R2 };
