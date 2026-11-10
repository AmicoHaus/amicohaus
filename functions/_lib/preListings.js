import { clampString } from './util.js';
import { PROPERTY_TYPES } from './listings.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from './geo.js';
import { PREP_ITEMS, validatePrep } from './sellerPrep.js';
import { notBlockedByOwnersSql } from './blocks.js';

function num(value, { min = 0, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

const OCCUPANCY_STATUSES = ['occupied', 'vacant'];

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

// A required number: blank stays blank (null) instead of turning into 0, so "Fill in beds" can fire. A typed 0 is
// still fine (a studio has 0 beds).
function requiredNum(value, range) {
  return isBlank(value) ? null : num(value, range);
}

// "Open to price opinions": the homeowner left the asking price blank. Stored as asking_price = 0 (the column is
// NOT NULL); a real price is a whole number from $1,000 up. Older rows saved a blank price as $1, so anything under
// $1,000 counts as open too.
export const MIN_ASKING_PRICE = 1000;
export const MAX_ASKING_PRICE = 500000000;
export function priceIsOpen(askingPrice) {
  return !(Number(askingPrice) >= MIN_ASKING_PRICE);
}
// The price the API shows: 0 when open, otherwise the stored whole-dollar price.
export function shownAskingPrice(askingPrice) {
  return priceIsOpen(askingPrice) ? 0 : Number(askingPrice);
}

// Blank (or 0, the value the API itself returns for an open price) means "no price yet". Otherwise "$750,000",
// "750000" and "750 000" all work; decimals, words and amounts outside $1,000-$500M don't.
export function parseAskingPrice(raw) {
  if (isBlank(raw)) return { value: 0 };
  const s = String(raw).replace(/[$,\s]/g, '');
  if (/^0+(\.0+)?$/.test(s)) return { value: 0 };
  const n = /^\d+(\.0+)?$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n) || n < MIN_ASKING_PRICE || n > MAX_ASKING_PRICE) {
    return { error: 'Enter an asking price as a whole-dollar amount, or leave it blank.' };
  }
  return { value: n };
}

export function validatePreListingInput(body) {
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  const zip = clampString(body.zip, 10);
  const propertyType = PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : null;
  const beds = requiredNum(body.beds, { min: 0, max: 50 });
  const baths = requiredNum(body.baths, { min: 0, max: 50 });
  const price = parseAskingPrice(body.askingPrice);
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
  if (price.error) return { error: price.error };
  const askingPrice = price.value;

  return {
    data: {
      title: clampString(body.title, 120),
      description: clampString(body.description, 2000),
      address: clampString(body.address, 150),
      neighborhood: clampString(body.neighborhood, 80),
      city, state, zip, propertyType, beds, baths,
      sqft: body.sqft ? num(body.sqft, { min: 0, max: 200000 }) : null,
      askingPrice, priceOpen: askingPrice === 0, occupancyStatus, showingNoticeHours,
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
    'SELECT id, position, swept_at FROM pre_listing_photos WHERE pre_listing_id = ? ORDER BY position ASC'
  ).bind(preListingId).all();
  return rows.results;
}

const VOTE_TYPES = ['too_high', 'too_low', 'just_right'];

const MAX_COMPS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Up to 3 recently sold homes an agent uses to back up their price. Blank rows are dropped; anything half-filled
// gets a message saying which comp and what's missing.
export function validateComps(raw) {
  if (raw === undefined || raw === null) return { comps: [] };
  if (!Array.isArray(raw)) return { error: 'Comps must be a list.' };
  const rows = raw.filter(c => c && typeof c === 'object' && ['address', 'soldPrice', 'soldDate', 'sqft', 'note'].some(k => String(c[k] ?? '').trim()));
  if (rows.length > MAX_COMPS) return { error: `Add up to ${MAX_COMPS} comps.` };
  const today = new Date().toISOString().slice(0, 10);
  const comps = [];
  for (const [i, c] of rows.entries()) {
    const label = `Comp ${i + 1}`;
    const address = clampString(c.address, 120);
    if (!address) return { error: `${label}: add the address.` };
    const soldPrice = Number(c.soldPrice);
    if (!Number.isInteger(soldPrice) || soldPrice < 1000 || soldPrice > 500000000) return { error: `${label}: add the sold price in whole dollars.` };
    const soldDate = clampString(c.soldDate, 10);
    if (soldDate && (!DATE_RE.test(soldDate) || soldDate > today || soldDate < '2000-01-01')) return { error: `${label}: the sold date should be a past date.` };
    const sqft = c.sqft === '' || c.sqft === undefined || c.sqft === null ? null : Number(c.sqft);
    if (sqft !== null && (!Number.isInteger(sqft) || sqft < 100 || sqft > 100000)) return { error: `${label}: square feet should be a whole number.` };
    comps.push({ address, soldPrice, soldDate: soldDate || null, sqft, note: clampString(c.note, 200) });
  }
  return { comps };
}

// Price opinion history (R3-1b, migration_v44): every number an agent gives a home is kept as a version, the
// owner's private per-agent history (functions/_lib/opinionTrail.js reads it). Never averaged across agents.
// The number already on file becomes this agent's first version before anything changes it (opinions from before
// the history began, migration_v44).
export function ensureFirstVersionStmt(db, preListingId, agentUserId) {
  return db.prepare(`INSERT INTO pre_listing_opinion_versions (pre_listing_id, agent_user_id, price_opinion, source, created_at)
    SELECT o.pre_listing_id, o.agent_user_id, o.price_opinion, 'first', o.updated_at FROM pre_listing_price_opinions o
    WHERE o.pre_listing_id = ?1 AND o.agent_user_id = ?2 AND o.price_opinion IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pre_listing_opinion_versions v WHERE v.pre_listing_id = ?1 AND v.agent_user_id = ?2)`).bind(Number(preListingId), agentUserId);
}
// A new version: 'first' when this agent has none yet, else the given source.
export function addVersionStmt(db, preListingId, agentUserId, price, source, { reason = '', comp = null, askId = null } = {}) {
  return db.prepare(`INSERT INTO pre_listing_opinion_versions (pre_listing_id, agent_user_id, price_opinion, source, reason, comp_json, ask_id)
    SELECT ?1, ?2, ?3, CASE WHEN EXISTS (SELECT 1 FROM pre_listing_opinion_versions WHERE pre_listing_id = ?1 AND agent_user_id = ?2) THEN ?4 ELSE 'first' END, ?5, ?6, ?7`)
    .bind(Number(preListingId), agentUserId, price, source, reason, comp ? JSON.stringify(comp) : null, askId);
}

// The vote itself, plus (when the form sends them) the agent's suggested list price and comps, which are saved
// to pre_listing_price_opinions. The presentation file is uploaded separately
// (functions/api/pre-listings/[id]/votes/deck.js) and is left alone here.
// priceOpen: the homeowner hasn't set a price, so there's nothing to vote on. The suggested list price is required
// instead, any vote sent along is ignored (never stored), and only the opinion is saved.
// opinionNew: this agent's first suggested price on this home (for the "shared a price opinion" notice).
// beforeWrite: an optional async check run once the input is valid, before anything is saved (the route's per-person
// limit, rateLimits.js); when it returns false nothing is saved and the result is { rateLimited: true }.
export async function castPriceVote(db, preListingId, agentUserId, body, { priceOpen = false, beforeWrite = null } = {}) {
  const vote = !priceOpen && VOTE_TYPES.includes(body.vote) ? body.vote : null;
  if (!priceOpen && !vote) return { error: 'Pick too high, too low, or just right.' };
  const note = clampString(body.note, 300);
  const withOpinion = priceOpen || 'priceOpinion' in body || 'comps' in body || 'prep' in body;
  const prep = validatePrep(body.prep);
  let priceOpinion = null;
  let comps = [];
  if (withOpinion) {
    if (body.priceOpinion !== undefined && body.priceOpinion !== null && body.priceOpinion !== '') {
      priceOpinion = Number(body.priceOpinion);
      if (!Number.isInteger(priceOpinion) || priceOpinion < 10000 || priceOpinion > 500000000) return { error: 'Your suggested list price should be a whole-dollar amount.' };
    } else if (priceOpen) {
      return { error: "This homeowner hasn't set a price yet. Share your suggested list price." };
    }
    const checked = validateComps(body.comps);
    if (checked.error) return { error: checked.error };
    comps = checked.comps;
  }
  if (beforeWrite && !(await beforeWrite())) return { rateLimited: true };
  // The number on file (if any, from before the history began) is kept as the first version before it changes.
  if (withOpinion) await ensureFirstVersionStmt(db, preListingId, agentUserId).run();

  const opinionBefore = await db.prepare('SELECT price_opinion FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = ?').bind(preListingId, agentUserId).first();
  const opinionNew = priceOpinion !== null && !(opinionBefore && opinionBefore.price_opinion !== null);
  let before = null;
  if (!priceOpen) {
    before = await db.prepare('SELECT vote FROM pre_listing_price_votes WHERE pre_listing_id = ? AND agent_user_id = ?').bind(preListingId, agentUserId).first();
    await db.prepare(
      `INSERT INTO pre_listing_price_votes (pre_listing_id, agent_user_id, vote, note)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pre_listing_id, agent_user_id) DO UPDATE SET vote = excluded.vote, note = excluded.note, created_at = datetime('now')`
    ).bind(preListingId, agentUserId, vote, note).run();
  }
  if (withOpinion) {
    // The note explains the suggested price, so it's kept with the opinion (which outlives a price change).
    await db.prepare(
      `INSERT INTO pre_listing_price_opinions (pre_listing_id, agent_user_id, price_opinion, comps_json, note, prep_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(pre_listing_id, agent_user_id) DO UPDATE SET price_opinion = excluded.price_opinion,
         comps_json = excluded.comps_json, note = excluded.note, prep_json = excluded.prep_json, updated_at = datetime('now')`
    ).bind(preListingId, agentUserId, priceOpinion, JSON.stringify(comps), note, JSON.stringify(prep)).run();
    // A changed number is a new version. Re-saving the same number, clearing it (the history keeps the last one) and
    // deck uploads add nothing.
    if (priceOpinion !== null && !(opinionBefore && opinionBefore.price_opinion === priceOpinion)) {
      await addVersionStmt(db, preListingId, agentUserId, priceOpinion, 'edit').run();
    }
  }

  // Re-saving the same vote (to add a comp or fix a typo) shouldn't notify the homeowner again.
  return { ok: true, voteChanged: !priceOpen && (!before || before.vote !== vote), opinionNew };
}

// Any approved agent may vote, so the tally also says how many of the votes
// came from agents whose service area reaches the home (a service zip within
// SERVICE_RADIUS_MILES of it) — that is what makes "local agent experts" true
// rather than a claim. `nearby` is null when the home's zip isn't a known one,
// i.e. we can't tell, which is not the same as none.
// On a home that's open to price opinions there are no votes, so the tally counts the agents who shared a
// suggested price instead (total = opinionCount, for "{N} agents shared a price opinion").
// home: the pre-listing row ({ zip, asking_price }) when the caller already has it.
// Only active agents with no block either way with the homeowner count (a blocked agent's vote stays stored, so
// unblocking brings it back).
export async function getVoteTally(db, preListingId, home = null) {
  if (!home) home = await db.prepare('SELECT zip, asking_price FROM pre_listings WHERE id = ?').bind(preListingId).first();
  const open = !!home && priceIsOpen(home.asking_price);
  const rows = open
    ? await db.prepare(
        `SELECT NULL AS vote, ap.service_zips_json
         FROM pre_listing_price_opinions o
         JOIN users ON users.id = o.agent_user_id
         LEFT JOIN agent_profiles ap ON ap.user_id = o.agent_user_id
         WHERE o.pre_listing_id = ?1 AND o.price_opinion IS NOT NULL AND users.status = 'active'
           AND ${notBlockedByOwnersSql('pre_listing', '?1', 'o.agent_user_id')}`
      ).bind(preListingId).all()
    : await db.prepare(
        `SELECT v.vote, ap.service_zips_json
         FROM pre_listing_price_votes v
         JOIN users ON users.id = v.agent_user_id
         LEFT JOIN agent_profiles ap ON ap.user_id = v.agent_user_id
         WHERE v.pre_listing_id = ?1 AND users.status = 'active'
           AND ${notBlockedByOwnersSql('pre_listing', '?1', 'v.agent_user_id')}`
      ).bind(preListingId).all();
  const tally = { too_high: 0, too_low: 0, just_right: 0, total: 0, nearby: 0, priceOpen: open };
  if (open) tally.opinionCount = rows.results.length;
  if (!rows.results.length) return tally;

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

// The agent's own vote and price opinion. vote is null when they haven't voted on the current asking price (never,
// or the owner has since changed it) even though their opinion, comps and file are still there.
export async function fetchMyVote(db, preListingId, agentUserId) {
  const vote = await db.prepare(
    'SELECT vote, note FROM pre_listing_price_votes WHERE pre_listing_id = ? AND agent_user_id = ?'
  ).bind(preListingId, agentUserId).first();
  const opinion = await db.prepare(
    'SELECT price_opinion, comps_json, note, prep_json, deck_name, deck_size FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = ?'
  ).bind(preListingId, agentUserId).first();
  if (!vote && !opinion) return null;
  return {
    vote: vote ? vote.vote : null, note: (opinion && opinion.note) || (vote ? vote.note : ''),
    priceOpinion: opinion ? opinion.price_opinion : null, comps: opinion ? parseComps(opinion.comps_json) : [],
    prep: opinion ? validatePrep(parseComps(opinion.prep_json)) : [],
    deck: opinion && opinion.deck_name ? { name: opinion.deck_name, size: opinion.deck_size } : null,
  };
}

function parseComps(json) {
  try { const c = JSON.parse(json || '[]'); return Array.isArray(c) ? c : []; } catch { return []; }
}

// Sealed: an agent who hasn't voted on the current asking price sees only how many agents have, never how they
// voted, so nobody anchors on the crowd. Only the owner, admins and agents who've already voted see the full tally
// (other homeowners don't get it at all). Price opinions are never shown to other agents at all.
export function sealTally(tally) {
  return tally.priceOpen
    ? { sealed: true, total: tally.total, priceOpen: true, opinionCount: tally.opinionCount }
    : { sealed: true, total: tally.total };
}

// The ids of pre-listings this agent has already voted on (for sealing a browse list in one query).
export async function fetchVotedIds(db, agentUserId) {
  const rows = await db.prepare('SELECT pre_listing_id FROM pre_listing_price_votes WHERE agent_user_id = ?').bind(agentUserId).all();
  return new Set(rows.results.map(r => r.pre_listing_id));
}

// For the homeowner only: every agent's suggested price, comps and presentation file, plus the low-to-high range
// once at least 3 agents have suggested a price (fewer than that isn't a range worth showing). There is no middle,
// average or other number worked out across agents (Rudy 11.04): each opinion is one agent's own. Suspended agents'
// opinions are left out, same as their proposals, and so are agents blocked either way with the homeowner (from the
// list, the range and the "fix before you list" counts; the rows stay, so unblocking brings them back).
export const OPINION_SUMMARY_MIN = 3;
export async function fetchPriceOpinions(db, preListingId) {
  // The agent's DRE number and brokerage ride along: an opinion is a first point of contact, so the homeowner
  // always sees who it's from (California DRE rule).
  const opinionRows = await db.prepare(
    `SELECT o.agent_user_id, o.price_opinion, o.comps_json, o.note, o.prep_json, o.deck_name, o.deck_size, o.created_at, o.updated_at, users.display_name AS agent_name, users.role AS agent_role,
            ap.license_number, ap.brokerage_name
     FROM pre_listing_price_opinions o JOIN users ON users.id = o.agent_user_id LEFT JOIN agent_profiles ap ON ap.user_id = o.agent_user_id
     WHERE o.pre_listing_id = ?1 AND users.status = 'active' AND ${notBlockedByOwnersSql('pre_listing', '?1', 'o.agent_user_id')}`
  ).bind(preListingId).all();
  const voteRows = await db.prepare(
    `SELECT v.agent_user_id, v.vote, v.note, v.created_at, users.display_name AS agent_name, users.role AS agent_role,
            ap.license_number, ap.brokerage_name
     FROM pre_listing_price_votes v JOIN users ON users.id = v.agent_user_id LEFT JOIN agent_profiles ap ON ap.user_id = v.agent_user_id
     WHERE v.pre_listing_id = ?1 AND users.status = 'active' AND ${notBlockedByOwnersSql('pre_listing', '?1', 'v.agent_user_id')}`
  ).bind(preListingId).all();
  // One entry per agent who either voted or gave an opinion.
  const byAgent = new Map();
  // isPlatformOperator: the admin account that runs Amico Haus, when it weighs in as an agent (always labeled).
  const entry = (r) => {
    const id = r.agent_user_id;
    if (!byAgent.has(id)) {
      byAgent.set(id, {
        agentUserId: id, agentName: r.agent_name, licenseNumber: r.license_number || '', brokerageName: r.brokerage_name || '',
        isPlatformOperator: r.agent_role === 'admin', vote: null, note: '', priceOpinion: null, comps: [], prep: [], deck: null, updatedAt: null,
      });
    }
    return byAgent.get(id);
  };
  // When each agent weighed in: their opinion row's created_at (an edit never resets it), else their vote's.
  const arrived = new Map();
  for (const r of voteRows.results) { Object.assign(entry(r), { vote: r.vote, note: r.note }); arrived.set(r.agent_user_id, r.created_at || ''); }
  for (const r of opinionRows.results) {
    arrived.set(r.agent_user_id, r.created_at || arrived.get(r.agent_user_id) || '');
    const e = entry(r);
    Object.assign(e, {
      note: r.note || e.note, priceOpinion: r.price_opinion, comps: parseComps(r.comps_json), prep: validatePrep(parseComps(r.prep_json)),
      deck: r.deck_name ? { name: r.deck_name, size: r.deck_size } : null, updatedAt: r.updated_at,
    });
  }
  // In the order they arrived, oldest first (never by the number, so the biggest one isn't put on top).
  const opinions = [...byAgent.values()].sort((a, b) => {
    const at = arrived.get(a.agentUserId) || '';
    const bt = arrived.get(b.agentUserId) || '';
    return at < bt ? -1 : at > bt ? 1 : a.agentUserId - b.agentUserId;
  });
  const prices = opinions.map(o => o.priceOpinion).filter(p => Number.isInteger(p)).sort((a, b) => a - b);
  const summary = prices.length >= OPINION_SUMMARY_MIN ? { count: prices.length, low: prices[0], high: prices[prices.length - 1] } : null;
  // "Fix before you list": each recommended item with how many agents suggested it, most-agreed first.
  const counts = new Map();
  for (const o of opinions) for (const k of o.prep) counts.set(k, (counts.get(k) || 0) + 1);
  const prepSummary = [...counts.entries()].map(([key, count]) => ({ key, label: PREP_ITEMS[key], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { opinions, summary, prepSummary };
}

