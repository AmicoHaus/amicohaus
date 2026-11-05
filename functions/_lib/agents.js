import { clampString, DEMO_EMAIL_PATTERN } from './util.js';
import { validateServiceZips } from './geo.js';

// Approval is an admin review of what the applicant enters here: before approving, the admin looks the license number
// up by hand on the California DRE's public lookup (dreLookupUrl). There's no automatic call to the DRE, and the site
// never vouches for an agent's status today: it says "DRE #01234567 on file" (plus, on the profile page, the date it
// was checked and a link to check current status).
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
  // A California DRE license ID is 8 digits (leading zeros included); "DRE #1234567" becomes "01234567".
  const licenseDigits = String(body.licenseNumber ?? '').replace(/\D/g, '');
  const licenseNumber = licenseDigits.length >= 5 && licenseDigits.length <= 8 ? licenseDigits.padStart(8, '0') : '';
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

  if (!licenseNumber) return { error: 'Enter your California DRE license number (8 digits, for example 01234567).' };
  if (!brokerageName) return { error: 'Enter your brokerage name.' };
  // Fees are optional at apply time: every proposal sets its own fee anyway.

  return {
    data: {
      brokerageName, licenseNumber, yearsExperience, bio, defaultCommissionPct, defaultFlatFee, services,
      serviceZips, openHouseDays, avgDaysOnMarket, homesSoldLastYear, notifyNewRequests,
      saleToListRatio, specialtyTags, certifications, languages: languages.length ? languages : ['English'], soloAgent,
      acceptingClients, carriesEoInsurance,
    },
  };
}

// The agent rules in the Terms of Use (terms.html#agent-rules). Applicants agree to them, and the version they agreed
// to is stored, so there's always a written agreement to point to.
export const AGENT_RULES_VERSION = '2026-11-04';
export const RULES_REQUIRED_ERROR = 'Please agree to the agent rules in the Terms of Use to continue.';

// Submitting again re-applies: an already-approved agent editing their
// profile stays approved (this is a profile edit, not a fresh vetting
// request), but a rejected or first-time applicant goes back to pending for
// another admin review. Agreeing to the agent rules (body.acceptRules === true) is required for a new application,
// and on any save by someone who hasn't agreed to the current version yet.
export async function submitAgentApplication(db, userId, body) {
  const validated = validateAgentApplication(body);
  if (validated.error) return validated;
  const d = validated.data;
  const prior = await db.prepare('SELECT status, rules_version FROM agent_profiles WHERE user_id = ?').bind(userId).first();
  const needsRules = !prior || prior.status === 'rejected' || prior.rules_version !== AGENT_RULES_VERSION;
  if (needsRules && body.acceptRules !== true) return { error: RULES_REQUIRED_ERROR, code: 'rules_required' };

  if (d.serviceZips.length > 0) {
    const placeholders = d.serviceZips.map(() => '?').join(',');
    const found = await db.prepare(`SELECT zip FROM zip_codes WHERE zip IN (${placeholders})`).bind(...d.serviceZips).all();
    const foundZips = new Set(found.results.map(r => r.zip));
    const unknown = d.serviceZips.filter(z => !foundZips.has(z));
    if (unknown.length > 0) return { error: `Not a recognized US zip code: ${unknown.join(', ')}.` };
  }

  const existing = await db.prepare('SELECT status, license_number, brokerage_name FROM agent_profiles WHERE user_id = ?').bind(userId).first();
  const nextStatus = existing && existing.status === 'approved' ? 'approved' : 'pending';

  // An admin checked the license number and broker they were shown on the DRE, so an approved agent (free to edit
  // their profile) changing either one voids that check (the DRE record ties a license to its broker) -- see the
  // license_verified CASE expressions in the upsert below. apply.js alerts the admin so it gets looked up again.

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
       license_verified = CASE WHEN excluded.license_number IS NOT agent_profiles.license_number OR excluded.brokerage_name IS NOT agent_profiles.brokerage_name THEN 0 ELSE agent_profiles.license_verified END,
       license_verified_at = CASE WHEN excluded.license_number IS NOT agent_profiles.license_number OR excluded.brokerage_name IS NOT agent_profiles.brokerage_name THEN NULL ELSE agent_profiles.license_verified_at END,
       license_verified_by = CASE WHEN excluded.license_number IS NOT agent_profiles.license_number OR excluded.brokerage_name IS NOT agent_profiles.brokerage_name THEN NULL ELSE agent_profiles.license_verified_by END,
       applied_at = CASE WHEN status = 'pending' THEN datetime('now') ELSE agent_profiles.applied_at END,
       rejection_reason = CASE WHEN excluded.status = 'pending' THEN NULL ELSE agent_profiles.rejection_reason END`
  ).bind(
    userId, nextStatus, d.brokerageName, d.licenseNumber, d.yearsExperience, d.bio, d.defaultCommissionPct, d.defaultFlatFee,
    JSON.stringify(d.services), JSON.stringify(d.serviceZips), JSON.stringify(d.openHouseDays), d.avgDaysOnMarket, d.homesSoldLastYear,
    d.notifyNewRequests ? 1 : 0, JSON.stringify(d.specialtyTags), d.certifications, JSON.stringify(d.languages), d.saleToListRatio,
    d.soloAgent ? 1 : 0, d.acceptingClients ? 1 : 0, d.carriesEoInsurance ? 1 : 0
  ).run();
  // The first agreement to this version keeps its date (a later save doesn't move it).
  if (needsRules) {
    await db.prepare("UPDATE agent_profiles SET rules_version = ?, rules_accepted_at = datetime('now') WHERE user_id = ?")
      .bind(AGENT_RULES_VERSION, userId).run();
  }

  // "New" = a first application or a re-application after a rejection -- not an approved or pending agent editing
  // their profile, which would otherwise alert the admin on every save.
  return {
    status: nextStatus, isNewApplication: !existing || existing.status === 'rejected', licenseNumber: d.licenseNumber,
    licenseChanged: !!existing && existing.license_number !== d.licenseNumber,
    brokerageChanged: !!existing && (existing.brokerage_name || '') !== (d.brokerageName || ''),
    oldLicense: existing ? existing.license_number : null,
    oldBrokerage: existing ? existing.brokerage_name : null,
    brokerageName: d.brokerageName,
  };
}

// When an admin last looked this license number up on the DRE (an agent_profiles row): the DRE check's own date, else
// the approval date. Only while the check stands: an admin marking the license "not active", or the agent changing the
// number, clears license_verified, and then there's no date to show (the old date was about a different check).
export function licenseCheckedAt(row) {
  if (!row || !row.license_verified) return null;
  return row.license_verified_at || row.reviewed_at || null;
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
    licenseCheckedAt: licenseCheckedAt(row),
    specialtyTags: JSON.parse(row.specialty_tags_json || '[]'), certifications: row.certifications,
    languages: JSON.parse(row.languages_json || '["English"]'), saleToListRatio: row.sale_to_list_ratio,
    soloAgent: !!row.solo_agent,
    acceptingClients: !!row.accepting_clients, carriesEoInsurance: !!row.carries_eo_insurance,
    appliedAt: row.applied_at, reviewedAt: row.reviewed_at, rejectionReason: row.rejection_reason,
    reviewInviteFromYear: row.review_invite_from_year || null, reviewInviteToYear: row.review_invite_to_year || null,
    // Which version of the agent rules (Terms of Use) they agreed to, so the form only asks again when it changes.
    rulesVersion: row.rules_version || null,
  };
}

export async function isApprovedAgent(db, userId) {
  const row = await db.prepare("SELECT 1 FROM agent_profiles WHERE user_id = ? AND status = 'approved'").bind(userId).first();
  return !!row;
}

// A rejection (or a removed approval) gives one of these fixed reasons, the same list for every applicant, so a
// decision is never a one-off judgment in the admin's own words. "Other" carries a short note.
export const REJECTION_REASONS = [
  'License not found or not active',
  "Brokerage doesn't match the DRE record",
  'Service area outside San Diego County',
  'Incomplete application',
  'Other (explained below)',
];
const OTHER_REASON = REJECTION_REASONS[REJECTION_REASONS.length - 1];

// { reason, note } -> the text stored and shown to the applicant, or { error }. A blank reason means none is given;
// free text that isn't on the list (the old prompt) is filed under "Other" with that text as the note.
export function rejectionReasonText(reason, note) {
  let r = clampString(reason, 200);
  let n = clampString(note, 300);
  if (!r) return { text: n ? `Other: ${n}` : '' };
  if (!REJECTION_REASONS.includes(r)) { n = [r, n].filter(Boolean).join(' '); r = OTHER_REASON; }
  if (r === OTHER_REASON && !n) return { error: 'Add a short explanation for "Other".' };
  return { text: clampString(r === OTHER_REASON ? `Other: ${n}` : `${r}${n ? `. ${n}` : ''}`, 500) };
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

// The range of flat fees approved agents on Amico Haus list for each prep service: not a market survey and not a quote,
// just "here's what agents here list today" so a homeowner has a rough idea before posting. Flat fees only;
// hourly/included entries and $0 fees don't give a dollar figure. A service shows only once at least
// MIN_AGENTS_FOR_ESTIMATE different agents list it, as a low-high range with no average, so no single agent's price is
// published as "the" price. Demo and suspended accounts never count.
export const MIN_AGENTS_FOR_ESTIMATE = 3;
export const SERVICE_ESTIMATE_NOTE = 'Not a quote. The range of flat fees approved agents on Amico Haus list today; each agent sets their own fees, and fees are negotiable.';

export async function fetchServiceEstimates(db) {
  const rows = await db.prepare(
    `SELECT agent_profiles.user_id, agent_profiles.services_json FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ?`
  ).bind(DEMO_EMAIL_PATTERN).all();

  const feesByType = {};
  for (const row of rows.results) {
    let services;
    try { services = JSON.parse(row.services_json || '[]'); } catch { continue; }
    for (const s of Array.isArray(services) ? services : []) {
      if (s.feeType !== 'flat' || !s.fee || s.fee <= 0) continue;
      if (!SERVICE_TYPES.includes(s.type)) continue;
      const entry = (feesByType[s.type] ||= { fees: [], agents: new Set() });
      entry.fees.push(s.fee);
      entry.agents.add(row.user_id);
    }
  }

  const estimates = {};
  for (const type of SERVICE_TYPES) {
    const entry = feesByType[type];
    if (!entry || entry.agents.size < MIN_AGENTS_FOR_ESTIMATE) { estimates[type] = null; continue; }
    estimates[type] = { min: Math.min(...entry.fees), max: Math.max(...entry.fees), agentCount: entry.agents.size };
  }
  return estimates;
}

// The California DRE's public license lookup for one license ID (name, status, expiration, responsible broker).
export function dreLookupUrl(licenseNumber) {
  return `https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=${encodeURIComponent(String(licenseNumber || ''))}`;
}
