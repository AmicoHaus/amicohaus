import { json } from '../../_lib/util.js';
import { fetchServiceEstimates, SERVICE_ESTIMATE_NOTE, MIN_AGENTS_FOR_ESTIMATE } from '../../_lib/agents.js';

// Public — a homeowner deciding whether to post a pre-listing can see the range of fees agents here list before
// signing in. Ranges only (no average), only for services at least MIN_AGENTS_FOR_ESTIMATE agents list, and always
// labeled "Not a quote".
export async function onRequestGet(context) {
  const estimates = await fetchServiceEstimates(context.env.DB);
  return json({ estimates, note: SERVICE_ESTIMATE_NOTE, minAgents: MIN_AGENTS_FOR_ESTIMATE });
}
