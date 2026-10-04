/* Amico Haus — real agents, drawn the same way everywhere (the signed-in
   app's directory and the public home page). Needs client.js loaded first.

   The label maps live here because the card needs them and main.js needs
   them too; main.js loads this file before itself. */

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

function formatResponseHours(hours) {
  if (hours === null || hours === undefined) return null;
  return hours < 24 ? `~${Math.round(hours)}h` : `~${Math.round(hours / 24)}d`;
}

// Prices are left out of the browse view on purpose — a package shows as a
// pill and its included services appear on hover (see packageChipHtml).
function packagesForPills(packages) {
  return (packages || []).map(p => ({
    label: PACKAGE_TIER_LABELS[p.tier] || p.tier,
    turnaroundDays: p.turnaroundDays,
    description: p.description,
    services: (p.services || []).map(sv => `${SERVICE_TYPE_LABELS[sv.type] || sv.type}${sv.note ? ` — ${sv.note}` : ''}`),
  }));
}

function directoryAgentInfo(a) {
  const respLabel = formatResponseHours(a.avgResponseHours);
  const range = a.commissionRange;
  return {
    status: [
      { text: a.acceptingClients ? 'Accepting new clients' : 'Not accepting new clients', tone: a.acceptingClients ? 'good' : 'bad' },
      a.isLocalSpecialist && { text: 'Local specialist', tone: 'gold' },
      a.licenseVerified && { text: 'License Verified', tone: 'good' },
      a.carriesEoInsurance && { text: 'E&O insured (self-reported)', tone: 'good' },
    ].filter(Boolean),
    stats: [
      respLabel && { k: 'Replies in', v: respLabel },
      a.caseStudies && a.caseStudies.length > 0 && { k: 'Case studies', v: String(a.caseStudies.length) },
    ].filter(Boolean),
    selfReported: [
      a.homesSoldLastYear && { k: 'Sold, last 12 mo', v: String(a.homesSoldLastYear) },
      a.avgDaysOnMarket && { k: 'On market', v: `~${a.avgDaysOnMarket} days` },
      a.saleToListRatio && { k: 'Sale-to-list', v: `${Math.round(a.saleToListRatio * 100)}%` },
    ].filter(Boolean),
    specialties: (a.specialtyTags || []).map(t => SPECIALTY_TAG_LABELS[t] || t),
    languages: a.languages && a.languages.length > 1 ? a.languages : [],
    area: [
      a.distanceMiles !== null && a.distanceMiles !== undefined ? `${a.distanceMiles} mi away` : null,
      a.serviceAreaSpreadMiles !== null && a.serviceAreaSpreadMiles !== undefined && !a.isLocalSpecialist ? `Spans about ${Math.round(a.serviceAreaSpreadMiles)} mi` : null,
    ].filter(Boolean),
    commission: range ? (range.min === range.max ? `${range.min}%` : `${range.min}–${range.max}%`) : null,
    packages: packagesForPills(a.packages),
  };
}

// One agent as a card. Pass { favorite: true } inside the signed-in app to add
// the ☆ Favorite button; the public home page leaves it off.
function directoryAgentCardHtml(a, { favorite = false, message = false } = {}) {
  return `
    <div class="card">
      ${personHeadHtml({
        avatar: avatarHtml(a.displayName, { seed: a.userId, size: 'lg' }),
        nameHtml: `<a class="profile-link" href="/profile.html?id=${a.userId}">${escapeHtml(a.displayName)}</a>${a.isVerified ? ' <span class="badge badge-verified">✓</span>' : ''}${a.topRated ? ' <span class="badge badge-gold">🏆 Top Rated</span>' : ''}`,
        sub: [a.brokerageName, a.teamName ? `${a.teamName} Team` : ''].filter(Boolean).join(' · '),
        chips: [ratingChipHtml(a.rating, a.reviewCount), a.yearsExperience ? chipHtml(`${a.yearsExperience} yrs experience`, 'outline') : ''].filter(Boolean),
      })}
      ${agentDetailsHtml(directoryAgentInfo(a))}
      ${favorite || message ? `<div class="card-actions">
        ${message ? `<button class="btn btn-ghost btn-sm" data-action="message-user" data-id="${a.userId}" data-name="${escapeHtml(a.displayName)}">Message</button>` : ''}
        ${favorite ? `<button class="btn btn-ghost btn-sm" data-action="toggle-favorite-agent" data-agent-id="${a.userId}">☆ Favorite</button>` : ''}
      </div>` : ''}
    </div>`;
}
