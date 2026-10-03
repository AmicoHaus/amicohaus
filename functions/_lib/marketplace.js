// Shared proposal/bid + review logic for the Pre-Listings Marketplace —
// used by both a solo pre-listing and a transaction request opened from an
// existing trade match. The proposal shape (message, fee, included
// services, status) is identical either way, keyed by (request_type,
// request_id) in the polymorphic service_bids table rather than two
// near-duplicate tables per request kind.
import { clampString } from './util.js';
import { validateServices } from './agents.js';
import { seedDefaultMilestones } from './milestones.js';
import { markInviteResponded } from './agentInvites.js';

// A pending proposal that's sat untouched this long gets flagged so the
// homeowner sees a nudge — same idea as matches.js's "gone quiet" flag for
// stale matches, just pointed at proposals instead.
const STALE_PROPOSAL_DAYS = 5;
function isStaleProposal(status, createdAt) {
  if (status !== 'pending') return false;
  const ageMs = Date.now() - new Date(createdAt + 'Z').getTime();
  return ageMs > STALE_PROPOSAL_DAYS * 86400000;
}

function num(value, { min = 0, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

function validateBidInput(body) {
  const message = clampString(body.message, 2000);
  const commissionPct = body.commissionPct ? num(body.commissionPct, { min: 0, max: 100 }) : null;
  const flatFee = body.flatFee ? num(body.flatFee, { min: 0, max: 500000 }) : null;
  const services = validateServices(body.services);

  if (!message) return { error: 'Add a short message explaining your proposal.' };
  if (commissionPct === null && flatFee === null) {
    return { error: 'Enter a commission % or flat fee for this proposal.' };
  }
  return { data: { message, commissionPct, flatFee, services } };
}

// One active proposal per agent per request — re-submitting (including
// after withdrawing or being declined) just overwrites it and puts it back
// to pending, rather than piling up duplicate rows.
export async function upsertBid(db, requestType, requestId, agentUserId, body) {
  const validated = validateBidInput(body);
  if (validated.error) return validated;
  const d = validated.data;

  await db.prepare(
    `INSERT INTO service_bids (request_type, request_id, agent_user_id, message, commission_pct, flat_fee, services_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(request_type, request_id, agent_user_id) DO UPDATE SET
       message = excluded.message, commission_pct = excluded.commission_pct, flat_fee = excluded.flat_fee,
       services_json = excluded.services_json, status = 'pending', updated_at = datetime('now')`
  ).bind(requestType, requestId, agentUserId, d.message, d.commissionPct, d.flatFee, JSON.stringify(d.services)).run();

  await markInviteResponded(db, requestType, requestId, agentUserId);
  return { ok: true };
}

export async function withdrawBid(db, bidId, agentUserId) {
  await db.prepare(
    "UPDATE service_bids SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ? AND agent_user_id = ? AND status = 'pending'"
  ).bind(bidId, agentUserId).run();
}

function mapBidRow(r, stats) {
  return {
    id: r.id, agentUserId: r.agent_user_id, agentName: r.agent_name, isVerified: !!r.is_verified,
    brokerageName: r.brokerage_name, yearsExperience: r.years_experience, hasVideo: !!r.video_r2_key,
    rating: r.agent_rating, reviewCount: r.agent_review_count,
    avgDaysOnMarket: r.avg_days_on_market, homesSoldLastYear: r.homes_sold_last_year,
    openHouseDays: JSON.parse(r.open_house_days_json || '[]'),
    licenseVerified: !!r.license_verified,
    winRate: stats.winRate, topRated: stats.topRated, avgResponseHours: stats.avgResponseHours,
    message: r.message, commissionPct: r.commission_pct, flatFee: r.flat_fee,
    services: JSON.parse(r.services_json || '[]'), status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
    isStale: isStaleProposal(r.status, r.created_at),
  };
}

export async function fetchBids(db, requestType, requestId) {
  const rows = await db.prepare(
    `SELECT service_bids.*, users.display_name AS agent_name, users.is_verified,
            agent_profiles.brokerage_name, agent_profiles.years_experience, agent_profiles.video_r2_key,
            agent_profiles.avg_days_on_market, agent_profiles.homes_sold_last_year, agent_profiles.open_house_days_json,
            agent_profiles.license_verified,
            (SELECT ROUND(AVG(rating), 1) FROM agent_reviews WHERE agent_reviews.agent_user_id = service_bids.agent_user_id) AS agent_rating,
            (SELECT COUNT(*) FROM agent_reviews WHERE agent_reviews.agent_user_id = service_bids.agent_user_id) AS agent_review_count
     FROM service_bids
     JOIN users ON users.id = service_bids.agent_user_id
     LEFT JOIN agent_profiles ON agent_profiles.user_id = service_bids.agent_user_id
     WHERE service_bids.request_type = ? AND service_bids.request_id = ? AND service_bids.status != 'withdrawn'
     ORDER BY service_bids.created_at DESC`
  ).bind(requestType, requestId).all();

  // Win rate / response time / Top Rated pulled from the single shared
  // fetchAgentStats (below) rather than duplicated as SQL subqueries here,
  // so there's one source of truth for what "Top Rated" means.
  return Promise.all(rows.results.map(async r => mapBidRow(r, await fetchAgentStats(db, r.agent_user_id))));
}

export async function fetchMyBid(db, requestType, requestId, agentUserId) {
  const row = await db.prepare(
    'SELECT * FROM service_bids WHERE request_type = ? AND request_id = ? AND agent_user_id = ?'
  ).bind(requestType, requestId, agentUserId).first();
  if (!row) return null;
  return {
    id: row.id, message: row.message, commissionPct: row.commission_pct, flatFee: row.flat_fee,
    services: JSON.parse(row.services_json || '[]'), status: row.status,
  };
}

// An agent's own proposal dashboard, across every pre-listing and
// transaction request they've bid on. Bids reference two different tables
// depending on request_type, so this does two lookups and merges rather
// than one polymorphic join.
export async function fetchAgentOwnBids(db, agentUserId) {
  const rows = await db.prepare('SELECT * FROM service_bids WHERE agent_user_id = ? ORDER BY created_at DESC').bind(agentUserId).all();

  const preListingIds = rows.results.filter(r => r.request_type === 'pre_listing').map(r => r.request_id);
  const transactionIds = rows.results.filter(r => r.request_type === 'transaction').map(r => r.request_id);

  const preListingsById = new Map();
  if (preListingIds.length > 0) {
    const placeholders = preListingIds.map(() => '?').join(',');
    const pl = await db.prepare(`SELECT id, title, city, state, asking_price, status FROM pre_listings WHERE id IN (${placeholders})`).bind(...preListingIds).all();
    for (const r of pl.results) preListingsById.set(r.id, r);
  }
  const transactionsById = new Map();
  if (transactionIds.length > 0) {
    const placeholders = transactionIds.map(() => '?').join(',');
    const tx = await db.prepare(`SELECT id, listing_a_id, listing_b_id, status FROM transaction_requests WHERE id IN (${placeholders})`).bind(...transactionIds).all();
    for (const r of tx.results) transactionsById.set(r.id, r);
  }

  return rows.results.map(r => ({
    id: r.id, requestType: r.request_type, requestId: r.request_id,
    message: r.message, commissionPct: r.commission_pct, flatFee: r.flat_fee,
    services: JSON.parse(r.services_json || '[]'), status: r.status, createdAt: r.created_at,
    preListing: r.request_type === 'pre_listing' ? preListingsById.get(r.request_id) : undefined,
    transaction: r.request_type === 'transaction' ? transactionsById.get(r.request_id) : undefined,
    isStale: isStaleProposal(r.status, r.created_at),
  }));
}

// Accepting one proposal declines every other still-pending one on the same
// request and marks the request itself awarded, all in one batch so there's
// no window where two proposals could both look accepted.
export async function acceptBid(db, requestType, requestId, bidId) {
  const table = requestType === 'pre_listing' ? 'pre_listings' : 'transaction_requests';
  await db.batch([
    db.prepare("UPDATE service_bids SET status = 'declined', updated_at = datetime('now') WHERE request_type = ? AND request_id = ? AND id != ? AND status = 'pending'").bind(requestType, requestId, bidId),
    db.prepare("UPDATE service_bids SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").bind(bidId),
    db.prepare(`UPDATE ${table} SET status = 'awarded', awarded_bid_id = ?, updated_at = datetime('now') WHERE id = ?`).bind(bidId, requestId),
  ]);
  await seedDefaultMilestones(db, requestType, requestId);
}

export function validateReviewInput(body) {
  const rating = num(body.rating, { min: 1, max: 5 });
  if (rating === null) return { error: 'Pick a rating from 1 to 5.' };
  return { data: { rating: Math.round(rating), comment: clampString(body.comment, 1000) } };
}

// Gated to whoever was actually a party to the awarded request, so reviews
// can't be left by someone who was never involved.
export async function canReview(db, requestType, requestId, reviewerUserId, agentUserId) {
  const row = requestType === 'pre_listing'
    ? await db.prepare('SELECT user_id AS a, NULL AS b, awarded_bid_id FROM pre_listings WHERE id = ?').bind(requestId).first()
    : await db.prepare('SELECT user_a_id AS a, user_b_id AS b, awarded_bid_id FROM transaction_requests WHERE id = ?').bind(requestId).first();
  if (!row || !row.awarded_bid_id) return false;
  if (row.a !== reviewerUserId && row.b !== reviewerUserId) return false;

  const bid = await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(row.awarded_bid_id).first();
  return !!bid && bid.agent_user_id === agentUserId;
}

export async function submitReview(db, agentUserId, reviewerUserId, requestType, requestId, body) {
  const validated = validateReviewInput(body);
  if (validated.error) return validated;
  const d = validated.data;

  try {
    await db.prepare(
      `INSERT INTO agent_reviews (agent_user_id, reviewer_user_id, request_type, request_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(agentUserId, reviewerUserId, requestType, requestId, d.rating, d.comment).run();
  } catch {
    return { error: "You've already reviewed this." };
  }
  return { ok: true };
}

export async function fetchAgentReviews(db, agentUserId) {
  const rows = await db.prepare(
    `SELECT agent_reviews.rating, agent_reviews.comment, agent_reviews.created_at, users.display_name AS reviewer_name
     FROM agent_reviews JOIN users ON users.id = agent_reviews.reviewer_user_id
     WHERE agent_reviews.agent_user_id = ? ORDER BY agent_reviews.created_at DESC LIMIT 50`
  ).bind(agentUserId).all();
  return rows.results.map(r => ({ rating: r.rating, comment: r.comment, createdAt: r.created_at, reviewerName: r.reviewer_name }));
}

export async function fetchAgentRatingSummary(db, agentUserId) {
  const row = await db.prepare(
    'SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS n FROM agent_reviews WHERE agent_user_id = ?'
  ).bind(agentUserId).first();
  return { avgRating: row.avg_rating, reviewCount: row.n };
}

// The reciprocal side — an awarded agent rating the homeowner(s) they worked
// with. For a transaction (two homeowners on one engagement), one review row
// is written per homeowner since they're rated independently; a pre-listing
// only ever has the one.
async function reviewableHomeowners(db, requestType, requestId, agentUserId) {
  const row = requestType === 'pre_listing'
    ? await db.prepare('SELECT user_id AS a, NULL AS b, awarded_bid_id FROM pre_listings WHERE id = ?').bind(requestId).first()
    : await db.prepare('SELECT user_a_id AS a, user_b_id AS b, awarded_bid_id FROM transaction_requests WHERE id = ?').bind(requestId).first();
  if (!row || !row.awarded_bid_id) return [];
  const bid = await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(row.awarded_bid_id).first();
  if (!bid || bid.agent_user_id !== agentUserId) return [];
  return [row.a, row.b].filter(Boolean);
}

export async function canReviewHomeowners(db, requestType, requestId, agentUserId) {
  const homeowners = await reviewableHomeowners(db, requestType, requestId, agentUserId);
  return homeowners.length > 0;
}

export async function submitHomeownerReview(db, agentUserId, requestType, requestId, body) {
  const homeowners = await reviewableHomeowners(db, requestType, requestId, agentUserId);
  if (homeowners.length === 0) return { error: 'Not eligible to review on this request.' };

  const validated = validateReviewInput(body);
  if (validated.error) return validated;
  const d = validated.data;

  try {
    await db.batch(homeowners.map(homeownerUserId =>
      db.prepare(
        `INSERT INTO homeowner_reviews (homeowner_user_id, reviewer_user_id, request_type, request_id, rating, comment)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(homeownerUserId, agentUserId, requestType, requestId, d.rating, d.comment)
    ));
  } catch {
    return { error: "You've already reviewed this." };
  }
  return { ok: true };
}

export async function fetchHomeownerRatingSummary(db, homeownerUserId) {
  const row = await db.prepare(
    'SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS n FROM homeowner_reviews WHERE homeowner_user_id = ?'
  ).bind(homeownerUserId).first();
  return { avgRating: row.avg_rating, reviewCount: row.n };
}

// Win rate (accepted / non-withdrawn proposals) and average response time
// (how long after a request opened the agent typically got their proposal
// in) — computed fresh each time rather than stored, same reasoning as
// matches.js never persisting match scores. "Top Rated" is a simple
// threshold on top of these plus the existing review average, not a stored
// flag, so it can never drift out of sync with the underlying numbers.
export async function fetchAgentStats(db, agentUserId) {
  const bidRows = await db.prepare(
    "SELECT id, request_type, request_id, status, created_at FROM service_bids WHERE agent_user_id = ? AND status != 'withdrawn'"
  ).bind(agentUserId).all();
  const bids = bidRows.results;
  const totalBids = bids.length;
  const acceptedBids = bids.filter(b => b.status === 'accepted').length;
  // Only decided bids (accepted/declined) count toward win rate — a
  // still-pending proposal isn't a loss yet.
  const decidedBids = bids.filter(b => b.status === 'accepted' || b.status === 'declined').length;
  const winRate = decidedBids > 0 ? acceptedBids / decidedBids : null;

  const preListingIds = bids.filter(b => b.request_type === 'pre_listing').map(b => b.request_id);
  const transactionIds = bids.filter(b => b.request_type === 'transaction').map(b => b.request_id);
  const openedAtById = new Map();
  if (preListingIds.length > 0) {
    const placeholders = preListingIds.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT id, created_at FROM pre_listings WHERE id IN (${placeholders})`).bind(...preListingIds).all();
    for (const r of rows.results) openedAtById.set(`pre_listing:${r.id}`, r.created_at);
  }
  if (transactionIds.length > 0) {
    const placeholders = transactionIds.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT id, created_at FROM transaction_requests WHERE id IN (${placeholders})`).bind(...transactionIds).all();
    for (const r of rows.results) openedAtById.set(`transaction:${r.id}`, r.created_at);
  }

  const responseHours = [];
  for (const b of bids) {
    const openedAt = openedAtById.get(`${b.request_type}:${b.request_id}`);
    if (!openedAt) continue;
    const hours = (new Date(b.created_at + 'Z') - new Date(openedAt + 'Z')) / 3600000;
    if (Number.isFinite(hours) && hours >= 0) responseHours.push(hours);
  }
  const avgResponseHours = responseHours.length > 0 ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length : null;

  const rating = await fetchAgentRatingSummary(db, agentUserId);
  const topRated = rating.avgRating !== null && rating.avgRating >= 4.5 && rating.reviewCount >= 3 && winRate !== null && winRate >= 0.3;

  return { totalBids, acceptedBids, decidedBids, winRate, avgResponseHours, topRated };
}
