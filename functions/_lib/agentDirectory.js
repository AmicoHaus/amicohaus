// Shared "what does this agent look like as a directory row" builder and
// filter-matcher — used by both the live directory browse (functions/api/
// agents/directory.js) and saved agent-search alerts (agentSearchAlerts.js),
// so the two can never drift out of sync on what counts as a match.
import { fetchAgentRatingSummary, fetchAgentStats } from './marketplace.js';
import { fetchAgentPackages, packagePriceRange } from './agentPackages.js';
import { fetchCaseStudies } from './caseStudies.js';
import { fetchActiveTeamName } from './agentTeams.js';
import { lookupZipCoords, nearestServiceDistance, serviceAreaSpread, SERVICE_RADIUS_MILES, LOCAL_SPECIALIST_SPREAD_MILES } from './geo.js';

// A commission range across every commission-based offering an agent has
// (their profile default plus any package) — the reciprocal of
// packagePriceRange, but for percentage fees rather than flat ones.
function commissionRange(defaultCommissionPct, packages) {
  const values = packages.map(p => p.commissionPct).filter(v => v !== null && v !== undefined);
  if (defaultCommissionPct !== null && defaultCommissionPct !== undefined) values.push(defaultCommissionPct);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export async function buildAgentDirectoryEntry(db, agentUserId) {
  const row = await db.prepare(
    `SELECT agent_profiles.*, users.display_name, users.is_verified
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.user_id = ? AND agent_profiles.status = 'approved'`
  ).bind(agentUserId).first();
  if (!row) return null;

  const rating = await fetchAgentRatingSummary(db, agentUserId);
  const stats = await fetchAgentStats(db, agentUserId);
  const packages = await fetchAgentPackages(db, agentUserId);
  const caseStudies = await fetchCaseStudies(db, agentUserId);
  const teamName = await fetchActiveTeamName(db, agentUserId);
  const priceRange = packagePriceRange(packages);
  const generalServices = JSON.parse(row.services_json || '[]').map(s => s.type);
  const packageServices = packages.flatMap(p => p.services.map(s => s.type));
  const serviceZips = JSON.parse(row.service_zips_json || '[]');
  const ownZipCoords = await lookupZipCoords(db, serviceZips);
  const serviceAreaSpreadMiles = serviceAreaSpread(serviceZips, ownZipCoords);
  const turnaroundValues = packages.map(p => p.turnaroundDays).filter(v => v !== null && v !== undefined);
  const fastestTurnaroundDays = turnaroundValues.length ? Math.min(...turnaroundValues) : null;

  return {
    userId: row.user_id, displayName: row.display_name, brokerageName: row.brokerage_name, teamName,
    yearsExperience: row.years_experience, hasVideo: !!row.video_r2_key,
    isVerified: !!row.is_verified, licenseVerified: !!row.license_verified,
    rating: rating.avgRating, reviewCount: rating.reviewCount, topRated: stats.topRated,
    avgResponseHours: stats.avgResponseHours,
    packages, priceRange, caseStudies,
    commissionRange: commissionRange(row.default_commission_pct, packages),
    allServiceTypes: new Set([...generalServices, ...packageServices]),
    fastestTurnaroundDays,
    openHouseDays: JSON.parse(row.open_house_days_json || '[]'),
    specialtyTags: JSON.parse(row.specialty_tags_json || '[]'),
    certifications: row.certifications,
    languages: JSON.parse(row.languages_json || '["English"]'),
    avgDaysOnMarket: row.avg_days_on_market, homesSoldLastYear: row.homes_sold_last_year,
    saleToListRatio: row.sale_to_list_ratio,
    soloAgent: !!row.solo_agent,
    acceptingClients: !!row.accepting_clients, carriesEoInsurance: !!row.carries_eo_insurance,
    serviceZips, distanceMiles: null,
    serviceAreaSpreadMiles, isLocalSpecialist: serviceAreaSpreadMiles !== null && serviceAreaSpreadMiles <= LOCAL_SPECIALIST_SPREAD_MILES,
  };
}

// filters: { q, service, minRating, minReviewCount, topRatedOnly,
//            licenseVerifiedOnly, hasVideoOnly, priceMin, priceMax, zip,
//            specialtyTag, language, soloAgentOnly, minYearsExperience,
//            maxAvgDaysOnMarket, minHomesSoldLastYear, minSaleToListRatio,
//            maxCommissionPct, maxTurnaroundDays, openHouseDay,
//            hasCaseStudiesOnly, acceptingClientsOnly, eoInsuranceOnly,
//            localSpecialistOnly }
export async function agentMatchesFilters(db, entry, filters) {
  if (filters.q) {
    const q = filters.q.toLowerCase();
    if (!entry.displayName.toLowerCase().includes(q) && !(entry.brokerageName || '').toLowerCase().includes(q)) return false;
  }
  if (filters.service && !entry.allServiceTypes.has(filters.service)) return false;
  if (filters.minRating != null && (entry.rating === null || entry.rating < filters.minRating)) return false;
  if (filters.minReviewCount != null && entry.reviewCount < filters.minReviewCount) return false;
  if (filters.topRatedOnly && !entry.topRated) return false;
  if (filters.licenseVerifiedOnly && !entry.licenseVerified) return false;
  if (filters.hasVideoOnly && !entry.hasVideo) return false;
  if (filters.specialtyTag && !entry.specialtyTags.includes(filters.specialtyTag)) return false;
  if (filters.language && !entry.languages.includes(filters.language)) return false;
  if (filters.soloAgentOnly && !entry.soloAgent) return false;
  if (filters.priceMin != null && (!entry.priceRange || entry.priceRange.max < filters.priceMin)) return false;
  if (filters.priceMax != null && (!entry.priceRange || entry.priceRange.min > filters.priceMax)) return false;
  if (filters.minYearsExperience != null && entry.yearsExperience < filters.minYearsExperience) return false;
  if (filters.maxAvgDaysOnMarket != null && (entry.avgDaysOnMarket === null || entry.avgDaysOnMarket > filters.maxAvgDaysOnMarket)) return false;
  if (filters.minHomesSoldLastYear != null && (entry.homesSoldLastYear === null || entry.homesSoldLastYear < filters.minHomesSoldLastYear)) return false;
  if (filters.minSaleToListRatio != null && (entry.saleToListRatio === null || entry.saleToListRatio < filters.minSaleToListRatio)) return false;
  if (filters.maxCommissionPct != null && (!entry.commissionRange || entry.commissionRange.min > filters.maxCommissionPct)) return false;
  if (filters.maxTurnaroundDays != null && (entry.fastestTurnaroundDays === null || entry.fastestTurnaroundDays > filters.maxTurnaroundDays)) return false;
  if (filters.openHouseDay && !entry.openHouseDays.includes(filters.openHouseDay)) return false;
  if (filters.hasCaseStudiesOnly && entry.caseStudies.length === 0) return false;
  if (filters.acceptingClientsOnly && !entry.acceptingClients) return false;
  if (filters.eoInsuranceOnly && !entry.carriesEoInsurance) return false;
  if (filters.localSpecialistOnly && !entry.isLocalSpecialist) return false;
  if (filters.zip) {
    if (entry.serviceZips.length === 0) return false;
    const coords = await lookupZipCoords(db, [filters.zip, ...entry.serviceZips]);
    const d = nearestServiceDistance(coords.get(filters.zip), entry.serviceZips, coords);
    if (d === null || d > SERVICE_RADIUS_MILES) return false;
    // Side effect: stash the computed distance on the entry so the caller
    // (the live directory browse) doesn't have to redo this lookup just to
    // display "X mi away" — saved-alert matching ignores this field.
    entry.distanceMiles = Math.round(d);
  }
  return true;
}

export function parseDirectoryFilters(url) {
  const num = v => (v || v === '0') ? Number(v) : null;
  return {
    q: (url.searchParams.get('q') || '').trim() || null,
    service: (url.searchParams.get('service') || '').trim() || null,
    minRating: num(url.searchParams.get('minRating')),
    minReviewCount: num(url.searchParams.get('minReviewCount')),
    topRatedOnly: url.searchParams.get('topRatedOnly') === '1',
    licenseVerifiedOnly: url.searchParams.get('licenseVerifiedOnly') === '1',
    hasVideoOnly: url.searchParams.get('hasVideoOnly') === '1',
    priceMin: num(url.searchParams.get('priceMin')),
    priceMax: num(url.searchParams.get('priceMax')),
    zip: (url.searchParams.get('zip') || '').trim() || null,
    specialtyTag: (url.searchParams.get('specialtyTag') || '').trim() || null,
    language: (url.searchParams.get('language') || '').trim() || null,
    soloAgentOnly: url.searchParams.get('soloAgentOnly') === '1',
    minYearsExperience: num(url.searchParams.get('minYearsExperience')),
    maxAvgDaysOnMarket: num(url.searchParams.get('maxAvgDaysOnMarket')),
    minHomesSoldLastYear: num(url.searchParams.get('minHomesSoldLastYear')),
    minSaleToListRatio: num(url.searchParams.get('minSaleToListRatio')),
    maxCommissionPct: num(url.searchParams.get('maxCommissionPct')),
    maxTurnaroundDays: num(url.searchParams.get('maxTurnaroundDays')),
    openHouseDay: (url.searchParams.get('openHouseDay') || '').trim() || null,
    hasCaseStudiesOnly: url.searchParams.get('hasCaseStudiesOnly') === '1',
    acceptingClientsOnly: url.searchParams.get('acceptingClientsOnly') === '1',
    eoInsuranceOnly: url.searchParams.get('eoInsuranceOnly') === '1',
    localSpecialistOnly: url.searchParams.get('localSpecialistOnly') === '1',
  };
}
