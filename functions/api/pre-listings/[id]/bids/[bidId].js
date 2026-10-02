import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { acceptBid, withdrawBid } from '../../../../_lib/marketplace.js';
import { notifyBidDecision } from '../../../../_lib/marketplaceNotify.js';

export async function onRequestPut(context) {
  const { id, bidId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const bid = await db.prepare('SELECT agent_user_id, status FROM service_bids WHERE id = ? AND request_type = ? AND request_id = ?')
    .bind(bidId, 'pre_listing', id).first();
  if (!bid) return notFound('Proposal not found.');

  if (body.action === 'withdraw') {
    if (bid.agent_user_id !== user.id) return forbidden();
    await withdrawBid(db, bidId, user.id);
    return json({ ok: true });
  }

  if (body.action === 'accept') {
    const preListing = await db.prepare('SELECT user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
    if (!preListing) return notFound('Pre-listing not found.');
    if (preListing.user_id !== user.id) return forbidden();
    if (preListing.status !== 'open') return badRequest('This pre-listing is no longer open.');
    if (bid.status !== 'pending') return badRequest('This proposal is no longer pending.');

    await acceptBid(db, 'pre_listing', id, bidId);
    context.waitUntil(notifyBidDecision(context, bid.agent_user_id, 'pre_listing', id, true));
    return json({ ok: true });
  }

  return badRequest('action must be "accept" or "withdraw".');
}
