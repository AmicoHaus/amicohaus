import { getSessionUser } from '../../_lib/auth.js';
import { json, notFound, unauthorized } from '../../_lib/util.js';
import { fetchTransactionRequest } from '../../_lib/transactions.js';
import { fetchBids, fetchMyBid, fetchHomeownerRatingSummary } from '../../_lib/marketplace.js';
import { isApprovedAgent } from '../../_lib/agents.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const transaction = await fetchTransactionRequest(db, id);
  if (!transaction) return notFound('Transaction request not found.');

  const isParty = user && (user.id === transaction.listingA.userId || user.id === transaction.listingB.userId);

  let bids = null;
  let myBid = null;
  if (isParty) {
    bids = await fetchBids(db, 'transaction', id);
  } else if (user && await isApprovedAgent(db, user.id)) {
    myBid = await fetchMyBid(db, 'transaction', id, user.id);
  }

  // Shown to an agent deciding whether to bid — a track record for the
  // homeowner side, the reciprocal of the rating an agent already carries.
  const ratingA = await fetchHomeownerRatingSummary(db, transaction.listingA.userId);
  const ratingB = await fetchHomeownerRatingSummary(db, transaction.listingB.userId);

  return json({ transaction, bids, myBid, isParty: !!isParty, homeownerRatings: { a: ratingA, b: ratingB } });
}
