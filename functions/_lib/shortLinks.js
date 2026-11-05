// Short links for video captions: amicohaus.com/t/mv4 (TikTok), /i/ (Instagram, which cross-posts to Facebook),
// /y/ (YouTube) and /f/ (Facebook). Captions can't hold clickable links, so a short path someone can type is the only
// way to tell which video brought a visitor. Each one is a 302 to the home page (or /for-agents with /agents on the
// end) carrying the utm tags, which client.js's captureAttribution saves like any other tagged visit.
// No database, no cookies, nothing about the visitor is stored here.
import { withSecurityHeaders } from './withSecurityHeaders.js';

export const SHORT_LINK_SOURCES = { t: 'tiktok', i: 'instagram', y: 'youtube', f: 'facebook' };

// The video id: lowercase letters, digits and hyphens, up to 40 characters, starting with a letter or digit.
const VIDEO_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Where a short link goes, as a path: `/?utm_…` or `/for-agents?utm_…`, or plain `/` for anything that isn't a
// valid id (so a typo still lands somewhere useful, just untagged).
export function shortLinkTarget(source, segments) {
  const parts = (segments || []).map(s => String(s).toLowerCase());
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop(); // a trailing slash
  const [id, extra, ...rest] = parts;
  if (!id || !VIDEO_ID_RE.test(id) || rest.length > 0 || (extra !== undefined && extra !== 'agents')) return '/';
  const page = extra === 'agents' ? '/for-agents' : '/';
  return `${page}?utm_source=${source}&utm_medium=video&utm_campaign=${id}`;
}

// The handler behind functions/<t|i|y|f>/[[path]].js. The path is read from the URL itself (not the route params),
// so a trailing slash or an extra segment is handled the same way everywhere.
export function shortLinkRedirect(context, letter) {
  const source = SHORT_LINK_SOURCES[letter];
  const url = new URL(context.request.url);
  const segments = url.pathname.split('/').slice(2); // drop '' and the letter
  const target = source ? shortLinkTarget(source, segments) : '/';
  return withSecurityHeaders(new Response(null, {
    status: 302,
    headers: { Location: new URL(target, url.origin).href, 'Cache-Control': 'no-store' },
  }));
}
