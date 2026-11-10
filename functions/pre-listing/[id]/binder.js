import { getSessionUser } from '../../_lib/auth.js';
import { escapeHtml } from '../../_lib/util.js';
import { fetchPreListingPhotos } from '../../_lib/preListings.js';
import { withSecurityHeaders } from '../../_lib/withSecurityHeaders.js';
import { renderFlyerShell } from '../../_lib/flyerShell.js';
import {
  binderForOwner, BINDER_NOT_DISCLOSURE, BINDER_CODES_NOTE, BINDER_SECTIONS, MOVE_OUT_ITEMS, MOVE_OUT_LINKS,
} from '../../_lib/handoffBinder.js';

// The printable handoff binder (/pre-listing/:id/binder): the homeowner prints it or saves it as a PDF and hands it
// over at closing. Owner only (the hired agent, other agents and admins get 403), never cached, noindex (the flyer
// shell has it), with the site's security headers. Only what the owner wrote in the binder goes in: nothing from
// proposals, price opinions, opinion history, visit feedback, the Ready Meter, interviews or showings.
export async function onRequestGet(context) {
  return withSecurityHeaders(await renderBinder(context));
}

const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const paragraphs = (s) => String(s).split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => `<p>${escapeHtml(line)}</p>`).join('');

async function renderBinder(context) {
  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return text('Not found.', 404);
  const viewer = await getSessionUser(context);
  if (!viewer) return text('Sign in required.', 401);
  const db = context.env.DB;
  const row = await db.prepare('SELECT id, user_id, address, city, state, zip, property_type, binder_json FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row) return text('Not found.', 404);
  if (row.user_id !== viewer.id) return text('Forbidden.', 403);

  // Only photos that are still this home's (a photo deleted or replaced since is left out, never requested).
  const photoIds = (await fetchPreListingPhotos(db, id)).map(p => p.id);
  const b = binderForOwner(row, photoIds);
  const title = `Handoff binder: ${row.property_type} in ${row.city}`;
  const where = b.printAddress && row.address
    ? `<p><strong>${escapeHtml(row.address)}</strong><br>${escapeHtml(row.city)}, ${escapeHtml(row.state)} ${escapeHtml(row.zip || '')}</p>` : '';
  const sections = Object.entries(BINDER_SECTIONS).filter(([key]) => b.sections[key]).map(([key, label]) =>
    `<section class="binder-section"><h2>${escapeHtml(label)}</h2>${paragraphs(b.sections[key])}</section>`).join('');
  const appliances = b.appliances.length ? `<section class="binder-section"><h2>Appliances</h2>
    <table><thead><tr><th scope="col">Item</th><th scope="col">Brand</th><th scope="col">Year</th><th scope="col">Manual</th></tr></thead>
    <tbody>${b.appliances.map(a => `<tr><td>${escapeHtml(a.item)}</td><td>${escapeHtml(a.brand)}</td><td>${a.year || ''}</td><td>${escapeHtml(a.manual)}</td></tr>`).join('')}</tbody></table></section>` : '';
  const photos = b.photoIds.length ? `<section class="binder-section"><h2>Photos</h2><div class="binder-photos">${b.photoIds.map(pid =>
    `<img src="/api/pre-listing-photos/${pid}" alt="Photo of the ${escapeHtml(row.property_type)} in ${escapeHtml(row.city)}">`).join('')}</div></section>` : '';
  const moveOut = `<section class="binder-section"><h2>Move-out checklist</h2><ul>${Object.entries(MOVE_OUT_ITEMS).map(([key, label]) =>
    `<li>${b.moveOut.includes(key) ? '☑' : '☐'} ${escapeHtml(label)}${MOVE_OUT_LINKS[key] ? ` (${escapeHtml(MOVE_OUT_LINKS[key])})` : ''}</li>`).join('')}</ul></section>`;

  const body = `
    <div class="binder-print">
      <h1>${escapeHtml(title)}</h1>
      ${where}
      <p class="binder-banner">${escapeHtml(BINDER_NOT_DISCLOSURE)}</p>
      <p class="binder-banner">${escapeHtml(BINDER_CODES_NOTE)}</p>
      ${sections}
      ${appliances}
      ${photos}
      ${moveOut}
      <hr>
      <p>Prepared by the homeowner on Amico Haus. Owner notes, not a disclosure.</p>
      <p class="tiny">Amico Haus is presented by Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West</p>
    </div>`;
  return new Response(renderFlyerShell(title, body, { printLabel: 'Print Binder' }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}
