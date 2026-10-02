import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { inviteAgent, fetchInvitesForRequest } from '../../../_lib/agentInvites.js';
import { notifyAgentInvited } from '../../../_lib/marketplaceNotify.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const row = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden();

  const invites = await fetchInvitesForRequest(db, 'pre_listing', id);
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

  const result = await inviteAgent(context.env.DB, 'pre_listing', id, user.id, agentUserId, body.message);
  if (result.error) return badRequest(result.error);
  context.waitUntil(notifyAgentInvited(context, 'pre_listing', id, agentUserId, user.id));
  return json(result, { status: 201 });
}
