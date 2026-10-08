import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { deleteGreenAlert } from '../../_lib/greenNeedsAlerts.js';

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  await deleteGreenAlert(context.env.DB, user.id, context.params.id);
  return json({ ok: true });
}
