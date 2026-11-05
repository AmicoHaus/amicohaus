// Server-rendered public profile page — same reasoning as functions/listing/[id].js: a unique, crawlable
// title/description/canonical per person instead of the one generic shell every /profile.html?id=N visitor
// used to get. Unlike the listing page this one needs real interactivity (Message, Edit, Favorite, admin
// verify), so unlike listing/[id].js it still loads client.js + profile-actions.js — the HTML below is real
// content for crawlers and first paint, and those scripts progressively enhance the buttons already in it.
import { getSessionUser, phoneVisibleTo } from '../_lib/auth.js';
import { fetchPastClientReviews, fetchPastClientSummary, PAST_CLIENT_SIDES } from '../_lib/pastClientReviews.js';
import { escapeHtml, parseJsonSafe, DEMO_EMAIL_PATTERN, unlistedOwnerSql } from '../_lib/util.js';
import { getAgentProfile, fetchAgentPortfolioPhotos, dreLookupUrl } from '../_lib/agents.js';
import { fetchAgentReviews, fetchAgentRatingSummary, fetchAgentStats } from '../_lib/marketplace.js';
import { fetchAgentPackages } from '../_lib/agentPackages.js';
import { fetchCaseStudies } from '../_lib/caseStudies.js';
import { fetchActiveTeamName, teamDisplayName } from '../_lib/agentTeams.js';
import { fetchFavoriteAgentIds } from '../_lib/favoriteAgents.js';
import { fetchPortfolioMembers } from '../_lib/portfolios.js';
import { propertyArtUrl } from '../_lib/propertyArt.js';
import { ASSET_VERSIONS } from '../_lib/assetVersions.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { fetchFoundingZips, foundingCaption } from '../_lib/zipBoard.js';

// Shown with someone's phone number on their own profile (it's private unless they turn it on).
const PHONE_PRIVATE_NOTE = "Private unless you turn on 'Show my phone number' in You're in Control.";
const PHONE_PUBLIC_NOTE = "Shown on your public profile and listings. You can turn this off in You're in Control.";
// The settings live in the app (main.js opens them for /app#control).
const CONTROL_LINK = '<a href="/app#control">Change this setting</a>';

// Shown beside every review section (Rudy 11.04, Fair Play): the person who runs the site also competes as an agent.
const OPERATOR_LINE = 'Amico Haus is run by Rudy Flores, a Coldwell Banker West agent who may compete for the same homes.';
// Shown beside agent fee chips.
const FEE_LINE = 'Each agent sets their own fees; commissions are negotiable and not set by law or by Amico Haus.';

// Signed-out visitors can't message anyone, so they get the way in instead of a button that can only fail.
// Report (fair housing or a rules problem) on a person, never on your own profile: signed-in visitors get the inline
// report form (profile-actions.js); signed-out visitors are sent to the contact form.
function reportUserHtml(viewer, isMine, userId) {
  if (isMine) return '';
  if (!viewer) return '<a class="link-btn" href="/contact">Report a concern</a>';
  return `<span data-report-host><button type="button" class="link-btn" data-action="report-user" data-id="${Number(userId)}">Report</button></span>`;
}

const SIGN_UP_TO_MESSAGE = '<a class="btn btn-primary btn-sm" href="/signup">Sign up to message</a> <a class="btn btn-ghost btn-sm" href="/login">Log in</a>';

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

/* ---- small presentation helpers, ported from client.js / agent-cards.js (no DOM access there either, just
   string builders) so this server-rendered page looks identical to the directory cards it mirrors. ---- */
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return h;
}
function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const first = (parts[0] || '?')[0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
function avatarHtml(name, { seed = name, size = '' } = {}) {
  const sizeClass = size ? ` avatar-${size}` : '';
  return `<span class="avatar avatar-tone-${hashSeed(seed) % 6}${sizeClass}" aria-hidden="true">${escapeHtml(initialsOf(name))}</span>`;
}
function chipHtml(text, tone = '') {
  return `<span class="chip${tone ? ` chip-${tone}` : ''}">${escapeHtml(text)}</span>`;
}
function statChipHtml(label, value) {
  return `<span class="chip chip-stat"><span class="chip-k">${escapeHtml(label)}</span><span class="chip-v">${escapeHtml(value)}</span></span>`;
}
function chipBlockHtml(label, chips, { hint = '' } = {}) {
  if (!chips.length) return '';
  return `<div class="chip-block"><span class="chip-label">${escapeHtml(label)}</span><div class="chip-row">${chips.join('')}</div>${hint ? `<span class="chip-hint">${escapeHtml(hint)}</span>` : ''}</div>`;
}
const SERVICE_TYPE_LABELS = {
  photography: 'Photography', drone: 'Drone photos/video', staging: 'Staging', cleaning: 'Cleaning',
  landscaping: 'Landscaping', virtual_tour: '3D virtual tour',
  social_media_ads: 'Social media ad campaign', email_campaign: 'Email blast to buyer list',
  print_marketing: 'Print marketing (postcards, etc.)', mls_syndication: 'MLS + Zillow/Redfin syndication',
  other: 'Other',
};
const SPECIALTY_TAG_LABELS = {
  luxury: 'Luxury', first_time_buyer: 'First-time buyers', relocation: 'Relocation', military_va: 'Military / VA',
  investment: 'Investment properties', new_construction: 'New construction', senior_downsizing: 'Senior downsizing',
  condo_hoa: 'Condo / HOA', waterfront: 'Waterfront', other: 'Other',
};
const PACKAGE_TIER_LABELS = { basic: 'Basic', standard: 'Standard', premium: 'Premium' };
function packageChipHtml(pkg) {
  const features = (pkg.services || []).map(sv => `<span class="pkg-feat">${escapeHtml(`${SERVICE_TYPE_LABELS[sv.type] || sv.type}${sv.note ? ` — ${sv.note}` : ''}`)}</span>`).join('');
  const days = pkg.turnaroundDays ? `<span class="pkg-days">Ready in about ${pkg.turnaroundDays} day${pkg.turnaroundDays === 1 ? '' : 's'}</span>` : '';
  const desc = pkg.description ? `<span class="pkg-desc">${escapeHtml(String(pkg.description).slice(0, 140))}</span>` : '';
  const label = PACKAGE_TIER_LABELS[pkg.tier] || pkg.tier;
  return `<button type="button" class="pkg-chip"><span class="chip chip-gold">${escapeHtml(label)}</span><span class="pkg-pop" role="tooltip"><strong>${escapeHtml(label)} package</strong>${days}${desc}${features}</span></button>`;
}
function personHeadHtml({ avatar, nameHtml, sub = '', chips = [] }) {
  return `<div class="person-head">${avatar}<div class="person-main"><h1>${nameHtml}</h1>${sub ? `<p class="tiny">${escapeHtml(sub)}</p>` : ''}${chips.length ? `<div class="chip-row chip-row-tight">${chips.join('')}</div>` : ''}</div></div>`;
}
// A plain fact, never a badge: "★ 4.8 from 3 homeowners who hired them here".
function ratingChipHtml(rating, reviewCount) {
  return rating
    ? `<span class="chip chip-star"><span class="chip-star-mark" aria-hidden="true">★</span>${escapeHtml(String(rating))} <span class="chip-k">from ${reviewCount} homeowner${reviewCount === 1 ? '' : 's'} who hired them here</span></span>`
    : chipHtml('No reviews yet', 'outline');
}
// "Name Team", unless the name already ends in Team, Group or Associates (the shared rule in agentTeams.js).
const teamLabel = teamDisplayName;
// "Oct 30, 2026" for a SQLite UTC timestamp, in Pacific time.
function shortDate(sqlTime) {
  const d = new Date(String(sqlTime).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
}
// The license line on an agent's profile (Rudy 11.04): what's on file, when an admin last looked it up, and a link to
// the DRE's own lookup. Never "verified": the site doesn't vouch for anyone's status today.
function licenseLineHtml(licenseNumber, checkedAt) {
  if (!licenseNumber) return '';
  const checked = checkedAt ? shortDate(checkedAt) : '';
  return `<p class="tiny license-line">DRE license #${escapeHtml(licenseNumber)} on file${checked ? ` · checked ${escapeHtml(checked)}` : ''} · <a href="${escapeHtml(dreLookupUrl(licenseNumber))}" target="_blank" rel="noopener noreferrer">Check current status</a></p>`;
}
// Same as agent-cards.js: days round up so the label matches the directory's "within N days" filter.
function formatResponseHours(hours) {
  if (hours === null || hours === undefined) return null;
  return hours < 24 ? `~${Math.round(hours)}h` : `~${Math.ceil(hours / 24)}d`;
}
function renderExternalLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  return `<div class="mini-block"><span class="label">Links</span>${links.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || 'Link')}</a>`).join(' · ')}</div>`;
}

function notFoundPage() {
  return new Response(renderShell('Profile Not Found — Amico Haus', '', `
    <div class="empty-state">This profile doesn't exist.</div>
    <div class="form-actions"><a class="btn btn-primary" href="/#directory">Browse the Directory</a></div>
  `, null, null, null, { noindex: true }), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// noindex: homeowner and buyer profiles stay out of search engines (only agents' professional pages are listed).
function renderShell(title, description, bodyHtml, authCta, jsonLd, canonicalPath, { noindex = false } = {}) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${noindex ? '<meta name="robots" content="noindex">' : ''}
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
${canonicalPath ? `<link rel="canonical" href="${escapeHtml('https://amicohaus.com' + canonicalPath)}">` : ''}
<meta property="og:type" content="profile">
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSIONS['/styles.css']}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
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
    <div class="auth-cta" id="authCta">${authCta || '<a class="btn btn-ghost btn-sm" href="/login">Log In</a> <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a>'}</div>
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
<script src="/profile-actions.js?v=${ASSET_VERSIONS['/profile-actions.js']}"></script>
<!-- Cloudflare Web Analytics -->
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "91a193988b2d45e58aa1c27d5abf6bdb"}'></script>
<!-- End Cloudflare Web Analytics -->
</body>
</html>`;
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderProfilePage(context));
}

async function renderProfilePage(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFoundPage();

  const db = context.env.DB;
  const userRow = await db.prepare(
    `SELECT id, display_name, bio, phone, phone_public, is_verified, role, created_at, ${unlistedOwnerSql('email')} AS is_test_account
     FROM users WHERE id = ? AND email NOT LIKE ? AND status = 'active'`
  ).bind(id, DEMO_EMAIL_PATTERN).first();
  if (!userRow) return notFoundPage();

  const viewer = await getSessionUser(context);
  const isMine = !!viewer && viewer.id === id;
  const isAdmin = !!viewer && viewer.role === 'admin' && !isMine;
  const authCta = viewer
    ? `<span class="tiny">Hi, ${escapeHtml(viewer.display_name)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`
    : null;

  // ?back=pre-listing-5 or transaction-3, set by the proposal card this profile was opened from — a direct way
  // back to that exact proposal. Rendered server-side now, so it works with JS disabled too.
  const backParam = new URL(context.request.url).searchParams.get('back') || '';
  const backMatch = /^(pre-listing|transaction)-\d+$/.exec(backParam);
  const backLinkHtml = backMatch
    ? `<p class="tiny"><a href="/app#${escapeHtml(backMatch[0])}">← Back to ${backMatch[1] === 'pre-listing' ? 'this pre-listing' : 'this trade'}</a></p>`
    : '';

  const agentProfile = await getAgentProfile(db, id);
  if (agentProfile && agentProfile.status === 'approved') {
    return renderAgentProfilePage(context, db, userRow, agentProfile, { viewer, isMine, isAdmin, authCta, backLinkHtml });
  }
  return renderUserProfilePage(context, db, userRow, { viewer, isMine, isAdmin, authCta, backLinkHtml });
}

async function renderUserProfilePage(context, db, user, { viewer, isMine, isAdmin, authCta, backLinkHtml }) {
  const listings = await db.prepare(
    `SELECT listings.id, listings.title, listings.neighborhood, listings.city, listings.state,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value, listings.price_tier,
            listings.external_links, listings.is_rental, listings.rent_amount, listings.min_lease_months, listings.is_portfolio,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.price_min, desired_criteria.price_max,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM listings
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.user_id = ? AND listings.status = 'active' AND listings.is_buyer_only = 0
       AND listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)
     ORDER BY listings.created_at DESC LIMIT 20`
  ).bind(user.id).all();
  const portfolioIds = listings.results.filter(l => l.is_portfolio).map(l => l.id);
  const membersByPortfolio = await fetchPortfolioMembers(db, portfolioIds);

  const posts = await db.prepare(
    `SELECT posts.id, posts.body, posts.created_at,
            (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id AND comments.hidden_at IS NULL) AS comment_count
     FROM posts WHERE posts.user_id = ? AND posts.hidden_at IS NULL ORDER BY posts.created_at DESC LIMIT 15`
  ).bind(user.id).all();

  const joined = user.created_at ? new Date(user.created_at + 'Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
  const title = `${user.display_name} — Amico Haus`;
  const description = user.bio
    ? user.bio.slice(0, 160)
    : `${user.display_name}'s profile on Amico Haus — the home-trading and agent-matching marketplace.`;

  // The phone is private unless they turned it on (or shared their contact with this agent); otherwise people reach
  // them through Amico Haus messages.
  const phone = await phoneVisibleTo(db, viewer, user);
  const contactHtml = isMine
    ? `<p>${user.phone ? escapeHtml(user.phone) : '<span class="tiny">No phone on file.</span>'}</p>${user.phone ? `<p class="tiny">${escapeHtml(user.phone_public ? PHONE_PUBLIC_NOTE : PHONE_PRIVATE_NOTE)} ${CONTROL_LINK}</p>` : ''}`
    : phone
      ? `<p><a href="tel:${escapeHtml(phone.replace(/[^0-9+]/g, ''))}">${escapeHtml(phone)}</a></p>`
      : `<p class="tiny">${viewer ? 'Message' : 'Sign up to message'} ${escapeHtml(user.display_name)} directly through Amico Haus.</p>`;

  const listingCard = l => `
    <div class="card">
      <img class="directory-thumb" src="${l.photo_id ? `/api/photos/${l.photo_id}` : propertyArtUrl(l.property_type, l.id)}" alt="${l.photo_id ? escapeHtml(`Photo of ${l.title || l.property_type} in ${l.city}`) : 'Illustrative photo, not this home'}" loading="lazy">
      ${l.photo_id ? '' : '<span class="photo-caption">Illustrative photo</span>'}
      <div class="card-head">
        <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
        <span class="badge badge-gold">${l.is_portfolio ? `Portfolio · ${(membersByPortfolio.get(l.id) || []).length}` : (l.is_rental ? 'For Rent' : escapeHtml(l.price_tier))}</span>
      </div>
      <div class="mini-two">
        <div class="mini-block"><span class="label">Has</span>${l.is_portfolio ? `${(membersByPortfolio.get(l.id) || []).length} properties` : `${escapeHtml(l.property_type)} · ${l.beds}bd/${l.baths}ba`}<br>${l.neighborhood ? escapeHtml(l.neighborhood) + ', ' : ''}${escapeHtml(l.city)}, ${escapeHtml(l.state)}<br>${money(l.estimated_value)}${l.is_portfolio ? ' combined' : ''} <span class="tiny">(owner's estimated value)</span></div>
        ${l.is_portfolio
          ? `<div class="mini-block"><span class="label">Includes</span>${(membersByPortfolio.get(l.id) || []).map(m => `${escapeHtml(m.propertyType)} in ${escapeHtml(m.city)}, ${escapeHtml(m.state)}`).join('<br>')}</div>`
          : (l.is_rental
            ? `<div class="mini-block"><span class="label">Rent</span>${money(l.rent_amount)}/mo<br>${l.min_lease_months}-month min lease</div>`
            : (l.desired_type ? `<div class="mini-block"><span class="label">Wants</span>${escapeHtml(l.desired_type)} in ${escapeHtml(l.locations || 'Anywhere')}<br>${money(l.price_min)}–${money(l.price_max)}</div>` : ''))}
      </div>
      ${renderExternalLinks(parseJsonSafe(l.external_links, []))}
    </div>
  `;

  const postItem = p => `
    <div class="side">
      <p class="tiny">${escapeHtml(p.body)}</p>
      <span class="tiny">${new Date(p.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · 👍 ${p.like_count} · 💬 ${p.comment_count}</span>
    </div>
  `;

  const body = `
    ${backLinkHtml}
    <div class="card" id="profileCard" data-user-id="${user.id}">
      <div class="card-head">
        <div>
          <h1>${escapeHtml(user.display_name)}</h1>
          ${joined ? `<p class="tiny">Member since ${joined}</p>` : ''}
        </div>
        ${isMine ? '<button type="button" class="btn btn-ghost btn-sm" id="editBioBtn">Edit Profile</button>' : ''}
        ${isMine ? '' : viewer ? `<button type="button" class="btn btn-primary btn-sm" id="messageUserBtn" data-id="${user.id}" data-name="${escapeHtml(user.display_name)}">Message</button>` : SIGN_UP_TO_MESSAGE}
        ${reportUserHtml(viewer, isMine, user.id)}
        ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" id="toggleVerifiedBtn" data-id="${user.id}" data-action="${user.is_verified ? 'unverify' : 'verify'}">${user.is_verified ? 'Clear admin "verified" note' : 'Admin note: verified (never shown publicly)'}</button>` : ''}
      </div>
      <div id="bioSection" data-bio="${escapeHtml(user.bio || '')}">
        <p>${user.bio ? escapeHtml(user.bio) : '<span class="tiny">No bio yet.</span>'}</p>
      </div>
      <div class="card-head">
        <span class="label">Contact</span>
        ${isMine ? '<button type="button" class="btn btn-ghost btn-sm" id="editPhoneBtn">Edit</button>' : ''}
      </div>
      <div id="phoneSection"${isMine ? ` data-phone="${escapeHtml(user.phone || '')}"` : ''}>
        ${contactHtml}
      </div>
    </div>

    <h2>Listings</h2>
    <div class="grid">${listings.results.length ? listings.results.map(listingCard).join('') : '<div class="empty-state">No active listings.</div>'}</div>

    <h2>Recent Activity</h2>
    <div class="stack">${posts.results.length ? posts.results.map(postItem).join('') : '<div class="empty-state">No posts yet.</div>'}</div>
  `;

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Person', name: user.display_name,
    url: `https://amicohaus.com/profile/${user.id}`,
    ...(user.bio ? { description: user.bio.slice(0, 500) } : {}),
  };
  return renderFinal(title, description, body, authCta, jsonLd, `/profile/${user.id}`, { noindex: true });
}

function renderFinal(title, description, body, authCta, jsonLd, canonicalPath, options) {
  const noindex = !!(options && options.noindex);
  return new Response(renderShell(title, description, body, authCta, jsonLd, canonicalPath, options), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...(noindex ? { 'X-Robots-Tag': 'noindex' } : {}) },
  });
}

async function renderAgentProfilePage(context, db, user, agentProfile, { viewer, isMine, isAdmin, authCta, backLinkHtml }) {
  const foundingZips = (await fetchFoundingZips(db, [user.id])).get(user.id) || [];
  const [photos, reviews, ratingSummary, stats, packages, caseStudies, teamName, pastReviews, pastSummary] = await Promise.all([
    fetchAgentPortfolioPhotos(db, user.id),
    fetchAgentReviews(db, user.id),
    fetchAgentRatingSummary(db, user.id),
    fetchAgentStats(db, user.id),
    fetchAgentPackages(db, user.id),
    fetchCaseStudies(db, user.id),
    fetchActiveTeamName(db, user.id),
    fetchPastClientReviews(db, user.id),
    fetchPastClientSummary(db, user.id),
  ]);
  const isFavorited = viewer ? (await fetchFavoriteAgentIds(db, viewer.id)).includes(user.id) : false;
  // An agent's phone shows here only once they turn on "Show my phone number", the same rule as everyone's.
  const phone = isMine ? (user.phone_public ? String(user.phone || '').trim() : '') : await phoneVisibleTo(db, viewer, user);

  const title = `${user.display_name}, Real Estate Agent${agentProfile.brokerageName ? ` at ${agentProfile.brokerageName}` : ''} — Amico Haus`;
  const description = [
    `${user.display_name} is an approved real estate agent on Amico Haus`,
    agentProfile.brokerageName ? ` with ${agentProfile.brokerageName}` : '',
    agentProfile.licenseNumber ? ` (DRE #${agentProfile.licenseNumber})` : '',
    ratingSummary.avgRating ? `, rated ${ratingSummary.avgRating}/5 by ${ratingSummary.reviewCount} homeowner${ratingSummary.reviewCount === 1 ? '' : 's'} who hired them here` : '',
    '.',
  ].join('');

  const respLabel = formatResponseHours(stats.avgResponseHours);
  const statusChips = [
    chipHtml(agentProfile.acceptingClients ? 'Accepting new clients' : 'Not accepting new clients', agentProfile.acceptingClients ? 'good' : 'bad'),
    // The admin account that runs Amico Haus, when it competes as an agent: always labeled (Fair Play rules).
    user.role === 'admin' ? chipHtml('Platform operator: runs Amico Haus', 'outline') : '',
    // Founding = among the first 3 approved agents in a launch ZIP; recognition only (the tooltip says so).
    foundingZips.length ? `<span class="chip chip-good" title="${escapeHtml(foundingCaption(foundingZips))}">${escapeHtml(`Founding agent · ${foundingZips.join(', ')}`)}</span>` : '',
    agentProfile.carriesEoInsurance ? chipHtml('E&O insured (self-reported)', 'good') : '',
    agentProfile.soloAgent ? chipHtml('Sole point of contact', 'outline') : '',
  ].filter(Boolean);
  const onPlatformChips = [
    stats.acceptedBids > 0 ? statChipHtml('Proposal accepted', `${stats.acceptedBids} time${stats.acceptedBids === 1 ? '' : 's'} here`) : '',
    stats.finalistCount > 0 ? statChipHtml('Finalist', `${stats.finalistCount} home${stats.finalistCount === 1 ? '' : 's'}`) : '',
    respLabel ? statChipHtml('Proposal speed', respLabel) : '',
    caseStudies.length ? statChipHtml('Case studies', String(caseStudies.length)) : '',
  ].filter(Boolean);
  const selfReportedChips = [
    // Invited by the agent and not checked against sale records, so they sit with what agents tell us, not with what we measure.
    pastSummary.count > 0 ? statChipHtml('Past clients (outside Amico, not verified)', `★ ${pastSummary.avgRating} (${pastSummary.count})`) : '',
    agentProfile.homesSoldLastYear ? statChipHtml('Sold, last 12 mo', String(agentProfile.homesSoldLastYear)) : '',
    agentProfile.avgDaysOnMarket ? statChipHtml('On market', `~${agentProfile.avgDaysOnMarket} days`) : '',
    agentProfile.saleToListRatio ? statChipHtml('Sale-to-list', `${Math.round(agentProfile.saleToListRatio * 100)}%`) : '',
  ].filter(Boolean);
  const specialtyChips = (agentProfile.specialtyTags || []).map(t => chipHtml(SPECIALTY_TAG_LABELS[t] || t, 'gold'));
  const languageChips = agentProfile.languages && agentProfile.languages.length > 1 ? agentProfile.languages.map(l => chipHtml(l, 'outline')) : [];
  const feeChips = [];
  if (agentProfile.defaultCommissionPct) feeChips.push(statChipHtml('Commission', `${agentProfile.defaultCommissionPct}%`));
  packages.forEach(p => feeChips.push(packageChipHtml(p)));

  const agentDetailsBody = [
    statusChips.length ? `<div class="chip-row">${statusChips.join('')}</div>` : '',
    chipBlockHtml('On Amico Haus', onPlatformChips),
    chipBlockHtml('Self-reported', selfReportedChips),
    chipBlockHtml('Specialties', specialtyChips),
    chipBlockHtml('Speaks', languageChips),
    chipBlockHtml('Fees & packages', feeChips, { hint: `${packages.length ? 'Hover or tap a package to see what’s included. ' : ''}${FEE_LINE}` }),
  ].filter(Boolean).join('');

  const photoGallery = photos.length
    ? `<div class="photo-gallery">${photos.map(p => `<img src="/api/agent-photos/${p.id}" alt="${escapeHtml(p.caption || '')}" loading="lazy" class="media-thumb">`).join('')}</div>`
    : '';
  const videoHtml = agentProfile.hasVideo
    ? `<video controls preload="none" class="media-video" src="/api/agent-video/${user.id}"></video>`
    : '';
  const caseStudiesHtml = caseStudies.length
    ? caseStudies.map(c => `
        <div class="card">
          <div class="mini-two">
            <img src="/api/case-study-photos/${c.id}/before" alt="Before" class="media-fit">
            <img src="/api/case-study-photos/${c.id}/after" alt="After" class="media-fit">
          </div>
          <p class="tiny"><strong>${escapeHtml(c.title || 'Case study')}</strong>${c.resultNote ? ` — ${escapeHtml(c.resultNote)}` : ''}</p>
        </div>
      `).join('')
    : '';
  const reviewsHtml = reviews.length
    ? reviews.map(r => `
        <div class="side">
          <strong>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</strong>
          <span class="tiny">${escapeHtml(r.reviewerName)} · ${new Date(r.createdAt + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          ${r.comment ? `<p class="tiny">${escapeHtml(r.comment)}</p>` : ''}
        </div>
      `).join('')
    : '<div class="empty-state">No reviews yet.</div>';
  // Bring Your Reviews: always labeled and kept apart from reviews of agents hired here.
  // Signed-in visitors can report one (e.g. as fake): only such a report shows the reviewer's details to an admin.
  const pastReviewsHtml = pastReviews.map(r => `
        <div class="side" data-report-host>
          <strong>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</strong>
          <span class="tiny">${escapeHtml(r.reviewerName)} · ${escapeHtml(PAST_CLIENT_SIDES[r.clientSide] || '')} in ${r.saleYear}, ${escapeHtml(r.saleCity)}</span>
          ${r.comment ? `<p class="tiny">${escapeHtml(r.comment)}</p>` : ''}
          ${viewer && !isMine && viewer.id !== r.reviewerUserId ? `<button type="button" class="link-btn" data-action="report-past-review" data-id="${Number(r.id)}">Report</button>` : ''}
        </div>
      `).join('');

  const body = `
    ${backLinkHtml}
    <div class="card" id="profileCard" data-user-id="${user.id}" data-agent="1">
      ${personHeadHtml({
        avatar: avatarHtml(user.display_name, { seed: user.id, size: 'lg' }),
        // No "Verified" and no "Top Rated" badge (Rudy 11.04): the site doesn't vouch for or rank agents.
        nameHtml: escapeHtml(user.display_name),
        // The brokerage (and team) here and the DRE license line right below, as California requires wherever an
        // agent meets a homeowner.
        sub: [agentProfile.brokerageName, teamLabel(teamName)].filter(Boolean).join(' · '),
        chips: [ratingChipHtml(ratingSummary.avgRating, ratingSummary.reviewCount), agentProfile.yearsExperience ? chipHtml(`${agentProfile.yearsExperience} yrs experience (self-reported)`, 'outline') : ''].filter(Boolean),
      })}
      ${licenseLineHtml(agentProfile.licenseNumber, agentProfile.licenseCheckedAt)}
      <div class="card-actions">
        ${isMine ? '' : viewer ? `<button type="button" class="btn btn-primary btn-sm" id="messageUserBtn" data-id="${user.id}" data-name="${escapeHtml(user.display_name)}">Message</button>` : SIGN_UP_TO_MESSAGE}
        ${viewer && !isMine ? `<button type="button" class="btn btn-ghost btn-sm" id="favoriteAgentBtn" data-id="${user.id}">${isFavorited ? '★ Favorited' : '☆ Favorite'}</button>` : ''}
        ${reportUserHtml(viewer, isMine, user.id)}
        ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" id="toggleVerifiedBtn" data-id="${user.id}" data-action="${user.is_verified ? 'unverify' : 'verify'}">${user.is_verified ? 'Clear admin "verified" note' : 'Admin note: verified (never shown publicly)'}</button>` : ''}
      </div>
      ${phone ? `<p class="tiny"><span class="label">Phone</span> <a href="tel:${escapeHtml(phone.replace(/[^0-9+]/g, ''))}">${escapeHtml(phone)}</a></p>` : ''}
      ${agentProfile.bio ? `<p>${escapeHtml(agentProfile.bio)}</p>` : ''}
      ${agentProfile.certifications ? `<p class="tiny"><span class="label">Certifications (self-reported)</span> ${escapeHtml(agentProfile.certifications)}</p>` : ''}
      <p class="tiny">Before approving an agent, Amico Haus looks up their license on the California DRE's public license lookup. Check an agent's current license status anytime on the DRE's public lookup before engaging anyone.</p>
      <div class="agent-details">${agentDetailsBody}</div>
    </div>

    ${videoHtml ? `<h2>Intro Video</h2>${videoHtml}` : ''}
    ${photoGallery ? `<h2>Portfolio</h2>${photoGallery}` : ''}
    ${caseStudiesHtml ? `<h2>Case Studies</h2><div class="grid">${caseStudiesHtml}</div>` : ''}
    <h2>Reviews from homeowners who hired them on Amico Haus</h2>
    <p class="tiny">${OPERATOR_LINE}</p>
    <div class="stack">${reviewsHtml}</div>
    ${pastReviews.length ? `<h2>Past clients, outside Amico Haus</h2>
    <p class="tiny">${pastSummary.count} review${pastSummary.count === 1 ? '' : 's'} averaging ${pastSummary.avgRating} stars from people this agent helped outside Amico Haus${agentProfile.reviewInviteFromYear ? `. The agent agreed to send their review link to every client they helped from ${agentProfile.reviewInviteFromYear}${agentProfile.reviewInviteToYear !== agentProfile.reviewInviteFromYear ? ` to ${agentProfile.reviewInviteToYear}` : ''}` : ''}. Agents can't hide or remove these reviews; Amico Haus removes one only if it's fake, abusive or not about the agent's work, the same rule for every rating. Amico Haus doesn't check these against sale records. ${OPERATOR_LINE}</p>
    <div class="stack">${pastReviewsHtml}</div>` : ''}
  `;

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Person', name: user.display_name,
    url: `https://amicohaus.com/profile/${user.id}`, jobTitle: 'Real Estate Agent',
    ...(agentProfile.brokerageName ? { worksFor: { '@type': 'Organization', name: agentProfile.brokerageName } } : {}),
    ...(agentProfile.bio ? { description: agentProfile.bio.slice(0, 500) } : {}),
    ...(ratingSummary.avgRating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: ratingSummary.avgRating, reviewCount: ratingSummary.reviewCount } } : {}),
  };
  // The authz test agents (@resend.dev) and the Google Play reviewer's sample stay out of search (Rudy 11.05).
  return renderFinal(title, description, body, authCta, jsonLd, `/profile/${user.id}`, { noindex: !!user.is_test_account });
}
