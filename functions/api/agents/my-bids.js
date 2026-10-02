import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchAgentOwnBids } from '../../_lib/marketplace.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const bids = await fetchAgentOwnBids(context.env.DB, user.id);
  return json({ bids });
}
