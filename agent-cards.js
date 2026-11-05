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

// How a team name reads: "<name> Team", unless it already ends in Team, Group or Associates (same rule as
// functions/_lib/agentTeams.js teamDisplayName).
function teamDisplayName(name) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  return /(^|\s)(team|group|associates)$/i.test(clean) ? clean : `${clean} Team`;
}

// Days round UP so the label never promises faster than the "Usually sends a proposal within N days" filter allows:
// 30 hours reads "~2d", not "~1d", since the 1-day filter excludes it.
function formatResponseHours(hours) {
  if (hours === null || hours === undefined) return null;
  return hours < 24 ? `~${Math.round(hours)}h` : `~${Math.ceil(hours / 24)}d`;
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
  // "Focused service area": how close together the agent's own ZIPs are, a plain fact, not a claim about skill.
  const focused = a.focusedServiceArea ?? a.isLocalSpecialist;
  return {
    status: [
      { text: a.acceptingClients ? 'Accepting new clients' : 'Not accepting new clients', tone: a.acceptingClients ? 'good' : 'bad' },
      focused && { text: 'Focused service area', tone: 'gold' },
      a.isPlatformOperator && { text: 'Platform operator: runs Amico Haus' },
      (a.foundingZips || []).length > 0 && { text: `Founding agent · ${a.foundingZips.join(', ')}`, tone: 'good' },
      a.carriesEoInsurance && { text: 'E&O insured (self-reported)', tone: 'good' },
      a.isNewToAmicoHaus && { text: 'New to Amico Haus' },
      a.offersFlatFee && { text: 'Flat-fee option' },
    ].filter(Boolean),
    stats: [
      a.hiresOnPlatform > 0 && { k: 'Hired here', v: `${a.hiresOnPlatform} time${a.hiresOnPlatform === 1 ? '' : 's'}` },
      a.finalistCount > 0 && { k: 'Finalist', v: `${a.finalistCount} home${a.finalistCount === 1 ? '' : 's'}` },
      // Measures how soon after a request opens (or after an invite) the agent sends a proposal -- not message replies.
      respLabel && { k: 'Proposal speed', v: respLabel },
      a.caseStudies && a.caseStudies.length > 0 && { k: 'Case studies', v: String(a.caseStudies.length) },
      a.hasPastWork && !(a.caseStudies && a.caseStudies.length > 0) && { k: 'Past work', v: 'Portfolio photos' },
    ].filter(Boolean),
    selfReported: [
      a.pastClients && a.pastClients.count > 0 && { k: 'Past clients (outside Amico, not verified)', v: `★ ${a.pastClients.avgRating} (${a.pastClients.count})` },
      a.homesSoldLastYear && { k: 'Sold, last 12 mo', v: String(a.homesSoldLastYear) },
      a.avgDaysOnMarket && { k: 'On market', v: `~${a.avgDaysOnMarket} days` },
      a.saleToListRatio && { k: 'Sale-to-list', v: `${Math.round(a.saleToListRatio * 100)}%` },
    ].filter(Boolean),
    specialties: (a.specialtyTags || []).map(t => SPECIALTY_TAG_LABELS[t] || t),
    languages: a.languages && a.languages.length > 1 ? a.languages : [],
    area: [
      a.distanceMiles !== null && a.distanceMiles !== undefined ? `${a.distanceMiles} mi away` : null,
      a.serviceAreaSpreadMiles !== null && a.serviceAreaSpreadMiles !== undefined && !focused ? `Spans about ${Math.round(a.serviceAreaSpreadMiles)} mi` : null,
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
        // No "verified" or "top rated" badges: the site never vouches for or ranks agents. The license reads "on file".
        nameHtml: `<a class="profile-link" href="/profile/${a.userId}">${escapeHtml(a.displayName)}</a>`,
        sub: [licenseOnFileLabel(a.licenseNumber), a.brokerageName, a.teamDisplayName || teamDisplayName(a.teamName)].filter(Boolean).join(' · '),
        chips: [ratingChipHtml(a.rating, a.reviewCount), a.yearsExperience ? chipHtml(`${a.yearsExperience} yrs experience`, 'outline') : ''].filter(Boolean),
      })}
      ${agentDetailsHtml(directoryAgentInfo(a))}
      ${foundingCaptionHtml(a.foundingZips)}
      ${favorite || message ? `<div class="card-actions">
        ${message ? `<button class="btn btn-ghost btn-sm" data-action="message-user" data-id="${a.userId}" data-name="${escapeHtml(a.displayName)}">Message</button>` : ''}
        ${favorite ? `<button class="btn btn-ghost btn-sm" data-action="toggle-favorite-agent" data-agent-id="${a.userId}">☆ Favorite</button>` : ''}
      </div>` : ''}
    </div>`;
}
