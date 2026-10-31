// Bring Your Reviews: an approved agent shares a link with past clients from a period they choose, so a new profile
// doesn't start at zero. These reviews are always labeled "Past client, before Amico Haus" and kept apart from
// reviews of agents hired on Amico Haus (agent_reviews), which are the only ones counted toward Top Rated.
//
// FTC Consumer Reviews Rule / Endorsement Guides: the agent attests they invite every client from the period (not
// only happy ones), nothing is offered for a review, and the agent can never hide or delete one. Only an admin can
// remove a review that breaks the rules, and that's on the admin activity log.
import { clampString, DEMO_EMAIL_PATTERN } from './util.js';

export const PAST_CLIENT_SIDES = { sold: 'Sold a home', bought: 'Bought a home', both: 'Sold and bought' };
const EARLIEST_YEAR = 1980;

export function newInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

export function validateInvitePeriod(body, nowYear = new Date().getFullYear()) {
  const from = Number(body.fromYear);
  const to = Number(body.toYear);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < EARLIEST_YEAR || to > nowYear || from > to) {
    return { error: `Pick the years your past clients bought or sold (${EARLIEST_YEAR} to ${nowYear}).` };
  }
  if (body.attest !== true) return { error: 'Confirm you will send the link to every client from those years, not only the happiest ones.' };
  return { fromYear: from, toYear: to };
}

export function validatePastClientReview(body, period) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Pick a rating from 1 to 5 stars.' };
  if (!Object.hasOwn(PAST_CLIENT_SIDES, body.clientSide)) return { error: 'Tell us whether you sold, bought, or both.' };
  const saleYear = Number(body.saleYear);
  if (!Number.isInteger(saleYear) || saleYear < period.fromYear || saleYear > period.toYear) {
    return { error: `This agent asked for reviews from clients in ${period.fromYear}${period.toYear !== period.fromYear ? `-${period.toYear}` : ''}.` };
  }
  const saleCity = clampString(body.saleCity, 80);
  const saleAddress = clampString(body.saleAddress, 200);
  if (!saleCity) return { error: 'Enter the city of the home.' };
  if (saleAddress.length < 5) return { error: "Enter the home's street address. It stays private: only Amico Haus sees it." };
  const comment = clampString(body.comment, 1500);
  return { data: { rating, clientSide: body.clientSide, saleYear, saleCity, saleAddress, comment } };
}

// The agent behind an invite link, if the link is on and the agent is approved, active and not a demo account.
export async function findInvite(db, token) {
  if (!token || typeof token !== 'string' || token.length > 64) return null;
  return db.prepare(
    `SELECT agent_profiles.user_id, agent_profiles.brokerage_name, agent_profiles.license_number,
            agent_profiles.review_invite_from_year AS from_year, agent_profiles.review_invite_to_year AS to_year, users.display_name
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.review_invite_token = ? AND agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ?`
  ).bind(token, DEMO_EMAIL_PATTERN).first();
}

// Published reviews for a profile (never the street address), newest first.
export async function fetchPastClientReviews(db, agentUserId, { limit = 50 } = {}) {
  const rows = await db.prepare(
    `SELECT r.id, r.rating, r.comment, r.client_side, r.sale_year, r.sale_city, r.created_at, users.display_name AS reviewer_name
     FROM past_client_reviews r JOIN users ON users.id = r.reviewer_user_id
     WHERE r.agent_user_id = ? AND r.status = 'published'
     ORDER BY r.created_at DESC LIMIT ?`
  ).bind(agentUserId, limit).all();
  return rows.results.map(r => ({
    id: r.id, rating: r.rating, comment: r.comment, clientSide: r.client_side, saleYear: r.sale_year, saleCity: r.sale_city,
    createdAt: r.created_at, reviewerName: r.reviewer_name,
  }));
}

export async function fetchPastClientSummary(db, agentUserId) {
  const row = await db.prepare(
    "SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS n FROM past_client_reviews WHERE agent_user_id = ? AND status = 'published'"
  ).bind(agentUserId).first();
  return { avgRating: row && row.n ? row.avg_rating : null, count: row ? row.n : 0 };
}
