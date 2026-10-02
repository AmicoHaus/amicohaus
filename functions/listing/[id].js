import { getSessionUser } from '../_lib/auth.js';
import { escapeHtml, parseJsonSafe } from '../_lib/util.js';
import { propertyArtUrl } from '../_lib/propertyArt.js';
import { fetchPortfolioMembers } from '../_lib/portfolios.js';
import { ASSET_VERSIONS } from '../_lib/assetVersions.js';
import { DEMO_EMAIL_PATTERN } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

function notFoundPage() {
  return new Response(renderShell('Listing Not Found — Amico Haus', '', `
    <div class="empty-state">This listing doesn't exist or is no longer active.</div>
    <div class="form-actions"><a class="btn btn-primary" href="/#directory">Browse the Directory</a></div>
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
      <a class="tab" href="/calculator">Calculator</a>
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
</body>
</html>`;
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderListingPage(context));
}

async function renderListingPage(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFoundPage();

  const db = context.env.DB;
  // Sample listings seeded for the demo have no public page: the demo and the live site stay separate.
  const listing = await db.prepare(
    `SELECT listings.*, users.id AS owner_id, users.display_name AS owner_name,
            users.phone AS owner_phone, users.is_verified AS owner_verified,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.price_min, desired_criteria.price_max,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM listings
     JOIN users ON users.id = listings.user_id
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.id = ? AND listings.status = 'active'
       AND users.email NOT LIKE ?`
  ).bind(id, DEMO_EMAIL_PATTERN).first();

  if (!listing) return notFoundPage();

  const members = listing.is_portfolio ? (await fetchPortfolioMembers(db, [listing.id])).get(listing.id) || [] : [];

  const viewer = await getSessionUser(context);
  const isOwnerOrAdmin = viewer && (viewer.id === listing.owner_id || viewer.role === 'admin');
  const showAddress = listing.show_exact_address && isOwnerOrAdmin && listing.address;

  // Don't count the owner refreshing their own page — "X people viewed this"
  // should mean actual prospective matches, not the owner checking on it.
  if (!viewer || viewer.id !== listing.owner_id) {
    context.waitUntil(db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').bind(id).run());
    listing.views += 1;
  }

  const loc = `${listing.neighborhood ? escapeHtml(listing.neighborhood) + ', ' : ''}${escapeHtml(listing.city)}, ${escapeHtml(listing.state)}`;
  const title = `${listing.title || listing.property_type} in ${listing.city}, ${listing.state} — Amico Haus`;
  const description = listing.is_portfolio
    ? `A portfolio of ${members.length} properties, ${money(listing.estimated_value)} combined. Listed on Amico Haus, looking to trade for ${listing.desired_type || 'the right match'}.`
    : listing.is_rental
    ? `${listing.property_type} · ${listing.beds}bd/${listing.baths}ba in ${listing.city}, ${listing.state}. Ultra-luxury rental at ${money(listing.rent_amount)}/mo on Amico Haus.`
    : `${listing.property_type} · ${listing.beds}bd/${listing.baths}ba in ${listing.city}, ${listing.state}, valued around ${money(listing.estimated_value)}. Listed on Amico Haus, looking to trade for ${listing.desired_type || 'the right match'}.`;

  const externalLinks = parseJsonSafe(listing.external_links, []);
  const linksHtml = externalLinks.length
    ? `<div class="mini-block"><span class="label">Links</span>${externalLinks.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || 'Link')}</a>`).join(' · ')}</div>`
    : '';

  const authCta = viewer
    ? `<span class="tiny">Hi, ${escapeHtml(viewer.display_name)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`
    : null;

  const body = `
    <div class="card">
      <img class="directory-thumb" src="${listing.photo_id ? `/api/photos/${listing.photo_id}` : propertyArtUrl(listing.property_type, listing.id)}" alt="">
      <div class="card-head">
        <div>
          <h1>${escapeHtml(listing.title || listing.property_type)}</h1>
          <div class="card-agent">Listed by <a class="profile-link" href="/profile.html?id=${listing.owner_id}">${escapeHtml(listing.owner_name)}</a>${listing.owner_verified ? ' <span class="badge badge-verified" title="Verified by Amico Haus">✓ Verified</span>' : ''}${listing.client_name ? ` on behalf of <strong>${escapeHtml(listing.client_name)}</strong>` : ''} · ${listing.views} view${listing.views === 1 ? '' : 's'}</div>
        </div>
        <span class="badge badge-gold">${listing.is_portfolio ? `Portfolio · ${members.length}` : (listing.is_rental ? 'For Rent' : escapeHtml(listing.price_tier))}</span>
      </div>

      <div class="mini-two">
        <div class="mini-block">
          <span class="label">Has</span>
          ${listing.is_portfolio ? `${members.length} properties` : `${escapeHtml(listing.property_type)} · ${listing.beds}bd/${listing.baths}ba${listing.sqft ? ` · ${listing.sqft.toLocaleString('en-US')} sqft` : ''}`}<br>
          ${showAddress ? escapeHtml(listing.address) + '<br>' : ''}${loc}${listing.is_portfolio ? ' (primary property)' : ''}<br>
          ${money(listing.estimated_value)}${listing.is_portfolio ? ' combined' : ''}
        </div>
        ${listing.is_rental
          ? `<div class="mini-block">
          <span class="label">Rent</span>
          ${money(listing.rent_amount)}/mo<br>
          ${listing.min_lease_months}-month minimum lease
        </div>`
          : `<div class="mini-block">
          <span class="label">Wants</span>
          ${escapeHtml(listing.desired_type || 'Any')} in ${escapeHtml(listing.locations || 'Anywhere')}<br>
          ${money(listing.price_min)}–${money(listing.price_max)}
        </div>`}
      </div>
      ${listing.is_portfolio ? `<div class="mini-block"><span class="label">Includes</span>${members.map(m => `${escapeHtml(m.propertyType)} in ${escapeHtml(m.city)}, ${escapeHtml(m.state)} (${money(m.estimatedValue)})`).join('<br>')}</div><p class="tiny">This is a portfolio trade — all ${members.length} properties move together as one deal. The combined value is the sum of what the owner entered for each property, not an appraisal.</p>` : ''}
      ${listing.is_rental ? '<p class="tiny">A lump-sum, multi-year prepayment may be negotiable in exchange for extra lease time — see the <a href="/calculator">rent-for-equity calculator</a> for an illustrative range. Not a guaranteed or platform-set term.</p>' : ''}

      ${listing.description ? `<p>${escapeHtml(listing.description)}</p>` : ''}
      ${linksHtml}
    </div>

    <div class="card about-card">
      <h2>Contact ${escapeHtml(listing.owner_name)}</h2>
      ${listing.owner_phone
        ? `<p>Call or text: <a href="tel:${escapeHtml(listing.owner_phone.replace(/[^0-9+]/g, ''))}"><strong>${escapeHtml(listing.owner_phone)}</strong></a></p>`
        : `<p class="tiny">No phone on file — sign up to message ${escapeHtml(listing.owner_name)} directly through Amico Haus.</p>`}
      <div class="card-actions">
        <a class="btn btn-primary btn-sm" href="/profile.html?id=${listing.owner_id}">View Full Profile</a>
      </div>
    </div>

    <div class="form-actions">
      <a class="btn btn-primary" href="/signup">Create Your Own Profile to Connect</a>
      <a class="btn btn-ghost" href="/#directory">← Back to Directory</a>
    </div>
  `;

  return new Response(renderShell(title, description, body, authCta), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
