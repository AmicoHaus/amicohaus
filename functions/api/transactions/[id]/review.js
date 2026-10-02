import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { canReview, submitReview } from '../../../_lib/marketplace.js';

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const transaction = await db.prepare('SELECT awarded_bid_id FROM transaction_requests WHERE id = ?').bind(id).first();
  if (!transaction) return notFound('Transaction request not found.');
  if (!transaction.awarded_bid_id) return badRequest('This transaction request has no awarded agent to review yet.');

  const bid = await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(transaction.awarded_bid_id).first();
  if (!(await canReview(db, 'transaction', id, user.id, bid.agent_user_id))) {
    return forbidden('You can only review the agent awarded on a transaction you were a party to.');
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await submitReview(db, bid.agent_user_id, user.id, 'transaction', id, body);
  if (result.error) return badRequest(result.error);
  return json({ ok: true }, { status: 201 });
}
