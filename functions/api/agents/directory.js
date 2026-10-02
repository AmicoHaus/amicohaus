import { json } from '../../_lib/util.js';
import { buildAgentDirectoryEntry, agentMatchesFilters, parseDirectoryFilters } from '../../_lib/agentDirectory.js';

// Public directory of every approved agent — what a homeowner searches to
// find someone specific to invite (see agentInvites.js) or favorite, rather
// than only ever meeting agents through an open marketplace proposal.
// Filtering happens in JS via the shared agentMatchesFilters (see
// agentDirectory.js) — the same function saved agent-search alerts use, so
// "what counts as a match" can never drift between the two.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const filters = parseDirectoryFilters(new URL(context.request.url));

  const rows = await db.prepare(
    "SELECT user_id FROM agent_profiles WHERE status = 'approved' ORDER BY user_id DESC LIMIT 200"
  ).all();

  const agents = [];
  for (const r of rows.results) {
    const entry = await buildAgentDirectoryEntry(db, r.user_id);
    if (!entry) continue;
    if (!(await agentMatchesFilters(db, entry, filters))) continue;

    const { allServiceTypes, ...rest } = entry;
    agents.push(rest);
    if (agents.length >= 100) break;
  }
  // Nearest-first when the homeowner searched by zip — a flat 20-mile
  // in/out cutoff already applied above, but among the matches, closer is
  // still more useful than alphabetical.
  agents.sort((a, b) => filters.zip ? a.distanceMiles - b.distanceMiles : a.displayName.localeCompare(b.displayName));
  return json({ agents });
}
