import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString } from '../../../_lib/util.js';
import { isEitherBlocked } from '../../../_lib/blocks.js';

export async function onRequestGet(context) {
  const postId = context.params.id;
  const viewer = await getSessionUser(context);
  const db = context.env.DB;
  // Readable without signing in, like the feed it belongs to. For a signed-in
  // viewer a block hides the other person's comments in either direction,
  // same as the feed does for posts.
  const blockClause = viewer
    ? `AND NOT EXISTS (
         SELECT 1 FROM user_blocks
         WHERE (user_blocks.blocker_id = ? AND user_blocks.blocked_id = comments.user_id)
            OR (user_blocks.blocker_id = comments.user_id AND user_blocks.blocked_id = ?)
       )`
    : '';
  const likedByMeSelect = viewer
    ? '(SELECT 1 FROM comment_likes WHERE comment_likes.comment_id = comments.id AND comment_likes.user_id = ?) AS liked_by_me'
    : '0 AS liked_by_me';
  const rows = await db.prepare(
    `SELECT comments.id, comments.user_id, comments.body, comments.created_at, users.display_name AS author_name,
            (SELECT COUNT(*) FROM comment_likes WHERE comment_likes.comment_id = comments.id) AS like_count,
            ${likedByMeSelect}
     FROM comments JOIN users ON users.id = comments.user_id
     WHERE comments.post_id = ? ${blockClause}
     ORDER BY comments.created_at ASC LIMIT 200`
  ).bind(...(viewer ? [viewer.id] : []), postId, ...(viewer ? [viewer.id, viewer.id] : [])).all();
  return json({ comments: rows.results });
}

export async function onRequestPost(context) {
  const postId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').bind(postId).first();
  if (!post) return notFound('Post not found.');

  if (post.user_id !== user.id && await isEitherBlocked(db, user.id, post.user_id)) {
    return forbidden('You cannot comment on this post.');
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const text = clampString(body.body, 1000);
  if (!text) return badRequest('Comment cannot be empty.');

  const result = await db.prepare(
    'INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)'
  ).bind(postId, user.id, text).run();

  if (post.user_id !== user.id) {
    await db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'comment', ?, '/app')"
    ).bind(post.user_id, `${user.display_name} commented on your post`).run();
  }

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
