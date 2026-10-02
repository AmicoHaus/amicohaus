import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { listMilestones, addMilestone } from '../../../../_lib/milestones.js';

async function checkParty(db, id, userId) {
  const row = await db.prepare('SELECT user_a_id, user_b_id, awarded_bid_id FROM transaction_requests WHERE id = ?').bind(id).first();
  if (!row) return { error: notFound('Transaction request not found.') };
  if (!row.awarded_bid_id) return { error: badRequest('This transaction request has no awarded agent yet.') };
  const bid = await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(row.awarded_bid_id).first();
  const isParty = row.user_a_id === userId || row.user_b_id === userId || (bid && bid.agent_user_id === userId);
  if (!isParty) return { error: forbidden() };
  return { ok: true };
}

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const check = await checkParty(db, id, user.id);
  if (check.error) return check.error;

  const milestones = await listMilestones(db, 'transaction', id);
  return json({ milestones });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const check = await checkParty(db, id, user.id);
  if (check.error) return check.error;

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await addMilestone(db, 'transaction', id, user.id, body.label);
  if (result.error) return badRequest(result.error);
  return json(result, { status: 201 });
}
