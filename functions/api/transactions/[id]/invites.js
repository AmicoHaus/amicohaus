import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { isApprovedAgent } from '../../../_lib/agents.js';
import { inviteAgent, fetchInvitesForRequest } from '../../../_lib/agentInvites.js';
import { notifyAgentInvited } from '../../../_lib/marketplaceNotify.js';
import { claimUserAction, rateLimited } from '../../../_lib/rateLimits.js';
import { blockedWithPartners, didBlock, PARTNER_CONFIRM_FIRST } from '../../../_lib/transactions.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const row = await db.prepare('SELECT user_a_id, user_b_id FROM transaction_requests WHERE id = ?').bind(id).first();
  if (!row) return notFound('Transaction request not found.');
  if (row.user_a_id !== user.id && row.user_b_id !== user.id) return forbidden();

  const invites = await fetchInvitesForRequest(context.env.DB, 'transaction', id);
  return json({ invites });
}

// A partner invites one approved agent to send a proposal: only on a request both partners confirmed, never across
// a block with either partner, and within the per-person invite limit (rateLimits.js).
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const row = await db.prepare('SELECT user_a_id, user_b_id, partner_confirmed_at FROM transaction_requests WHERE id = ?').bind(id).first();
  if (!row) return notFound('Transaction request not found.');
  if (row.user_a_id !== user.id && row.user_b_id !== user.id) return forbidden();
  if (!row.partner_confirmed_at) return badRequest(PARTNER_CONFIRM_FIRST);

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const agentUserId = Number(body.agentUserId);
  if (!Number.isInteger(agentUserId)) return badRequest('Pick an agent to invite.');
  if (!(await isApprovedAgent(db, agentUserId))) return badRequest('That agent is not an approved agent.');
  if (await blockedWithPartners(db, row, agentUserId)) {
    return badRequest((await didBlock(db, user.id, agentUserId)) ? 'Unblock this agent first.' : "That agent can't be invited to this request.");
  }

  // Counted only once the invite is valid, right before it's saved (inviteAgent runs the check just before writing).
  const result = await inviteAgent(db, 'transaction', id, user.id, agentUserId, body.message, {
    beforeWrite: () => claimUserAction(db, 'agent_invite', user.id),
  });
  if (result.rateLimited) return rateLimited();
  if (result.error) return badRequest(result.error);
  context.waitUntil(notifyAgentInvited(context, 'transaction', id, agentUserId, user.id));
  return json(result, { status: 201 });
}
