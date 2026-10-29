// Mello-Roos and HOA snapshot, shared by every kind of home (regular listings, pre-listings, AugmentedHomes,
// GreenHomes). Mello-Roos (a Community Facilities District tax) is common in newer San Diego County communities
// like EastLake and Otay Ranch and changes the real yearly cost of a home, so buyers and agents ask about it first.
// NULL means the owner didn't say; 0 means none.
import { clampString } from './util.js';

export const HOA_INCLUDES = {
  water: 'Water', trash: 'Trash', sewer: 'Sewer', internet: 'Cable or internet', pool: 'Pool or spa',
  clubhouse: 'Clubhouse or gym', landscaping: 'Landscaping', exterior: 'Exterior upkeep', insurance: 'Building insurance',
  security: 'Gated or security',
};
// California HOAs can't ban renting a home out, only rentals of 30 days or less (Civ. Code 4741), and (for rules
// adopted since 2001) can't ban keeping at least one pet (Civ. Code 4715), so "not allowed" isn't offered.
// "Limited (see HOA rules)" covers anything stricter.
export const HOA_RENTAL_RULES = ['allowed', 'no_short_term', 'limited'];
export const HOA_PET_RULES = ['allowed', 'limited'];

// The table and owner column for each kind of home the costs can be saved on.
export const HOME_KINDS = {
  listing: 'listings',
  pre_listing: 'pre_listings',
  augmented_home: 'augmented_homes',
  green_home: 'green_homes',
};

function optionalWholeDollars(value, max, label) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) return { error: `${label} should be a whole-dollar amount.` };
  return { value: n };
}

export function validateHomeCosts(body) {
  const mello = optionalWholeDollars(body.melloRoosAnnual, 100000, 'Mello-Roos per year');
  if (mello.error) return { error: mello.error };
  const hoa = optionalWholeDollars(body.hoaMonthly, 20000, 'HOA dues per month');
  if (hoa.error) return { error: hoa.error };
  const d = body.hoaDetails && typeof body.hoaDetails === 'object' && !Array.isArray(body.hoaDetails) ? body.hoaDetails : {};
  const includes = Array.isArray(d.includes) ? [...new Set(d.includes.filter(k => Object.hasOwn(HOA_INCLUDES, k)))] : [];
  const details = hoa.value === 0 ? { includes: [], rentals: '', pets: '', specialAssessment: '' } : {
    includes,
    rentals: HOA_RENTAL_RULES.includes(d.rentals) ? d.rentals : '',
    pets: HOA_PET_RULES.includes(d.pets) ? d.pets : '',
    specialAssessment: clampString(d.specialAssessment, 120),
  };
  return { data: { melloRoosAnnual: mello.value, hoaMonthly: hoa.value, hoaDetails: details } };
}

export function homeCostsFromRow(row) {
  let details = {};
  try { details = JSON.parse(row.hoa_details_json || '{}') || {}; } catch { details = {}; }
  return {
    melloRoosAnnual: row.mello_roos_annual ?? null,
    hoaMonthly: row.hoa_monthly ?? null,
    hoaDetails: {
      includes: Array.isArray(details.includes) ? details.includes : [],
      rentals: details.rentals || '', pets: details.pets || '', specialAssessment: details.specialAssessment || '',
    },
  };
}

const RULE_LABELS = { allowed: 'allowed', no_short_term: 'allowed, no short-term (30 days or less)', limited: 'limited (see HOA rules)' };

// Plain-text lines for server-rendered pages (escaped by the caller's template).
export function homeCostsLines(costs) {
  const lines = [];
  if (costs.melloRoosAnnual === 0) lines.push('No Mello-Roos');
  else if (costs.melloRoosAnnual) lines.push(`Mello-Roos about $${costs.melloRoosAnnual.toLocaleString('en-US')}/yr`);
  if (costs.hoaMonthly === 0) lines.push('No HOA');
  else if (costs.hoaMonthly) {
    const inc = costs.hoaDetails.includes.map(k => HOA_INCLUDES[k]).filter(Boolean);
    lines.push(`HOA $${costs.hoaMonthly.toLocaleString('en-US')}/mo${inc.length ? ` (includes ${inc.join(', ').toLowerCase()})` : ''}`);
  }
  if (RULE_LABELS[costs.hoaDetails.rentals]) lines.push(`Renting out: ${RULE_LABELS[costs.hoaDetails.rentals]}`);
  if (RULE_LABELS[costs.hoaDetails.pets]) lines.push(`Pets: ${RULE_LABELS[costs.hoaDetails.pets]}`);
  if (costs.hoaDetails.specialAssessment) lines.push(`Special assessment: ${costs.hoaDetails.specialAssessment}`);
  return lines;
}
