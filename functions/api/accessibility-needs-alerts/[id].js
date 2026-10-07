import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { deleteAccessibilityAlert } from '../../_lib/accessibilityAlerts.js';

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  await deleteAccessibilityAlert(context.env.DB, user.id, context.params.id);
  return json({ ok: true });
}
