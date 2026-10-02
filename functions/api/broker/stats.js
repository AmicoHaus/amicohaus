import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { computeBrokerStats } from '../../_lib/brokerStats.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const stats = await computeBrokerStats(context.env.DB, user.id);
  return json(stats);
}
