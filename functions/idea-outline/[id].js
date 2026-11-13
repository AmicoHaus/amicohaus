// The attorney packet: /idea-outline/<id>. One of the owner's own idea outlines as a page to print and take to any
// California attorney they choose. Owner only: anyone else, a signed-out visitor and a viewer the tool is dark for
// all get the same 404 page. Never cached, never indexed. It is the owner's outline plus general notes: no legal
// document, no clause, no named attorney, firm, surveyor or title company (only the State Bar's lawyer referral
// page), and nothing typed into the two fill-in lines is sent anywhere. The Print button uses client.js's
// data-action="print" handler (the page loads no script of its own). 2 statements (session, row).
import { getSessionUser } from '../_lib/auth.js';
import { escapeHtml } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { renderPublicShell } from '../_lib/publicShell.js';
import { toolLive } from '../_lib/nuancedGate.js';
import {
  OUTLINE_LABELS, SKETCH_LINE, SKETCH_LEGEND, ASK_LINE, NO_RECOMMEND_LINE, PACKET_LINES, STATE_BAR_LRS_URL, QUESTIONS, WHO_TO_ASK,
  outlineFromRow, sketchSvg, termOptionHtml,
} from '../_lib/dealOutlines.js';

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  });
}

function notFoundPage() {
  const body = `
    <div class="packet">
      <h1>We couldn't find that page</h1>
      <p class="section-sub">The link may be out of date, or the address may have a typo.</p>
      <p><a class="btn btn-primary" href="/">Back to home</a> <a class="btn btn-ghost" href="/app">Open the app</a></p>
    </div>`;
  return htmlResponse(renderPublicShell('Page not found — Amico Haus', '', body, { noindex: true }), 404);
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderPacket(context));
}

async function renderPacket(context) {
  const user = await getSessionUser(context);
  if (!user || !toolLive(context.env, 'easementIdeas', user)) return notFoundPage();
  const id = /^\d{1,15}$/.test(String(context.params.id || '')) ? Number(context.params.id) : 0;
  const row = id ? await context.env.DB.prepare('SELECT * FROM deal_outlines WHERE id = ? AND user_id = ?').bind(id, user.id).first() : null;
  if (!row) return notFoundPage();

  const o = outlineFromRow(row, { mine: true });
  const line = (text) => `<p class="packet-line">${escapeHtml(text)}</p>`;
  const hasSketch = o.sketch.cells.length > 0 || o.sketch.house.length > 0;
  const questions = [...o.questions.map(k => QUESTIONS[k]), ...(o.ownQuestion ? [o.ownQuestion] : [])];
  const body = `
    <div class="packet">
      <h1>Idea outline for my attorney</h1>
      ${OUTLINE_LABELS.map(line).join('\n      ')}

      <ul>${o.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
      ${hasSketch ? `${sketchSvg(o.sketch)}
      <p class="tiny">${escapeHtml(SKETCH_LEGEND)}</p>
      ${line(SKETCH_LINE)}` : ''}
      ${o.ask ? line(ASK_LINE) : ''}

      <h2>The option I'm looking at</h2>
      ${termOptionHtml(o.termOption)}
      ${line(NO_RECOMMEND_LINE)}

      <h2>Who to ask before anything is signed</h2>
      <div>${WHO_TO_ASK.map((who, i) => `<label class="checkbox-row" for="packetAsk${i}"><input type="checkbox" id="packetAsk${i}"> ${escapeHtml(who)}</label>`).join('')}</div>

      <h2>My questions</h2>
      ${questions.length ? `<ul>${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>` : '<p class="packet-line">&nbsp;</p>'}

      <div class="form-row two-col">
        <div class="field"><label for="packetApn">Parcel number (APN)</label><input type="text" id="packetApn" autocomplete="off"></div>
        <div class="field"><label for="packetAddress">Property address</label><input type="text" id="packetAddress" autocomplete="off"></div>
      </div>
      <p class="tiny flyer-noprint">Type these in before you print. Amico Haus doesn't keep them.</p>

      ${line(PACKET_LINES[0])}
      <p class="packet-line"><a href="${escapeHtml(STATE_BAR_LRS_URL)}" target="_blank" rel="noopener noreferrer">${escapeHtml(PACKET_LINES[1])}</a></p>
      ${line(PACKET_LINES[2])}

      <div class="form-actions flyer-noprint"><button type="button" class="btn btn-primary" data-action="print">Print</button></div>
    </div>`;
  return htmlResponse(renderPublicShell('Idea outline for my attorney — Amico Haus', '', body, { noindex: true }));
}
