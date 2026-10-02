import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, clampString, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const groupId = url.searchParams.get('groupId');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
  const viewer = await getSessionUser(context);

  // Hide posts to/from anyone in a block relationship with the viewer, in
  // either direction — a block should be effective regardless of who blocked whom.
  const blockClause = viewer
    ? `AND NOT EXISTS (
         SELECT 1 FROM user_blocks
         WHERE (user_blocks.blocker_id = ? AND user_blocks.blocked_id = posts.user_id)
            OR (user_blocks.blocker_id = posts.user_id AND user_blocks.blocked_id = ?)
       )`
    : '';
  const blockParams = viewer ? [viewer.id, viewer.id] : [];

  const baseSelect = `SELECT posts.id, posts.user_id, posts.body, posts.created_at, posts.listing_id, users.display_name AS author_name,
            (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
     FROM posts JOIN users ON users.id = posts.user_id`;

  // Seeded demo accounts (no password, can never reply) are excluded from
  // every real-facing feed — they only ever show up on the public /demo
  // showcase page, which queries them separately (api/demo-overview.js).
  const query = groupId
    ? db.prepare(`${baseSelect} WHERE posts.group_id = ? AND users.email NOT LIKE ? ${blockClause} ORDER BY posts.created_at DESC LIMIT ?`)
        .bind(groupId, DEMO_EMAIL_PATTERN, ...blockParams, limit)
    : db.prepare(`${baseSelect} WHERE posts.group_id IS NULL AND users.email NOT LIKE ? ${blockClause} ORDER BY posts.created_at DESC LIMIT ?`)
        .bind(DEMO_EMAIL_PATTERN, ...blockParams, limit);

  const rows = await query.all();
  return json({ posts: rows.results });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const text = clampString(body.body, 2000);
  if (!text) return badRequest('Post cannot be empty.');

  const db = context.env.DB;
  const groupId = body.groupId ? Number(body.groupId) : null;
  const listingId = body.listingId ? Number(body.listingId) : null;

  const result = await db.prepare(
    'INSERT INTO posts (user_id, listing_id, group_id, body) VALUES (?, ?, ?, ?)'
  ).bind(user.id, listingId, groupId, text).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
