// One Mystery Home page: /mystery-home/<slug>. Public and the same for everyone (never reads the session), cached 60 s.
// Draft, not-yet-published, retired or unknown homes get the 404 page. The sold price is in nothing served before the
// reveal time: not the HTML, the og tags, the data attributes or the photos route. No JSON-LD (not a home for sale).
import { escapeHtml } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { renderPublicShell, publicHtmlResponse } from '../_lib/publicShell.js';
import {
  MYSTERY_GAME_NOTE, MYSTERY_PERMISSION_LINE, MYSTERY_FACTS_NOTE, MYSTERY_ROW_SQL, publicMysteryView, photoIdsOf,
  mysteryPhotoUrl, mysteryFactsList, formatSoldPrice, formatSoldMonth, formatRevealDay,
} from '../_lib/mysteryHomes.js';

export function mysteryNotFoundResponse() {
  const body = `
    <div class="mystery-page">
      <h1>Mystery Home Monday</h1>
      <div class="empty-state">This Mystery Home isn't here. The next one is coming Monday.</div>
      <div class="form-actions"><a class="btn btn-primary" href="/mystery-home">See Mystery Home Monday</a></div>
    </div>`;
  return publicHtmlResponse(renderPublicShell('Mystery Home not found — Amico Haus', '', body, { noindex: true }), { status: 404, maxAge: 60, noindex: true });
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderMysteryPage(context));
}

async function renderMysteryPage(context) {
  const slug = String(context.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return mysteryNotFoundResponse();
  const row = await context.env.DB.prepare(`${MYSTERY_ROW_SQL} WHERE slug = ?`).bind(slug).first();
  const nowIso = new Date().toISOString();
  const view = row ? publicMysteryView(row, photoIdsOf(row), nowIso) : null;
  if (!view || (view.state !== 'live' && view.state !== 'revealed')) return mysteryNotFoundResponse();

  const origin = new URL(context.request.url).origin;
  const place = `${view.city}, ${view.stateCode}`;
  const revealed = view.state === 'revealed';
  const photos = view.photoIds.map((id, i) => `<img src="/api/mystery-home-photos/${id}" alt="Mystery Home photo ${i + 1}" loading="${i < 2 ? 'eager' : 'lazy'}">`).join('');
  const facts = mysteryFactsList(view).map(f => `<li>${escapeHtml(f)}</li>`).join('');
  const sub = revealed
    ? 'Make your guess, then see what it sold for.'
    : `Guess the price, then come back ${escapeHtml(formatRevealDay(view.revealAt))} to see it.`;
  const reveal = revealed ? `
      <div class="mystery-reveal">
        <p><strong>Sold for ${escapeHtml(formatSoldPrice(view.sold.price))}</strong></p>
        <p class="tiny">${escapeHtml(formatSoldMonth(view.sold.month))} · ${escapeHtml(view.sold.label)}</p>
      </div>` : '';
  const dataAttrs = `data-mystery-slug="${escapeHtml(view.slug)}" data-mystery-place="${escapeHtml(place)}"` +
    (revealed ? ` data-mystery-sold="${Number(view.sold.price)}" data-mystery-month="${escapeHtml(formatSoldMonth(view.sold.month))}"` : '');

  const body = `
    <div class="mystery-page" ${dataAttrs}>
      <p class="eyebrow">Mystery Home Monday</p>
      <h1>A home that sold in ${escapeHtml(place)}</h1>
      <p class="section-sub">${sub}</p>
      <div class="mystery-photos">${photos}</div>
      <ul class="mystery-facts">${facts}</ul>
      <p class="tiny">${escapeHtml(MYSTERY_FACTS_NOTE)}</p>
      ${view.highlights ? `<p>${escapeHtml(view.highlights)}</p>` : ''}
      <div class="mystery-guess">
        <label for="mysteryGuess">Your guess</label>
        <input type="number" id="mysteryGuess" min="0" step="1000" inputmode="numeric">
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="mysteryLockBtn">Lock in my guess</button>
          <button type="button" class="btn btn-ghost" id="mysteryShareBtn">Make a share card</button>
        </div>
        <p class="tiny">Your guess stays on this device. We don't collect it.</p>
        <p class="tiny" id="mysteryGuessResult" aria-live="polite"></p>
      </div>
      ${reveal}
      <p class="tiny mystery-game-note">${escapeHtml(MYSTERY_GAME_NOTE)}</p>
      <p class="tiny">${escapeHtml(MYSTERY_PERMISSION_LINE)}</p>
      <div class="form-actions"><a class="btn btn-primary" href="/signup?as=homeowner">Thinking about your own home? Post a pre-listing</a></div>
      <p class="tiny"><a href="/mystery-home">More Mystery Homes</a></p>
    </div>`;

  const title = `Mystery Home Monday: a home that sold in ${place} — Amico Haus`;
  const description = revealed
    ? `A home that sold in ${place}. Guess the price, then see what it sold for. Just for fun.`
    : `A home that sold in ${place}. Guess the price, then come back to see it. Just for fun.`;
  const image = view.photoIds.length ? mysteryPhotoUrl(origin, view.photoIds[0]) : '';
  return publicHtmlResponse(renderPublicShell(title, description, body, {
    image, url: `${origin}/mystery-home/${view.slug}`, scripts: ['/mystery-home.js'],
  }), { maxAge: 60 });
}
