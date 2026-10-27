import { json } from '../../_lib/util.js';
import { buildAgentDirectoryEntry, agentMatchesFilters, parseDirectoryFilters } from '../../_lib/agentDirectory.js';

const MAX_RESULTS = 100;
const byName = (a, b) => a.displayName.localeCompare(b.displayName);

// Missing values (no reviews, no proposals yet) always sort last, so an agent who's simply new is never ranked above
// or below anyone on a number they don't have yet.
const SORTS = {
  name: byName,
  distance: (a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) || byName(a, b),
  // 3+ reviews first (the same bar Top Rated uses), so one 5-star review can't outrank a 4.8 average over 40.
  highestRated: (a, b) => {
    const tier = e => (e.reviewCount >= 3 ? 0 : e.reviewCount > 0 ? 1 : 2);
    return tier(a) - tier(b) || (b.rating ?? 0) - (a.rating ?? 0) || b.reviewCount - a.reviewCount || byName(a, b);
  },
  mostHired: (a, b) => b.hiresOnPlatform - a.hiresOnPlatform || b.reviewCount - a.reviewCount || byName(a, b),
  fastestProposal: (a, b) => (a.avgResponseHours ?? Infinity) - (b.avgResponseHours ?? Infinity) || byName(a, b),
  // The counterweight to the history-based sorts: lets a homeowner find newly approved agents on purpose.
  newest: (a, b) => (b.approvedAt || '').localeCompare(a.approvedAt || '') || b.userId - a.userId,
};

// Public directory of every approved agent — what a homeowner searches to
// find someone specific to invite (see agentInvites.js) or favorite, rather
// than only ever meeting agents through an open marketplace proposal.
// Filtering happens in JS via the shared agentMatchesFilters (see
// agentDirectory.js) — the same function saved agent-search alerts use, so
// "what counts as a match" can never drift between the two.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const filters = parseDirectoryFilters(url);
  // Nearest-first by default when the homeowner searched by zip; A–Z otherwise. "Nearest" without a zip has nothing to measure.
  // Own keys only: a plain-object lookup would also accept inherited names like "valueOf" or "__proto__".
  let sort = url.searchParams.get('sort');
  if (!Object.hasOwn(SORTS, sort) || (sort === 'distance' && !filters.zip)) sort = filters.zip ? 'distance' : 'name';

  const rows = await db.prepare(
    "SELECT user_id FROM agent_profiles WHERE status = 'approved' ORDER BY user_id DESC LIMIT 200"
  ).all();

  // Every match is collected and sorted before the cut, so the order is true across all agents, not just whichever
  // 100 happened to be scanned first.
  const matches = [];
  for (const r of rows.results) {
    const entry = await buildAgentDirectoryEntry(db, r.user_id);
    if (!entry) continue;
    if (!(await agentMatchesFilters(db, entry, filters))) continue;
    matches.push(entry);
  }
  matches.sort(SORTS[sort]);

  const agents = matches.slice(0, MAX_RESULTS).map(({ allServiceTypes, approvedAt, ...rest }) => rest);
  return json({ agents, sort });
}
