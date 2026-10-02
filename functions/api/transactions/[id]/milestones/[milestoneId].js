import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { toggleMilestone, deleteMilestone } from '../../../../_lib/milestones.js';

async function checkPartyAndMilestone(db, id, milestoneId, userId) {
  const row = await db.prepare('SELECT user_a_id, user_b_id, awarded_bid_id FROM transaction_requests WHERE id = ?').bind(id).first();
  if (!row) return { error: notFound('Transaction request not found.') };
  const bid = row.awarded_bid_id ? await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(row.awarded_bid_id).first() : null;
  const isParty = row.user_a_id === userId || row.user_b_id === userId || (bid && bid.agent_user_id === userId);
  if (!isParty) return { error: forbidden() };

  const milestone = await db.prepare('SELECT id FROM bid_milestones WHERE id = ? AND request_type = ? AND request_id = ?').bind(milestoneId, 'transaction', id).first();
  if (!milestone) return { error: notFound('Checklist item not found.') };
  return { ok: true };
}

export async function onRequestPut(context) {
  const { id, milestoneId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const check = await checkPartyAndMilestone(db, id, milestoneId, user.id);
  if (check.error) return check.error;

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  await toggleMilestone(db, milestoneId, user.id, !!body.isDone);
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { id, milestoneId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const check = await checkPartyAndMilestone(db, id, milestoneId, user.id);
  if (check.error) return check.error;

  await deleteMilestone(db, milestoneId);
  return json({ ok: true });
}
