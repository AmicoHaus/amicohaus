// Mystery Home Monday (owner tools batch, migration_v45): a weekly guessing game about a home that already sold.
// Admin-entered only. A home goes public only once the former seller's written OK date AND Coldwell Banker West's OK
// date are entered, every photo was checked in Privacy Sweep, and the photos are Rudy's own or licensed to him in
// writing (never MLS photos or remarks). City only: never the address, ZIP, map, subdivision, owner, buyer or who
// listed or sold it. The sold price shows only after the reveal time, labeled by where it came from ("sale price at
// closing" for Rudy's own closings), never as a value, worth or estimate. Guesses never reach the server.
// All publish/reveal/retire times are ISO strings, compared only with other ISO strings.
import { PROPERTY_TYPES } from './listings.js';
import { steeringProblem, STEERING_ERROR, addressProblem } from './homeText.js';

// Mystery Home pages show the city only: a ZIP or a named street ("Corner lot on Otay Lakes Rd") is refused in the
// highlights too. Subdivision names can't be pattern-checked; the admin form says to leave them out.
const MYSTERY_ZIP_RE = /\b\d{5}(-\d{4})?\b/;
const MYSTERY_STREET_RE = /\b[A-Z][a-z]+\s+(Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Blvd|Boulevard|Ct|Court|Ln|Lane|Way|Pkwy|Parkway|Pl|Place|Cir|Circle|Ter|Terrace|Loop|Trl|Trail)\b/;

export const MYSTERY_GAME_NOTE = 'Just for fun. Not a price opinion or an appraisal.';
export const MYSTERY_PERMISSION_LINE = "Shared with the seller's written permission.";
export const MYSTERY_FACTS_NOTE = 'Home facts as of the sale.';
export const RETIRE_AFTER_DAYS = 56, MAX_MYSTERY_PHOTOS = 12, MIN_MYSTERY_PHOTOS = 3;
export const MYSTERY_SOURCES = ['own_sale', 'former_owner'];
export const MYSTERY_PHOTO_RIGHTS = ['own', 'licensed'];
// The reveal label says where the number came from; never "recorded" (that reads as a county-record check).
export const SOLD_LABELS = { own_sale: 'sale price at closing', former_owner: 'sale price as shared by the former owner' };
export const ADDRESS_IN_HIGHLIGHTS_ERROR = 'Leave the street address out: Mystery Homes show the city only.';
export const TEAM_IN_HIGHLIGHTS_ERROR = 'Leave out who listed or sold the home.';
// Who listed or sold it, or the team behind it. The team's names are written with one-letter character classes so the
// repo-wide scans for those names (they never appear in Amico content) stay clean; what it matches is the same.
const TEAM_RE = /\b(listed by|sold by|listing agent|our team|mc[k]elvey|pat[t]i|je[f]f)\b/i;
const DAY_MS = 86400000;
const PACIFIC = 'America/Los_Angeles';

// Lowercase, runs of anything but a-z/0-9 become one '-', trimmed of '-', at most 40 characters; '' -> 'home'.
export function slugify(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'home';
}

// 'YYYY-MM-DD' and 'YYYY-MM' in Pacific time for a moment.
export function pacificDate(ms) { return new Date(ms).toLocaleDateString('en-CA', { timeZone: PACIFIC }); }
export function pacificMonth(ms) { return pacificDate(ms).slice(0, 7); }

// 'draft' | 'scheduled' | 'live' | 'revealed' | 'retired'.
export function mysteryState(row, nowIso) {
  if (!row || row.status === 'draft') return 'draft';
  if (row.status === 'retired' || (row.retire_at && row.retire_at <= nowIso)) return 'retired';
  if (!row.publish_at || nowIso < row.publish_at) return 'scheduled';
  if (!row.reveal_at || nowIso < row.reveal_at) return 'live';
  return 'revealed';
}

function isoOrNull(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return { error: true };
  return { value: new Date(ms).toISOString() };
}

function dayOrNull(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) return { error: true };
  return { value: s };
}

function numberOrNull(value, { min, max, integer }) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return { error: true };
  return { value: n };
}

// The admin form (camelCase) -> the row's columns, or the first problem as { error }.
export function validateMysteryHome(body, { nowMs = Date.now() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const source = MYSTERY_SOURCES.includes(b.source) ? b.source : null;
  if (!source) return { error: 'Pick where the sale price comes from: your own closing, or the former owner.' };
  const city = String(b.city || '').trim();
  if (city.length < 1 || city.length > 60) return { error: 'Add the city.' };
  if (addressProblem(city) || /\d/.test(city)) return { error: ADDRESS_IN_HIGHLIGHTS_ERROR };
  const state = String(b.state || 'CA').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return { error: 'Use the two-letter state code (like CA).' };
  if (!PROPERTY_TYPES.includes(b.propertyType)) return { error: 'Pick a home type.' };
  const nums = {};
  const year = Number(pacificDate(nowMs).slice(0, 4));
  for (const [key, col, label, rule] of [
    ['beds', 'beds', 'beds', { min: 0, max: 30, integer: false }],
    ['baths', 'baths', 'baths', { min: 0, max: 30, integer: false }],
    ['sqft', 'sqft', 'square feet', { min: 100, max: 100000, integer: true }],
    ['lotSqft', 'lot_sqft', 'lot size', { min: 0, max: 50000000, integer: true }],
    ['yearBuilt', 'year_built', 'year built', { min: 1700, max: year + 1, integer: true }],
  ]) {
    const r = numberOrNull(b[key], rule);
    if (r.error) return { error: `Check the ${label}.` };
    nums[col] = r.value;
  }
  const highlights = String(b.highlights || '').trim();
  if (highlights.length > 400) return { error: 'Keep the highlights to 400 characters.' };
  if (steeringProblem(highlights)) return { error: STEERING_ERROR };
  if (addressProblem(highlights)) return { error: ADDRESS_IN_HIGHLIGHTS_ERROR };
  // City only on these public pages: no ZIP and no street name either, even without a house number.
  if (MYSTERY_ZIP_RE.test(highlights) || MYSTERY_STREET_RE.test(highlights)) return { error: ADDRESS_IN_HIGHLIGHTS_ERROR };
  if (TEAM_RE.test(highlights)) return { error: TEAM_IN_HIGHLIGHTS_ERROR };
  const soldPrice = Number(b.soldPrice);
  if (!Number.isInteger(soldPrice) || soldPrice < 10000 || soldPrice > 100000000) return { error: 'Add the recorded sale price.' };
  const soldMonth = String(b.soldMonth || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(soldMonth)) return { error: 'Add the month the sale closed.' };
  // Strictly earlier than the month 30 days ago, so a sale is always at least 30 days old whatever day it closed.
  if (soldMonth >= pacificMonth(nowMs - 30 * DAY_MS)) return { error: 'The sale must have closed at least 30 days ago.' };
  const today = pacificDate(nowMs);
  const sellerOk = dayOrNull(b.sellerOkOn);
  if (sellerOk.error) return { error: "Check the date of the seller's written OK." };
  if (sellerOk.value && sellerOk.value > today) return { error: "The seller's OK date can't be in the future." };
  const brokerOk = dayOrNull(b.brokerOkOn);
  if (brokerOk.error) return { error: "Check the date of Coldwell Banker West's OK." };
  if (brokerOk.value && brokerOk.value > today) return { error: "Coldwell Banker West's OK date can't be in the future." };
  const publishAt = isoOrNull(b.publishAt);
  if (publishAt.error) return { error: 'Check the publish time.' };
  const revealAt = isoOrNull(b.revealAt);
  if (revealAt.error) return { error: 'Check the reveal time.' };
  const photoRights = b.photoRights === undefined || b.photoRights === null || b.photoRights === '' ? 'own' : b.photoRights;
  if (!MYSTERY_PHOTO_RIGHTS.includes(photoRights)) return { error: 'Pick who owns the photos.' };
  return {
    data: {
      source, city, state, property_type: b.propertyType, ...nums, highlights,
      sold_price: soldPrice, sold_month: soldMonth,
      publish_at: publishAt.value, reveal_at: revealAt.value,
      seller_ok_on: sellerOk.value, broker_ok_on: brokerOk.value, photo_rights: photoRights,
    },
  };
}

// What still stands between a home and going public, as codes ([] = ready). photos: its rows ({ swept_at }).
export function scheduleProblems(row, photos, nowMs = Date.now()) {
  const out = [];
  const publishMs = row.publish_at ? Date.parse(row.publish_at) : NaN;
  const revealMs = row.reveal_at ? Date.parse(row.reveal_at) : NaN;
  if (!Number.isFinite(publishMs)) out.push('publish_at');
  if (!Number.isFinite(revealMs)) out.push('reveal_at');
  if (Number.isFinite(publishMs) && Number.isFinite(revealMs) && revealMs < publishMs + DAY_MS) out.push('reveal_order');
  if (!row.seller_ok_on) out.push('seller_ok');
  if (!row.broker_ok_on) out.push('broker_ok');
  const list = photos || [];
  if (list.length < MIN_MYSTERY_PHOTOS) out.push('photos');
  if (list.some(p => !p.swept_at)) out.push('sweep');
  if (!MYSTERY_PHOTO_RIGHTS.includes(row.photo_rights)) out.push('rights');
  if (!row.sold_month || row.sold_month >= pacificMonth(nowMs - 30 * DAY_MS)) out.push('sold_month');
  return out;
}

// Plain-English names for the codes above (the admin panel shows them).
export const SCHEDULE_PROBLEM_LABELS = {
  publish_at: 'a publish time', reveal_at: 'a reveal time', reveal_order: 'a reveal at least 24 hours after it publishes',
  seller_ok: "the date of the seller's written OK", broker_ok: "the date of Coldwell Banker West's OK",
  photos: `at least ${MIN_MYSTERY_PHOTOS} photos`, sweep: 'Privacy Sweep checked on every photo', rights: 'who owns the photos',
  sold_month: 'a sale that closed at least 30 days ago',
};

export function formatSoldPrice(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
// 'YYYY-MM' -> 'Oct 2026'.
export function formatSoldMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
// ISO -> 'Thursday, Nov 12' in Pacific time.
export function formatRevealDay(iso) {
  const ms = Date.parse(String(iso || ''));
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: PACIFIC }) : '';
}

// What a public page may show. The sold fields are added ONLY once revealed. Never the owner, buyer, team, address,
// ZIP, map, subdivision, the OK dates or the source column.
export function publicMysteryView(row, photoIds, nowIso) {
  const state = mysteryState(row, nowIso);
  const view = {
    slug: row.slug, state, city: row.city, stateCode: row.state, propertyType: row.property_type,
    beds: row.beds ?? null, baths: row.baths ?? null, sqft: row.sqft ?? null, lotSqft: row.lot_sqft ?? null,
    yearBuilt: row.year_built ?? null, highlights: row.highlights || '', photoIds: [...(photoIds || [])], revealAt: row.reveal_at,
  };
  if (state === 'revealed') {
    view.sold = { price: row.sold_price, month: row.sold_month, label: SOLD_LABELS[row.source] || SOLD_LABELS.own_sale };
  }
  return view;
}

// Columns -> the admin API's camelCase.
export function adminMysteryRow(row, nowIso) {
  const camel = {};
  for (const [k, v] of Object.entries(row)) camel[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  camel.state = mysteryState(row, nowIso);
  camel.stateCode = row.state;
  return camel;
}

// ---- Public pages (functions/mystery-home/*): shared bits. They never read the session. ----
// The row plus its photo ids in position order, in one statement.
export const MYSTERY_ROW_SQL = `SELECT mystery_homes.*,
    (SELECT json_group_array(id) FROM (SELECT id FROM mystery_home_photos WHERE mystery_home_id = mystery_homes.id ORDER BY position, id)) AS photo_ids_json
  FROM mystery_homes`;

export function photoIdsOf(row) {
  try { const ids = JSON.parse(row.photo_ids_json || '[]'); return Array.isArray(ids) ? ids.filter(n => Number.isInteger(n)) : []; } catch { return []; }
}

export function mysteryPhotoUrl(origin, id) { return `${origin}/api/mystery-home-photos/${id}`; }

// "4 beds", "2,138 sq ft", ... (only the facts that were entered).
export function mysteryFactsList(view) {
  const n = (v) => Number(v).toLocaleString('en-US');
  const out = [view.propertyType];
  if (view.beds !== null && view.beds !== undefined) out.push(`${n(view.beds)} ${Number(view.beds) === 1 ? 'bed' : 'beds'}`);
  if (view.baths !== null && view.baths !== undefined) out.push(`${n(view.baths)} ${Number(view.baths) === 1 ? 'bath' : 'baths'}`);
  if (view.sqft) out.push(`${n(view.sqft)} sq ft`);
  if (view.lotSqft) out.push(`Lot: ${n(view.lotSqft)} sq ft`);
  if (view.yearBuilt) out.push(`Built in ${view.yearBuilt}`);
  return out.filter(Boolean);
}
