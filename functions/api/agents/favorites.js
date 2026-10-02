import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchFavoriteAgents } from '../../_lib/favoriteAgents.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const agents = await fetchFavoriteAgents(context.env.DB, user.id);
  return json({ agents });
}
