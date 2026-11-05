import { getSessionUser } from '../../_lib/auth.js';
import { json, notFound, unauthorized } from '../../_lib/util.js';
import { fetchTransactionRequest, confirmationFlags, blockedWithPartners, DUAL_AGENCY_LINE } from '../../_lib/transactions.js';
import { fetchBids, fetchMyBid } from '../../_lib/marketplace.js';
import { isApprovedAgent } from '../../_lib/agents.js';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

// The two partners see everything. An approved agent sees a request only once both partners confirmed it, and never
// across a block with either partner (the same 404 as no request). Anyone else signed in gets agents_only. There are
// no homeowner ratings any more (Rudy 11.04).
export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const transaction = await fetchTransactionRequest(db, id);
  if (!transaction) return notFound('Transaction request not found.');

  const isParty = user.id === transaction.listingA.userId || user.id === transaction.listingB.userId;
  const isAdmin = user.role === 'admin';

  let bids = null;
  let myBid = null;
  if (isParty) {
    bids = await fetchBids(db, 'transaction', id);
  } else {
    const approved = await isApprovedAgent(db, user.id);
    if (!approved && !isAdmin) {
      return json({ error: 'Only approved agents can open trade requests.', code: 'agents_only' }, { status: 403, headers: PRIVATE });
    }
    if (!isAdmin) {
      const hidden = !transaction.partnerConfirmed
        || await blockedWithPartners(db, { user_a_id: transaction.listingA.userId, user_b_id: transaction.listingB.userId }, user.id);
      if (hidden) return json({ error: 'Transaction request not found.' }, { status: 404, headers: PRIVATE });
    }
    if (approved) myBid = await fetchMyBid(db, 'transaction', id, user.id);
  }

  const flags = isParty ? confirmationFlags(transaction, user.id) : { needsMyConfirmation: false, awaitingPartner: false };
  return json({ transaction, bids, myBid, isParty, ...flags, dualAgencyNote: DUAL_AGENCY_LINE }, { headers: PRIVATE });
}
