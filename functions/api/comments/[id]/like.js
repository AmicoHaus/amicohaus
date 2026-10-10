import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { isEitherBlocked } from '../../../_lib/blocks.js';

// Mirrors functions/api/posts/[id]/like.js exactly, one level down for a comment instead of a post.
export async function onRequestPost(context) {
  const commentId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const comment = await db.prepare('SELECT id, user_id FROM comments WHERE id = ?').bind(commentId).first();
  if (!comment) return notFound('Comment not found.');

  if (comment.user_id !== user.id && await isEitherBlocked(db, user.id, comment.user_id)) {
    return forbidden('You cannot like this comment.');
  }

  const existing = await db.prepare('SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?').bind(commentId, user.id).first();
  if (existing) {
    await db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').bind(commentId, user.id).run();
  } else {
    await db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').bind(commentId, user.id).run();
    if (comment.user_id !== user.id) {
      await db.prepare(
        "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'like', ?, '/app')"
      ).bind(comment.user_id, `${user.display_name} liked your comment`).run();
    }
  }

  const count = await db.prepare('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?').bind(commentId).first();
  return json({ liked: !existing, likeCount: count.n });
}
