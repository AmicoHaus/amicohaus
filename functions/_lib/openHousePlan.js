// Open-house route (home facts batch, migration_v46): the owner's per-open-house choice to share the street address
// with people going, the names an owner sees, the RSVP and share toggles for all 3 open-house kinds, and a signed-in
// person's plan of upcoming open houses (GET /api/open-house-plan). openHouses.js, augmentedHomeOpenHouses.js and
// greenHomeOpenHouses.js keep their own exports and call the shared code here with their kind.
import { isEitherBlocked, notBlockedSql } from './blocks.js';
import { allUnionAll } from './compoundSelect.js';
import { json, notFound, badRequest, clampString, DEMO_EMAIL_PATTERN } from './util.js';
import { claimUserAction, rateLimited } from './rateLimits.js';
import { pacificDayKey } from './pacificTime.js';
import { steeringProblem, addressProblem, codeProblem, STEERING_ERROR, ADDRESS_ERROR, CODE_ERROR } from './homeText.js';

// The owner chose to share the street address with people going: only to a signed-in viewer who RSVP'd, from 24 hours
// before the start until the end, while the home is active and the owner active, never across a block. Computed on
// every request; nothing is cached or logged.
export const ADDRESS_WINDOW_HOURS = 24;
// rsvp_named (migration_v46) is 1 on every RSVP this code makes (the person was told the owner sees their display
// name) and 0 on RSVPs made before it, when owners saw only a count: those are never named and never get the address
// (they RSVP again to be included). A per-row flag, not a date, so RSVPs made on the old code are never named.

const HOUR_MS = 3600e3;
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const MAX_GOING_NAMES = 50;
const isDemoEmail = (email) => String(email || '').toLowerCase().endsWith('@demo.amicohaus.local');

// Table names per kind (from code, never from a request).
export const OPEN_HOUSE_KINDS = {
  listing: { ohTable: 'open_houses', rsvpTable: 'open_house_rsvps', ohFk: 'listing_id', homeTable: 'listings' },
  augmented_home: { ohTable: 'augmented_home_open_houses', rsvpTable: 'augmented_home_open_house_rsvps', ohFk: 'augmented_home_id', homeTable: 'augmented_homes' },
  green_home: { ohTable: 'green_home_open_houses', rsvpTable: 'green_home_open_house_rsvps', ohFk: 'green_home_id', homeTable: 'green_homes' },
};

// An RSVP row's rsvp_named: the person was told the owner sees their display name.
export function rsvpNamed(flag) { return Number(flag) === 1; }

export function addressRevealed({ share, going, named, startsAt, endsAt, address, blocked, active }, now = Date.now()) {
  return Number(share) === 1 && !!going && !!named && !blocked && !!active && !!address
    && now >= Date.parse(startsAt) - ADDRESS_WINDOW_HOURS * HOUR_MS && now < Date.parse(endsAt);
}

// Which address line a person sees for an open house: 'shared' | 'opens_at' | 'rsvp_to_get' | 'rsvp_again' | 'not_shared'.
export function addressNote({ share, going, named, startsAt }, now = Date.now()) {
  if (Number(share) !== 1) return 'not_shared';
  if (!going) return 'rsvp_to_get';
  if (!named) return 'rsvp_again';
  if (now < Date.parse(startsAt) - ADDRESS_WINDOW_HOURS * HOUR_MS) return 'opens_at';
  return 'shared';
}

// The same checks as every other public home text (fair housing, no street address, no gate or lockbox codes), and the
// owner's share choice (off unless exactly true).
export function validateOpenHouseBody(body) {
  const b = body || {};
  const starts = new Date(b.startsAt);
  const ends = new Date(b.endsAt);
  if (isNaN(starts.getTime()) || isNaN(ends.getTime())) return { error: 'Pick a start and end time.' };
  if (starts.getTime() <= Date.now()) return { error: 'The open house has to be in the future.' };
  if (ends.getTime() <= starts.getTime()) return { error: 'The end time has to be after the start time.' };
  const note = clampString(b.note, 300);
  if (steeringProblem(note)) return { error: STEERING_ERROR };
  if (addressProblem(note)) return { error: ADDRESS_ERROR };
  if (codeProblem(note)) return { error: CODE_ERROR };
  return { data: { startsAt: starts.toISOString(), endsAt: ends.toISOString(), note, shareAddressWithRsvps: b.shareAddressWithRsvps === true ? 1 : 0 } };
}

export async function createKindOpenHouse(db, kind, homeId, d) {
  const c = OPEN_HOUSE_KINDS[kind];
  const result = await db.prepare(
    `INSERT INTO ${c.ohTable} (${c.ohFk}, starts_at, ends_at, note, share_address_with_rsvps) VALUES (?, ?, ?, ?, ?)`
  ).bind(homeId, d.startsAt, d.endsAt, d.note, d.shareAddressWithRsvps ? 1 : 0).run();
  return result.meta.last_row_id;
}

// Upcoming open houses for one home, soonest first. The 4th argument turns on the extras: `address` (the caller passes
// it only for an active home) lets a going, named viewer inside the window get the street address (one statement that
// re-checks the home, the owner and blocks, run only when some open house would reveal); `ownerId` gives the owner
// the names of people going (one statement, owner only). Without it the result is as before (no address, no names).
export async function fetchKindOpenHouses(db, kind, homeId, viewerUserId, { ownerId, address } = {}) {
  const c = OPEN_HOUSE_KINDS[kind];
  const now = Date.now();
  // ends_at is ISO text (toISOString), so it compares with an ISO string, never with datetime('now').
  const rows = (await db.prepare(
    `SELECT oh.id, oh.starts_at, oh.ends_at, oh.note, oh.share_address_with_rsvps,
            (SELECT COUNT(*) FROM ${c.rsvpTable} r WHERE r.open_house_id = oh.id) AS rsvp_count
     FROM ${c.ohTable} oh WHERE oh.${c.ohFk} = ? AND oh.ends_at > ? ORDER BY oh.starts_at ASC`
  ).bind(homeId, new Date(now).toISOString()).all()).results || [];
  if (!rows.length) return [];
  const ids = JSON.stringify(rows.map(r => r.id));

  const mine = new Map();
  if (viewerUserId) {
    const res = await db.prepare(
      `SELECT open_house_id, rsvp_named FROM ${c.rsvpTable} WHERE user_id = ?1 AND open_house_id IN (SELECT value FROM json_each(?2))`
    ).bind(viewerUserId, ids).all();
    for (const r of res.results || []) mine.set(r.open_house_id, r.rsvp_named);
  }
  const isOwner = !!viewerUserId && ownerId !== undefined && ownerId !== null && Number(viewerUserId) === Number(ownerId);

  const out = rows.map(r => ({
    id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, note: r.note, rsvpCount: r.rsvp_count, imGoing: mine.has(r.id),
    shareAddressWithRsvps: Number(r.share_address_with_rsvps) === 1,
  }));

  // Address: only a viewer who isn't the owner, and only when some open house passes the rule before the home check.
  if (address && viewerUserId && !isOwner) {
    const would = (r, extra) => addressRevealed({
      share: r.share_address_with_rsvps, going: mine.has(r.id), named: rsvpNamed(mine.get(r.id)),
      startsAt: r.starts_at, endsAt: r.ends_at, ...extra,
    }, now);
    if (rows.some(r => would(r, { address: true, active: true, blocked: false }))) {
      const home = await db.prepare(
        `SELECT h.address, h.status AS home_status, u.status AS owner_status,
                ${notBlockedSql('h.user_id', '?2')} AS not_blocked
         FROM ${c.homeTable} h JOIN users u ON u.id = h.user_id WHERE h.id = ?1`
      ).bind(homeId, viewerUserId).first();
      const active = !!home && home.home_status === 'active' && home.owner_status === 'active';
      const blocked = !home || !home.not_blocked;
      rows.forEach((r, i) => {
        if (would(r, { address: home && home.address, active, blocked })) out[i].address = home.address;
      });
    }
  }

  // Names: the owner only, never their own RSVP or a blocked, suspended or demo account. One statement: named rows
  // (rsvp_named = 1) give the names; the others are the people who RSVP'd before names were shown (goingBefore), and
  // their display name is never selected.
  if (isOwner) {
    const res = await db.prepare(
      `SELECT r.open_house_id, r.rsvp_named, CASE WHEN r.rsvp_named = 1 THEN u.display_name END AS display_name
       FROM ${c.rsvpTable} r JOIN users u ON u.id = r.user_id
       WHERE r.open_house_id IN (SELECT value FROM json_each(?1)) AND r.user_id != ?3
         AND u.status = 'active' AND u.email NOT LIKE ?2 AND ${notBlockedSql('r.user_id', '?3')}
       ORDER BY r.created_at ASC, r.id ASC`
    ).bind(ids, DEMO_EMAIL_PATTERN, ownerId).all();
    const named = new Map();
    const before = new Map();
    for (const r of res.results || []) {
      if (rsvpNamed(r.rsvp_named)) named.set(r.open_house_id, [...(named.get(r.open_house_id) || []), r.display_name]);
      else before.set(r.open_house_id, (before.get(r.open_house_id) || 0) + 1);
    }
    for (const oh of out) {
      const all = named.get(oh.id) || [];
      oh.goingNames = all.slice(0, MAX_GOING_NAMES);
      oh.goingNamedCount = all.length;
      // Eligible people who RSVP'd before names were shown (rsvp_named = 0): not named, no address until they RSVP again.
      oh.goingBefore = before.get(oh.id) || 0;
    }
  }
  return out;
}

// POST .../open-houses/:ohId/rsvp for every kind. One statement loads the open house, the home and the owner (and
// feeds the address); an open house that isn't this home's gets a 404. Removing the viewer's own RSVP always works
// (a paused home, a suspended owner, a block or an ended open house never keeps someone on the list) and is never
// rate limited. Adding gets the same 404 for a paused home, a suspended owner, a block either way or an ended open
// house, and is rate limited. Every add sets rsvp_named = 1 (the page tells them the owner sees their name). At most
// 5 statements.
export async function rsvpToggleResponse(db, kind, homeId, ohId, user) {
  const c = OPEN_HOUSE_KINDS[kind];
  const gone = () => notFound('Open house not found.');
  const row = await db.prepare(
    `SELECT oh.id, oh.starts_at, oh.ends_at, oh.share_address_with_rsvps, h.user_id, h.address, h.status, u.status AS owner_status
     FROM ${c.ohTable} oh JOIN ${c.homeTable} h ON h.id = oh.${c.ohFk} JOIN users u ON u.id = h.user_id
     WHERE oh.id = ? AND h.id = ?`
  ).bind(ohId, homeId).first();
  if (!row) return gone();

  const existing = await db.prepare(`SELECT id FROM ${c.rsvpTable} WHERE open_house_id = ? AND user_id = ?`).bind(row.id, user.id).first();
  if (existing) {
    await db.prepare(`DELETE FROM ${c.rsvpTable} WHERE id = ?`).bind(existing.id).run();
    return json({ going: false, address: null }, NO_STORE);
  }
  if (row.status !== 'active' || row.owner_status !== 'active') return gone();
  if (await isEitherBlocked(db, user.id, row.user_id)) return gone();
  const now = Date.now();
  if (Date.parse(row.ends_at) <= now) return gone();
  if (!(await claimUserAction(db, 'open_house_rsvp', user.id))) return rateLimited();
  // "RSVP again" on a row that is somehow still there (a double tap racing the delete) also marks it named.
  await db.prepare(
    `INSERT INTO ${c.rsvpTable} (open_house_id, user_id, rsvp_named) VALUES (?, ?, 1)
     ON CONFLICT(open_house_id, user_id) DO UPDATE SET rsvp_named = 1`
  ).bind(row.id, user.id).run();
  const revealed = addressRevealed({
    share: row.share_address_with_rsvps, going: true, named: true,
    startsAt: row.starts_at, endsAt: row.ends_at, address: row.address, blocked: false, active: true,
  }, now);
  return json({ going: true, address: revealed ? row.address : null }, NO_STORE);
}

// PATCH .../open-houses/:ohId for every kind: the owner turns address sharing on or off. 404 for another home's
// open house (scoped by the home id, like DELETE).
export async function shareToggleResponse(db, kind, homeId, ohId, body) {
  const c = OPEN_HOUSE_KINDS[kind];
  if (!body || typeof body.shareAddressWithRsvps !== 'boolean') return badRequest('Say whether to share the address.');
  const share = body.shareAddressWithRsvps;
  const res = await db.prepare(`UPDATE ${c.ohTable} SET share_address_with_rsvps = ? WHERE id = ? AND ${c.ohFk} = ?`)
    .bind(share ? 1 : 0, ohId, homeId).run();
  if (!res.meta || !res.meta.changes) return notFound('Open house not found.');
  return json({ ok: true, shareAddressWithRsvps: share }, NO_STORE);
}

// ---------- The plan (GET /api/open-house-plan) ----------
export const PLAN_MAX_DAYS = 8;
export const PLAN_DEFAULT_DAYS = 7;
export const PLAN_MAX_STOPS = 60;
export function planDays(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return PLAN_DEFAULT_DAYS;
  return Math.min(PLAN_MAX_DAYS, Math.max(1, n));
}

// Shared WHERE pieces. ?1 viewer, ?2 now (ISO), ?3 end of window (ISO), ?4 demo pattern, ?5 viewer is demo,
// (5 parameters). Times are ISO text on both sides; "named" is the RSVP row's rsvp_named flag.
const LIVE = (homeStatus) => `oh.ends_at > ?2 AND oh.starts_at < ?3 AND h.status = '${homeStatus}'
       AND u.status = 'active' AND (u.email NOT LIKE ?4 OR ?5 = 1) AND ${notBlockedSql('h.user_id', '?1')}`;
const HOME_COLS = 'h.title, h.property_type, h.beds, h.baths, h.neighborhood, h.city, h.state';

// 7 terms (run as 2 statements by allUnionAll): 1-3 open houses the viewer RSVP'd to, 4-6 saved homes' open houses
// without an RSVP, 7 broker previews an approved agent RSVP'd to. The street address is never selected raw: only the
// CASE in terms 1-3 (owner shares it, RSVP made after names were shown: rsvp_named = 1) returns it; JS then applies the time window.
// Terms 4-7 return NULL. Ordering by RSVP count or anything else "popular" never happens here.
export const PLAN_COLUMNS = ['kind', 'home_id', 'oh_id', 'starts_at', 'ends_at', 'note', 'share', 'address', 'going', 'named',
  'saved', 'title', 'property_type', 'beds', 'baths', 'neighborhood', 'city', 'state', 'photo_id'];
export const PLAN_SQL = `SELECT 'listing' AS kind, h.id AS home_id, oh.id AS oh_id, oh.starts_at, oh.ends_at, oh.note, oh.share_address_with_rsvps AS share,
       CASE WHEN oh.share_address_with_rsvps = 1 AND r.rsvp_named = 1 THEN h.address END AS address, 1 AS going, (r.rsvp_named = 1) AS named,
       EXISTS (SELECT 1 FROM listing_feedback f WHERE f.user_id = ?1 AND f.listing_id = h.id AND f.feedback = 'up') AS saved, ${HOME_COLS},
       (SELECT p.id FROM listing_photos p WHERE p.listing_id = h.id ORDER BY p.position ASC LIMIT 1) AS photo_id
     FROM open_house_rsvps r JOIN open_houses oh ON oh.id = r.open_house_id JOIN listings h ON h.id = oh.listing_id JOIN users u ON u.id = h.user_id
     WHERE r.user_id = ?1 AND h.is_buyer_only = 0 AND ${LIVE('active')}
  UNION ALL SELECT 'augmented_home' AS kind, h.id AS home_id, oh.id AS oh_id, oh.starts_at AS starts_at, oh.ends_at AS ends_at, oh.note AS note, oh.share_address_with_rsvps AS share,
       CASE WHEN oh.share_address_with_rsvps = 1 AND r.rsvp_named = 1 THEN h.address END AS address, 1 AS going, (r.rsvp_named = 1) AS named,
       EXISTS (SELECT 1 FROM augmented_home_favorites f WHERE f.user_id = ?1 AND f.augmented_home_id = h.id) AS saved, ${HOME_COLS},
       (SELECT p.id FROM augmented_home_photos p WHERE p.augmented_home_id = h.id ORDER BY p.position ASC LIMIT 1) AS photo_id
     FROM augmented_home_open_house_rsvps r JOIN augmented_home_open_houses oh ON oh.id = r.open_house_id JOIN augmented_homes h ON h.id = oh.augmented_home_id JOIN users u ON u.id = h.user_id
     WHERE r.user_id = ?1 AND ${LIVE('active')}
  UNION ALL SELECT 'green_home' AS kind, h.id AS home_id, oh.id AS oh_id, oh.starts_at AS starts_at, oh.ends_at AS ends_at, oh.note AS note, oh.share_address_with_rsvps AS share,
       CASE WHEN oh.share_address_with_rsvps = 1 AND r.rsvp_named = 1 THEN h.address END AS address, 1 AS going, (r.rsvp_named = 1) AS named,
       EXISTS (SELECT 1 FROM green_home_favorites f WHERE f.user_id = ?1 AND f.green_home_id = h.id) AS saved, ${HOME_COLS},
       (SELECT p.id FROM green_home_photos p WHERE p.green_home_id = h.id ORDER BY p.position ASC LIMIT 1) AS photo_id
     FROM green_home_open_house_rsvps r JOIN green_home_open_houses oh ON oh.id = r.open_house_id JOIN green_homes h ON h.id = oh.green_home_id JOIN users u ON u.id = h.user_id
     WHERE r.user_id = ?1 AND ${LIVE('active')}
  UNION ALL SELECT 'listing' AS kind, h.id AS home_id, oh.id AS oh_id, oh.starts_at AS starts_at, oh.ends_at AS ends_at, oh.note AS note, oh.share_address_with_rsvps AS share, NULL AS address, 0 AS going, 0 AS named, 1 AS saved, ${HOME_COLS},
       (SELECT p.id FROM listing_photos p WHERE p.listing_id = h.id ORDER BY p.position ASC LIMIT 1) AS photo_id
     FROM listing_feedback f JOIN listings h ON h.id = f.listing_id JOIN open_houses oh ON oh.listing_id = h.id JOIN users u ON u.id = h.user_id
     WHERE f.user_id = ?1 AND f.feedback = 'up' AND h.is_buyer_only = 0 AND ${LIVE('active')}
       AND NOT EXISTS (SELECT 1 FROM open_house_rsvps x WHERE x.open_house_id = oh.id AND x.user_id = ?1)
  UNION ALL SELECT 'augmented_home' AS kind, h.id AS home_id, oh.id AS oh_id, oh.starts_at AS starts_at, oh.ends_at AS ends_at, oh.note AS note, oh.share_address_with_rsvps AS share, NULL AS address, 0 AS going, 0 AS named, 1 AS saved, ${HOME_COLS},
       (SELECT p.id FROM augmented_home_photos p WHERE p.augmented_home_id = h.id ORDER BY p.position ASC LIMIT 1) AS photo_id
     FROM augmented_home_favorites f JOIN augmented_homes h ON h.id = f.augmented_home_id JOIN augmented_home_open_houses oh ON oh.augmented_home_id = h.id JOIN users u ON u.id = h.user_id
     WHERE f.user_id = ?1 AND ${LIVE('active')}
       AND NOT EXISTS (SELECT 1 FROM augmented_home_open_house_rsvps x WHERE x.open_house_id = oh.id AND x.user_id = ?1)
  UNION ALL SELECT 'green_home' AS kind, h.id AS home_id, oh.id AS oh_id, oh.starts_at AS starts_at, oh.ends_at AS ends_at, oh.note AS note, oh.share_address_with_rsvps AS share, NULL AS address, 0 AS going, 0 AS named, 1 AS saved, ${HOME_COLS},
       (SELECT p.id FROM green_home_photos p WHERE p.green_home_id = h.id ORDER BY p.position ASC LIMIT 1) AS photo_id
     FROM green_home_favorites f JOIN green_homes h ON h.id = f.green_home_id JOIN green_home_open_houses oh ON oh.green_home_id = h.id JOIN users u ON u.id = h.user_id
     WHERE f.user_id = ?1 AND ${LIVE('active')}
       AND NOT EXISTS (SELECT 1 FROM green_home_open_house_rsvps x WHERE x.open_house_id = oh.id AND x.user_id = ?1)
  UNION ALL SELECT 'preview' AS kind, h.id AS home_id, oh.id AS oh_id, oh.starts_at AS starts_at, oh.ends_at AS ends_at, oh.note AS note, 0 AS share, NULL AS address, 1 AS going, 0 AS named, 0 AS saved, ${HOME_COLS},
       (SELECT p.id FROM pre_listing_photos p WHERE p.pre_listing_id = h.id ORDER BY p.position ASC LIMIT 1) AS photo_id
     FROM pre_listing_preview_rsvps r JOIN pre_listing_previews oh ON oh.id = r.preview_id JOIN pre_listings h ON h.id = oh.pre_listing_id JOIN users u ON u.id = h.user_id
     WHERE r.agent_user_id = ?1 AND ${LIVE('open')}
       AND EXISTS (SELECT 1 FROM agent_profiles ap WHERE ap.user_id = ?1 AND ap.status = 'approved')`;

const KIND_ORDER = { listing: 0, augmented_home: 1, green_home: 2, preview: 3 };
const PHOTO_ROUTE = { listing: '/api/photos/', augmented_home: '/api/augmented-home-photos/', green_home: '/api/green-home-photos/', preview: '/api/pre-listing-photos/' };
const HREF = { listing: id => `/listing/${id}`, augmented_home: id => `/augmented-home/${id}`, green_home: id => `/green-home/${id}`, preview: id => `/app#pre-listing-${id}` };

// The viewer's stops for the next `days` days, in start-time order (then kind, then id), at most 60. 2 statements.
export async function fetchOpenHousePlan(db, viewer, { days = PLAN_DEFAULT_DAYS } = {}) {
  const now = Date.now();
  const params = [viewer.id, new Date(now).toISOString(), new Date(now + planDays(days) * 24 * HOUR_MS).toISOString(),
    DEMO_EMAIL_PATTERN, isDemoEmail(viewer.email) ? 1 : 0];
  const rows = await allUnionAll(db, PLAN_SQL, params, PLAN_COLUMNS);
  rows.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(a.oh_id) - Number(b.oh_id));
  return rows.slice(0, PLAN_MAX_STOPS).map(r => {
    const isPreview = r.kind === 'preview';
    const going = !!Number(r.going);
    const named = !!Number(r.named);
    // Blocks, paused homes and suspended owners are already left out by the SQL.
    const revealed = !isPreview && addressRevealed({ share: r.share, going, named, startsAt: r.starts_at, endsAt: r.ends_at,
      address: r.address, blocked: false, active: true }, now);
    let note = isPreview ? 'preview' : addressNote({ share: r.share, going, named, startsAt: r.starts_at }, now);
    if (note === 'shared' && !revealed) note = 'not_shared';
    return {
      key: `${r.kind}:${r.home_id}:${r.oh_id}`, kind: r.kind, homeId: r.home_id, openHouseId: r.oh_id,
      title: r.title || r.property_type, propertyType: r.property_type, beds: r.beds, baths: r.baths,
      neighborhood: r.neighborhood || '', city: r.city, state: r.state,
      photoUrl: r.photo_id ? `${PHOTO_ROUTE[r.kind]}${r.photo_id}` : null,
      startsAt: r.starts_at, endsAt: r.ends_at, day: pacificDayKey(r.starts_at), note: r.note || '',
      going, saved: !!Number(r.saved), href: HREF[r.kind](r.home_id),
      address: revealed ? r.address : null, addressNote: note,
    };
  });
}
