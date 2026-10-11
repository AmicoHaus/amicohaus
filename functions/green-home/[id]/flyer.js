import { getSessionUser } from '../../_lib/auth.js';
import { escapeHtml, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { withSecurityHeaders } from '../../_lib/withSecurityHeaders.js';
import { renderFlyerShell } from '../../_lib/flyerShell.js';
import { GREEN_FEATURE_ITEMS } from '../../_lib/greenFeatures.js';

const GREEN_FEATURE_LABELS = Object.fromEntries(GREEN_FEATURE_ITEMS.map(i => [i.key, i.label]));

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderFlyer(context));
}

async function renderFlyer(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return new Response('Not found.', { status: 404 });

  const db = context.env.DB;
  const viewer = await getSessionUser(context);
  if (!viewer) return new Response('Sign in required.', { status: 401 });

  const home = await db.prepare(
    `SELECT green_homes.*, users.id AS owner_id, users.display_name AS owner_name, users.phone AS owner_phone
     FROM green_homes JOIN users ON users.id = green_homes.user_id
     WHERE green_homes.id = ? AND users.email NOT LIKE ?`
  ).bind(id, DEMO_EMAIL_PATTERN).first();
  if (!home) return new Response('Not found.', { status: 404 });
  if (viewer.id !== home.owner_id && viewer.role !== 'admin') return new Response('Forbidden.', { status: 403 });

  const photo = await db.prepare('SELECT id FROM green_home_photos WHERE green_home_id = ? ORDER BY position ASC LIMIT 1').bind(id).first();
  const greenFeatures = JSON.parse(home.green_features_json || '[]');
  const loc = `${home.neighborhood ? escapeHtml(home.neighborhood) + ', ' : ''}${escapeHtml(home.city)}, ${escapeHtml(home.state)} ${escapeHtml(home.zip || '')}`;

  const body = `
    <img class="directory-thumb" src="${photo ? `/api/green-home-photos/${photo.id}` : '/favicon.svg'}" alt="">
    <h1>${escapeHtml(home.title || home.property_type)}</h1>
    <p class="flyer-price">${money(home.asking_price)}</p>
    <p><strong>${escapeHtml(home.address || '')}</strong><br>${loc}</p>
    <div class="mini-block"><span class="label">Property</span>${escapeHtml(home.property_type)} · ${home.beds}bd/${home.baths}ba${home.sqft ? ` · ${home.sqft.toLocaleString('en-US')} sqft` : ''}</div>
    <h3>Green Features</h3>
    <p class="tiny">${greenFeatures.map(k => `<span class="badge badge-gold">${escapeHtml(GREEN_FEATURE_LABELS[k] || k)}</span>`).join(' ')}</p>
    ${home.feature_notes ? `<p class="tiny"><span class="label">Notes</span> ${escapeHtml(home.feature_notes)}</p>` : ''}
    ${home.description ? `<p>${escapeHtml(home.description)}</p>` : ''}
    <hr>
    <p class="flyer-brand">
      <strong>${escapeHtml(home.owner_name)}</strong>${home.owner_phone ? ` · ${escapeHtml(home.owner_phone)}` : ''}<br>
      Presented on Amico Haus · amicohaus.com/green-home/${id}<br>
      Rudy Flores · Coldwell Banker West · DRE #02257808
    </p>
  `;

  return new Response(renderFlyerShell(`${home.title || home.property_type} — Flyer`, body), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
