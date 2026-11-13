// Standing Offer (nuanced ideas batch, migration_v47): a member's NON-BINDING standing interest ("Not an offer to
// purchase") on a ZIP code, a street name or one pre-listing (standing_interests: terms only, no free text, nothing
// about the person), and a homeowner's own note of where their home is (home_claims: ZIP + street name, never a
// house number). Never public: only matching owners see it, without the member's name. The name on screen is
// "Standing interest".
//
// What it never does: show an interest to anyone it doesn't reach, name or describe the member who posted it, sort
// or sum the amounts (newest first, never highest first; no average, no chart, no "demand"), alert the operator, or
// let an agent post, claim or reply (an agent posting for a buyer is soliciting sellers: licensed work).
import { DEMO_EMAIL_PATTERN, clampString } from './util.js';
import { sqlUtc } from './contactPolicy.js';
import { notBlockedSql } from './blocks.js';
import { validZip, hasHouseNumber, streetKey, HOUSE_NUMBER_ERROR } from './ideaText.js';
import { steeringProblem, STEERING_ERROR, addressProblem } from './homeText.js';
import { headStartTeaserSql } from './watchAreas.js';
import { toolLive } from './nuancedGate.js';

export const STANDING_LABEL = 'Not an offer to purchase.';
export const STANDING_LINE = "Standing interest tells an owner what you'd consider. It isn't an offer, it doesn't bind you or the owner, and it is never shown publicly.";
export const STANDING_ACK = "I understand this is not an offer to purchase and doesn't bind me or any owner.";
export const STANDING_NOTICE = 'A member posted standing interest that reaches you: for your ZIP code, your street or your pre-listing. It is not an offer to purchase.';
export const STANDING_AGENT_ERROR = 'Standing interest is for buyers posting for themselves. Agents reach owners through price opinions and proposals.';
export const HOME_CLAIM_ACK = "I own a home on this street. I understand Amico Haus doesn't check this.";
export const STANDING_DAYS = 90; export const MAX_STANDING = 5; export const MAX_HOME_CLAIMS = 2;

export const STANDING_ACK_ERROR = 'Tick the box to post your standing interest.';
export const STANDING_MAX_ERROR = 'You can keep up to 5 standing interests. Withdraw one to post another.';
export const STANDING_AMOUNT_ERROR = 'Enter a whole dollar amount from $50,000 to $50,000,000.';
export const STANDING_REPLY_AGENT_ERROR = "Agents can't reply to standing interest.";
export const STANDING_REPLY_LENGTH_ERROR = 'Write a reply of 1 to 1,000 characters.';
export const STANDING_REPLY_NAME_LINE = 'Replying shows the member your display name and starts a conversation in Messages.';
export const HOME_CLAIM_AGENT_ERROR = 'Home claims are for homeowners.';
export const HOME_CLAIM_ACK_ERROR = 'Tick the box to add your home.';
export const HOME_CLAIM_MAX_ERROR = 'You can add up to 2 homes here. Remove one to add another.';
export const HOME_CLAIM_DUPLICATE_ERROR = 'You already added that street.';
export const UNKNOWN_ZIP_ERROR = "We don't know that ZIP code.";
export const HOME_NOT_FOUND = 'Home not found.';

export const STANDING_MIN_AMOUNT = 50000;
export const STANDING_MAX_AMOUNT = 50000000;
export const STANDING_FINANCING = { cash: 'cash', financed: 'financed', either: 'cash or financed' };
export const STANDING_TIMING = { '3_months': 'within 3 months', '6_months': 'within 6 months', '12_months': 'within 12 months', flexible: 'flexible on timing' };
// The home types a member can name (the trade listing types), or 'Any'. Kept here, not imported from listings.js,
// so this lib has no import cycle with it; tools/neighbors-test.mjs checks the two lists are the same.
export const STANDING_PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];

// A street NAME for an interest or a home claim: optional, at most 60 characters, never a house number, never a
// line about the area or the people in it. { label, key } ('' and '' when none) or { error }.
export function validateStreet(raw) {
  const label = clampString(raw, 60).replace(/\s+/g, ' ');
  if (!label) return { label: '', key: '' };
  // A leading number ("1218 La Vida Ct"), a full address anywhere, a long run of digits, or a number at the end
  // ("La Vida Ct 1218") all read as a house number.
  if (hasHouseNumber(label) || addressProblem(label) || /\d{3,}/.test(label) || /\s#?\d+\s*$/.test(label)) return { error: HOUSE_NUMBER_ERROR };
  if (steeringProblem(label)) return { error: STEERING_ERROR };
  const key = streetKey(label);
  if (!key) return { label: '', key: '' };
  return { label, key };
}

// The terms of a standing interest: fixed choices and one whole-dollar amount. There is no free-text field, and
// unknown keys in the body are ignored. { data } or { error }.
export function validateStandingTerms(body) {
  const b = body || {};
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount < STANDING_MIN_AMOUNT || amount > STANDING_MAX_AMOUNT) return { error: STANDING_AMOUNT_ERROR };
  const propertyType = b.propertyType === undefined || b.propertyType === null || b.propertyType === '' ? 'Any' : b.propertyType;
  if (propertyType !== 'Any' && !STANDING_PROPERTY_TYPES.includes(propertyType)) return { error: 'Pick a home type from the list.' };
  const minBeds = b.minBeds === undefined || b.minBeds === null || b.minBeds === '' ? 0 : Number(b.minBeds);
  if (!Number.isInteger(minBeds) || minBeds < 0 || minBeds > 6) return { error: 'Bedrooms should be a whole number from 0 to 6.' };
  const financing = b.financing === undefined ? 'either' : b.financing;
  if (!Object.hasOwn(STANDING_FINANCING, financing)) return { error: 'Pick cash, financed or either.' };
  const timing = b.timing === undefined ? 'flexible' : b.timing;
  if (!Object.hasOwn(STANDING_TIMING, timing)) return { error: 'Pick a timing from the list.' };
  if (b.ack !== true) return { error: STANDING_ACK_ERROR };
  return { data: { amount, propertyType, minBeds, financing, timing } };
}

// The target: { kind: 'area', zip, street } or { kind: 'pre_listing', id }. { data } or { error }.
export function validateStandingTarget(target) {
  const t = target || {};
  if (t.kind === 'pre_listing') {
    const id = Number(t.id);
    if (!Number.isInteger(id) || id <= 0) return { error: HOME_NOT_FOUND, status: 404 };
    return { data: { kind: 'pre_listing', preListingId: id, zip: '', streetLabel: '', streetKey: '' } };
  }
  if (t.kind !== 'area') return { error: 'Pick a ZIP code or a pre-listing.' };
  if (!validZip(t.zip)) return { error: 'ZIP code should be 5 digits.' };
  const street = validateStreet(t.street);
  if (street.error) return { error: street.error };
  return { data: { kind: 'area', preListingId: null, zip: String(t.zip), streetLabel: street.label, streetKey: street.key } };
}

// "About $850,000 · Condo · 3+ bedrooms · cash or financed · within 6 months". Terms only: nothing about the member.
export function standingLine(row) {
  const parts = [`About $${Number(row.amount).toLocaleString('en-US')}`, row.property_type === 'Any' ? 'Any home type' : row.property_type];
  if (Number(row.min_beds) > 0) parts.push(`${Number(row.min_beds)}+ bedrooms`);
  parts.push(STANDING_FINANCING[row.financing] || STANDING_FINANCING.either, STANDING_TIMING[row.timing] || STANDING_TIMING.flexible);
  return parts.join(' · ');
}

// What the poster's reply note calls the target: the ZIP, the street, or "this pre-listing".
export function standingTargetLabel(row) {
  if (row.target_kind === 'pre_listing') return 'this pre-listing';
  return row.street_label ? `${row.street_label}, ZIP ${row.zip}` : `ZIP ${row.zip}`;
}

export function standingExpiresAt(nowMs = Date.now()) {
  return sqlUtc(nowMs + STANDING_DAYS * 86400e3);
}

/* ---------------- The poster's side ---------------- */

// One read before anything is written. ?1 poster, ?2 now, ?3 ZIP, ?4 street key, ?5 pre-listing id, ?6 demo pattern.
// pl_zip is the pre-listing's ZIP only when the poster may see its teaser: open, owner active and real, not the
// poster's own, no block either way, and not held back by a head start the poster doesn't watch (watchAreas.js).
export async function standingGuard(db, userId, target, nowMs = Date.now()) {
  return db.prepare(
    `SELECT EXISTS (SELECT 1 FROM agent_profiles WHERE user_id = ?1) AS is_agent,
            EXISTS (SELECT 1 FROM zip_codes WHERE zip = ?3) AS zip_known,
            (SELECT COUNT(*) FROM standing_interests WHERE user_id = ?1 AND status = 'active' AND expires_at > ?2) AS active_n,
            (SELECT id FROM standing_interests WHERE user_id = ?1
               AND ((?5 IS NOT NULL AND target_kind = 'pre_listing' AND pre_listing_id = ?5)
                 OR (?5 IS NULL AND target_kind = 'area' AND zip = ?3 AND street_key = ?4))
             ORDER BY id DESC LIMIT 1) AS existing_id,
            (SELECT (status = 'active' AND expires_at > ?2) FROM standing_interests WHERE user_id = ?1
               AND ((?5 IS NOT NULL AND target_kind = 'pre_listing' AND pre_listing_id = ?5)
                 OR (?5 IS NULL AND target_kind = 'area' AND zip = ?3 AND street_key = ?4))
             ORDER BY id DESC LIMIT 1) AS existing_live,
            (SELECT pre_listings.zip FROM pre_listings JOIN users o ON o.id = pre_listings.user_id
             WHERE pre_listings.id = ?5 AND pre_listings.status = 'open' AND o.status = 'active' AND o.email NOT LIKE ?6
               AND pre_listings.user_id != ?1 AND ${notBlockedSql('pre_listings.user_id', '?1')}
               AND ${headStartTeaserSql('?1')}) AS pl_zip`
  ).bind(userId, sqlUtc(nowMs), target.zip, target.streetKey, target.preListingId, DEMO_EMAIL_PATTERN).first();
}

// Tells the owners the interest reaches (ONE statement, in-app only). A ZIP interest: home claims in the ZIP, and
// owners of open pre-listings and of active trade listings there (not rentals, not buyer profiles). A street
// interest: only that street's claims. A pre-listing interest: that owner. Left out: the poster, suspended and demo
// accounts, anyone with an agent profile, blocked pairs, and anyone who got one of these notices in the last 24
// hours. A poster who has an agent profile tells nobody. While the tool is admin-only (nuancedGate.js) only admins are told. Returns how many notices were written.
export async function notifyStandingOwners(db, env, interest) {
  // ?4 ZIP, ?5 street key ('' = the whole ZIP), ?6 pre-listing id (NULL for a ZIP or street interest). Three terms.
  const reach = `SELECT hc.user_id AS uid FROM home_claims hc WHERE ?6 IS NULL AND hc.zip = ?4 AND (?5 = '' OR hc.street_key = ?5)
       UNION SELECT p.user_id FROM pre_listings p WHERE (?6 IS NOT NULL AND p.id = ?6) OR (?6 IS NULL AND ?5 = '' AND p.zip = ?4 AND p.status = 'open')
       UNION SELECT l.user_id FROM listings l WHERE ?6 IS NULL AND ?5 = '' AND l.zip = ?4 AND l.status = 'active' AND l.is_rental = 0 AND l.is_buyer_only = 0`;
  const result = await db.prepare(
    `INSERT INTO notifications (user_id, type, body, link)
     SELECT t.uid, 'standing_interest', ?1, '/app#standing-interests' FROM (${reach}) t JOIN users u ON u.id = t.uid
     WHERE t.uid != ?2 AND u.status = 'active' AND u.email NOT LIKE ?3
       AND EXISTS (SELECT 1 FROM users me WHERE me.id = ?2 AND me.status = 'active' AND me.email NOT LIKE ?3
                     AND NOT EXISTS (SELECT 1 FROM agent_profiles pa WHERE pa.user_id = me.id))
       AND NOT EXISTS (SELECT 1 FROM agent_profiles ap WHERE ap.user_id = t.uid)
       AND ${notBlockedSql('t.uid', '?2')}
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = t.uid AND n.type = 'standing_interest' AND n.created_at > datetime('now', '-1 day'))
       AND (?7 = 1 OR u.role = 'admin')
     LIMIT 500`
  ).bind(STANDING_NOTICE, interest.userId, DEMO_EMAIL_PATTERN, interest.zip || '', interest.streetKey || '', interest.preListingId || null,
    toolLive(env, 'standingOffer', null) ? 1 : 0).run();
  return (result.meta && result.meta.changes) || 0;
}

// The poster's own interests (active ones; an expired one stays listed so it can be renewed). One statement.
export async function fetchMyStandingInterests(db, userId, nowMs = Date.now()) {
  const now = sqlUtc(nowMs);
  const rows = await db.prepare(
    `SELECT id, target_kind, zip, street_label, pre_listing_id, amount, property_type, min_beds, financing, timing, expires_at, created_at
     FROM standing_interests WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC, id DESC LIMIT 20`
  ).bind(userId).all();
  return (rows.results || []).map(r => ({
    id: r.id,
    target: r.target_kind === 'pre_listing' ? { kind: 'pre_listing', id: r.pre_listing_id } : { kind: 'area', zip: r.zip, street: r.street_label },
    amount: r.amount, propertyType: r.property_type, minBeds: r.min_beds, financing: r.financing, timing: r.timing,
    line: standingLine(r), label: STANDING_LABEL,
    expiresAt: r.expires_at, expired: r.expires_at <= now, postedAt: r.created_at,
  }));
}

/* ---------------- The owner's side ---------------- */

// Active, unexpired interests that reach the viewer (?1; ?2 = now; ?3 = demo pattern): pre-listing targets on the
// viewer's own pre-listings; ZIP interests where the viewer has a home claim, an open pre-listing or an active trade
// listing in that ZIP; street interests only where the viewer claimed that street. Left out: blocked pairs,
// suspended or demo posters, posters who have an agent profile (one made after posting counts too), the viewer's own. oneId: also "AND si.id = ?4" (the reply check).
function reachSql({ oneId = false, forAgents = false } = {}) {
  return `SELECT si.id, si.user_id AS poster_id, si.target_kind, si.zip, si.street_label, si.street_key, si.pre_listing_id,
            si.amount, si.property_type, si.min_beds, si.financing, si.timing, si.created_at,
            CASE WHEN si.target_kind = 'pre_listing' THEN 'home' WHEN si.street_key != '' THEN 'street' ELSE 'zip' END AS reach,
            NOT EXISTS (SELECT 1 FROM user_action_log a WHERE a.user_id = ?1 AND a.kind = 'interest_reply' AND a.ref = 'standing_interest:' || si.id) AS can_reply,
            EXISTS (SELECT 1 FROM agent_profiles ap WHERE ap.user_id = ?1) AS viewer_is_agent
     FROM standing_interests si JOIN users u ON u.id = si.user_id
     WHERE si.status = 'active' AND si.expires_at > ?2 AND si.user_id != ?1 AND u.status = 'active' AND u.email NOT LIKE ?3
       AND NOT EXISTS (SELECT 1 FROM agent_profiles pa WHERE pa.user_id = si.user_id)
       AND ${notBlockedSql('si.user_id', '?1')}
       ${forAgents ? '' : 'AND NOT EXISTS (SELECT 1 FROM agent_profiles ap2 WHERE ap2.user_id = ?1)'}
       AND ((si.target_kind = 'pre_listing' AND EXISTS (SELECT 1 FROM pre_listings p WHERE p.id = si.pre_listing_id AND p.user_id = ?1))
         OR (si.target_kind = 'area' AND si.street_key != '' AND EXISTS (SELECT 1 FROM home_claims hc WHERE hc.user_id = ?1 AND hc.zip = si.zip AND hc.street_key = si.street_key))
         OR (si.target_kind = 'area' AND si.street_key = '' AND (
               EXISTS (SELECT 1 FROM home_claims hc WHERE hc.user_id = ?1 AND hc.zip = si.zip)
            OR EXISTS (SELECT 1 FROM pre_listings p WHERE p.user_id = ?1 AND p.zip = si.zip AND p.status = 'open')
            OR EXISTS (SELECT 1 FROM listings l WHERE l.user_id = ?1 AND l.zip = si.zip AND l.status = 'active' AND l.is_rental = 0 AND l.is_buyer_only = 0))))
       ${oneId ? 'AND si.id = ?4' : ''}
     ORDER BY si.created_at DESC, si.id DESC LIMIT ${oneId ? 1 : 50}`;
}

// What an owner sees of one interest: the terms and how it reaches them. Never the poster's name, id, profile link,
// photo or anything else about them; where is the owner's own area, never text the poster typed.
function ownerItem(r) {
  return {
    id: r.id, reach: r.reach,
    where: r.reach === 'home' ? 'Your pre-listing' : r.reach === 'street' ? `Your street in ZIP ${r.zip}` : `ZIP ${r.zip}`,
    amount: r.amount, propertyType: r.property_type, minBeds: r.min_beds, financing: r.financing, timing: r.timing,
    line: standingLine(r), label: STANDING_LABEL,
    postedAt: r.created_at, canReply: !!r.can_reply,
  };
}

// Newest first (never by amount), at most 50. An account with an agent profile gets an empty list. One statement.
export async function fetchReachingInterests(db, userId, nowMs = Date.now()) {
  const rows = await db.prepare(reachSql()).bind(userId, sqlUtc(nowMs), DEMO_EMAIL_PATTERN).all();
  return (rows.results || []).map(ownerItem);
}

// The reply check: the one interest, only if it reaches this viewer. Returns the row (with poster_id and
// viewer_is_agent, for the route only) or null. One statement.
export async function fetchReachingInterest(db, userId, interestId, nowMs = Date.now()) {
  return db.prepare(reachSql({ oneId: true, forAgents: true })).bind(userId, sqlUtc(nowMs), DEMO_EMAIL_PATTERN, interestId).first();
}

/* ---------------- Home claims ---------------- */

// A homeowner's own unchecked note of where their home is, so interest for that street or ZIP reaches them. It shows
// nowhere, grants nothing but those notices, and is never called verified.
export async function fetchHomeClaims(db, userId) {
  const rows = await db.prepare('SELECT id, zip, street_label FROM home_claims WHERE user_id = ? ORDER BY created_at ASC, id ASC').bind(userId).all();
  return (rows.results || []).map(r => ({ id: r.id, zip: r.zip, street: r.street_label }));
}

// One read before a claim is written: ?1 the person, ?2 the ZIP, ?3 the street key.
export async function homeClaimGuard(db, userId, zip, key) {
  return db.prepare(
    `SELECT EXISTS (SELECT 1 FROM agent_profiles WHERE user_id = ?1) AS is_agent,
            EXISTS (SELECT 1 FROM zip_codes WHERE zip = ?2) AS zip_known,
            (SELECT COUNT(*) FROM home_claims WHERE user_id = ?1) AS claim_n,
            EXISTS (SELECT 1 FROM home_claims WHERE user_id = ?1 AND zip = ?2 AND street_key = ?3) AS dup`
  ).bind(userId, zip, key).first();
}
