import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, forbidden, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { getOrCreateConversation } from '../../_lib/conversations.js';
import { isEitherBlocked } from '../../_lib/blocks.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT conversations.id,
            CASE WHEN conversations.user_a_id = ? THEN conversations.user_b_id ELSE conversations.user_a_id END AS other_user_id,
            other.display_name AS other_name,
            (SELECT body FROM messages WHERE messages.conversation_id = conversations.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT created_at FROM messages WHERE messages.conversation_id = conversations.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
            (SELECT COUNT(*) FROM messages WHERE messages.conversation_id = conversations.id AND messages.sender_id != ? AND messages.read_at IS NULL) AS unread_count
     FROM conversations
     JOIN users AS other ON other.id = CASE WHEN conversations.user_a_id = ? THEN conversations.user_b_id ELSE conversations.user_a_id END
     WHERE conversations.user_a_id = ? OR conversations.user_b_id = ?
     ORDER BY last_message_at DESC`
  ).bind(user.id, user.id, user.id, user.id, user.id).all();

  return json({ conversations: rows.results });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const otherUserId = Number(body.userId);
  if (!Number.isFinite(otherUserId)) return badRequest('Invalid user.');
  if (otherUserId === user.id) return badRequest("You can't message yourself.");

  const db = context.env.DB;
  // Seeded demo accounts have no password and can never log in to reply —
  // starting a "conversation" with one would just be a dead end.
  const other = await db.prepare('SELECT id FROM users WHERE id = ? AND email NOT LIKE ?').bind(otherUserId, DEMO_EMAIL_PATTERN).first();
  if (!other) return notFound('User not found.');
  if (await isEitherBlocked(db, user.id, otherUserId)) return forbidden('You cannot message this user.');

  const conversation = await getOrCreateConversation(db, user.id, otherUserId);
  return json({ id: conversation.id });
}
