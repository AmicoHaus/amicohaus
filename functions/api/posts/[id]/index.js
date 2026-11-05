import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { hidePostAs, reasonFrom } from '../../../_lib/moderation.js';

// The author deletes their own post. An admin taking down someone else's hides it instead, with a reason the author
// is told (moderation.js).
export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first();
  if (!post) return notFound('Post not found.');

  if (post.user_id === user.id) {
    await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  if (user.role !== 'admin') return forbidden();

  const { reason } = await reasonFrom(context.request);
  const result = await hidePostAs(db, user, id, reason);
  if (result.notFound) return notFound('Post not found.');
  if (result.error) return json({ error: result.error, code: result.code }, { status: 400 });
  await logAdminAction(db, user.id, 'hide_post', 'post', id, { reason: result.reason });
  return json({ ok: true, hidden: true });
}
