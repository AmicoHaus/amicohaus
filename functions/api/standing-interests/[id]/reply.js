import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, forbidden } from '../../../_lib/util.js';
import { toolLive } from '../../../_lib/nuancedGate.js';
import { claimUserAction, rateLimited } from '../../../_lib/rateLimits.js';
import { getOrCreateConversation } from '../../../_lib/conversations.js';
import { notifyNewMessage } from '../../../_lib/marketplaceNotify.js';
import { steeringProblem, STEERING_ERROR, codeProblem, CODE_ERROR } from '../../../_lib/homeText.js';
import { STANDING_REPLY_AGENT_ERROR, STANDING_REPLY_LENGTH_ERROR, fetchReachingInterest, standingTargetLabel } from '../../../_lib/standingInterest.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// An owner the interest reaches writes back: { message } (1 to 1,000 characters). One reply per owner per interest;
// it goes out as an ordinary message (the member then sees the owner's display name, and the two continue in
// Messages). Not for anyone with an agent profile. An interest that doesn't reach the viewer answers 404, the same
// as one that isn't there (a block, a suspended or demo member, an expired or withdrawn interest).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) return notFound('Not found.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const message = String(body.message ?? '').trim();
  if (!message || message.length > 1000) return badRequest(STANDING_REPLY_LENGTH_ERROR);
  // Price, terms and timing only: the fair-housing and codes checks every home text gets (homeText.js).
  if (steeringProblem(message)) return badRequest(STEERING_ERROR);
  if (codeProblem(message)) return badRequest(CODE_ERROR);

  const db = context.env.DB;
  const interest = await fetchReachingInterest(db, user.id, id);
  if (interest && interest.viewer_is_agent) return forbidden(STANDING_REPLY_AGENT_ERROR);
  if (!interest) {
    // An agent the interest doesn't reach still gets the agents' answer; everyone else, "not there".
    const agent = await db.prepare('SELECT 1 FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
    return agent ? forbidden(STANDING_REPLY_AGENT_ERROR) : notFound('Not found.');
  }
  if (!(await claimUserAction(db, 'interest_reply', user.id, `standing_interest:${id}`))) return rateLimited();

  const conversation = await getOrCreateConversation(db, user.id, interest.poster_id);
  const text = `About your standing interest (${standingTargetLabel(interest)}): ${message}`;
  await db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)').bind(conversation.id, user.id, text).run();
  context.waitUntil(notifyNewMessage(context, interest.poster_id, user.display_name, conversation.id, user.id));
  return json({ ok: true, conversationId: conversation.id }, { status: 201, ...NO_STORE });
}
