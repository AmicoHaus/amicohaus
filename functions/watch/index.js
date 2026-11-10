// /watch: every Amico Haus video with a page, one list per series in episode order (functions/_lib/videoTwins.js).
// Public and the same for everyone (never reads the session), cached 5 minutes.
import { escapeHtml } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { renderPublicShell, publicHtmlResponse } from '../_lib/publicShell.js';
import { VIDEO_TWINS, TWIN_SERIES } from '../_lib/videoTwins.js';

export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const sections = Object.entries(TWIN_SERIES).map(([key, label]) => {
    const list = VIDEO_TWINS.filter(t => t.series === key).sort((a, b) => a.n - b.n);
    if (!list.length) return '';
    return `<div class="watch-hub"><h2>${escapeHtml(label)}</h2>
      <ul>${list.map(t => `<li><a href="/watch/${escapeHtml(t.slug)}">${escapeHtml(t.hook)}</a></li>`).join('')}</ul></div>`;
  }).join('');
  const body = `
    <div class="watch-page">
      <h1>Amico Haus videos</h1>
      <p class="section-sub">Short cartoons about what you can do on Amico Haus. Each page has the transcript and links to watch it.</p>
      ${sections || '<div class="empty-state">Videos are coming soon.</div>'}
    </div>`;
  return withSecurityHeaders(publicHtmlResponse(renderPublicShell('Amico Haus videos',
    'Short Amico Haus cartoons with transcripts and links to watch them.', body, { url: `${origin}/watch` }), { maxAge: 300 }));
}
