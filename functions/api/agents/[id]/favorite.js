import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, badRequest, notFound } from '../../../_lib/util.js';
import { toggleFavoriteAgent } from '../../../_lib/favoriteAgents.js';

export async function onRequestPost(context) {
  const agentUserId = Number(context.params.id);
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (!Number.isInteger(agentUserId)) return badRequest('Invalid agent.');

  const result = await toggleFavoriteAgent(context.env.DB, user.id, agentUserId);
  if (result.error) return result.notFound ? notFound(result.error) : badRequest(result.error);
  return json(result);
}
