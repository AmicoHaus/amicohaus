import { getSessionUser } from '../_lib/auth.js';
import { escapeHtml } from '../_lib/util.js';
import { ASSET_VERSIONS } from '../_lib/assetVersions.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { ADAPTATION_ITEMS } from '../_lib/adaptations.js';
import { LIFE_EVENT_ITEMS } from '../_lib/lifeEvents.js';

const ADAPTATION_LABELS = Object.fromEntries(ADAPTATION_ITEMS.map(i => [i.key, i.label]));
const LIFE_EVENT_LABELS = Object.fromEntries(LIFE_EVENT_ITEMS.map(i => [i.key, i.label]));

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

function notFoundPage() {
  return new Response(renderShell('Listing Not Found — Amico Haus', '', `
    <div class="empty-state">This listing doesn't exist or is no longer active.</div>
    <div class="form-actions"><a class="btn btn-primary" href="/signup">Create Your Own Profile</a></div>
  `), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function renderShell(title, description, bodyHtml, authCta) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSIONS['/styles.css']}">
</head>
<body>
<div id="app">
  <a class="agent-strip" href="/about">Presented by <strong>Rudy Flores</strong> &middot; Coldwell Banker West &middot; DRE #02257808</a>
  <header class="topbar">
    <a class="brand" href="/">
      <svg viewBox="0 0 48 48" class="logo" aria-hidden="true">
        <path d="M24 4 L44 20 V42 H30 V28 H18 V42 H4 V20 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
      </svg>
      <span class="brand-text">AMICO <span class="accent">HAUS</span></span>
    </a>
    <nav class="tabs">
      <a class="tab tab-demo" href="/demo">Demo - Start Here!</a>
      <a class="tab" href="/#how">How it works</a>
      <a class="tab" href="/#directory">Live listings</a>
      <a class="tab" href="/about">About</a>
    </nav>
    <div class="auth-cta">${authCta || '<a class="btn btn-ghost btn-sm" href="/login">Log In</a> <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a>'}</div>
  </header>
  <main class="prose">
    ${bodyHtml}
  </main>
  <footer class="site-footer">
    Amico Haus — where homeowners and vetted agents find each other. <a href="/about">About</a> · <a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
  </footer>
</div>
<script src="/client.js?v=${ASSET_VERSIONS['/client.js']}"></script>
</body>
</html>`;
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderPage(context));
}

async function renderPage(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFoundPage();

  const db = context.env.DB;
  const home = await db.prepare(
    `SELECT augmented_homes.*, users.id AS owner_id, users.display_name AS owner_name, users.phone AS owner_phone,
            users.is_verified AS owner_verified,
            (SELECT id FROM augmented_home_photos WHERE augmented_home_photos.augmented_home_id = augmented_homes.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id
     WHERE augmented_homes.id = ? AND augmented_homes.status = 'active'`
  ).bind(id).first();
  if (!home) return notFoundPage();

  const viewer = await getSessionUser(context);
  const adaptations = JSON.parse(home.adaptations_json || '[]');
  const lifeEventTags = JSON.parse(home.life_event_tags_json || '[]');

  const loc = `${home.neighborhood ? escapeHtml(home.neighborhood) + ', ' : ''}${escapeHtml(home.city)}, ${escapeHtml(home.state)}`;
  const title = `${home.title || 'Accessible home'} in ${home.city}, ${home.state} — AugmentedHomes on Amico Haus`;
  const description = `${home.property_type} · ${home.beds}bd/${home.baths}ba in ${home.city}, ${home.state}, ${money(home.asking_price)}. Adapted with ${adaptations.slice(0, 3).map(k => ADAPTATION_LABELS[k] || k).join(', ')}${adaptations.length > 3 ? ', and more' : ''} — listed on AugmentedHomes.`;

  const authCta = viewer
    ? `<span class="tiny">Hi, ${escapeHtml(viewer.display_name)}</span> <a class="btn btn-primary btn-sm" href="/app#augmented">Go to App</a>`
    : null;

  const body = `
    <div class="card">
      <img class="directory-thumb" src="${home.photo_id ? `/api/augmented-home-photos/${home.photo_id}` : '/favicon.svg'}" alt="">
      <div class="card-head">
        <div>
          <h1>${escapeHtml(home.title || home.property_type)}</h1>
          <div class="card-agent">Listed by <a class="profile-link" href="/profile/${home.owner_id}">${escapeHtml(home.owner_name)}</a>${home.owner_verified ? ' <span class="badge badge-verified" title="Verified by Amico Haus">✓ Verified</span>' : ''}</div>
        </div>
        <span class="badge badge-gold">AugmentedHomes</span>
      </div>

      <div class="mini-block">
        <span class="label">Has</span>
        ${escapeHtml(home.property_type)} · ${home.beds}bd/${home.baths}ba${home.sqft ? ` · ${home.sqft.toLocaleString('en-US')} sqft` : ''}<br>
        ${loc}<br>
        ${money(home.asking_price)} asking
      </div>

      ${lifeEventTags.length ? `<p class="tiny">${lifeEventTags.map(k => `<span class="badge badge-gold">${escapeHtml(LIFE_EVENT_LABELS[k] || k)}</span>`).join(' ')}</p>` : ''}
      ${home.description ? `<p>${escapeHtml(home.description)}</p>` : ''}

      <h3>Adaptations</h3>
      <p class="tiny">${adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(ADAPTATION_LABELS[k] || k)}</span>`).join(' ')}</p>
      ${home.adaptation_notes ? `<p class="tiny"><span class="label">Seller's notes</span> ${escapeHtml(home.adaptation_notes)}</p>` : ''}
    </div>

    <div class="card about-card">
      <h2>Contact ${escapeHtml(home.owner_name)}</h2>
      ${home.owner_phone
        ? `<p>Call or text: <a href="tel:${escapeHtml(home.owner_phone.replace(/[^0-9+]/g, ''))}"><strong>${escapeHtml(home.owner_phone)}</strong></a></p>`
        : `<p class="tiny">No phone on file — sign up to message ${escapeHtml(home.owner_name)} directly through Amico Haus.</p>`}
      <div class="card-actions">
        <a class="btn btn-primary btn-sm" href="/profile/${home.owner_id}">View Full Profile</a>
      </div>
    </div>

    <div class="form-actions">
      <a class="btn btn-primary" href="/signup">Create Your Own Profile to Connect</a>
      <a class="btn btn-ghost" href="/app#augmented">← Back to AugmentedHomes</a>
    </div>
  `;

  return new Response(renderShell(title, description, body, authCta), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
