import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, forbidden, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { getOrCreateConversation } from '../../_lib/conversations.js';
import { isEitherBlocked, hasBlocked } from '../../_lib/blocks.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { contactDecision, isExemptPair, sqlUtc } from '../../_lib/contactPolicy.js';

// A message is visible to the viewer once it's delivered: always their own, and someone else's once its
// deliver_after (a weekly-mode hold, see contactPolicy.js) has passed. ?1 = viewer id, ?2 = now (sqlUtc).
const VISIBLE = '(messages.deliver_after IS NULL OR messages.deliver_after <= ?2 OR messages.sender_id = ?1)';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  // A thread whose only messages are still waiting for the weekly delivery isn't listed for the person they're
  // waiting for. An empty thread is listed as before, except one an agent opened with someone whose dial isn't Open
  // (tapping Message shouldn't put the agent in a Weekly or Quiet person's inbox before anything is delivered),
  // unless the two already work together (isExemptPair).
  const rows = await db.prepare(
    `SELECT conversations.id,
            CASE WHEN conversations.user_a_id = ?1 THEN conversations.user_b_id ELSE conversations.user_a_id END AS other_user_id,
            other.display_name AS other_name,
            (SELECT body FROM messages WHERE messages.conversation_id = conversations.id AND ${VISIBLE} ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message,
            (SELECT created_at FROM messages WHERE messages.conversation_id = conversations.id AND ${VISIBLE} ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message_at,
            (SELECT COUNT(*) FROM messages WHERE messages.conversation_id = conversations.id AND messages.sender_id != ?1 AND messages.read_at IS NULL
               AND (messages.deliver_after IS NULL OR messages.deliver_after <= ?2)) AS unread_count,
            agent_profiles.user_id AS other_agent_id, agent_profiles.license_number AS other_license_number, agent_profiles.brokerage_name AS other_brokerage_name,
            (NOT EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id)
             AND viewer.contact_mode != 'open'
             AND EXISTS (SELECT 1 FROM agent_profiles ap2 WHERE ap2.user_id = other.id)) AS held_back_empty,
            EXISTS (SELECT 1 FROM user_blocks WHERE user_blocks.blocker_id = ?1 AND user_blocks.blocked_id = other.id) AS blocked_by_me
     FROM conversations
     JOIN users AS viewer ON viewer.id = ?1
     JOIN users AS other ON other.id = CASE WHEN conversations.user_a_id = ?1 THEN conversations.user_b_id ELSE conversations.user_a_id END
     LEFT JOIN agent_profiles ON agent_profiles.user_id = other.id AND agent_profiles.status = 'approved'
     WHERE (conversations.user_a_id = ?1 OR conversations.user_b_id = ?1)
       AND (EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id AND ${VISIBLE})
            OR NOT EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id))
     ORDER BY last_message_at DESC`
  ).bind(user.id, sqlUtc()).all();

  // An empty thread from an agent the viewer's dial covers stays out of the list (checked only for those rows).
  const listed = [];
  for (const row of rows.results) {
    if (row.held_back_empty && !(await isExemptPair(db, row.other_user_id, user.id))) continue;
    listed.push(row);
  }

  // otherAgent: the other person's DRE number and brokerage when they're an approved agent (shown under the name).
  // blockedByMe: the viewer blocked them (the list never says whether they blocked the viewer).
  const conversations = listed.map(({ other_agent_id, other_license_number, other_brokerage_name, held_back_empty, blocked_by_me, ...row }) => ({
    ...row,
    blockedByMe: !!blocked_by_me,
    otherAgent: other_agent_id ? { licenseNumber: other_license_number || '', brokerageName: other_brokerage_name || '' } : null,
  }));
  return json({ conversations });
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
  const other = await db.prepare('SELECT id, display_name FROM users WHERE id = ? AND email NOT LIKE ?').bind(otherUserId, DEMO_EMAIL_PATTERN).first();
  if (!other) return notFound('User not found.');
  const [a, b] = user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id];
  const existing = await db.prepare('SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ?').bind(a, b).first();
  // Someone the viewer blocked: an existing thread still opens (read-only, with an Unblock link); a new one doesn't.
  if (await hasBlocked(db, user.id, otherUserId)) {
    if (existing) return json({ id: existing.id });
    return json({ error: `Unblock ${other.display_name || 'this person'} to send a message.`, code: 'blocked_by_me' }, { status: 403 });
  }
  if (await isEitherBlocked(db, user.id, otherUserId)) return forbidden('You cannot message this user.');

  // Quiet mode: an agent can't open a new thread with this person (an existing one still opens, read-only for
  // them: sending is refused in messages.js).
  const decision = await contactDecision(db, user.id, otherUserId);
  if (decision.code === 'contact_quiet') {
    if (existing) return json({ id: existing.id });
    return json({ error: decision.error, code: decision.code }, { status: 403 });
  }

  // Opening a thread that already exists is free; only a brand-new one counts toward the per-person limit.
  if (existing) return json({ id: existing.id });
  if (!(await claimUserAction(db, 'conversation_new', user.id))) return rateLimited();

  const conversation = await getOrCreateConversation(db, user.id, otherUserId);
  return json({ id: conversation.id });
}
