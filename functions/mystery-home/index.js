// /mystery-home: this week's Mystery Home (if one is live) and the recent reveals (not retired, newest first, up to 8).
// Public and the same for everyone (never reads the session), cached 60 s. Cards never carry a sold price: the price
// is on each home's own page once its reveal time has passed.
import { escapeHtml } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { renderPublicShell, publicHtmlResponse } from '../_lib/publicShell.js';
import { MYSTERY_GAME_NOTE, MYSTERY_ROW_SQL, photoIdsOf, mysteryPhotoUrl, publicMysteryView, formatRevealDay, formatSoldMonth } from '../_lib/mysteryHomes.js';

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderMysteryHub(context));
}

async function renderMysteryHub(context) {
  const db = context.env.DB;
  const nowIso = new Date().toISOString();
  const notRetired = `status = 'scheduled' AND (retire_at IS NULL OR retire_at > ?1)`;
  const live = await db.prepare(
    `${MYSTERY_ROW_SQL} WHERE ${notRetired} AND publish_at <= ?1 AND reveal_at > ?1 ORDER BY publish_at DESC LIMIT 1`
  ).bind(nowIso).first();
  const reveals = await db.prepare(
    `${MYSTERY_ROW_SQL} WHERE ${notRetired} AND reveal_at <= ?1 ORDER BY reveal_at DESC LIMIT 8`
  ).bind(nowIso).all();

  const origin = new URL(context.request.url).origin;
  const card = (row, line) => {
    const view = publicMysteryView(row, photoIdsOf(row), nowIso);
    const photo = view.photoIds.length ? `<img src="/api/mystery-home-photos/${view.photoIds[0]}" alt="Mystery Home photo 1" loading="lazy">` : '';
    return `<a class="card" href="/mystery-home/${escapeHtml(view.slug)}">${photo}
        <strong>A home that sold in ${escapeHtml(view.city)}, ${escapeHtml(view.stateCode)}</strong>
        <span class="tiny">${escapeHtml(line(view))}</span></a>`;
  };
  const liveHtml = live
    ? `<h2>This week's Mystery Home</h2><div class="mystery-photos">${card(live, v => `Guess the price. The reveal is ${formatRevealDay(v.revealAt)}.`)}</div>`
    : '<div class="empty-state">The next Mystery Home is coming Monday.</div>';
  const revealRows = reveals.results || [];
  const revealsHtml = revealRows.length
    ? `<h2>Recent reveals</h2><ul class="mystery-archive">${revealRows.map(r => { const v = publicMysteryView(r, [], nowIso); return `<li><a href="/mystery-home/${escapeHtml(v.slug)}">A home that sold in ${escapeHtml(v.city)}, ${escapeHtml(v.stateCode)}</a> <span class="tiny">${escapeHtml(v.propertyType)} · sold ${escapeHtml(formatSoldMonth(r.sold_month))}</span></li>`; }).join('')}</ul>`
    : '';

  const body = `
    <div class="mystery-page">
      <p class="eyebrow">A new home every Monday</p>
      <h1>Mystery Home Monday</h1>
      <p class="section-sub">Look at the photos and the facts, guess what the home sold for, then come back on reveal day to see it.</p>
      ${liveHtml}
      ${revealsHtml}
      <p class="tiny mystery-game-note">${escapeHtml(MYSTERY_GAME_NOTE)}</p>
      <p class="tiny">Your guesses stay on your device. We don't collect them.</p>
      <div class="form-actions"><a class="btn btn-primary" href="/signup?as=homeowner">Thinking about your own home? Post a pre-listing</a></div>
    </div>`;
  const liveIds = live ? photoIdsOf(live) : [];
  return publicHtmlResponse(renderPublicShell('Mystery Home Monday — Amico Haus',
    'A weekly guessing game about a home that already sold. Guess the price, then see it on reveal day. Just for fun.', body, {
      image: liveIds.length ? mysteryPhotoUrl(origin, liveIds[0]) : '', url: `${origin}/mystery-home`,
    }), { maxAge: 60 });
}
