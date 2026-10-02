import { clampString } from './util.js';
import { PROPERTY_TYPES } from './listings.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from './geo.js';

function num(value, { min = 0, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

const OCCUPANCY_STATUSES = ['occupied', 'vacant'];

export function validatePreListingInput(body) {
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  const zip = clampString(body.zip, 10);
  const propertyType = PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : null;
  const beds = num(body.beds, { min: 0, max: 50 });
  const baths = num(body.baths, { min: 0, max: 50 });
  const askingPrice = num(body.askingPrice, { min: 1, max: 500000000 });
  const occupancyStatus = OCCUPANCY_STATUSES.includes(body.occupancyStatus) ? body.occupancyStatus : 'occupied';
  const showingNoticeHours = num(body.showingNoticeHours, { min: 0, max: 336 }) || 0;
  // Informational stipulations only — nothing here is enforced or a binding
  // contract term, same footing as occupancy/showing-notice.
  const minYearsExperience = body.minYearsExperience ? num(body.minYearsExperience, { min: 0, max: 80 }) : null;
  const preferredLanguage = clampString(body.preferredLanguage, 40);
  const requireDedicatedContact = !!body.requireDedicatedContact;
  const prefersExclusive = !!body.prefersExclusive;
  const preferredAgreementMonths = body.preferredAgreementMonths ? num(body.preferredAgreementMonths, { min: 1, max: 60 }) : null;
  const prefersLocalSpecialist = !!body.prefersLocalSpecialist;

  if (!city || !state || !propertyType || beds === null || baths === null) {
    return { error: 'Fill in city, state, property type, beds, and baths.' };
  }
  if (!/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit zip code.' };
  if (askingPrice === null) return { error: 'Enter an asking price.' };

  return {
    data: {
      title: clampString(body.title, 120),
      description: clampString(body.description, 2000),
      address: clampString(body.address, 150),
      neighborhood: clampString(body.neighborhood, 80),
      city, state, zip, propertyType, beds, baths,
      sqft: body.sqft ? num(body.sqft, { min: 0, max: 200000 }) : null,
      askingPrice, occupancyStatus, showingNoticeHours,
      specialInstructions: clampString(body.specialInstructions, 500),
      minYearsExperience, preferredLanguage, requireDedicatedContact, prefersExclusive, preferredAgreementMonths,
      prefersLocalSpecialist,
    },
  };
}

export async function insertPreListing(db, userId, d) {
  const result = await db.prepare(
    `INSERT INTO pre_listings (user_id, title, description, address, neighborhood, city, state, zip, property_type,
       beds, baths, sqft, asking_price, occupancy_status, showing_notice_hours, special_instructions,
       min_years_experience, preferred_language, require_dedicated_contact, prefers_exclusive, preferred_agreement_months,
       prefers_local_specialist)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip, d.propertyType,
    d.beds, d.baths, d.sqft, d.askingPrice, d.occupancyStatus, d.showingNoticeHours, d.specialInstructions,
    d.minYearsExperience, d.preferredLanguage, d.requireDedicatedContact ? 1 : 0, d.prefersExclusive ? 1 : 0, d.preferredAgreementMonths,
    d.prefersLocalSpecialist ? 1 : 0
  ).run();
  return result.meta.last_row_id;
}

export async function updatePreListing(db, id, d) {
  await db.prepare(
    `UPDATE pre_listings SET title = ?, description = ?, address = ?, neighborhood = ?, city = ?, state = ?, zip = ?,
       property_type = ?, beds = ?, baths = ?, sqft = ?, asking_price = ?, occupancy_status = ?,
       showing_notice_hours = ?, special_instructions = ?, min_years_experience = ?, preferred_language = ?,
       require_dedicated_contact = ?, prefers_exclusive = ?, preferred_agreement_months = ?, prefers_local_specialist = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip, d.propertyType,
    d.beds, d.baths, d.sqft, d.askingPrice, d.occupancyStatus, d.showingNoticeHours, d.specialInstructions,
    d.minYearsExperience, d.preferredLanguage, d.requireDedicatedContact ? 1 : 0, d.prefersExclusive ? 1 : 0, d.preferredAgreementMonths,
    d.prefersLocalSpecialist ? 1 : 0, id
  ).run();
}

export async function fetchPreListingPhotos(db, preListingId) {
  const rows = await db.prepare(
    'SELECT id, position FROM pre_listing_photos WHERE pre_listing_id = ? ORDER BY position ASC'
  ).bind(preListingId).all();
  return rows.results;
}

const VOTE_TYPES = ['too_high', 'too_low', 'just_right'];

export async function castPriceVote(db, preListingId, agentUserId, body) {
  const vote = VOTE_TYPES.includes(body.vote) ? body.vote : null;
  if (!vote) return { error: 'Pick too high, too low, or just right.' };
  const note = clampString(body.note, 300);

  await db.prepare(
    `INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote, note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(pre_listing_id, agent_user_id) DO UPDATE SET vote = excluded.vote, note = excluded.note, created_at = datetime('now')`
  ).bind(preListingId, agentUserId, vote, note).run();

  return { ok: true };
}

// Any approved agent may vote, so the tally also says how many of the votes
// came from agents whose service area reaches the home (a service zip within
// SERVICE_RADIUS_MILES of it) — that is what makes "local agent experts" true
// rather than a claim. `nearby` is null when the home's zip isn't a known one,
// i.e. we can't tell, which is not the same as none.
export async function getVoteTally(db, preListingId) {
  const rows = await db.prepare(
    `SELECT v.vote, ap.service_zips_json
     FROM pre_listing_price_votes v
     LEFT JOIN agent_profiles ap ON ap.user_id = v.agent_user_id
     WHERE v.pre_listing_id = ?`
  ).bind(preListingId).all();
  const tally = { too_high: 0, too_low: 0, just_right: 0, total: 0, nearby: 0 };
  if (!rows.results.length) return tally;

  const home = await db.prepare('SELECT zip FROM pre_listings WHERE id = ?').bind(preListingId).first();
  const agentZips = rows.results.map(r => { try { return JSON.parse(r.service_zips_json || '[]'); } catch { return []; } });
  const coords = await lookupZipCoords(db, [home && home.zip, ...agentZips.flat()]);
  const homeCoords = home ? coords.get(home.zip) : null;

  rows.results.forEach((r, i) => {
    if (r.vote in tally) tally[r.vote] += 1;
    tally.total += 1;
    const d = nearestServiceDistance(homeCoords, agentZips[i], coords);
    if (d !== null && d <= SERVICE_RADIUS_MILES) tally.nearby += 1;
  });
  if (!homeCoords) tally.nearby = null;
  return tally;
}

export async function fetchMyVote(db, preListingId, agentUserId) {
  const row = await db.prepare(
    'SELECT vote, note FROM pre_listing_price_votes WHERE pre_listing_id = ? AND agent_user_id = ?'
  ).bind(preListingId, agentUserId).first();
  return row || null;
}
