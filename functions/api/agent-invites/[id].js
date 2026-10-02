import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { declineInvite } from '../../_lib/agentInvites.js';

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  await declineInvite(context.env.DB, id, user.id);
  return json({ ok: true });
}
