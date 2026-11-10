// One Amico Haus video's page: /watch/<slug> (functions/_lib/videoTwins.js). Public and the same for everyone (never
// reads the session), cached 5 minutes. The hook as the headline, the cover, links to the real posts, the transcript
// (the posted cut's captions), one button and the previous/next episode. No embedded player and no third-party
// script (the CSP stays as it is); a VideoObject JSON-LD block only when there is a YouTube post and a cover.
import { escapeHtml } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { renderPublicShell, publicHtmlResponse, jsonLdScript } from '../_lib/publicShell.js';
import { VIDEO_TWINS, TWIN_BY_SLUG, TWIN_SERIES } from '../_lib/videoTwins.js';

const PLATFORMS = [['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['facebook', 'Facebook']];

// The YouTube video id from a youtube.com/shorts/<id>, youtu.be/<id> or watch?v=<id> link.
export function youtubeId(url) {
  const m = /(?:youtube\.com\/shorts\/|youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{6,20})/.exec(String(url || ''));
  return m ? m[1] : null;
}

export function watchNotFoundResponse() {
  const body = `
    <div class="watch-page">
      <h1>Amico Haus videos</h1>
      <div class="empty-state">This video page isn't here.</div>
      <div class="form-actions"><a class="btn btn-primary" href="/watch">See all the videos</a></div>
    </div>`;
  return publicHtmlResponse(renderPublicShell('Video not found — Amico Haus', '', body, { noindex: true }), { status: 404, maxAge: 60, noindex: true });
}

export async function onRequestGet(context) {
  return withSecurityHeaders(renderWatchPage(context));
}

function renderWatchPage(context) {
  const twin = TWIN_BY_SLUG.get(String(context.params.slug || '').toLowerCase());
  if (!twin) return watchNotFoundResponse();
  const origin = new URL(context.request.url).origin;
  const series = VIDEO_TWINS.filter(t => t.series === twin.series);
  const at = series.indexOf(twin);
  const prev = series[at - 1], next = series[at + 1];
  const links = PLATFORMS.filter(([key]) => twin.posts && twin.posts[key])
    .map(([key, label]) => `<a href="${escapeHtml(twin.posts[key])}" target="_blank" rel="noopener noreferrer">${label}</a>`).join(' · ');
  const label = TWIN_SERIES[twin.series] || 'Amico Haus';
  const body = `
    <div class="watch-page">
      <p class="eyebrow">${escapeHtml(label)} · Episode ${Number(twin.n)}</p>
      <h1>${escapeHtml(twin.hook)}</h1>
      ${twin.cover ? `<img class="watch-cover" src="${escapeHtml(twin.cover)}" alt="${escapeHtml(twin.title)} video cover">` : ''}
      ${links ? `<p class="watch-links">Watch it on: ${links}</p>` : ''}
      ${twin.description ? `<p>${escapeHtml(twin.description)}</p>` : ''}
      <h2>Transcript</h2>
      <div class="watch-transcript">${twin.transcript.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div>
      <div class="watch-cta"><a class="btn btn-primary" href="${escapeHtml(twin.cta.href)}">${escapeHtml(twin.cta.label)}</a></div>
      <nav class="watch-nav" aria-label="More episodes">
        ${prev ? `<a href="/watch/${escapeHtml(prev.slug)}">← Previous episode</a>` : ''}
        <a href="/watch">All videos</a>
        ${next ? `<a href="/watch/${escapeHtml(next.slug)}">Next episode →</a>` : ''}
      </nav>
    </div>`;

  const ytId = youtubeId(twin.posts && twin.posts.youtube);
  const jsonLd = ytId && twin.cover ? jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: twin.title,
    description: twin.description || twin.hook,
    thumbnailUrl: `${origin}${twin.cover}`,
    uploadDate: twin.uploadDate,
    embedUrl: `https://www.youtube.com/embed/${ytId}`,
  }) : '';
  return publicHtmlResponse(renderPublicShell(`${twin.title} — Amico Haus`, twin.description || twin.hook, body, {
    jsonLd, image: twin.cover ? `${origin}${twin.cover}` : '', url: `${origin}/watch/${twin.slug}`,
  }), { maxAge: 300 });
}
