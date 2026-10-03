import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchMyTeamRow, fetchTeamDetail } from '../../_lib/agentTeams.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const row = await fetchMyTeamRow(db, user.id);
  if (!row) return json({ team: null });
  const team = await fetchTeamDetail(db, row.team_id);
  return json({ team, myStatus: row.status, myRole: row.role });
}
