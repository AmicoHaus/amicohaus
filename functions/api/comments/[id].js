import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../_lib/util.js';
import { logAdminAction } from '../../_lib/audit.js';
import { hideCommentAs, reasonFrom } from '../../_lib/moderation.js';

// The author deletes their own comment. Anyone else allowed to take it down (an admin with a reason, or the home's
// owner on their own home's thread) hides it instead, and the author is told why (moderation.js).
export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const comment = await db.prepare('SELECT user_id FROM comments WHERE id = ?').bind(id).first();
  if (!comment) return notFound('Comment not found.');

  if (comment.user_id === user.id) {
    await db.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  const { reason } = await reasonFrom(context.request);
  const result = await hideCommentAs(db, user, id, reason);
  if (result.notFound) return notFound('Comment not found.');
  if (result.forbidden) return forbidden();
  if (result.error) return json({ error: result.error, code: result.code }, { status: 400 });
  if (result.asAdmin) await logAdminAction(db, user.id, 'hide_comment', 'comment', id, { reason: result.reason });
  return json({ ok: true, hidden: true });
}
