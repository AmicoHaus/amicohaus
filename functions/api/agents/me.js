import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { getAgentProfile, fetchAgentPortfolioPhotos } from '../../_lib/agents.js';
import { fetchAgentStats } from '../../_lib/marketplace.js';
import { fetchAgentPackages } from '../../_lib/agentPackages.js';
import { fetchCaseStudies } from '../../_lib/caseStudies.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const profile = await getAgentProfile(db, user.id);
  if (!profile) return json({ profile: null });

  const photos = await fetchAgentPortfolioPhotos(db, user.id);
  const stats = await fetchAgentStats(db, user.id);
  const packages = await fetchAgentPackages(db, user.id);
  const caseStudies = await fetchCaseStudies(db, user.id);
  return json({ profile, photos, stats, packages, caseStudies });
}
