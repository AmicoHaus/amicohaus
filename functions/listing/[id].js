import { getSessionUser, phoneVisibleTo } from '../_lib/auth.js';
import { escapeHtml, parseJsonSafe } from '../_lib/util.js';
import { propertyArtUrl } from '../_lib/propertyArt.js';
import { fetchPortfolioMembers } from '../_lib/portfolios.js';
import { ASSET_VERSIONS } from '../_lib/assetVersions.js';
import { DEMO_EMAIL_PATTERN, unlistedOwnerSql } from '../_lib/util.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { homeCostsFromRow, homeCostsLines, HOME_COSTS_HEADING, HOME_COSTS_CONFIRM_LINE } from '../_lib/homeCosts.js';
import { fetchOpenHouses } from '../_lib/openHouses.js';
import { fetchMyOffer } from '../_lib/listingOffers.js';
import { findOrCreateThreadPost } from '../_lib/dealThreads.js';
import { fetchPriceSeriesBatch } from '../_lib/priceSeries.js';
import { fetchSimilarEntities, similarEntitiesHtml } from '../_lib/similarEntities.js';
import { mortgageCalcHtml } from '../_lib/mortgageCalc.js';
import { realEstateListingJsonLd } from '../_lib/structuredData.js';

// Under the offer and counter-back message boxes (fair housing: the note is about the deal, not the buyer).
const OFFER_MESSAGE_NOTE = 'Stick to price, terms and timing. Leave out personal details like family, religion, age or background.';
// Under California law a renter's source of income (e.g. a housing voucher) is protected; shown on every rental.
const SOI_PAGE_LINE = "Under California law, a renter's source of income (including a Section 8 or VASH voucher) is protected.";
// Beside every offer, accept and counter (Rudy 11.04): the tools only say "I'd like to move forward", never a contract.
const OFFER_TOOLS_LINE = "Not a purchase agreement. A California home sale needs a written contract signed by both sides, usually prepared by your agents. Accepting here only tells the other side you'd like to move forward.";
// Under the comment box (fair housing).
const COMPOSER_LINE = 'Describe the home, not who should live there or who lives nearby.';

// An approved agent's identity at a point of contact: "Name · DRE #01234567 on file · Brokerage". "On file", never
// "verified": the site doesn't vouch for anyone's license status today.
function agentIdentity(name, licenseNumber, brokerageName) {
  const lic = String(licenseNumber || '').trim();
  const brok = String(brokerageName || '').trim();
  if (!lic && !brok) return '';
  return [name, lic ? `DRE #${lic} on file` : '', brok].filter(Boolean).join(' · ');
}

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

// Duplicated from client.js's timeAgo() on purpose -- this runs server-side at render time, the client
// copy runs in the browser after a comment is posted/deleted. Same tiny function, two environments.
function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString + 'Z').getTime()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(seconds / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function daysOnMarketLabel(createdAt) {
  if (!createdAt) return '';
  const days = Math.floor((Date.now() - new Date(createdAt + 'Z').getTime()) / 86400000);
  if (days <= 0) return 'Listed today';
  return `${days} day${days === 1 ? '' : 's'} on market`;
}

// Duplicated from main.js's sparklineHtml() on purpose -- same reasoning as money()/timeAgo() above, this
// runs server-side at render time for the public page's initial HTML.
function sparklineHtml(series) {
  if (!series || series.length < 2) return '';
  const w = 88, h = 22, pad = 2;
  const min = Math.min(...series), max = Math.max(...series);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (series.length - 1);
  const points = series.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const tone = series[series.length - 1] < series[0] ? 'ticker-down' : series[series.length - 1] > series[0] ? 'ticker-up' : 'ticker-neutral';
  const title = `${money(series[0])} → ${money(series[series.length - 1])}`;
  return `<svg class="sparkline ${tone}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Price history: ${title}"><title>${title}</title><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function notFoundPage() {
  return new Response(renderShell('Listing Not Found — Amico Haus', '', `
    <div class="empty-state">This listing doesn't exist or is no longer active.</div>
    <div class="form-actions"><a class="btn btn-primary" href="/#directory">Browse the Directory</a></div>
  `), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// noindex: the page still opens by direct link but asks search engines to leave it out (unlisted owners, see
// unlistedOwnerSql in _lib/util.js); the Response also carries X-Robots-Tag.
function renderShell(title, description, bodyHtml, authCta, { jsonLd = '', image = '', url = '', noindex = false } = {}) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${noindex ? '<meta name="robots" content="noindex">' : ''}
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
${url ? `<link rel="canonical" href="${escapeHtml(url)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Amico Haus">
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ''}
${url ? `<meta property="og:url" content="${escapeHtml(url)}">` : ''}
${image ? `<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSIONS['/styles.css']}">
${jsonLd}
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
      <a class="tab tab-cta tab-cta-post" href="/signup?as=homeowner">Post a Pre-Listing</a>
      <a class="tab tab-cta tab-cta-agent" href="/signup?as=agent">I'm an Agent</a>
      <a class="tab" href="/#how">How it works</a>
      <a class="tab" href="/about">About</a>
    </nav>
    <div class="auth-cta">${authCta || '<a class="btn btn-ghost btn-sm" href="/login">Log In</a> <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a>'}</div>
  </header>
  <main class="prose">
    ${bodyHtml}
  </main>
  <footer class="site-footer">
    <span class="footer-tagline">Amico Haus: the real estate marketplace of tomorrow! Everything that's missing from the real estate market for the homeowner!</span> <a href="/about">About</a> · <a href="/whats-new">What's New</a> · <a href="/calculator">Calculator</a> · <a href="/assumable-loans">Assumable loans</a> · <a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="https://www.instagram.com/amicohaus" target="_blank" rel="noopener noreferrer">Instagram</a> · <a href="https://www.tiktok.com/@amicohaus" target="_blank" rel="noopener noreferrer">TikTok</a> · <a href="https://www.youtube.com/@amicohaus" target="_blank" rel="noopener noreferrer">YouTube</a>
    <p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>
  </footer>
</div>
<script src="/client.js?v=${ASSET_VERSIONS['/client.js']}"></script>
<script src="/listing-actions.js?v=${ASSET_VERSIONS['/listing-actions.js']}"></script>
<!-- Cloudflare Web Analytics -->
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "91a193988b2d45e58aa1c27d5abf6bdb"}'></script>
<!-- End Cloudflare Web Analytics -->
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
            users.phone AS owner_phone, users.phone_public AS owner_phone_public,
            owner_agent.license_number AS owner_license, owner_agent.brokerage_name AS owner_brokerage,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.price_min, desired_criteria.price_max,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id,
            ${unlistedOwnerSql('users.email')} AS unlisted_owner
     FROM listings
     JOIN users ON users.id = listings.user_id
     LEFT JOIN agent_profiles AS owner_agent ON owner_agent.user_id = users.id AND owner_agent.status = 'approved'
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.id = ? AND listings.status = 'active'
       AND users.email NOT LIKE ? AND users.status = 'active'`
  ).bind(id, DEMO_EMAIL_PATTERN).first();

  if (!listing) return notFoundPage();

  const members = listing.is_portfolio ? (await fetchPortfolioMembers(db, [listing.id])).get(listing.id) || [] : [];
  const priceSeriesMap = await fetchPriceSeriesBatch(db, 'listing', [listing.id]);
  const priceSeries = [...(priceSeriesMap.get(listing.id) || []), listing.estimated_value];

  const viewer = await getSessionUser(context);
  // The owner's phone is private unless they turned on "Show my phone number" (or shared their contact with this
  // agent); otherwise visitors reach them through Amico Haus messages.
  const ownerPhone = await phoneVisibleTo(db, viewer, { id: listing.owner_id, phone: listing.owner_phone, phone_public: listing.owner_phone_public });
  // An approved agent who posted this (e.g. for a client) carries their DRE identity line at this point of contact
  // (California rule): "Name · DRE #01234567 on file · Brokerage". Homeowners and buyers keep the plain name.
  const ownerIdentity = agentIdentity(listing.owner_name, listing.owner_license, listing.owner_brokerage);
  const isOwner = !!viewer && viewer.id === listing.owner_id;
  const isOwnerOrAdmin = !!viewer && (isOwner || viewer.role === 'admin');
  // The street address is only ever shown to the owner (and admins), labeled so they know nobody else sees it.
  const showAddress = isOwnerOrAdmin && listing.address;

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
    ? `${listing.property_type} · ${listing.beds}bd/${listing.baths}ba in ${listing.city}, ${listing.state}. For rent at ${money(listing.rent_amount)}/mo on Amico Haus.`
    : `${listing.property_type} · ${listing.beds}bd/${listing.baths}ba in ${listing.city}, ${listing.state}. Owner's estimated value ${money(listing.estimated_value)} (not an appraisal). Listed on Amico Haus, looking to trade for ${listing.desired_type || 'the right match'}.`;

  // "Why I'm moving" tags are never shown on this public page (fair housing and privacy): only the owner and their
  // matches see them in the app.

  const similar = await fetchSimilarEntities(db, 'listing', { excludeId: id, city: listing.city, state: listing.state, propertyType: listing.property_type });

  const openHouses = await fetchOpenHouses(db, id, viewer ? viewer.id : null);
  const openHousesHtml = openHouses.length ? `
    <div class="card about-card">
      <h2>Open Houses</h2>
      ${openHouses.map(oh => `
        <div class="side" data-open-house-id="${oh.id}">
          <strong>${new Date(oh.startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} – ${new Date(oh.endsAt).toLocaleTimeString('en-US', { timeStyle: 'short' })}</strong>
          ${oh.note ? `<p class="tiny">${escapeHtml(oh.note)}</p>` : ''}
          <p class="tiny" data-rsvp-count>${oh.rsvpCount} ${oh.rsvpCount === 1 ? 'person is' : 'people are'} going</p>
          ${viewer
            ? `<button type="button" class="btn ${oh.imGoing ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="rsvp-open-house" data-id="${oh.id}" data-going="${oh.imGoing ? '1' : '0'}">${oh.imGoing ? "I'm Going ✓" : "I'm Going"}</button>`
            : `<a class="btn btn-ghost btn-sm" href="/signup">Sign up free to RSVP</a> <a class="tiny" href="/login">Have an account? Log in</a>`}
        </div>
      `).join('')}
    </div>` : '';

  // Offers only apply to a home actually for sale/trade -- not a rental, and not the owner's own listing.
  const canOffer = !listing.is_rental && !listing.is_buyer_only && (!viewer || viewer.id !== listing.owner_id);
  let offerHtml = '';
  if (canOffer) {
    if (!viewer) {
      offerHtml = `<div class="card about-card"><h2>Make an Offer</h2><p class="tiny">Create a free account to tell the owner the price, financing and timeline you'd offer. It's not a purchase agreement.</p><a class="btn btn-primary btn-sm" href="/signup">Sign Up Free</a> <a class="tiny" href="/login">Have an account? Log in</a></div>`;
    } else {
      const myOffer = await fetchMyOffer(db, id, viewer.id);
      if (myOffer && myOffer.status === 'pending') {
        offerHtml = `
          <div class="card about-card">
            <h2>Your Offer</h2>
            <p><strong>${money(myOffer.offerPrice)}</strong> — ${myOffer.financingType === 'cash' ? 'Cash' : 'Financed'} <span class="badge">pending</span></p>
            <div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-offer" data-id="${myOffer.id}">Withdraw Offer</button></div>
            <p class="form-note">${OFFER_TOOLS_LINE}</p>
          </div>`;
      } else if (myOffer && myOffer.status === 'countered' && myOffer.counteredBy === 'owner') {
        offerHtml = `
          <div class="card about-card">
            <h2>Your Offer</h2>
            <p><strong>${money(myOffer.offerPrice)}</strong> — ${myOffer.financingType === 'cash' ? 'Cash' : 'Financed'} <span class="badge">countered</span></p>
            <p class="tiny"><span class="label">Seller's counter</span> ${money(myOffer.counterPrice)}${myOffer.counterMessage ? ` — "${escapeHtml(myOffer.counterMessage)}"` : ''}</p>
            <div class="card-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="respond-counter" data-id="${myOffer.id}" data-decision="accept_counter">Accept ${money(myOffer.counterPrice)}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="respond-counter" data-id="${myOffer.id}" data-decision="decline_counter">Decline</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-offer" data-id="${myOffer.id}">Withdraw</button>
            </div>
            <details class="panel">
              <summary>Counter back</summary>
              <div class="field"><label>Counter price ($)</label><input type="number" id="counterBackPrice" min="1" max="500000000" step="1000"></div>
              <div class="field"><label>Message (optional)</label><textarea id="counterBackMessage" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${OFFER_MESSAGE_NOTE}</p></div>
              <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-back" data-id="${myOffer.id}">Send Counter</button></div>
            </details>
            <p class="form-note">${OFFER_TOOLS_LINE}</p>
          </div>`;
      } else if (myOffer && myOffer.status === 'countered' && myOffer.counteredBy === 'buyer') {
        offerHtml = `
          <div class="card about-card">
            <h2>Your Offer</h2>
            <p><strong>${money(myOffer.counterPrice)}</strong>${myOffer.counterMessage ? ` — "${escapeHtml(myOffer.counterMessage)}"` : ''} <span class="badge">countered</span></p>
            <p class="tiny">Waiting on the seller to respond.</p>
            <div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-offer" data-id="${myOffer.id}">Withdraw Offer</button></div>
          </div>`;
      } else if (myOffer && myOffer.status !== 'pending') {
        offerHtml = `<div class="card about-card"><h2>Your Offer</h2><p><strong>${money(myOffer.offerPrice)}</strong> — <span class="badge">${myOffer.status}</span></p></div>`;
      } else {
        offerHtml = `
          <div class="card about-card" id="offerFormCard">
            <h2>Make an Offer</h2>
            <p class="tiny">Tell the owner your price, financing and timeline. The owner sees it directly; no funds move through Amico Haus.</p>
            <div class="field"><label>Offer price ($)</label><input type="number" id="offerPrice" min="1" max="500000000" step="1000"></div>
            <div class="field"><label>Financing</label><select id="offerFinancingType"><option value="financed">Financed</option><option value="cash">Cash</option></select></div>
            <div class="field"><label>Proposed closing timeline</label><input type="text" id="offerClosingTimeline" maxlength="100" placeholder="e.g. 30 days"></div>
            <div class="field"><label>Contingencies</label><input type="text" id="offerContingencies" maxlength="500" placeholder="e.g. subject to inspection, financing approval"></div>
            <div class="field"><label for="offerMessage">Note about your terms (optional)</label><textarea id="offerMessage" maxlength="1000"></textarea><p class="tiny field-hint composer-note">Stick to price, terms and timing. Leave out personal details like family, religion, age or background.</p></div>
            <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="submit-offer" data-listing-id="${id}">Submit Offer</button></div>
            <p class="form-note">${OFFER_TOOLS_LINE}</p>
          </div>`;
      }
    }
  }

  // Discussion thread: shown to signed-in members only, so other people's comments never sit on a public, indexed page.
  // Reuses the same posts/comments API the SPA's deal threads use, no new comment logic here. Hidden comments
  // (moderation, functions/_lib/moderation.js) are left out, except for their author and admins, labeled. A comment by
  // an approved agent carries their DRE identity line (California rule).
  let discussionHtml;
  if (!viewer) {
    discussionHtml = `
    <div class="card about-card">
      <h2>Discussion</h2>
      <p class="tiny"><a href="/signup">Sign up free</a> to read and join the discussion about this home (or <a href="/login">log in</a>).</p>
    </div>`;
  } else {
    const threadPostId = await findOrCreateThreadPost(db, 'listing', id, listing.owner_id);
    const commentRows = await db.prepare(
      `SELECT comments.id, comments.user_id, comments.body, comments.created_at, comments.hidden_at, comments.hidden_reason,
              users.display_name AS author_name,
              author_agent.license_number AS author_license, author_agent.brokerage_name AS author_brokerage,
              (SELECT COUNT(*) FROM comment_likes WHERE comment_likes.comment_id = comments.id) AS like_count
       FROM comments JOIN users ON users.id = comments.user_id
       LEFT JOIN agent_profiles AS author_agent ON author_agent.user_id = comments.user_id AND author_agent.status = 'approved'
       WHERE comments.post_id = ?1 AND (comments.hidden_at IS NULL OR comments.user_id = ?2 OR ?3 = 1)
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks
           WHERE (user_blocks.blocker_id = ?2 AND user_blocks.blocked_id = comments.user_id)
              OR (user_blocks.blocker_id = comments.user_id AND user_blocks.blocked_id = ?2)
         )
       ORDER BY comments.created_at ASC LIMIT 200`
    ).bind(threadPostId, viewer.id, viewer.role === 'admin' ? 1 : 0).all();
    // The home's owner and admins can hide other people's comments here (POST /api/comments/:id/hide).
    const canHideComments = viewer.id === listing.owner_id || viewer.role === 'admin';
    const commentHtml = (c) => `
    <div class="side" data-comment-id="${c.id}">
      <strong><a class="profile-link" href="/profile/${c.user_id}">${escapeHtml(agentIdentity(c.author_name, c.author_license, c.author_brokerage) || c.author_name)}</a></strong> <span class="tiny">${timeAgo(c.created_at)}</span>
      ${!c.hidden_at ? '' : viewer.id === c.user_id
        ? '<p class="tiny">Hidden by moderation. Only you can see this comment.</p>'
        : `<p class="tiny hidden-note">Hidden (admins only see this)${c.hidden_reason ? `: ${escapeHtml(c.hidden_reason)}` : ''} <button type="button" class="link-btn" data-action="unhide-content" data-kind="comment" data-id="${c.id}">Unhide</button></p>`}
      <p class="tiny">${escapeHtml(c.body)}</p>
      <button type="button" class="link-btn" data-action="like-comment" data-id="${c.id}">👍 ${c.like_count || 0}</button>
      ${viewer.id === c.user_id
        ? `<button type="button" class="link-btn danger" data-action="delete-comment" data-id="${c.id}">Delete</button>`
        : `<button type="button" class="link-btn" data-action="report-comment" data-id="${c.id}">Report</button>`}
      ${canHideComments && viewer.id !== c.user_id && !c.hidden_at ? `<button type="button" class="link-btn" data-action="hide-comment" data-id="${c.id}">Hide</button>` : ''}
    </div>
  `;
    discussionHtml = `
    <div class="card about-card">
      <h2>Discussion</h2>
      <div class="comments-list" id="comments-list-${threadPostId}">
        ${commentRows.results.map(commentHtml).join('') || '<p class="tiny">No comments yet.</p>'}
      </div>
      <form class="comment-form" data-post-id="${threadPostId}">
        <input type="text" maxlength="1000" placeholder="Write a comment…" aria-label="Write a comment" required>
        <button type="submit" class="btn btn-ghost btn-sm">Send</button>
      </form>
      <p class="form-note">${COMPOSER_LINE}</p>
    </div>
  `;
  }

  const externalLinks = parseJsonSafe(listing.external_links, []);
  const virtualTour = externalLinks.find(l => l.label === 'Virtual Tour');
  const otherLinks = externalLinks.filter(l => l.label !== 'Virtual Tour');
  const linksHtml =
    (virtualTour ? `<div class="form-actions"><a class="btn btn-ghost btn-sm" href="${escapeHtml(virtualTour.url)}" target="_blank" rel="noopener noreferrer">🎥 Take the Virtual Tour</a></div>` : '') +
    (otherLinks.length ? `<div class="mini-block"><span class="label">Links</span>${otherLinks.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || 'Link')}</a>`).join(' · ')}</div>` : '');

  const authCta = viewer
    ? `<span class="tiny">Hi, ${escapeHtml(viewer.display_name)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`
    : null;

  // Report (fair housing or a rules problem): signed-in visitors other than the owner get the inline report form
  // (listing-actions.js); signed-out visitors are sent to the contact form; the owner sees nothing.
  const reportHtml = !viewer
    ? ' · <a class="link-btn" href="/contact">Report a concern</a>'
    : isOwner ? '' : ` · <span data-report-host><button type="button" class="link-btn" data-action="report-listing" data-id="${id}">Report</button></span>`;

  const body = `
    <div id="entityMeta" class="hidden" data-kind="listing" data-id="${id}" data-title="${escapeHtml(listing.title || listing.property_type)}" data-amount="${listing.estimated_value}" data-city="${escapeHtml(listing.city)}" data-state="${escapeHtml(listing.state)}"></div>
    <div class="card">
      <img class="directory-thumb" src="${listing.photo_id ? `/api/photos/${listing.photo_id}` : propertyArtUrl(listing.property_type, listing.id)}" alt="${listing.photo_id ? escapeHtml(`Photo of ${listing.title || listing.property_type}`) : 'Illustrative photo, not this home'}">
      ${listing.photo_id ? '' : '<span class="photo-caption">Illustrative photo, not this home</span>'}
      <div class="card-head">
        <div>
          <h1>${escapeHtml(listing.title || listing.property_type)}</h1>
          <div class="card-agent">Listed by <a class="profile-link" href="/profile/${listing.owner_id}">${escapeHtml(ownerIdentity || listing.owner_name)}</a>${(listing.client_name && isOwnerOrAdmin) ? ` on behalf of <strong>${escapeHtml(listing.client_name)}</strong>` : ''}${isOwnerOrAdmin ? ` · ${listing.views} view${listing.views === 1 ? '' : 's'}` : ''}${reportHtml}</div>
        </div>
        <span class="badge badge-gold">${listing.is_portfolio ? `Portfolio · ${members.length}` : (listing.is_rental ? 'For Rent' : escapeHtml(listing.price_tier))}</span>
      </div>

      <div class="mini-two">
        <div class="mini-block">
          <span class="label">Has</span>
          ${listing.is_portfolio ? `${members.length} properties` : `${escapeHtml(listing.property_type)} · ${listing.beds}bd/${listing.baths}ba${listing.sqft ? ` · ${listing.sqft.toLocaleString('en-US')} sqft` : ''}`}<br>
          ${showAddress ? `${escapeHtml(listing.address)} <span class="tiny">(${isOwner ? 'only you see this' : 'private: only the owner and admins see this'})</span><br>` : ''}${loc}${listing.is_portfolio ? ' (primary property)' : ''}<br>
          <span class="tiny">Owner's estimated value (not an appraisal or list price)</span><br>
          ${money(listing.estimated_value)}${listing.is_portfolio ? ' combined' : ''} ${listing.is_portfolio ? '' : sparklineHtml(priceSeries)}
          ${listing.is_portfolio ? '' : `<div class="tiny">${daysOnMarketLabel(listing.created_at)}</div>`}
          ${(() => { const lines = homeCostsLines(homeCostsFromRow(listing)); return lines.length ? `<p class="tiny"><span class="label">${escapeHtml(HOME_COSTS_HEADING)}</span> ${escapeHtml(lines.join(' · '))}</p><p class="tiny">${escapeHtml(HOME_COSTS_CONFIRM_LINE)}</p>` : ''; })()}
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
      ${listing.is_rental ? '<p class="tiny">See the <a href="/calculator">rent calculator</a> for rough math from your own numbers. A large rent prepayment can be lost if the landlord sells, refinances or loses the home. Use escrow and a real estate attorney; California rules on advance rent may apply. ' + SOI_PAGE_LINE + '</p>' : ''}

      ${listing.description ? `<p>${escapeHtml(listing.description)}</p>` : ''}
      ${linksHtml}
      ${!listing.is_rental ? `<p class="form-note trust"><strong>Talk to a lender.</strong> If a trade like this means financing a cash difference, rates, loan programs and approvals come from lenders, not from websites or real estate agents. Talk to your own mortgage broker, or use our preferred lender, <strong>Point Mortgage Corporation</strong> (NMLS #231073), at <a href="tel:+16194754095">(619) 475-4095</a>. You are always free to choose any lender you like, and you can verify any lender's license at nmlsconsumeraccess.org.</p>` : ''}
    </div>

    <div class="card about-card">
      <h2>Contact ${escapeHtml(listing.owner_name)}</h2>
      ${ownerIdentity ? `<p class="tiny">${escapeHtml(ownerIdentity)}</p>` : ''}
      ${ownerPhone
        ? `<p>Call or text: <a href="tel:${escapeHtml(ownerPhone.replace(/[^0-9+]/g, ''))}"><strong>${escapeHtml(ownerPhone)}</strong></a></p>`
        : `<p class="tiny">${viewer ? 'Message' : 'Sign up to message'} ${escapeHtml(listing.owner_name)} directly through Amico Haus.</p>`}
      <div class="card-actions">
        <a class="btn btn-primary btn-sm" href="/profile/${listing.owner_id}">View Full Profile</a>
      </div>
    </div>

    ${openHousesHtml}
    ${offerHtml}
    ${!listing.is_rental ? mortgageCalcHtml(listing.estimated_value, { lenderNote: false }) : ''}
    ${similarEntitiesHtml(similar)}
    ${discussionHtml}

    <div class="card about-card recently-viewed-strip hidden" id="recentlyViewedStrip"></div>

    <div class="form-actions">
      <a class="btn btn-primary" href="/signup">Create Your Own Profile to Connect</a>
      <a class="btn btn-ghost" href="/#directory">← Back to Directory</a>
    </div>
  `;

  // Buyer-only listings aren't a home for sale (it's someone wanting to buy one) -- RealEstateListing/Offer
  // schema would misrepresent that, so skip structured data for them entirely rather than force-fit it.
  const pageUrl = `https://amicohaus.com/listing/${id}`;
  // The same photo the page itself shows -- what a link preview in iMessage, Facebook, LinkedIn or a text shows.
  // A listing without its own photo previews with the site image rather than a stock house that a viewer would
  // take for the real home.
  const shareImage = listing.photo_id ? `https://amicohaus.com/api/photos/${listing.photo_id}` : 'https://amicohaus.com/og-image.png';
  const jsonLd = listing.is_buyer_only ? '' : realEstateListingJsonLd({
    url: pageUrl,
    name: listing.title || listing.property_type,
    description,
    image: shareImage,
    datePosted: listing.created_at,
    city: listing.city, state: listing.state, propertyType: listing.property_type,
    beds: listing.is_portfolio ? undefined : listing.beds,
    baths: listing.is_portfolio ? undefined : listing.baths,
    sqft: listing.is_portfolio ? undefined : listing.sqft,
    // A trade listing's number is the owner's estimated value (not an appraisal or list price), so it's never
    // published to search engines as an offer price; a rental's asking rent is.
    price: listing.is_rental ? listing.rent_amount : undefined,
  });

  const noindex = !!listing.unlisted_owner;
  return new Response(renderShell(title, description, body, authCta, { jsonLd, image: shareImage, url: pageUrl, noindex }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...(noindex ? { 'X-Robots-Tag': 'noindex' } : {}) },
  });
}
