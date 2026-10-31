// Brag Cards and the live profile badge: an agent's measured Amico Haus stats, worded for sharing. Only what Amico
// Haus records itself (never past-client reviews, which the agent collects and nobody has verified), each with a minimum sample, scoped to Amico Haus and dated ("as of Oct 2026"), never a
// bare "#1" (B&P 17500 and DRE advertising rules). The agent's name, DRE number and brokerage always go with them.
import { fetchAgentStats, fetchAgentRatingSummary } from './marketplace.js';
import { fetchFoundingZips } from './zipBoard.js';
import { DEMO_EMAIL_PATTERN } from './util.js';

const MIN_REVIEWS = 3;
const MIN_PROPOSALS_FOR_SPEED = 3;

function speedText(hours) {
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `about ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `about ${days} day${days === 1 ? '' : 's'}`;
}

// null when the agent isn't an approved, active, real agent.
export async function fetchBragStats(db, agentUserId) {
  const row = await db.prepare(
    `SELECT agent_profiles.license_number, agent_profiles.brokerage_name, agent_profiles.reviewed_at, users.display_name, users.role
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.user_id = ? AND agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ?`
  ).bind(agentUserId, DEMO_EMAIL_PATTERN).first();
  if (!row) return null;
  const rating = await fetchAgentRatingSummary(db, agentUserId);
  const stats = await fetchAgentStats(db, agentUserId, { rating, approvedAt: row.reviewed_at || null });
  const founding = (await fetchFoundingZips(db, [agentUserId])).get(agentUserId) || [];

  const items = [];
  if (founding.length) items.push(`Founding agent · ${founding.join(', ')}`);
  if (stats.acceptedBids > 0) items.push(`Hired ${stats.acceptedBids} time${stats.acceptedBids === 1 ? '' : 's'} on Amico Haus`);
  if (stats.finalistCount > 0) items.push(`Finalist on ${stats.finalistCount} home${stats.finalistCount === 1 ? '' : 's'}`);
  if (rating.reviewCount >= MIN_REVIEWS && rating.avgRating !== null) items.push(`★ ${rating.avgRating} from ${rating.reviewCount} homeowners who hired them`);
  if (stats.totalBids >= MIN_PROPOSALS_FOR_SPEED && stats.avgResponseHours !== null) items.push(`Typical proposal in ${speedText(stats.avgResponseHours)}`);

  return {
    // The account that runs Amico Haus is labeled wherever it competes (Fair Play rule 4), its own card and badge
    // included. Kept apart from items, which are measured stats only.
    isPlatformOperator: row.role === 'admin',
    userId: agentUserId, name: row.display_name, licenseNumber: row.license_number || '', brokerage: row.brokerage_name || '',
    items, asOf: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'America/Los_Angeles' }),
  };
}
