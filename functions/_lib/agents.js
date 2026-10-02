import { clampString } from './util.js';
import { validateServiceZips } from './geo.js';

// Vetting is admin-reviewed based on what the applicant self-reports here —
// Amico Haus does not call any state licensing board to verify a license
// number. The UI must say so plainly wherever an agent's license is shown.
export const SERVICE_TYPES = [
  'photography', 'drone', 'staging', 'cleaning', 'landscaping', 'virtual_tour',
  'social_media_ads', 'email_campaign', 'print_marketing', 'mls_syndication', 'other',
];
const MAX_SERVICES = 12;
export const OPEN_HOUSE_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const SPECIALTY_TAGS = [
  'luxury', 'first_time_buyer', 'relocation', 'military_va', 'investment',
  'new_construction', 'senior_downsizing', 'condo_hoa', 'waterfront', 'other',
];
const MAX_SPECIALTY_TAGS = 8;
export const LANGUAGES = [
  'English', 'Spanish', 'Mandarin', 'Cantonese', 'Vietnamese', 'Tagalog',
  'Korean', 'Russian', 'Arabic', 'French', 'Portuguese', 'Other',
];

function num(value, { min = 0, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

// Also reused by a per-listing bid's own included-services list
// (functions/_lib/preListings.js) — same shape either way.
export function validateServices(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_SERVICES).map(s => ({
    type: SERVICE_TYPES.includes(s.type) ? s.type : 'other',
    feeType: ['flat', 'hourly', 'included'].includes(s.feeType) ? s.feeType : 'flat',
    fee: s.feeType === 'included' ? 0 : Math.max(0, Math.min(Number(s.fee) || 0, 100000)),
    note: clampString(s.note, 200),
  }));
}

export function validateAgentApplication(body) {
  const brokerageName = clampString(body.brokerageName, 150);
  const licenseNumber = clampString(body.licenseNumber, 60);
  const yearsExperience = num(body.yearsExperience, { min: 0, max: 80 }) || 0;
  const bio = clampString(body.bio, 2000);
  const defaultCommissionPct = body.defaultCommissionPct ? num(body.defaultCommissionPct, { min: 0, max: 100 }) : null;
  const defaultFlatFee = body.defaultFlatFee ? num(body.defaultFlatFee, { min: 0, max: 500000 }) : null;
  const services = validateServices(body.services);
  const serviceZips = validateServiceZips(body.serviceZips);
  const openHouseDays = [...new Set((Array.isArray(body.openHouseDays) ? body.openHouseDays : []).filter(d => OPEN_HOUSE_DAYS.includes(d)))];
  // Self-reported track record, same footing as license_number — not
  // verified against any MLS, and the UI must disclose that too.
  const avgDaysOnMarket = body.avgDaysOnMarket ? num(body.avgDaysOnMarket, { min: 0, max: 3650 }) : null;
  const homesSoldLastYear = body.homesSoldLastYear ? num(body.homesSoldLastYear, { min: 0, max: 10000 }) : null;
  const saleToListRatio = body.saleToListRatio ? num(body.saleToListRatio, { min: 0, max: 2 }) : null;
  const notifyNewRequests = body.notifyNewRequests !== false;
  const specialtyTags = [...new Set((Array.isArray(body.specialtyTags) ? body.specialtyTags : []).filter(t => SPECIALTY_TAGS.includes(t)))].slice(0, MAX_SPECIALTY_TAGS);
  const certifications = clampString(body.certifications, 300);
  const languages = [...new Set((Array.isArray(body.languages) ? body.languages : ['English']).filter(l => LANGUAGES.includes(l)))];
  const soloAgent = body.soloAgent !== false;
  const acceptingClients = body.acceptingClients !== false;
  const carriesEoInsurance = !!body.carriesEoInsurance;

  if (!brokerageName || !licenseNumber) {
    return { error: 'Enter your brokerage name and license number.' };
  }
  if (defaultCommissionPct === null && defaultFlatFee === null) {
    return { error: 'Enter at least one of a default commission % or flat fee — proposals can still override it per listing.' };
  }

  return {
    data: {
      brokerageName, licenseNumber, yearsExperience, bio, defaultCommissionPct, defaultFlatFee, services,
      serviceZips, openHouseDays, avgDaysOnMarket, homesSoldLastYear, notifyNewRequests,
      saleToListRatio, specialtyTags, certifications, languages: languages.length ? languages : ['English'], soloAgent,
      acceptingClients, carriesEoInsurance,
    },
  };
}

// Submitting again re-applies: an already-approved agent editing their
// profile stays approved (this is a profile edit, not a fresh vetting
// request), but a rejected or first-time applicant goes back to pending for
// another admin review.
export async function submitAgentApplication(db, userId, body) {
  const validated = validateAgentApplication(body);
  if (validated.error) return validated;
  const d = validated.data;

  if (d.serviceZips.length > 0) {
    const placeholders = d.serviceZips.map(() => '?').join(',');
    const found = await db.prepare(`SELECT zip FROM zip_codes WHERE zip IN (${placeholders})`).bind(...d.serviceZips).all();
    const foundZips = new Set(found.results.map(r => r.zip));
    const unknown = d.serviceZips.filter(z => !foundZips.has(z));
    if (unknown.length > 0) return { error: `Not a recognized US zip code: ${unknown.join(', ')}.` };
  }

  const existing = await db.prepare('SELECT status FROM agent_profiles WHERE user_id = ?').bind(userId).first();
  const nextStatus = existing && existing.status === 'approved' ? 'approved' : 'pending';

  // An admin verified the license number they were shown, so an approved agent
  // (free to edit their profile) changing it voids that check — see the
  // license_verified CASE expressions in the upsert below.

  await db.prepare(
    `INSERT INTO agent_profiles (user_id, status, brokerage_name, license_number, years_experience, bio, default_commission_pct, default_flat_fee, services_json, service_zips_json, open_house_days_json, avg_days_on_market, homes_sold_last_year, notify_new_requests, specialty_tags_json, certifications, languages_json, sale_to_list_ratio, solo_agent, accepting_clients, carries_eo_insurance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       status = excluded.status, brokerage_name = excluded.brokerage_name, license_number = excluded.license_number,
       years_experience = excluded.years_experience, bio = excluded.bio,
       default_commission_pct = excluded.default_commission_pct, default_flat_fee = excluded.default_flat_fee,
       services_json = excluded.services_json, service_zips_json = excluded.service_zips_json,
       open_house_days_json = excluded.open_house_days_json, avg_days_on_market = excluded.avg_days_on_market,
       homes_sold_last_year = excluded.homes_sold_last_year, notify_new_requests = excluded.notify_new_requests,
       specialty_tags_json = excluded.specialty_tags_json, certifications = excluded.certifications,
       languages_json = excluded.languages_json, sale_to_list_ratio = excluded.sale_to_list_ratio, solo_agent = excluded.solo_agent,
       accepting_clients = excluded.accepting_clients, carries_eo_insurance = excluded.carries_eo_insurance,
       license_verified = CASE WHEN excluded.license_number IS NOT agent_profiles.license_number THEN 0 ELSE agent_profiles.license_verified END,
       license_verified_at = CASE WHEN excluded.license_number IS NOT agent_profiles.license_number THEN NULL ELSE agent_profiles.license_verified_at END,
       license_verified_by = CASE WHEN excluded.license_number IS NOT agent_profiles.license_number THEN NULL ELSE agent_profiles.license_verified_by END,
       applied_at = CASE WHEN status = 'pending' THEN datetime('now') ELSE agent_profiles.applied_at END,
       rejection_reason = CASE WHEN excluded.status = 'pending' THEN NULL ELSE agent_profiles.rejection_reason END`
  ).bind(
    userId, nextStatus, d.brokerageName, d.licenseNumber, d.yearsExperience, d.bio, d.defaultCommissionPct, d.defaultFlatFee,
    JSON.stringify(d.services), JSON.stringify(d.serviceZips), JSON.stringify(d.openHouseDays), d.avgDaysOnMarket, d.homesSoldLastYear,
    d.notifyNewRequests ? 1 : 0, JSON.stringify(d.specialtyTags), d.certifications, JSON.stringify(d.languages), d.saleToListRatio,
    d.soloAgent ? 1 : 0, d.acceptingClients ? 1 : 0, d.carriesEoInsurance ? 1 : 0
  ).run();

  return { status: nextStatus };
}

export async function getAgentProfile(db, userId) {
  const row = await db.prepare('SELECT * FROM agent_profiles WHERE user_id = ?').bind(userId).first();
  if (!row) return null;
  return {
    userId: row.user_id, status: row.status, brokerageName: row.brokerage_name, licenseNumber: row.license_number,
    yearsExperience: row.years_experience, bio: row.bio,
    defaultCommissionPct: row.default_commission_pct, defaultFlatFee: row.default_flat_fee,
    services: JSON.parse(row.services_json || '[]'),
    hasVideo: !!row.video_r2_key,
    serviceZips: JSON.parse(row.service_zips_json || '[]'),
    openHouseDays: JSON.parse(row.open_house_days_json || '[]'),
    avgDaysOnMarket: row.avg_days_on_market, homesSoldLastYear: row.homes_sold_last_year,
    notifyNewRequests: !!row.notify_new_requests,
    hasLicensePhoto: !!row.license_photo_r2_key, licenseVerified: !!row.license_verified,
    specialtyTags: JSON.parse(row.specialty_tags_json || '[]'), certifications: row.certifications,
    languages: JSON.parse(row.languages_json || '["English"]'), saleToListRatio: row.sale_to_list_ratio,
    soloAgent: !!row.solo_agent,
    acceptingClients: !!row.accepting_clients, carriesEoInsurance: !!row.carries_eo_insurance,
    appliedAt: row.applied_at, reviewedAt: row.reviewed_at, rejectionReason: row.rejection_reason,
  };
}

export async function isApprovedAgent(db, userId) {
  const row = await db.prepare("SELECT 1 FROM agent_profiles WHERE user_id = ? AND status = 'approved'").bind(userId).first();
  return !!row;
}

export async function reviewAgentApplication(db, adminUserId, applicantUserId, approve, rejectionReason) {
  await db.prepare(
    `UPDATE agent_profiles SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?, rejection_reason = ?
     WHERE user_id = ?`
  ).bind(approve ? 'approved' : 'rejected', adminUserId, approve ? null : clampString(rejectionReason, 500), applicantUserId).run();
}

export async function fetchAgentPortfolioPhotos(db, agentUserId) {
  const rows = await db.prepare(
    'SELECT id, caption, position FROM agent_portfolio_photos WHERE agent_user_id = ? ORDER BY position ASC'
  ).bind(agentUserId).all();
  return rows.results;
}

// A ballpark of what each prep service typically costs, pulled from what
// approved agents on the platform have actually listed as their default
// per-service fee — not a market survey, just "here's what's on Amico Haus
// today" so a homeowner has some expectation before opening a pre-listing
// to bid. Flat fees only; hourly/included entries and $0 fees are excluded
// since they don't produce a meaningful dollar estimate.
export async function fetchServiceEstimates(db) {
  const rows = await db.prepare(
    "SELECT services_json FROM agent_profiles WHERE status = 'approved'"
  ).all();

  const feesByType = {};
  for (const row of rows.results) {
    let services;
    try { services = JSON.parse(row.services_json || '[]'); } catch { continue; }
    for (const s of services) {
      if (s.feeType !== 'flat' || !s.fee || s.fee <= 0) continue;
      if (!SERVICE_TYPES.includes(s.type)) continue;
      (feesByType[s.type] ||= []).push(s.fee);
    }
  }

  const estimates = {};
  for (const type of SERVICE_TYPES) {
    const fees = feesByType[type];
    if (!fees || fees.length === 0) { estimates[type] = null; continue; }
    fees.sort((a, b) => a - b);
    const sum = fees.reduce((a, b) => a + b, 0);
    estimates[type] = {
      min: fees[0], max: fees[fees.length - 1],
      avg: Math.round(sum / fees.length), sampleSize: fees.length,
    };
  }
  return estimates;
}
