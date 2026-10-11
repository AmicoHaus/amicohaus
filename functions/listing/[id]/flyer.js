import { getSessionUser } from '../../_lib/auth.js';
import { escapeHtml, parseJsonSafe, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { propertyArtUrl } from '../../_lib/propertyArt.js';
import { withSecurityHeaders } from '../../_lib/withSecurityHeaders.js';
import { renderFlyerShell } from '../../_lib/flyerShell.js';

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderFlyer(context));
}

// Owner (or admin) only -- this shows the exact street address, same reasoning the public page already
// uses to gate address visibility, just the stricter "owner only" version since there's no "show my exact
// address publicly" opt-in here at all.
async function renderFlyer(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return new Response('Not found.', { status: 404 });

  const db = context.env.DB;
  const viewer = await getSessionUser(context);
  if (!viewer) return new Response('Sign in required.', { status: 401 });

  const listing = await db.prepare(
    `SELECT listings.*, users.id AS owner_id, users.display_name AS owner_name, users.phone AS owner_phone
     FROM listings JOIN users ON users.id = listings.user_id
     WHERE listings.id = ? AND users.email NOT LIKE ?`
  ).bind(id, DEMO_EMAIL_PATTERN).first();
  if (!listing) return new Response('Not found.', { status: 404 });
  if (viewer.id !== listing.owner_id && viewer.role !== 'admin') return new Response('Forbidden.', { status: 403 });

  const photo = await db.prepare('SELECT id FROM listing_photos WHERE listing_id = ? ORDER BY position ASC LIMIT 1').bind(id).first();
  const loc = `${listing.neighborhood ? escapeHtml(listing.neighborhood) + ', ' : ''}${escapeHtml(listing.city)}, ${escapeHtml(listing.state)} ${escapeHtml(listing.zip || '')}`;
  const lifeEventTags = parseJsonSafe(listing.life_event_tags_json, []);

  const body = `
    <img class="directory-thumb" src="${photo ? `/api/photos/${photo.id}` : propertyArtUrl(listing.property_type, listing.id)}" alt="">
    <h1>${escapeHtml(listing.title || listing.property_type)}</h1>
    <p class="flyer-price">${listing.is_rental ? `${money(listing.rent_amount)}/mo` : money(listing.estimated_value)}</p>
    <p><strong>${escapeHtml(listing.address || '')}</strong><br>${loc}</p>
    <div class="mini-two">
      <div class="mini-block"><span class="label">Property</span>${escapeHtml(listing.property_type)} · ${listing.beds}bd/${listing.baths}ba${listing.sqft ? ` · ${listing.sqft.toLocaleString('en-US')} sqft` : ''}</div>
      <div class="mini-block"><span class="label">Listed</span>${new Date(listing.created_at + 'Z').toLocaleDateString('en-US', { dateStyle: 'medium' })}</div>
    </div>
    ${lifeEventTags.length ? `<p class="tiny">${lifeEventTags.map(k => `<span class="badge badge-gold">${escapeHtml(k)}</span>`).join(' ')}</p>` : ''}
    ${listing.description ? `<p>${escapeHtml(listing.description)}</p>` : ''}
    <hr>
    <p class="flyer-brand">
      <strong>${escapeHtml(listing.owner_name)}</strong>${listing.owner_phone ? ` · ${escapeHtml(listing.owner_phone)}` : ''}<br>
      Presented on Amico Haus · amicohaus.com/listing/${id}<br>
      Rudy Flores · Coldwell Banker West · DRE #02257808
    </p>
  `;

  return new Response(renderFlyerShell(`${listing.title || listing.property_type} — Flyer`, body), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
