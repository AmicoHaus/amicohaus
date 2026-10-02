import { json } from '../../_lib/util.js';
import { fetchServiceEstimates } from '../../_lib/agents.js';

// Public — a homeowner deciding whether to post a pre-listing should be able
// to see typical prep costs before signing in.
export async function onRequestGet(context) {
  const estimates = await fetchServiceEstimates(context.env.DB);
  return json({ estimates });
}
