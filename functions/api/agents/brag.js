import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../_lib/util.js';
import { fetchBragStats } from '../../_lib/brag.js';

// The signed-in agent's own measured stats for their Brag Card and badge.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const brag = await fetchBragStats(context.env.DB, user.id);
  if (!brag) return forbidden('Brag Cards are for approved agents.');
  return json({ brag });
}
