import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../../_lib/util.js';
import { inviteToTeam } from '../../../_lib/agentTeams.js';
import { notifyTeamInvite } from '../../../_lib/marketplaceNotify.js';

export async function onRequestPost(context) {
  const teamId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const targetUserId = Number(body.agentUserId);
  if (!Number.isInteger(targetUserId)) return badRequest('Pick an agent to invite.');

  const db = context.env.DB;
  const result = await inviteToTeam(db, teamId, user.id, targetUserId);
  if (result.error) return badRequest(result.error);
  context.waitUntil(notifyTeamInvite(context, targetUserId));
  return json({ ok: true });
}
