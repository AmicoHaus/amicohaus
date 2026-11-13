// Neighbors First (nuanced ideas batch, migration_v47): watch areas (whole ZIP codes, up to 3 per member; any member
// can watch any ZIP, never tied to where they live) and the head start an owner can give the members who watch
// their home's ZIP (listings.head_start_until, pre_listings.head_start_until). In-app notices only: no email, no push.
//
// Precision, said honestly: the site holds no coordinates for any home, only ZIP codes, so a watch area is one whole
// ZIP code. Nothing here names a distance, and nothing asks where a member lives.
//
// Head start, trade listing: stored status = 'paused' with head_start_until, so every public surface hides it by the
// rules that already hide a paused listing; members who watch its ZIP see it through GET /api/watch-areas/early.
// Head start, pre-listing: approved agents see it as always; only the member teaser waits (headStartTeaserSql).
import { DEMO_EMAIL_PATTERN, REVIEW_SAMPLE_EMAIL } from './util.js';
import { sqlUtc } from './contactPolicy.js';
import { notBlockedSql } from './blocks.js';
import { validZip } from './ideaText.js';
import { toolLive } from './nuancedGate.js';
import { allUnionAll } from './compoundSelect.js';
import { PACIFIC } from './pacificTime.js';
import { announceNewListing } from './listings.js';
import * as openForLib from './openFor.js';
import * as dealOutlinesLib from './dealOutlines.js';

export const MAX_WATCH_AREAS = 3;
export const HEAD_START_HOURS = [24, 72, 168];          // 24 hours (default), 3 days, 7 days
export const WATCH_PRECISION_LINE = 'For now a watch area is a whole ZIP code.';
export const WATCH_OPEN_LINE = "Anyone with an account can watch any ZIP code. You don't have to live there.";
export const HEAD_START_NO_AGREEMENT = "I haven't signed a listing agreement for this home.";
export const HEAD_START_AGENT_LINE = 'Working with an agent? Their MLS rules decide the timing: once a home with a listing agreement is marketed to the public, MLS rules generally give the agent one business day to put it on the MLS (the Clear Cooperation rule). Ask your agent before using a head start.';
export const HEAD_START_AGENT_ERROR = 'A head start is for owners posting their own home before they hire an agent.';
export const HEAD_START_ZIP_ERROR = 'Add your ZIP code to use a head start.';
export const HEAD_START_TICK_ERROR = "Tick the box to confirm you haven't signed a listing agreement for this home.";
export const HEAD_START_HOURS_ERROR = 'Pick 24 hours, 3 days or 7 days for the head start.';
export const UNKNOWN_ZIP_ERROR = "We don't know that ZIP code.";
export const WATCH_DUPLICATE_ERROR = 'You already watch that ZIP code.';
export const WATCH_MAX_ERROR = 'You can watch up to 3 ZIP codes. Remove one to add another.';
// The "Neighbors first" idea card (ideaCards.js, key first), word for word.
export const WATCH_CARD_LINES = [
  "Watch up to 3 ZIP codes and see what's new there in one place. When an owner chooses a head start, members who watch that ZIP code see the home before everyone else.",
  WATCH_OPEN_LINE,
  WATCH_PRECISION_LINE,
];
// The head-start field's help line on a listing or pre-listing form (neighbors.js prints the same words).
export const HEAD_START_HELP = `During the head start only members who watch your ZIP code see your home. ${WATCH_OPEN_LINE} After it, your home opens to everyone by itself, and you can open it sooner.`;
// A member gets at most this many 'nearby' notices a day (the rest are still in their panel).
export const NEARBY_NOTICES_PER_DAY = 3;

// input = { hours, noAgreement }. { data: { hours } } (0 = no head start) or { error }. agentPosted: the listing has
// a client name, or the poster is an approved agent (their MLS rules decide the timing, not this site).
export function validateHeadStart(input, { agentPosted = false, zip = '' } = {}) {
  const hours = Number(input && input.hours) || 0;
  if (!hours) return { data: { hours: 0 } };
  if (!HEAD_START_HOURS.includes(hours)) return { error: HEAD_START_HOURS_ERROR };
  if (agentPosted) return { error: HEAD_START_AGENT_ERROR };
  if (!validZip(zip)) return { error: HEAD_START_ZIP_ERROR };
  if (input.noAgreement !== true) return { error: HEAD_START_TICK_ERROR };
  return { data: { hours } };
}

// When a head start of that many hours ends, as datetime('now')-style text, or null.
export function headStartUntil(hours, nowMs = Date.now()) {
  const h = Number(hours) || 0;
  return HEAD_START_HOURS.includes(h) ? sqlUtc(nowMs + h * 3600e3) : null;
}

// Whether a listings or pre_listings row is in its head start at nowMs.
export function inHeadStart(row, nowMs = Date.now()) {
  return !!row && !!row.head_start_until && row.head_start_until > sqlUtc(nowMs);
}

// "Sat, Nov 14, 1:00 PM" (Pacific) for a head_start_until value; the caller adds "Pacific time".
export function headStartLabel(until) {
  const d = new Date(String(until || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { timeZone: PACIFIC, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ');
}

// SQL condition for the pre-listing teaser other members get (viewerParam: the bound viewer id, e.g. '?1'): no
// head start, or it has ended, or the viewer owns the home or watches its ZIP. Compared at read time, so no job.
export function headStartTeaserSql(viewerParam) {
  return `(pre_listings.head_start_until IS NULL OR pre_listings.head_start_until <= datetime('now') OR pre_listings.user_id = ${viewerParam} OR EXISTS (SELECT 1 FROM watch_areas wa WHERE wa.user_id = ${viewerParam} AND wa.zip = pre_listings.zip))`;
}

// The notice's words: the ZIP and the time, nothing else about the home (no price, type, street or owner name).
export function nearbyNoticeBody(kind, zip, until) {
  return `Neighbors First: a ${kind === 'listing' ? 'home' : 'pre-listing'} in ZIP ${zip} is open to members who watch that ZIP code before everyone else, until ${headStartLabel(until)} Pacific time.`;
}

// Tells the members who watch the home's ZIP (ONE statement, in-app only). home = { kind, id, ownerId, zip, until }.
// Left out: the owner, suspended and demo accounts (and everyone when the owner is one), blocked pairs, and a member
// who already has 3 'nearby' notices today. While the head start is admin-only (nuancedGate.js) only admins are told,
// so nobody gets a notice about something they can't open. Returns how many notices were written.
export async function notifyWatchers(context, home) {
  const { kind, ownerId, zip, until } = home || {};
  if (!validZip(zip) || !until || !ownerId) return 0;
  const openToMembers = toolLive(context.env, 'headStart', null) ? 1 : 0;
  const result = await context.env.DB.prepare(
    `INSERT INTO notifications (user_id, type, body, link)
     SELECT w.user_id, 'nearby', ?1, '/app#watch-areas' FROM watch_areas w JOIN users u ON u.id = w.user_id
     WHERE w.zip = ?2 AND w.user_id != ?3 AND u.status = 'active' AND u.email NOT LIKE ?4
       AND EXISTS (SELECT 1 FROM users o WHERE o.id = ?3 AND o.status = 'active' AND o.email NOT LIKE ?4)
       AND ${notBlockedSql('w.user_id', '?3')}
       AND (SELECT COUNT(*) FROM notifications n WHERE n.user_id = w.user_id AND n.type = 'nearby' AND n.created_at > datetime('now', '-1 day')) < ${NEARBY_NOTICES_PER_DAY}
       AND (?5 = 1 OR u.role = 'admin')
     LIMIT 2000`
  ).bind(nearbyNoticeBody(kind, zip, until), String(zip), ownerId, DEMO_EMAIL_PATTERN, openToMembers).run();
  return (result.meta && result.meta.changes) || 0;
}

// Makes a head-start trade listing active (one statement). ownerId given = only that owner's listing. A listing an
// admin paused during its head start (hidden_at) stays paused. Returns whether a row changed.
export async function openHeadStartListing(db, listingId, ownerId = null) {
  const result = await db.prepare(
    `UPDATE listings SET status = 'active', head_start_until = NULL, updated_at = datetime('now')
     WHERE id = ?1 AND head_start_until IS NOT NULL AND hidden_at IS NULL${ownerId === null ? '' : ' AND user_id = ?2'}`
  ).bind(...(ownerId === null ? [listingId] : [listingId, ownerId])).run();
  return !!(result.meta && result.meta.changes);
}

// The create-time alerts a head-start listing skipped (matches, saved searches, Market Pulse), run once it opens.
export async function announceOpenedListing(context, listingId) {
  try { await announceNewListing(context, listingId); } catch (err) { console.log(`[head start announce failed] ${err && err.message}`); }
}

// Opens a trade listing to everyone now and runs the alerts it skipped at create. Returns whether it opened; a
// second call changes nothing and announces nothing.
export async function endHeadStart(context, listingId) {
  const opened = await openHeadStartListing(context.env.DB, Number(listingId));
  if (opened) await announceOpenedListing(context, Number(listingId));
  return opened;
}

// Lazy job (functions/api/_middleware.js): head starts that have ended open to everyone. One statement when idle;
// one listing a pass (opening runs the create-time alerts, about what a listing create costs, and the jobs share
// D1's per-invocation statement limit with the request that started them). The rest stay due for the next pass.
export async function runDueHeadStarts(context) {
  const due = await context.env.DB.prepare(
    'SELECT id FROM listings WHERE head_start_until IS NOT NULL AND head_start_until <= ?1 AND hidden_at IS NULL ORDER BY head_start_until ASC LIMIT 1'
  ).bind(sqlUtc()).all();
  for (const row of due.results || []) await endHeadStart(context, row.id);
}

/* ---------------- Watch areas ---------------- */

export async function fetchWatchAreas(db, userId) {
  const rows = await db.prepare('SELECT id, zip, label FROM watch_areas WHERE user_id = ? ORDER BY created_at ASC, id ASC').bind(userId).all();
  return rows.results || [];
}

// Adds a ZIP to a member's watch areas in one guarded statement (at most 3, a known ZIP). { id } or { error }.
// Nothing about where the member lives is asked, stored or implied.
export async function addWatchArea(db, userId, zip, label) {
  let changes = 0, id = null;
  try {
    const result = await db.prepare(
      `INSERT INTO watch_areas (user_id, zip, label) SELECT ?1, ?2, ?3
       WHERE (SELECT COUNT(*) FROM watch_areas WHERE user_id = ?1) < ${MAX_WATCH_AREAS} AND EXISTS (SELECT 1 FROM zip_codes WHERE zip = ?2)`
    ).bind(userId, zip, label).run();
    changes = (result.meta && result.meta.changes) || 0;
    id = result.meta && result.meta.last_row_id;
  } catch { /* UNIQUE(user_id, zip): the reason is read below */ }
  if (changes) return { id };
  // Only when nothing was added: which of the three reasons it was.
  const why = await db.prepare(
    `SELECT EXISTS (SELECT 1 FROM watch_areas WHERE user_id = ?1 AND zip = ?2) AS dup,
            EXISTS (SELECT 1 FROM zip_codes WHERE zip = ?2) AS known`
  ).bind(userId, zip).first();
  if (why && why.dup) return { error: WATCH_DUPLICATE_ERROR };
  if (!why || !why.known) return { error: UNKNOWN_ZIP_ERROR };
  return { error: WATCH_MAX_ERROR };
}

/* ---------------- Early looks (head-start trade listings in the viewer's watched ZIPs) ---------------- */

// The rule every early-look read uses. l = listings, u = its owner; ?1 = the viewer, ?2 = now (sqlUtc).
const EARLY_LOOK_WHERE = `l.status = 'paused' AND l.head_start_until > ?2 AND l.hidden_at IS NULL AND l.is_buyer_only = 0
       AND l.zip IN (SELECT zip FROM watch_areas WHERE user_id = ?1)
       AND l.user_id != ?1 AND u.status = 'active'
       AND ${notBlockedSql('l.user_id', '?1')}`;

const isDemoEmail = (email) => String(email || '').toLowerCase().endsWith('@demo.amicohaus.local');

// Up to 20 cards, newest first: the directory card's fields, the first 600 characters of the description, up to 6
// photo ids, when the head start ends and the owner's name. Never the address. One statement.
export async function fetchEarlyLooks(db, viewer, nowMs = Date.now()) {
  const rows = await db.prepare(
    `SELECT l.id, l.title, l.neighborhood, l.city, l.state, l.zip, l.property_type, l.beds, l.baths, l.sqft, l.estimated_value,
            l.is_rental, l.rent_amount, l.min_lease_months, l.is_portfolio, l.created_at, l.mello_roos_annual, l.hoa_monthly,
            substr(COALESCE(l.description, ''), 1, 600) AS description, l.head_start_until, l.user_id AS owner_id, u.display_name AS owner_name,
            dc.locations AS want_locations, dc.property_type AS want_type, dc.price_min AS want_min, dc.price_max AS want_max,
            (SELECT json_group_array(pid) FROM (SELECT p.id AS pid FROM listing_photos p WHERE p.listing_id = l.id ORDER BY p.position ASC LIMIT 6)) AS photo_ids
     FROM listings l JOIN users u ON u.id = l.user_id LEFT JOIN desired_criteria dc ON dc.listing_id = l.id
     WHERE ${EARLY_LOOK_WHERE}
       AND (u.email NOT LIKE ?3 OR ?4 = 1)
     ORDER BY l.created_at DESC, l.id DESC LIMIT 20`
  ).bind(viewer.id, sqlUtc(nowMs), DEMO_EMAIL_PATTERN, isDemoEmail(viewer.email) ? 1 : 0).all();
  return (rows.results || []).map(r => {
    let photoIds = [];
    try { photoIds = JSON.parse(r.photo_ids || '[]').map(Number).filter(Number.isInteger); } catch { /* no photos */ }
    return {
      id: r.id, title: r.title || '', neighborhood: r.neighborhood || '', city: r.city, state: r.state, zip: r.zip,
      propertyType: r.property_type, beds: r.beds, baths: r.baths, sqft: r.sqft, estimatedValue: r.estimated_value,
      isRental: !!r.is_rental, rentAmount: r.rent_amount, minLeaseMonths: r.min_lease_months, isPortfolio: !!r.is_portfolio,
      melloRoosAnnual: r.mello_roos_annual, hoaMonthly: r.hoa_monthly, createdAt: r.created_at,
      description: r.description || '', photoIds,
      // What the owner would trade for (a rental has none).
      wants: r.want_locations ? { type: r.want_type, locations: r.want_locations, priceMin: r.want_min, priceMax: r.want_max } : null,
      headStartUntil: r.head_start_until, headStartLabel: `${headStartLabel(r.head_start_until)} Pacific time`,
      owner: { id: r.owner_id, name: r.owner_name },
    };
  });
}

// For the photo route: may this signed-in viewer fetch a photo of a listing that is in a live, not-hidden head
// start? Yes when they watch its ZIP and there's no block either way with the owner. ONE statement.
export async function watcherMaySeeListing(db, viewerId, listing) {
  if (!validZip(listing && listing.zip)) return false;
  const row = await db.prepare(
    `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM watch_areas WHERE user_id = ?1 AND zip = ?2) AND ${notBlockedSql('?3', '?1')}`
  ).bind(viewerId, String(listing.zip), listing.user_id).first();
  return !!row;
}

/* ---------------- The member digest: "What's new in your watch areas" ---------------- */

// One registry, one endpoint. A later tool adds a member benefit by exporting ONE SQL term from its own lib and
// adding a line here; the endpoint, the panel and the client don't change.
// A term returns the columns kind, ref_id, zip, title, created_at; takes ?1 viewer id, ?2 DEMO_EMAIL_PATTERN, ?3 now
// minus 14 days, ?4 now minus 30 days, ?5 now (all sqlUtc text); keeps to the viewer's watched ZIPs; leaves out the
// viewer's own rows, suspended and demo owners and blocked pairs; and wraps its ORDER BY ... LIMIT 20 in a subquery.
// tool: the launch-gate name that must be live for the viewer. text/href build the item on the server (labels only:
// never a count, a price or an adjective).
const WATCHED_ZIPS = 'IN (SELECT zip FROM watch_areas WHERE user_id = ?1)';

function earlyLookTermSql() {
  // title carries the home type and, after a line break, when the head start ends (the item text needs both).
  return `SELECT * FROM (SELECT 'early_look' AS kind, l.id AS ref_id, l.zip AS zip, l.property_type || char(10) || l.head_start_until AS title, l.created_at AS created_at
     FROM listings l JOIN users u ON u.id = l.user_id
     WHERE l.status = 'paused' AND l.head_start_until > ?5 AND l.hidden_at IS NULL AND l.is_buyer_only = 0
       AND l.zip ${WATCHED_ZIPS} AND l.user_id != ?1 AND u.status = 'active' AND u.email NOT LIKE ?2
       AND ${notBlockedSql('l.user_id', '?1')}
     ORDER BY l.created_at DESC LIMIT 20)`;
}
function listingTermSql() {
  return `SELECT * FROM (SELECT 'listing' AS kind, l.id AS ref_id, l.zip AS zip, l.property_type AS title, l.created_at AS created_at
     FROM listings l JOIN users u ON u.id = l.user_id
     WHERE l.status = 'active' AND l.created_at > ?3 AND l.is_buyer_only = 0 AND l.is_rental = 0
       AND l.id NOT IN (SELECT member_listing_id FROM portfolio_members)
       AND l.zip ${WATCHED_ZIPS} AND l.user_id != ?1 AND u.status = 'active' AND u.email NOT LIKE ?2
       AND lower(u.email) <> '${REVIEW_SAMPLE_EMAIL}'
       AND ${notBlockedSql('l.user_id', '?1')}
     ORDER BY l.created_at DESC LIMIT 20)`;
}
function preListingTermSql() {
  // The teaser rule (headStartTeaserSql) holds by itself here: the viewer watches the ZIP.
  return `SELECT * FROM (SELECT 'pre_listing' AS kind, p.id AS ref_id, p.zip AS zip, p.property_type AS title, p.created_at AS created_at
     FROM pre_listings p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'open' AND p.created_at > ?3
       AND p.zip ${WATCHED_ZIPS} AND p.user_id != ?1 AND u.status = 'active' AND u.email NOT LIKE ?2
       AND ${notBlockedSql('p.user_id', '?1')}
     ORDER BY p.created_at DESC LIMIT 20)`;
}
// The label another lib gives its own key (openFor.js openForDigestLabel, dealOutlines.js dealOutlineDigestLabel);
// if that function is ever missing, the key in plain words rather than a broken digest.
function labelFrom(lib, name, key) {
  const label = lib && typeof lib[name] === 'function' ? lib[name](key) : '';
  return label ? String(label) : String(key || '').replace(/_/g, ' ');
}

export const WATCH_DIGEST_TERMS = [
  {
    kind: 'early_look', tool: 'headStart', sql: earlyLookTermSql,
    text: (r) => { const [type, until] = String(r.title || '').split('\n'); return `Neighbors First: ${type} in ZIP ${r.zip}, open to watchers until ${headStartLabel(until)} Pacific time`; },
    href: () => '/app#watch-areas',
  },
  { kind: 'listing', tool: 'watchAreas', sql: listingTermSql, text: (r) => `New trade listing: ${r.title} in ZIP ${r.zip}`, href: (r) => `/listing/${r.ref_id}` },
  { kind: 'pre_listing', tool: 'watchAreas', sql: preListingTermSql, text: (r) => `New pre-listing: ${r.title} in ZIP ${r.zip}`, href: (r) => `/app#pre-listing-${r.ref_id}` },
  {
    kind: 'open_for', tool: 'openFor', sql: () => openForLib.openForDigestTermSql(),
    text: (r) => `Open For: ${labelFrom(openForLib, 'openForDigestLabel', r.title)} in ZIP ${r.zip}`,
    href: () => '/app#ideas',
  },
  {
    kind: 'deal_outline', tool: 'easementIdeas', sql: () => dealOutlinesLib.dealOutlineDigestTermSql(),
    text: (r) => `Idea outline: ${labelFrom(dealOutlinesLib, 'dealOutlineDigestLabel', r.title)} in ZIP ${r.zip}`,
    href: () => '/app#ideas',
  },
];
export const WATCH_DIGEST_MAX = 40;
const DIGEST_COLUMNS = ['kind', 'ref_id', 'zip', 'title', 'created_at'];

// The digest SQL for this viewer: the terms whose tool is live for them, joined the way allUnionAll splits them.
export function watchDigestSql(env, user) {
  return WATCH_DIGEST_TERMS
    .filter(t => toolLive(env, t.tool, user))
    .map(t => String(t.sql() || '').trim())
    .filter(Boolean)
    .join('\n  UNION ALL ');
}

// { areas, items }: the member's watch areas and what is new in them, newest first, at most 40. Pull only: no email,
// no push, no "3 new homes" headline. 2 statements with up to five terms (1 when the member watches nothing).
export async function fetchWatchDigest(db, env, user, nowMs = Date.now()) {
  const areas = await fetchWatchAreas(db, user.id);
  if (!areas.length) return { areas, items: [] };
  const sql = watchDigestSql(env, user);
  if (!sql) return { areas, items: [] };
  const params = [user.id, DEMO_EMAIL_PATTERN, sqlUtc(nowMs - 14 * 86400e3), sqlUtc(nowMs - 30 * 86400e3), sqlUtc(nowMs)];
  const rows = await allUnionAll(db, sql, params, DIGEST_COLUMNS);
  const byKind = new Map(WATCH_DIGEST_TERMS.map(t => [t.kind, t]));
  const items = rows
    .filter(r => byKind.has(r.kind))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.ref_id) - Number(a.ref_id))
    .slice(0, WATCH_DIGEST_MAX)
    .map(r => {
      const term = byKind.get(r.kind);
      return { kind: r.kind, id: r.ref_id, zip: r.zip, text: term.text(r), href: term.href(r), createdAt: r.created_at };
    });
  return { areas, items };
}
