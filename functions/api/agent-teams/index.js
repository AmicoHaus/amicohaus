import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../_lib/util.js';
import { isApprovedAgent } from '../../_lib/agents.js';
import { createTeam } from '../../_lib/agentTeams.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can create a team.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await createTeam(db, user.id, body.name);
  if (result.error) return badRequest(result.error);
  return json(result, { status: 201 });
}
