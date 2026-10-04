import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString } from '../../../_lib/util.js';
import { isEitherBlocked } from '../../../_lib/blocks.js';
import { sendPushToUser } from '../../../_lib/webpush.js';
import { notifyNewMessage } from '../../../_lib/marketplaceNotify.js';

async function loadConversationForParticipant(db, conversationId, userId) {
  const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first();
  if (!convo) return { convo: null };
  const isParticipant = convo.user_a_id === userId || convo.user_b_id === userId;
  return { convo, isParticipant };
}

export async function onRequestGet(context) {
  const conversationId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const { convo, isParticipant } = await loadConversationForParticipant(db, conversationId, user.id);
  if (!convo) return notFound('Conversation not found.');
  if (!isParticipant) return forbidden();

  const rows = await db.prepare(
    'SELECT id, sender_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500'
  ).bind(conversationId).all();

  await db.prepare(
    'UPDATE messages SET read_at = datetime(\'now\') WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL'
  ).bind(conversationId, user.id).run();

  return json({ messages: rows.results });
}

export async function onRequestPost(context) {
  const conversationId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const { convo, isParticipant } = await loadConversationForParticipant(db, conversationId, user.id);
  if (!convo) return notFound('Conversation not found.');
  if (!isParticipant) return forbidden();

  const recipientIdCheck = convo.user_a_id === user.id ? convo.user_b_id : convo.user_a_id;
  if (await isEitherBlocked(db, user.id, recipientIdCheck)) return forbidden('You cannot message this user.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const text = clampString(body.body, 2000);
  if (!text) return badRequest('Message cannot be empty.');

  const result = await db.prepare(
    'INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)'
  ).bind(conversationId, user.id, text).run();

  const recipientId = convo.user_a_id === user.id ? convo.user_b_id : convo.user_a_id;
  context.waitUntil(notifyNewMessage(context, recipientId, user.display_name, conversationId));
  context.waitUntil(sendPushToUser(context, recipientId));

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
