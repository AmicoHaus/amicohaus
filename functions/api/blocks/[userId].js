import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  await context.env.DB.prepare(
    'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?'
  ).bind(user.id, context.params.userId).run();

  return json({ ok: true });
}
