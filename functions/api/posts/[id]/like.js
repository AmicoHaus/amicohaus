import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { isEitherBlocked } from '../../../_lib/blocks.js';

export async function onRequestPost(context) {
  const postId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').bind(postId).first();
  if (!post) return notFound('Post not found.');

  if (post.user_id !== user.id && await isEitherBlocked(db, user.id, post.user_id)) {
    return forbidden('You cannot like this post.');
  }

  const existing = await db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').bind(postId, user.id).first();
  if (existing) {
    await db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').bind(postId, user.id).run();
  } else {
    await db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').bind(postId, user.id).run();
    if (post.user_id !== user.id) {
      await db.prepare(
        "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'like', ?, '/app')"
      ).bind(post.user_id, `${user.display_name} liked your post`).run();
    }
  }

  const count = await db.prepare('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?').bind(postId).first();
  return json({ liked: !existing, likeCount: count.n });
}
