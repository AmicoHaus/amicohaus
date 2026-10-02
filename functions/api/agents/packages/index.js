import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, badRequest } from '../../../_lib/util.js';
import { fetchAgentPackages } from '../../../_lib/agentPackages.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT 1 FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent) return badRequest('Apply to become an agent before setting up packages.');

  const packages = await fetchAgentPackages(db, user.id);
  return json({ packages });
}
