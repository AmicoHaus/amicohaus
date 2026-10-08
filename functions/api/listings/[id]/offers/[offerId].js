import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { decideOffer } from '../../../../_lib/listingOffers.js';
import { notifyOfferDecision } from '../../../../_lib/marketplaceNotify.js';

export async function onRequestPut(context) {
  const { id: listingId, offerId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['accept', 'decline', 'withdraw'].includes(body.action)) return badRequest('Invalid action.');

  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').bind(listingId).first();
  if (!listing) return notFound('Listing not found.');
  const offer = await db.prepare('SELECT id, buyer_user_id, status FROM listing_offers WHERE id = ? AND listing_id = ?').bind(offerId, listingId).first();
  if (!offer) return notFound('Offer not found.');
  if (offer.status !== 'pending') return badRequest('This offer has already been decided.');

  if (body.action === 'withdraw') {
    if (offer.buyer_user_id !== user.id) return forbidden();
    await decideOffer(db, offerId, 'withdrawn');
    return json({ ok: true });
  }

  // accept / decline
  if (listing.user_id !== user.id) return forbidden();
  await decideOffer(db, offerId, body.action === 'accept' ? 'accepted' : 'declined');
  context.waitUntil(notifyOfferDecision(context, offer.buyer_user_id, listingId, body.action === 'accept'));
  return json({ ok: true });
}
