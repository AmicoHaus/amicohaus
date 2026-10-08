// Server-rendered public profile page — same reasoning as functions/listing/[id].js: a unique, crawlable
// title/description/canonical per person instead of the one generic shell every /profile.html?id=N visitor
// used to get. Unlike the listing page this one needs real interactivity (Message, Edit, Favorite, admin
// verify), so unlike listing/[id].js it still loads client.js + profile-actions.js — the HTML below is real
// content for crawlers and first paint, and those scripts progressively enhance the buttons already in it.
import { getSessionUser } from '../_lib/auth.js';
import { escapeHtml, parseJsonSafe, DEMO_EMAIL_PATTERN } from '../_lib/util.js';
import { getAgentProfile, fetchAgentPortfolioPhotos } from '../_lib/agents.js';
import { fetchAgentReviews, fetchAgentRatingSummary, fetchAgentStats } from '../_lib/marketplace.js';
import { fetchAgentPackages } from '../_lib/agentPackages.js';
import { fetchCaseStudies } from '../_lib/caseStudies.js';
import { fetchActiveTeamName } from '../_lib/agentTeams.js';
import { fetchFavoriteAgentIds } from '../_lib/favoriteAgents.js';
import { fetchPortfolioMembers } from '../_lib/portfolios.js';
import { propertyArtUrl } from '../_lib/propertyArt.js';
import { ASSET_VERSIONS } from '../_lib/assetVersions.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';

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
function ratingChipHtml(rating, reviewCount) {
  return rating
    ? `<span class="chip chip-star"><span class="chip-star-mark" aria-hidden="true">★</span>${escapeHtml(String(rating))} <span class="chip-k">· ${reviewCount} review${reviewCount === 1 ? '' : 's'}</span></span>`
    : chipHtml('No reviews yet', 'outline');
}
function formatResponseHours(hours) {
  if (hours === null || hours === undefined) return null;
  return hours < 24 ? `~${Math.round(hours)}h` : `~${Math.round(hours / 24)}d`;
}
function renderExternalLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  return `<div class="mini-block"><span class="label">Links</span>${links.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || 'Link')}</a>`).join(' · ')}</div>`;
}

function notFoundPage() {
  return new Response(renderShell('Profile Not Found — Amico Haus', '', `
    <div class="empty-state">This profile doesn't exist.</div>
    <div class="form-actions"><a class="btn btn-primary" href="/#directory">Browse the Directory</a></div>
  `, null, null, null), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function renderShell(title, description, bodyHtml, authCta, jsonLd, canonicalPath) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
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
      <a class="tab" href="/#how">How it works</a>
      <a class="tab" href="/#directory">Live listings</a>
      <a class="tab" href="/calculator">Calculator</a>
      <a class="tab" href="/about">About</a>
    </nav>
    <div class="auth-cta" id="authCta">${authCta || '<a class="btn btn-ghost btn-sm" href="/login">Log In</a> <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a>'}</div>
  </header>
  <main class="prose">
    ${bodyHtml}
  </main>
  <footer class="site-footer">
    Amico Haus — where homeowners and vetted agents find each other. <a href="/about">About</a> · <a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
  </footer>
</div>
<script src="/client.js?v=${ASSET_VERSIONS['/client.js']}"></script>
<script src="/profile-actions.js?v=${ASSET_VERSIONS['/profile-actions.js']}"></script>
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
    `SELECT id, display_name, bio, phone, is_verified, created_at FROM users WHERE id = ? AND email NOT LIKE ?`
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
  return renderUserProfilePage(context, db, userRow, { isMine, isAdmin, authCta, backLinkHtml });
}

async function renderUserProfilePage(context, db, user, { isMine, isAdmin, authCta, backLinkHtml }) {
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
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
     FROM posts WHERE posts.user_id = ? ORDER BY posts.created_at DESC LIMIT 15`
  ).bind(user.id).all();

  const joined = user.created_at ? new Date(user.created_at + 'Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
  const title = `${user.display_name} — Amico Haus`;
  const description = user.bio
    ? user.bio.slice(0, 160)
    : `${user.display_name}'s profile on Amico Haus — the home-trading and agent-matching marketplace.`;

  const listingCard = l => `
    <div class="card">
      <img class="directory-thumb" src="${l.photo_id ? `/api/photos/${l.photo_id}` : propertyArtUrl(l.property_type, l.id)}" alt="" loading="lazy">
      <div class="card-head">
        <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
        <span class="badge badge-gold">${l.is_portfolio ? `Portfolio · ${(membersByPortfolio.get(l.id) || []).length}` : (l.is_rental ? 'For Rent' : escapeHtml(l.price_tier))}</span>
      </div>
      <div class="mini-two">
        <div class="mini-block"><span class="label">Has</span>${l.is_portfolio ? `${(membersByPortfolio.get(l.id) || []).length} properties` : `${escapeHtml(l.property_type)} · ${l.beds}bd/${l.baths}ba`}<br>${l.neighborhood ? escapeHtml(l.neighborhood) + ', ' : ''}${escapeHtml(l.city)}, ${escapeHtml(l.state)}<br>${money(l.estimated_value)}${l.is_portfolio ? ' combined' : ''}</div>
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
          <h1>${escapeHtml(user.display_name)} ${user.is_verified ? '<span class="badge badge-verified" title="Verified by Amico Haus">✓ Verified</span>' : ''}</h1>
          ${joined ? `<p class="tiny">Member since ${joined}</p>` : ''}
        </div>
        ${isMine ? '<button type="button" class="btn btn-ghost btn-sm" id="editBioBtn">Edit Profile</button>' : ''}
        ${!isMine ? `<button type="button" class="btn btn-primary btn-sm" id="messageUserBtn" data-id="${user.id}" data-name="${escapeHtml(user.display_name)}">Message</button>` : ''}
        ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" id="toggleVerifiedBtn" data-id="${user.id}" data-action="${user.is_verified ? 'unverify' : 'verify'}">${user.is_verified ? 'Remove Verification' : 'Mark as Verified'}</button>` : ''}
      </div>
      <div id="bioSection" data-bio="${escapeHtml(user.bio || '')}">
        <p>${user.bio ? escapeHtml(user.bio) : '<span class="tiny">No bio yet.</span>'}</p>
      </div>
      <div class="card-head">
        <span class="label">Contact</span>
        ${isMine ? '<button type="button" class="btn btn-ghost btn-sm" id="editPhoneBtn">Edit</button>' : ''}
      </div>
      <div id="phoneSection" data-phone="${escapeHtml(user.phone || '')}">
        <p>${user.phone ? escapeHtml(user.phone) : '<span class="tiny">No phone on file.</span>'}</p>
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
  return renderFinal(title, description, body, authCta, jsonLd, `/profile/${user.id}`);
}

function renderFinal(title, description, body, authCta, jsonLd, canonicalPath) {
  return new Response(renderShell(title, description, body, authCta, jsonLd, canonicalPath), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function renderAgentProfilePage(context, db, user, agentProfile, { viewer, isMine, isAdmin, authCta, backLinkHtml }) {
  const [photos, reviews, ratingSummary, stats, packages, caseStudies, teamName] = await Promise.all([
    fetchAgentPortfolioPhotos(db, user.id),
    fetchAgentReviews(db, user.id),
    fetchAgentRatingSummary(db, user.id),
    fetchAgentStats(db, user.id),
    fetchAgentPackages(db, user.id),
    fetchCaseStudies(db, user.id),
    fetchActiveTeamName(db, user.id),
  ]);
  const isFavorited = viewer ? (await fetchFavoriteAgentIds(db, viewer.id)).includes(user.id) : false;
  const topRated = ratingSummary.avgRating >= 4.5 && ratingSummary.reviewCount >= 3 && stats.winRate !== null && stats.winRate >= 0.3;

  const title = `${user.display_name}, Real Estate Agent${agentProfile.brokerageName ? ` at ${agentProfile.brokerageName}` : ''} — Amico Haus`;
  const description = [
    `${user.display_name} is a vetted real estate agent on Amico Haus`,
    agentProfile.brokerageName ? ` with ${agentProfile.brokerageName}` : '',
    agentProfile.yearsExperience ? `, ${agentProfile.yearsExperience} years experience` : '',
    ratingSummary.avgRating ? `, rated ${ratingSummary.avgRating}/5 (${ratingSummary.reviewCount} review${ratingSummary.reviewCount === 1 ? '' : 's'})` : '',
    '.',
  ].join('');

  const respLabel = formatResponseHours(stats.avgResponseHours);
  const statusChips = [
    chipHtml(agentProfile.acceptingClients ? 'Accepting new clients' : 'Not accepting new clients', agentProfile.acceptingClients ? 'good' : 'bad'),
    agentProfile.licenseVerified ? chipHtml('License Verified', 'good') : '',
    agentProfile.carriesEoInsurance ? chipHtml('E&O insured (self-reported)', 'good') : '',
    agentProfile.soloAgent ? chipHtml('Sole point of contact', 'outline') : '',
  ].filter(Boolean);
  const onPlatformChips = [respLabel ? statChipHtml('Replies in', respLabel) : '', caseStudies.length ? statChipHtml('Case studies', String(caseStudies.length)) : ''].filter(Boolean);
  const selfReportedChips = [
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
    chipBlockHtml('Fees & packages', feeChips, { hint: packages.length ? 'Hover or tap a package to see what’s included.' : '' }),
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

  const body = `
    ${backLinkHtml}
    <div class="card" id="profileCard" data-user-id="${user.id}" data-agent="1">
      ${personHeadHtml({
        avatar: avatarHtml(user.display_name, { seed: user.id, size: 'lg' }),
        nameHtml: `${escapeHtml(user.display_name)}${user.is_verified ? ' <span class="badge badge-verified" title="Verified by Amico Haus">✓ Verified</span>' : ''}${topRated ? ' <span class="badge badge-gold">🏆 Top Rated</span>' : ''}`,
        sub: [agentProfile.brokerageName, teamName ? `${teamName} Team` : ''].filter(Boolean).join(' · '),
        chips: [ratingChipHtml(ratingSummary.avgRating, ratingSummary.reviewCount), agentProfile.yearsExperience ? chipHtml(`${agentProfile.yearsExperience} yrs experience`, 'outline') : ''].filter(Boolean),
      })}
      <div class="card-actions">
        ${!isMine ? `<button type="button" class="btn btn-primary btn-sm" id="messageUserBtn" data-id="${user.id}" data-name="${escapeHtml(user.display_name)}">Message</button>` : ''}
        ${viewer && !isMine ? `<button type="button" class="btn btn-ghost btn-sm" id="favoriteAgentBtn" data-id="${user.id}">${isFavorited ? '★ Favorited' : '☆ Favorite'}</button>` : ''}
        ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" id="toggleVerifiedBtn" data-id="${user.id}" data-action="${user.is_verified ? 'unverify' : 'verify'}">${user.is_verified ? 'Remove Verification' : 'Mark as Verified'}</button>` : ''}
      </div>
      ${agentProfile.bio ? `<p>${escapeHtml(agentProfile.bio)}</p>` : ''}
      ${agentProfile.certifications ? `<p class="tiny"><span class="label">Certifications (self-reported)</span> ${escapeHtml(agentProfile.certifications)}</p>` : ''}
      <p class="tiny">Amico Haus vets agents by reviewing what they self-report (license number, brokerage) — it does not independently confirm license numbers with any state licensing board. Always verify a license yourself before engaging anyone.</p>
      <div class="agent-details">${agentDetailsBody}</div>
    </div>

    ${videoHtml ? `<h2>Intro Video</h2>${videoHtml}` : ''}
    ${photoGallery ? `<h2>Portfolio</h2>${photoGallery}` : ''}
    ${caseStudiesHtml ? `<h2>Case Studies</h2><div class="grid">${caseStudiesHtml}</div>` : ''}
    <h2>Reviews</h2>
    <div class="stack">${reviewsHtml}</div>
  `;

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Person', name: user.display_name,
    url: `https://amicohaus.com/profile/${user.id}`, jobTitle: 'Real Estate Agent',
    ...(agentProfile.brokerageName ? { worksFor: { '@type': 'Organization', name: agentProfile.brokerageName } } : {}),
    ...(agentProfile.bio ? { description: agentProfile.bio.slice(0, 500) } : {}),
    ...(ratingSummary.avgRating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: ratingSummary.avgRating, reviewCount: ratingSummary.reviewCount } } : {}),
  };
  return renderFinal(title, description, body, authCta, jsonLd, `/profile/${user.id}`);
}
