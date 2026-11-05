// Opinion Refresh + price opinion history (R3-1b, migration_v44).
// Every number an agent gives a home is kept as a version (preListings.js castPriceVote, and the refresh answers
// here), so the homeowner has a private history per agent. Every 90 days the homeowner can ask the agents who gave a
// number for a fresh look: each one answers Same or Update (with a one-line reason, and optionally a new comparable
// sale). Jury test: each history is one agent's own numbers, labeled "Agent price opinion, not an appraisal". Nothing
// here is ever averaged, ranked or combined across agents, and nothing is published: only the homeowner and that agent
// ever see an agent's history or ask. All times are SQL UTC text ('YYYY-MM-DD HH:MM:SS', like datetime('now')).
import { clampString } from './util.js';
import { notBlockedByOwnersSql } from './blocks.js';
import { sqlTime } from './decisionNight.js';
import { sqlUtc } from './contactPolicy.js';
import { ensureFirstVersionStmt, addVersionStmt, validateComps } from './preListings.js';
import { notifyOpinionRefreshAsked } from './marketplaceNotify.js';

export const REFRESH_EVERY_DAYS = 90;
export const REFRESH_SKIP_RECENT_DAYS = 30;
export const REFRESH_REASON_MAX = 140;
export const OPINION_LABEL = 'Agent price opinion, not an appraisal';
const DAY_MS = 86400000;

// Agents whose number the owner can see (?1 = pre-listing, ?2 = owner): an active account with an approved profile,
// a number on file, and no block either way with the owner.
const VISIBLE_PRICED = `FROM pre_listing_price_opinions o JOIN users u ON u.id = o.agent_user_id JOIN agent_profiles ap ON ap.user_id = o.agent_user_id
  WHERE o.pre_listing_id = ?1 AND o.price_opinion IS NOT NULL AND o.agent_user_id != ?2
    AND u.status = 'active' AND ap.status = 'approved' AND ${notBlockedByOwnersSql('pre_listing', '?1', 'o.agent_user_id')}`;
// ...and who haven't touched it in the last 30 days (a fresh number needs no fresh look).
const RECENT_CUTOFF = `datetime('now', '-${REFRESH_SKIP_RECENT_DAYS} days')`;
const ELIGIBLE = `${VISIBLE_PRICED} AND o.updated_at <= ${RECENT_CUTOFF}`;

export const REFRESH_ERRORS = {
  not_open: 'Only an open pre-listing can ask for fresh price opinions.',
  no_opinions: 'No agent has shared a price opinion to refresh yet.',
  all_recent: "Your agents' price opinions are all from the last 30 days.",
};
export const NO_REFRESH_ASK = "There's no refresh request waiting for you on this home.";

// "Feb 2, 2027" (Pacific) for a SQL UTC time.
function dateLabel(sqlText) {
  const ms = sqlTime(sqlText);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : '';
}
const plusDays = (sqlText, days) => {
  const ms = sqlTime(sqlText);
  return Number.isFinite(ms) ? sqlUtc(ms + days * DAY_MS) : null;
};
function tooSoon(availableAt) {
  return { error: `You can ask for fresh opinions on ${dateLabel(availableAt)}.`, code: 'refresh_too_soon', availableAt };
}
function refusal(reason, availableAt) {
  if (reason === 'too_soon') return tooSoon(availableAt);
  return { error: REFRESH_ERRORS[reason] || REFRESH_ERRORS.not_open, code: reason };
}

// The last round (when there is one): how many agents were asked and how many have answered (active, unblocked only).
async function lastRoundFor(db, row) {
  if (!row.opinions_refreshed_at) return null;
  const r = await db.prepare(
    `SELECT COUNT(*) AS asked, COALESCE(SUM(a.answer IS NOT NULL), 0) AS answered
     FROM pre_listing_opinion_asks a JOIN users u ON u.id = a.agent_user_id
     WHERE a.pre_listing_id = ?1 AND a.asked_at = ?2 AND u.status = 'active' AND ${notBlockedByOwnersSql('pre_listing', '?1', 'a.agent_user_id')}`
  ).bind(row.id, row.opinions_refreshed_at).first();
  return { askedAt: row.opinions_refreshed_at, asked: Number(r ? r.asked : 0), answered: Number(r ? r.answered : 0) };
}

// Can the owner ask for a fresh look now? { canRequest, reason, availableAt, lastRound }.
// reason: 'not_open' | 'no_opinions' | 'too_soon' | 'all_recent' | null. availableAt: the first moment they can (90
// days after the first opinion, and 90 days after the last round), or null when there's no opinion yet.
export async function opinionRefreshStatus(db, row) {
  const lastRound = await lastRoundFor(db, row);
  if (row.status !== 'open') return { canRequest: false, reason: 'not_open', availableAt: null, lastRound };
  const agg = await db.prepare(
    `SELECT COUNT(*) AS priced, COALESCE(SUM(o.updated_at <= ${RECENT_CUTOFF}), 0) AS eligible, MIN(o.created_at) AS first_created ${VISIBLE_PRICED}`
  ).bind(row.id, row.user_id).first();
  const priced = Number(agg ? agg.priced : 0);
  const eligible = Number(agg ? agg.eligible : 0);
  let availableAt = priced ? plusDays(agg.first_created, REFRESH_EVERY_DAYS) : null;
  const afterRound = plusDays(row.opinions_refreshed_at, REFRESH_EVERY_DAYS);
  if (afterRound && (!availableAt || afterRound > availableAt)) availableAt = afterRound;
  let reason = null;
  if (!priced) reason = 'no_opinions';
  else if (availableAt && sqlUtc(Date.now()) < availableAt) reason = 'too_soon';
  else if (!eligible) reason = 'all_recent';
  return { canRequest: reason === null, reason, availableAt, lastRound };
}

// The owner asks every eligible agent for a fresh look. One round per 90 days, claimed with a conditional UPDATE.
// Returns { asked, agentIds } or { error, code, availableAt? }.
export async function startOpinionRefresh(context, row, ownerId) {
  const db = context.env.DB;
  const status = await opinionRefreshStatus(db, row);
  if (!status.canRequest) return refusal(status.reason, status.availableAt);
  const prev = row.opinions_refreshed_at ?? null;
  const claimed = await db.prepare(
    `UPDATE pre_listings SET opinions_refreshed_at = datetime('now')
     WHERE id = ?1 AND user_id = ?2 AND status = 'open'
       AND (opinions_refreshed_at IS NULL OR opinions_refreshed_at <= datetime('now', '-${REFRESH_EVERY_DAYS} days'))
     RETURNING opinions_refreshed_at`
  ).bind(row.id, ownerId).first();
  if (!claimed) {
    // Someone (another tab) just claimed it, or the home changed: say when they can ask next.
    const fresh = await db.prepare('SELECT * FROM pre_listings WHERE id = ?').bind(row.id).first();
    if (!fresh || fresh.status !== 'open') return refusal('not_open');
    const again = await opinionRefreshStatus(db, fresh);
    return tooSoon(again.availableAt);
  }
  const askedAt = claimed.opinions_refreshed_at;
  const rows = await db.prepare(
    `INSERT OR IGNORE INTO pre_listing_opinion_asks (pre_listing_id, agent_user_id, asked_at)
     SELECT ?1, o.agent_user_id, ?3 ${ELIGIBLE}
     RETURNING agent_user_id`
  ).bind(row.id, ownerId, askedAt).all();
  const agentIds = (rows.results || []).map(r => r.agent_user_id);
  if (!agentIds.length) {
    // Every eligible agent changed their number in the meantime: give the round back, so the owner doesn't lose 90 days.
    await db.prepare('UPDATE pre_listings SET opinions_refreshed_at = ?1 WHERE id = ?2 AND opinions_refreshed_at = ?3').bind(prev, row.id, askedAt).run();
    return refusal('all_recent');
  }
  context.waitUntil(notifyOpinionRefreshAsked(context, row.id, agentIds));
  return { asked: agentIds.length, agentIds };
}

// Only the sold-home facts of a new comparable sale (never anything about people).
function compFromBody(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { comp: null };
  const picked = { address: raw.address, soldPrice: raw.soldPrice, soldDate: raw.soldDate, sqft: raw.sqft };
  const checked = validateComps([picked]);
  if (checked.error) return { error: checked.error.replace(/^Comp 1:/, 'The new comparable sale:') };
  if (!checked.comps.length) return { comp: null };
  const c = checked.comps[0];
  return { comp: { address: c.address, soldPrice: c.soldPrice, soldDate: c.soldDate, sqft: c.sqft } };
}

// An agent answers the owner's request: 'same' (one tap, an optional reason) or 'update' (a new number and a one-line
// reason, optionally a new comparable sale). beforeWrite: the route's rate limit, run once the input is valid.
// Returns { ok, answer } | { error, code? } | { rateLimited: true }.
export async function answerOpinionRefresh(db, row, agentUserId, body, { beforeWrite = null } = {}) {
  const ask = await db.prepare(
    `SELECT a.id FROM pre_listing_opinion_asks a JOIN pre_listings p ON p.id = a.pre_listing_id
     WHERE a.pre_listing_id = ?1 AND a.agent_user_id = ?2 AND a.answer IS NULL AND a.asked_at = p.opinions_refreshed_at`
  ).bind(row.id, agentUserId).first();
  if (!ask) return { error: NO_REFRESH_ASK, code: 'no_refresh_ask' };
  const opinion = await db.prepare('SELECT price_opinion FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = ?').bind(row.id, agentUserId).first();
  if (!opinion) return { error: NO_REFRESH_ASK, code: 'no_refresh_ask' };

  let answer = body && typeof body === 'object' ? body.answer : null;
  if (answer !== 'same' && answer !== 'update') return { error: 'Pick Same or Update.' };
  const current = opinion.price_opinion;
  const reason = clampString(body.reason, REFRESH_REASON_MAX);
  let price = current;
  let comp = null;
  if (answer === 'same') {
    if (current === null || current === undefined) return { error: 'Share your number with Update.' };
  } else {
    price = Number(body.priceOpinion);
    if (!Number.isInteger(price) || price < 10000 || price > 500000000) return { error: 'Your updated price opinion should be a whole-dollar amount.' };
    if (!reason) return { error: 'Add a one-line reason for the change.' };
    const checked = compFromBody(body.comp);
    if (checked.error) return { error: checked.error };
    comp = checked.comp;
    // The same number sent as an update is stored as Same (the reason and comp are kept with it).
    if (price === current) answer = 'same';
  }
  if (beforeWrite && !(await beforeWrite())) return { rateLimited: true };

  const claim = await db.prepare("UPDATE pre_listing_opinion_asks SET answer = ?, answered_at = datetime('now') WHERE id = ? AND answer IS NULL").bind(answer, ask.id).run();
  if (!claim.meta || !claim.meta.changes) return { error: NO_REFRESH_ASK, code: 'no_refresh_ask' };
  // The comp goes only into this version, never into the opinion's own comps.
  const opinionUpdate = answer === 'same'
    ? db.prepare("UPDATE pre_listing_price_opinions SET updated_at = datetime('now') WHERE pre_listing_id = ? AND agent_user_id = ?").bind(row.id, agentUserId)
    : db.prepare("UPDATE pre_listing_price_opinions SET price_opinion = ?, updated_at = datetime('now') WHERE pre_listing_id = ? AND agent_user_id = ?").bind(price, row.id, agentUserId);
  await db.batch([
    ensureFirstVersionStmt(db, row.id, agentUserId),
    opinionUpdate,
    addVersionStmt(db, row.id, agentUserId, price, answer, { reason, comp, askId: ask.id }),
  ]);
  return { ok: true, answer };
}

function parseComp(json) {
  if (!json) return null;
  try { const c = JSON.parse(json); return c && typeof c === 'object' && !Array.isArray(c) ? c : null; } catch { return null; }
}
const trailEntry = (v) => ({ price: v.price_opinion, source: v.source, reason: v.reason || '', comp: parseComp(v.comp_json), at: v.created_at });
// No versions yet (an opinion from before the history began): the number on file stands in as the first one.
const onFileEntry = (price, at) => ({ price, source: 'first', reason: '', comp: null, at, onFile: true });
const askEntry = (a, row) => ({ askedAt: a.asked_at, answer: a.answer ?? null, answeredAt: a.answered_at ?? null, current: a.asked_at === row.opinions_refreshed_at && row.status === 'open' });

// For the owner (called by functions/api/pre-listings/[id].js): the refresh status, and on each agent's entry their
// own history (oldest first) and their latest ask. Only agents already in priceOpinions.opinions get one (that list
// already leaves out suspended and blocked agents). At most 4 statements. No cross-agent figure is ever added.
export async function attachOpinionTrails(db, row, priceOpinions) {
  if (!priceOpinions) return;
  priceOpinions.refresh = await opinionRefreshStatus(db, row);
  const list = priceOpinions.opinions || [];
  for (const o of list) { o.trail = []; o.ask = null; }
  if (!list.length) return;
  const byId = new Map(list.map(o => [o.agentUserId, o]));
  const versions = await db.prepare(
    'SELECT agent_user_id, price_opinion, source, reason, comp_json, created_at FROM pre_listing_opinion_versions WHERE pre_listing_id = ? ORDER BY agent_user_id, created_at, id'
  ).bind(row.id).all();
  for (const v of versions.results || []) {
    const o = byId.get(v.agent_user_id);
    if (o) o.trail.push(trailEntry(v));
  }
  for (const o of list) {
    if (!o.trail.length && o.priceOpinion !== null && o.priceOpinion !== undefined) o.trail.push(onFileEntry(o.priceOpinion, o.updatedAt));
  }
  const asks = await db.prepare(
    'SELECT agent_user_id, asked_at, answer, answered_at FROM pre_listing_opinion_asks WHERE pre_listing_id = ? ORDER BY agent_user_id, asked_at, id'
  ).bind(row.id).all();
  for (const a of asks.results || []) {
    const o = byId.get(a.agent_user_id);
    if (o) o.ask = askEntry(a, row); // the last one wins: their latest ask
  }
}

// For an approved agent: their own history on this home (oldest first), never anyone else's. [] when there's none.
export async function fetchMyOpinionTrail(db, preListingId, agentUserId) {
  const versions = await db.prepare(
    'SELECT price_opinion, source, reason, comp_json, created_at FROM pre_listing_opinion_versions WHERE pre_listing_id = ? AND agent_user_id = ? ORDER BY created_at, id'
  ).bind(Number(preListingId), agentUserId).all();
  if ((versions.results || []).length) return versions.results.map(trailEntry);
  const mine = await db.prepare('SELECT price_opinion, updated_at FROM pre_listing_price_opinions WHERE pre_listing_id = ? AND agent_user_id = ?').bind(Number(preListingId), agentUserId).first();
  return mine && mine.price_opinion !== null && mine.price_opinion !== undefined ? [onFileEntry(mine.price_opinion, mine.updated_at)] : [];
}

// For an approved agent: the latest refresh request to them on this home, or null. pending: it's from the current
// round, unanswered, and the home is still open.
export async function fetchMyRefreshAsk(db, row, agentUserId) {
  const a = await db.prepare(
    'SELECT asked_at, answer, answered_at FROM pre_listing_opinion_asks WHERE pre_listing_id = ? AND agent_user_id = ? ORDER BY asked_at DESC, id DESC LIMIT 1'
  ).bind(row.id, agentUserId).first();
  if (!a) return null;
  const answer = a.answer ?? null;
  return { askedAt: a.asked_at, answer, answeredAt: a.answered_at ?? null, pending: answer === null && a.asked_at === row.opinions_refreshed_at && row.status === 'open' };
}
