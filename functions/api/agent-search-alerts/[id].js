import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { deleteAlert } from '../../_lib/agentSearchAlerts.js';

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  await deleteAlert(context.env.DB, user.id, context.params.id);
  return json({ ok: true });
}
