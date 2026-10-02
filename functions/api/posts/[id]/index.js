import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first();
  if (!post) return notFound('Post not found.');
  if (post.user_id !== user.id && user.role !== 'admin') return forbidden();

  await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  if (user.role === 'admin' && post.user_id !== user.id) {
    await logAdminAction(db, user.id, 'delete_post', 'post', id);
  }
  return json({ ok: true });
}
