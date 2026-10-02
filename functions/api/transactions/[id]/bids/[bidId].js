import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { acceptBid, withdrawBid } from '../../../../_lib/marketplace.js';
import { notifyBidDecision } from '../../../../_lib/marketplaceNotify.js';

// Either trade partner can accept a proposal on their shared transaction
// request — this deliberately doesn't require both sides' sign-off (see
// migration_v17.sql), so the two of them should coordinate via their
// existing conversation before whichever one of them clicks accept.
export async function onRequestPut(context) {
  const { id, bidId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const bid = await db.prepare('SELECT agent_user_id, status FROM service_bids WHERE id = ? AND request_type = ? AND request_id = ?')
    .bind(bidId, 'transaction', id).first();
  if (!bid) return notFound('Proposal not found.');

  if (body.action === 'withdraw') {
    if (bid.agent_user_id !== user.id) return forbidden();
    await withdrawBid(db, bidId, user.id);
    return json({ ok: true });
  }

  if (body.action === 'accept') {
    const transaction = await db.prepare('SELECT user_a_id, user_b_id, status FROM transaction_requests WHERE id = ?').bind(id).first();
    if (!transaction) return notFound('Transaction request not found.');
    if (transaction.user_a_id !== user.id && transaction.user_b_id !== user.id) return forbidden();
    if (transaction.status !== 'open') return badRequest('This transaction request is no longer open.');
    if (bid.status !== 'pending') return badRequest('This proposal is no longer pending.');

    await acceptBid(db, 'transaction', id, bidId);
    context.waitUntil(notifyBidDecision(context, bid.agent_user_id, 'transaction', id, true));
    return json({ ok: true });
  }

  return badRequest('action must be "accept" or "withdraw".');
}
