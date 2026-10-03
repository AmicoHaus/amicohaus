import { json, notFound } from '../../_lib/util.js';
import { getSessionUser } from '../../_lib/auth.js';
import { getAgentProfile, fetchAgentPortfolioPhotos } from '../../_lib/agents.js';
import { fetchAgentReviews, fetchAgentRatingSummary, fetchAgentStats } from '../../_lib/marketplace.js';
import { fetchFavoriteAgentIds } from '../../_lib/favoriteAgents.js';
import { fetchAgentPackages } from '../../_lib/agentPackages.js';
import { fetchCaseStudies } from '../../_lib/caseStudies.js';
import { fetchActiveTeamName } from '../../_lib/agentTeams.js';

// Public, no-login-required — same reasoning as /api/users/[id].js: a
// homeowner reviewing proposals needs to see an agent's profile before
// they've necessarily signed in themselves. Only ever exposes an approved
// profile — a pending or rejected applicant isn't discoverable.
export async function onRequestGet(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFound('Agent not found.');

  const db = context.env.DB;
  const profile = await getAgentProfile(db, id);
  if (!profile || profile.status !== 'approved') return notFound('Agent not found.');

  const user = await db.prepare('SELECT display_name, is_verified FROM users WHERE id = ?').bind(id).first();
  if (!user) return notFound('Agent not found.');

  const photos = await fetchAgentPortfolioPhotos(db, id);
  const reviews = await fetchAgentReviews(db, id);
  const ratingSummary = await fetchAgentRatingSummary(db, id);
  const stats = await fetchAgentStats(db, id);
  const packages = await fetchAgentPackages(db, id);
  const caseStudies = await fetchCaseStudies(db, id);
  const teamName = await fetchActiveTeamName(db, id);

  const viewer = await getSessionUser(context);
  const isFavorited = viewer ? (await fetchFavoriteAgentIds(db, viewer.id)).includes(id) : false;

  // The public view leaves out the agent's own settings and review bookkeeping.
  const { notifyNewRequests, rejectionReason, appliedAt, reviewedAt, ...publicProfile } = profile;

  return json({
    profile: { ...publicProfile, displayName: user.display_name, isVerified: !!user.is_verified, teamName },
    photos, reviews, ratingSummary, stats, packages, caseStudies, isFavorited,
  });
}
