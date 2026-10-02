import { json, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';

// Seeded demo accounts (no password, can never reply) are excluded from the
// member count real users see — otherwise a group could show, say, 40
// members and then a near-empty post feed once demo posts are filtered out
// of functions/api/posts/index.js, which reads as broken rather than quiet.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT groups.id, groups.type, groups.key, groups.label, COUNT(users.id) AS member_count
     FROM groups
     LEFT JOIN group_memberships ON group_memberships.group_id = groups.id
     LEFT JOIN users ON users.id = group_memberships.user_id AND users.email NOT LIKE ?
     GROUP BY groups.id
     ORDER BY groups.type, member_count DESC`
  ).bind(DEMO_EMAIL_PATTERN).all();
  return json({ groups: rows.results });
}
