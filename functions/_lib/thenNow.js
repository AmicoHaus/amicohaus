// Then & Now (owner tools batch, migration_v45): the owner's own dated list of work done on their home, and up to 4
// photo pairs (an old photo next to today's). Owner-reported, never a disclosure, and never a number about the home:
// there is no cost field at all, and nothing here says what work is "worth". Permit answers (Yes / No / Not sure) go
// only to the owner, the agent they hired and agents they shared their contact info with (not admins: the privacy
// page promises exactly those three). Notes and captions run the shared fair-housing and address checks (homeText.js).
import { steeringProblem, STEERING_ERROR, addressProblem, ADDRESS_ERROR } from './homeText.js';
import { pacificToday } from './timingMatch.js';
import { getSessionUser } from './auth.js';
import { json, forbidden, notFound, unauthorized } from './util.js';
import { preListingAccess } from './visibility.js';

export const UPGRADE_CATEGORIES = { roof: 'Roof', solar: 'Solar', heating_cooling: 'Heating and cooling', water_heater: 'Water heater',
  windows_doors: 'Windows and doors', kitchen: 'Kitchen', bathroom: 'Bathroom', flooring: 'Flooring', paint: 'Paint',
  electrical: 'Electrical', plumbing: 'Plumbing', insulation: 'Insulation', yard: 'Yard and landscaping',
  patio_fence_driveway: 'Patio, fence or driveway', pool_spa: 'Pool or spa', garage: 'Garage', added_space: 'Added space', other: 'Other' };
export const PERMIT_ANSWERS = { yes: 'Yes', no: 'No', not_sure: 'Not sure' };
export const OWNER_REPORTED_LABEL = "Owner-reported, not a disclosure. It doesn't replace your seller disclosures (like the TDS and SPQ).";
export const OWNER_REPORTED_LABEL_AGENT = "Owner-reported, not a disclosure. It doesn't replace the seller's disclosures (like the TDS and SPQ).";
export const PERMIT_ASK_AGENT = 'Ask your agent how this gets disclosed.';
export const MAX_UPGRADES = 20, MAX_PAIRS = 4;
export const NOTE_MAX = 120, CAPTION_MAX = 80;
const FIRST_YEAR = 1900;

export const UPGRADE_CAP_ERROR = `A home can have up to ${MAX_UPGRADES} upgrades.`;
export const PAIR_CAP_ERROR = `A home can have up to ${MAX_PAIRS} photo pairs.`;
export const RIGHTS_ERROR = 'Please confirm you took these photos or have permission to use them.';

// Same file rules and messages as pre-listing photos (photos/index.js).
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export function photoProblem(file) {
  if (!file || typeof file === 'string') return 'Add a then photo and a now photo.';
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return 'Photos must be JPEG, PNG, WEBP, or GIF.';
  if (file.size > MAX_PHOTO_BYTES) return 'Photo must be under 5MB.';
  return null;
}

export const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
// A closed pre-listing is read-only here (owners add and edit while it's open or awarded).
export function closedResponse() {
  return json({ error: "This pre-listing is closed, so its Then & Now can't change.", code: 'closed' }, { status: 409, ...NO_STORE });
}

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const currentYear = (nowMs) => Number(pacificToday(nowMs).slice(0, 4));

// A year from 1900 to this year (Pacific), or null when left blank. Returns undefined when it's not a valid year.
function yearOrNull(v, nowMs) {
  if (blank(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= FIRST_YEAR && n <= currentYear(nowMs) ? n : undefined;
}

// Text about the home: trimmed, capped, no fair-housing steering and no street address. -> { text } | { error }
function homeText(v, max, tooLong) {
  const text = String(v ?? '').trim();
  if (text.length > max) return { error: tooLong };
  if (steeringProblem(text)) return { error: STEERING_ERROR };
  if (addressProblem(text)) return { error: ADDRESS_ERROR };
  return { text };
}

// One upgrade from the owner's form -> { data } | { error }. Only these five fields are read: a `cost` (or any other
// key) is ignored, and there's no column for one.
export function validateUpgrade(body, { nowMs = Date.now() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const category = String(b.category ?? '');
  if (!Object.prototype.hasOwnProperty.call(UPGRADE_CATEGORIES, category)) return { error: 'Pick a category.' };
  const doneYear = yearOrNull(b.doneYear, nowMs);
  if (!doneYear) return { error: 'Add the year the work was done.' };
  let doneMonth = null;
  if (!blank(b.doneMonth)) {
    doneMonth = Number(b.doneMonth);
    if (!Number.isInteger(doneMonth) || doneMonth < 1 || doneMonth > 12) return { error: 'Pick a month, or leave it blank.' };
  }
  const note = homeText(b.note, NOTE_MAX, `Keep the note to ${NOTE_MAX} characters or fewer.`);
  if (note.error) return { error: note.error };
  let permit = null;
  if (!blank(b.permit)) {
    permit = String(b.permit);
    if (!Object.prototype.hasOwnProperty.call(PERMIT_ANSWERS, permit)) return { error: 'Pick Yes, No or Not sure for the permit question, or leave it unanswered.' };
  }
  return { data: { category, doneYear, doneMonth, note: note.text, permit } };
}

// The text fields sent with a photo pair -> { data: { caption, thenYear, upgradeId } } | { error }.
export function validatePairFields({ caption, thenYear, upgradeId } = {}, { nowMs = Date.now() } = {}) {
  const c = homeText(caption, CAPTION_MAX, `Keep the caption to ${CAPTION_MAX} characters or fewer.`);
  if (c.error) return { error: c.error };
  const year = yearOrNull(thenYear, nowMs);
  if (year === undefined) return { error: 'Add the year of the old photo, or leave it blank.' };
  let upgrade = null;
  if (!blank(upgradeId)) {
    upgrade = Number(upgradeId);
    if (!Number.isInteger(upgrade) || upgrade <= 0) return { error: "That upgrade isn't on this home." };
  }
  return { data: { caption: c.text, thenYear: year, upgradeId: upgrade } };
}

// Permit answers: the owner, the hired agent (the service_bids row of row.awarded_bid_id) or an agent the owner shared
// contact info with. Unlike the notes for agents, an admin does NOT see them (moderation never needs them); the
// operator account sees them only the way any agent would. isAdmin and isApprovedAgent are accepted and not used:
// being an admin never opens them, and access (visibility.js) already decided who may open the home. One statement
// for anyone but the owner.
export async function canSeePermits(db, row, user, { isOwner, isAdmin, isApprovedAgent } = {}) {
  if (isOwner) return true;
  if (!user) return false;
  const hit = await db.prepare(
    `SELECT 1 AS yes WHERE
       EXISTS (SELECT 1 FROM service_bids WHERE id = ?1 AND agent_user_id = ?3)
       OR EXISTS (SELECT 1 FROM contact_shares WHERE pre_listing_id = ?2 AND agent_id = ?3)`
  ).bind(row.awarded_bid_id || 0, row.id, user.id).first();
  return !!hit;
}

// The list and the pairs for one viewer, in the owner's order (2 statements, one batch).
// upgrades: { id, category, label, doneYear, doneMonth, note, permit? } (permit only when showPermits)
// pairs: { id, upgradeId, caption, thenYear, sweptDone? } (sweptDone only for the owner). Storage keys never leave here.
export async function fetchThenNow(db, preListingId, { isOwner = false, showPermits = false } = {}) {
  const [u, p] = await db.batch([
    db.prepare(
      `SELECT id, category, done_year, done_month, note, permit FROM pre_listing_upgrades
       WHERE pre_listing_id = ? ORDER BY position ASC, id ASC`
    ).bind(preListingId),
    db.prepare(
      `SELECT id, upgrade_id, caption, then_year, swept_at FROM pre_listing_then_now
       WHERE pre_listing_id = ? ORDER BY position ASC, id ASC`
    ).bind(preListingId),
  ]);
  const upgrades = (u.results || []).map(r => {
    const out = {
      id: r.id, category: r.category, label: UPGRADE_CATEGORIES[r.category] || UPGRADE_CATEGORIES.other,
      doneYear: r.done_year, doneMonth: r.done_month ?? null, note: r.note || '',
    };
    if (showPermits) out.permit = r.permit ?? null;
    return out;
  });
  const pairs = (p.results || []).map(r => {
    const out = { id: r.id, upgradeId: r.upgrade_id ?? null, caption: r.caption || '', thenYear: r.then_year ?? null };
    if (isOwner) out.sweptDone = !!r.swept_at;
    return out;
  });
  return { upgrades, pairs };
}

// The owner-only write gate shared by the upgrade and pair endpoints. -> { row } | { response }
export async function ownerHomeForWrite(db, preListingId, user, { allowClosed = false } = {}) {
  const row = await db.prepare('SELECT id, user_id, status FROM pre_listings WHERE id = ?').bind(preListingId).first();
  if (!row) return { response: notFound('Pre-listing not found.') };
  if (row.user_id !== user.id) return { response: forbidden() };
  if (!allowClosed && row.status === 'closed') return { response: closedResponse() };
  return { row };
}

// GET /api/then-now-photos/:pairId/then and /now: the file, for the same people who can open the pre-listing
// (visibility.js). Anyone else gets a 404 (the teaser viewer too), never a hint that it exists. which: 'then' | 'now'.
export async function serveThenNowPhoto(context, which) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const col = which === 'then' ? 'then' : 'now'; // fixed column names, never from the request
  const photo = await db.prepare(
    `SELECT t.${col}_r2_key AS r2_key, t.${col}_content_type AS content_type, p.id, p.user_id, p.status
     FROM pre_listing_then_now t JOIN pre_listings p ON p.id = t.pre_listing_id WHERE t.id = ?`
  ).bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');
  const { access } = await preListingAccess(db, user, photo);
  if (access !== 'ok') return notFound('Photo not found.');
  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');
  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');
  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private, max-age=3600' },
  });
}
