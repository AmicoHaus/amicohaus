import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { decideOffer, validateCounterInput, counterOffer, acceptCounter } from '../../../../_lib/listingOffers.js';
import { notifyOfferDecision, notifyOfferCounter, notifyCounterDecision } from '../../../../_lib/marketplaceNotify.js';

const VALID_ACTIONS = ['accept', 'decline', 'withdraw', 'counter', 'accept_counter', 'decline_counter'];

export async function onRequestPut(context) {
  const { id: listingId, offerId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!VALID_ACTIONS.includes(body.action)) return badRequest('Invalid action.');

  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').bind(listingId).first();
  if (!listing) return notFound('Listing not found.');
  const offer = await db.prepare('SELECT id, buyer_user_id, status, counter_price FROM listing_offers WHERE id = ? AND listing_id = ?').bind(offerId, listingId).first();
  if (!offer) return notFound('Offer not found.');

  if (body.action === 'withdraw') {
    if (offer.buyer_user_id !== user.id) return forbidden();
    if (!['pending', 'countered'].includes(offer.status)) return badRequest('This offer has already been decided.');
    await decideOffer(db, offerId, 'withdrawn');
    return json({ ok: true });
  }

  if (body.action === 'counter') {
    if (listing.user_id !== user.id) return forbidden();
    if (offer.status !== 'pending') return badRequest('Only a pending offer can be countered.');
    const validated = validateCounterInput(body);
    if (validated.error) return badRequest(validated.error);
    await counterOffer(db, offerId, validated.data);
    context.waitUntil(notifyOfferCounter(context, listingId, offer.buyer_user_id, validated.data.counterPrice));
    return json({ ok: true });
  }

  if (body.action === 'accept_counter' || body.action === 'decline_counter') {
    if (offer.buyer_user_id !== user.id) return forbidden();
    if (offer.status !== 'countered') return badRequest('There is no counter-offer to respond to.');
    if (body.action === 'accept_counter') await acceptCounter(db, offerId, offer.counter_price);
    else await decideOffer(db, offerId, 'declined');
    context.waitUntil(notifyCounterDecision(context, listingId, listing.user_id, body.action === 'accept_counter'));
    return json({ ok: true });
  }

  // accept / decline -- only ever decided directly from pending (a countered offer goes through
  // accept_counter/decline_counter instead, so the owner can't short-circuit their own counter).
  if (listing.user_id !== user.id) return forbidden();
  if (offer.status !== 'pending') return badRequest('This offer has already been decided.');
  await decideOffer(db, offerId, body.action === 'accept' ? 'accepted' : 'declined');
  context.waitUntil(notifyOfferDecision(context, offer.buyer_user_id, listingId, body.action === 'accept'));
  return json({ ok: true });
}
