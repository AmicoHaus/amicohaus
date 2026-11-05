import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { inviteAgent, fetchInvitesForRequest } from '../../../_lib/agentInvites.js';
import { notifyAgentInvited } from '../../../_lib/marketplaceNotify.js';
import { proposalsSealed } from '../../../_lib/decisionNight.js';
import { claimUserAction, rateLimited } from '../../../_lib/rateLimits.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const row = await db.prepare('SELECT user_id, status, proposals_due_at FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden();

  const invites = await fetchInvitesForRequest(db, 'pre_listing', id);
  // Until Decision Night, "responded" would tell the owner who sent a proposal, so it reads as still pending.
  if (proposalsSealed(row)) for (const i of invites) if (i.status === 'responded') i.status = 'pending';
  return json({ invites });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const agentUserId = Number(body.agentUserId);
  if (!Number.isInteger(agentUserId)) return badRequest('Pick an agent to invite.');

  // Blocks are checked inside inviteAgent, then the per-person invite limit (rateLimits.js). An invite the agent
  // declined stays declined, and the agent isn't pinged again within 30 days (notifyAgentInvited).
  const db = context.env.DB;
  const result = await inviteAgent(db, 'pre_listing', id, user.id, agentUserId, body.message, {
    beforeWrite: () => claimUserAction(db, 'agent_invite', user.id, `pre_listing:${Number(id)}`),
  });
  if (result.rateLimited) return rateLimited();
  if (result.error) return badRequest(result.error);
  context.waitUntil(notifyAgentInvited(context, 'pre_listing', id, agentUserId, user.id));
  return json(result, { status: 201 });
}
