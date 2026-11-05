import { json, notFound, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { getSessionUser } from '../../_lib/auth.js';
import { moderationFields, authorAgentJoin, AUTHOR_AGENT_COLUMNS } from '../../_lib/moderation.js';

// Seeded demo accounts (no password, can never reply) are excluded from a
// real user's view of a group's members and posts.
export async function onRequestGet(context) {
  const id = context.params.id;
  const viewer = await getSessionUser(context);
  const db = context.env.DB;

  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first();
  if (!group) return notFound('Group not found.');

  const members = await db.prepare(
    `SELECT listings.id AS listing_id, listings.neighborhood, listings.city, listings.state,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value,
            users.id AS owner_id, users.display_name AS owner_name
     FROM group_memberships
     JOIN users ON users.id = group_memberships.user_id
     LEFT JOIN listings ON listings.user_id = users.id AND listings.status = 'active'
     WHERE group_memberships.group_id = ? AND users.email NOT LIKE ?
     ORDER BY listings.created_at DESC LIMIT 100`
  ).bind(id, DEMO_EMAIL_PATTERN).all();

  const blockClause = viewer
    ? `AND NOT EXISTS (
         SELECT 1 FROM user_blocks
         WHERE (user_blocks.blocker_id = ? AND user_blocks.blocked_id = posts.user_id)
            OR (user_blocks.blocker_id = posts.user_id AND user_blocks.blocked_id = ?)
       )`
    : '';
  // An approved agent's post carries their identity line (authorAgent), the same as the main feed (posts/index.js).
  // A hidden post (moderation.js) shows only to its author and admins, the same as posts/index.js.
  const hiddenClause = 'AND (posts.hidden_at IS NULL OR posts.user_id = ? OR ? = 1)';
  const hiddenParams = [viewer ? viewer.id : 0, viewer && viewer.role === 'admin' ? 1 : 0];
  const posts = await db.prepare(
    `SELECT posts.id, posts.user_id, posts.body, posts.created_at, posts.hidden_at, posts.hidden_reason, users.display_name AS author_name, ${AUTHOR_AGENT_COLUMNS},
            (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id AND comments.hidden_at IS NULL) AS comment_count
     FROM posts JOIN users ON users.id = posts.user_id ${authorAgentJoin('posts.user_id')}
     WHERE posts.group_id = ? AND users.email NOT LIKE ? ${blockClause} ${hiddenClause}
     ORDER BY posts.created_at DESC LIMIT 50`
  ).bind(id, DEMO_EMAIL_PATTERN, ...(viewer ? [viewer.id, viewer.id] : []), ...hiddenParams).all();

  return json({
    group, members: members.results,
    posts: posts.results.map(r => ({
      id: r.id, user_id: r.user_id, body: r.body, created_at: r.created_at, author_name: r.author_name,
      like_count: r.like_count, comment_count: r.comment_count,
      ...moderationFields(r, viewer),
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
