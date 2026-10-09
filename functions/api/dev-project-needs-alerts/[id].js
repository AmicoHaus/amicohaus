import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { deleteDevProjectAlert } from '../../_lib/devProjectNeedsAlerts.js';

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  await deleteDevProjectAlert(context.env.DB, user.id, context.params.id);
  return json({ ok: true });
}
