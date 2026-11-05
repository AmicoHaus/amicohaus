import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';

// Unblock. Proposals, price votes and opinions come back into the owner's lists; shared contact info, preview RSVPs,
// showing requests and interviews that ended with the block don't.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const blockedId = Number(context.params.userId);
  if (!Number.isInteger(blockedId) || blockedId <= 0) return badRequest('Invalid user.');

  await context.env.DB.prepare(
    'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?'
  ).bind(user.id, blockedId).run();

  return json({ ok: true });
}
