import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString } from '../../../_lib/util.js';
import { isEitherBlocked } from '../../../_lib/blocks.js';
import { notifyNewMessage } from '../../../_lib/marketplaceNotify.js';
import { contactDecision, sendPushUnlessQuiet, sqlUtc, WEEKLY_LIMIT_ERROR } from '../../../_lib/contactPolicy.js';

const THREAD_LIMIT = 500;

async function loadConversationForParticipant(db, conversationId, userId) {
  const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first();
  if (!convo) return { convo: null };
  const isParticipant = convo.user_a_id === userId || convo.user_b_id === userId;
  return { convo, isParticipant };
}

// other: who the viewer is talking to, their DRE identity when they're an approved agent, and how the viewer's
// messages reach them (deliveryMode 'weekly' or 'quiet' only when the contact dial applies to the viewer).
async function describeOther(db, viewerId, otherId) {
  const row = await db.prepare(
    `SELECT users.id, users.display_name, agent_profiles.status AS agent_status, agent_profiles.license_number, agent_profiles.brokerage_name
     FROM users LEFT JOIN agent_profiles ON agent_profiles.user_id = users.id WHERE users.id = ?`
  ).bind(otherId).first();
  if (!row) return null;
  const decision = await contactDecision(db, viewerId, otherId);
  return {
    id: row.id,
    displayName: row.display_name,
    agent: row.agent_status === 'approved' ? { licenseNumber: row.license_number || '', brokerageName: row.brokerage_name || '' } : null,
    deliveryMode: decision.appliesToSender && !decision.exempt ? decision.mode : 'open',
  };
}

export async function onRequestGet(context) {
  const conversationId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const { convo, isParticipant } = await loadConversationForParticipant(db, conversationId, user.id);
  if (!convo) return notFound('Conversation not found.');
  if (!isParticipant) return forbidden();

  // The newest 500 the viewer can see, returned oldest first. Someone else's message still waiting for the weekly
  // delivery isn't shown (or marked read) until its time; the sender sees their own with deliverAfter set.
  const now = sqlUtc();
  const rows = await db.prepare(
    `SELECT id, sender_id, body, created_at, deliver_after FROM messages
     WHERE conversation_id = ?1 AND (deliver_after IS NULL OR deliver_after <= ?2 OR sender_id = ?3)
     ORDER BY created_at DESC, id DESC LIMIT ${THREAD_LIMIT}`
  ).bind(conversationId, now, user.id).all();
  const messages = rows.results.reverse().map(({ deliver_after, ...m }) => ({
    ...m,
    deliverAfter: m.sender_id === user.id && deliver_after && deliver_after > now ? deliver_after : null,
  }));

  await db.prepare(
    `UPDATE messages SET read_at = datetime('now')
     WHERE conversation_id = ?1 AND sender_id != ?2 AND read_at IS NULL AND (deliver_after IS NULL OR deliver_after <= ?3)`
  ).bind(conversationId, user.id, now).run();

  const otherId = convo.user_a_id === user.id ? convo.user_b_id : convo.user_a_id;
  return json({ messages, other: await describeOther(db, user.id, otherId) });
}

export async function onRequestPost(context) {
  const conversationId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const { convo, isParticipant } = await loadConversationForParticipant(db, conversationId, user.id);
  if (!convo) return notFound('Conversation not found.');
  if (!isParticipant) return forbidden();

  const recipientId = convo.user_a_id === user.id ? convo.user_b_id : convo.user_a_id;
  if (await isEitherBlocked(db, user.id, recipientId)) return forbidden('You cannot message this user.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const text = clampString(body.body, 2000);
  if (!text) return badRequest('Message cannot be empty.');

  // The recipient's contact dial (contactPolicy.js): Quiet refuses an agent's message, Weekly holds it for Sunday.
  const decision = await contactDecision(db, user.id, recipientId);
  if (!decision.allow) return json({ error: decision.error, code: decision.code }, { status: decision.code === 'contact_quiet' ? 403 : 400 });
  const held = !!decision.holdUntil;

  // A held message is stored only if none from this sender is still waiting here, checked in the same statement
  // (D1 runs one statement at a time), so a double send can't queue two for Sunday. The pair has one conversation,
  // so this is the same one-per-agent-per-person rule contactDecision checks.
  const result = await db.prepare(
    `INSERT INTO messages (conversation_id, sender_id, body, deliver_after)
     SELECT ?1, ?2, ?3, ?4
     WHERE ?4 IS NULL OR NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = ?1 AND sender_id = ?2
                                     AND deliver_after IS NOT NULL AND deliver_after > ?5)`
  ).bind(Number(conversationId), user.id, text, decision.holdUntil, sqlUtc()).run();
  if (!result.meta.changes) return json({ error: WEEKLY_LIMIT_ERROR, code: 'weekly_limit' }, { status: 400 });

  // Writing back makes the pair exempt from the dial, so anything the other person sent that is still waiting for
  // this sender's weekly delivery arrives now (it's marked released, so the weekly alert doesn't count it again).
  await db.prepare(
    `UPDATE messages SET deliver_after = datetime('now'), released_at = datetime('now')
     WHERE conversation_id = ? AND sender_id = ? AND deliver_after IS NOT NULL AND released_at IS NULL AND deliver_after > ?`
  ).bind(conversationId, recipientId, sqlUtc()).run();

  // A held message tells nobody now; the weekly delivery announces it. Otherwise the usual alert, and a push
  // unless it's the recipient's quiet hours.
  if (!held) {
    context.waitUntil(notifyNewMessage(context, recipientId, user.display_name, conversationId, user.id));
    context.waitUntil(sendPushUnlessQuiet(context, recipientId));
  }

  return json({ id: result.meta.last_row_id, held, deliverAfter: decision.holdUntil }, { status: 201 });
}
