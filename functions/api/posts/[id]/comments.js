import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString } from '../../../_lib/util.js';
import { isEitherBlocked } from '../../../_lib/blocks.js';
import { authorAgentJoin, AUTHOR_AGENT_COLUMNS, moderationFields, threadOwnerId } from '../../../_lib/moderation.js';

// A hidden post is gone for everyone but its author and admins.
async function visiblePost(db, postId, viewer) {
  const post = await db.prepare('SELECT id, user_id, hidden_at, listing_id, augmented_home_id, green_home_id, dev_project_id FROM posts WHERE id = ?').bind(postId).first();
  if (!post) return null;
  if (post.hidden_at && !(viewer && (viewer.id === post.user_id || viewer.role === 'admin'))) return null;
  return post;
}

export async function onRequestGet(context) {
  const postId = context.params.id;
  const viewer = await getSessionUser(context);
  const db = context.env.DB;
  const post = await visiblePost(db, postId, viewer);
  if (!post) return notFound('Post not found.');
  // A home's or project's discussion (a deal-thread anchor post, dealThreads.js) is for signed-in members only, the
  // same as on its page.
  if (!viewer && (post.listing_id || post.augmented_home_id || post.green_home_id || post.dev_project_id)) return unauthorized();
  // A feed post's comments are readable without signing in, like the feed it belongs to. For a signed-in
  // viewer a block hides the other person's comments in either direction,
  // same as the feed does for posts. A hidden comment shows only to its author and admins.
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
    `SELECT comments.id, comments.user_id, comments.body, comments.created_at, comments.hidden_at, comments.hidden_reason,
            users.display_name AS author_name, ${AUTHOR_AGENT_COLUMNS},
            (SELECT COUNT(*) FROM comment_likes WHERE comment_likes.comment_id = comments.id) AS like_count,
            ${likedByMeSelect}
     FROM comments JOIN users ON users.id = comments.user_id ${authorAgentJoin('comments.user_id')}
     WHERE comments.post_id = ? ${blockClause}
       AND (comments.hidden_at IS NULL OR comments.user_id = ? OR ? = 1)
     ORDER BY comments.created_at ASC LIMIT 200`
  ).bind(...(viewer ? [viewer.id] : []), postId, ...(viewer ? [viewer.id, viewer.id] : []),
    viewer ? viewer.id : 0, viewer && viewer.role === 'admin' ? 1 : 0).all();

  // The home's owner (and admins) may hide other people's comments on the home's own thread.
  const ownerId = viewer ? await threadOwnerId(db, postId) : null;
  const moderator = !!viewer && (viewer.role === 'admin' || (ownerId !== null && ownerId === viewer.id));
  const comments = rows.results.map(r => ({
    id: r.id, user_id: r.user_id, body: r.body, created_at: r.created_at, author_name: r.author_name,
    like_count: r.like_count, liked_by_me: r.liked_by_me,
    ...moderationFields(r, viewer),
    canHide: moderator && !r.hidden_at && r.user_id !== viewer.id,
  }));
  // liked_by_me, canHide and hidden rows differ per viewer, so no shared cache may keep this.
  return json({ comments }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function onRequestPost(context) {
  const postId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const post = await visiblePost(db, postId, user);
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
