import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { acceptBid, withdrawBid, isAgentActive } from '../../../../_lib/marketplace.js';
import { notifyBidDecision } from '../../../../_lib/marketplaceNotify.js';
import { blockedWithPartners, didBlock, DUAL_AGENCY_LINE, PARTNER_CONFIRM_FIRST } from '../../../../_lib/transactions.js';

// Either trade partner can accept a proposal, but only on a request both partners confirmed (partner_confirmed_at,
// migration_v43): the other partner said yes before any agent saw it. One agent for both homes, or two agents under
// the same brokerage, is dual agency and needs both owners' written consent, so the two of them should still agree
// before whichever one clicks accept.
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
    const transaction = await db.prepare('SELECT user_a_id, user_b_id, status, partner_confirmed_at FROM transaction_requests WHERE id = ?').bind(id).first();
    if (!transaction) return notFound('Transaction request not found.');
    if (transaction.user_a_id !== user.id && transaction.user_b_id !== user.id) return forbidden();
    if (transaction.status !== 'open') return badRequest('This transaction request is no longer open.');
    if (!transaction.partner_confirmed_at) return badRequest(PARTNER_CONFIRM_FIRST);
    if (bid.status !== 'pending') return badRequest('This proposal is no longer pending.');
    if (!(await isAgentActive(db, bid.agent_user_id))) return badRequest("This agent's account isn't active right now, so this proposal can't be accepted.");
    // Never hire across a block with either partner.
    if (await blockedWithPartners(db, transaction, bid.agent_user_id)) {
      return badRequest((await didBlock(db, user.id, bid.agent_user_id)) ? 'Unblock this agent first.' : "This agent can't be hired on this trade.");
    }

    const declined = await acceptBid(db, 'transaction', id, bidId);
    context.waitUntil(notifyBidDecision(context, bid.agent_user_id, 'transaction', id, true));
    for (const agentId of declined) context.waitUntil(notifyBidDecision(context, agentId, 'transaction', id, false).catch(() => {}));
    return json({ ok: true, dualAgencyNote: DUAL_AGENCY_LINE });
  }

  return badRequest('action must be "accept" or "withdraw".');
}
