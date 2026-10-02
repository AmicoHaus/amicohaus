import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchMyInvites } from '../../_lib/agentInvites.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const invites = await fetchMyInvites(context.env.DB, user.id);
  return json({ invites });
}
