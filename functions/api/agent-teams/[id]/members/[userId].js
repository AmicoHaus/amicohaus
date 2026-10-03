import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../../../_lib/util.js';
import { fetchMyTeamRow, respondToInvite, removeFromTeam } from '../../../../_lib/agentTeams.js';

// action: 'accept' | 'decline' (the invited person only, on their own still-pending invite) · 'leave' (an active
// member, on themselves) · 'remove' (the team owner, on someone else).
export async function onRequestPut(context) {
  const teamId = context.params.id;
  const targetUserId = Number(context.params.userId);
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const db = context.env.DB;

  if (body.action === 'accept' || body.action === 'decline') {
    if (targetUserId !== user.id) return forbidden();
    const result = await respondToInvite(db, user.id, body.action === 'accept');
    if (result.error) return badRequest(result.error);
    return json({ ok: true });
  }

  if (body.action === 'leave') {
    if (targetUserId !== user.id) return forbidden();
    const result = await removeFromTeam(db, teamId, user.id);
    if (result.error) return badRequest(result.error);
    return json({ ok: true });
  }

  if (body.action === 'remove') {
    const mine = await fetchMyTeamRow(db, user.id);
    if (!mine || String(mine.team_id) !== String(teamId) || mine.role !== 'owner') return forbidden('Only the team owner can remove a member.');
    if (targetUserId === user.id) return badRequest('Use "leave" to remove yourself.');
    const result = await removeFromTeam(db, teamId, targetUserId);
    if (result.error) return badRequest(result.error);
    return json({ ok: true });
  }

  return badRequest('Unknown action.');
}
