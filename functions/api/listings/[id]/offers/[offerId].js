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
  const offer = await db.prepare('SELECT id, buyer_user_id, status, counter_price, countered_by FROM listing_offers WHERE id = ? AND listing_id = ?').bind(offerId, listingId).first();
  if (!offer) return notFound('Offer not found.');
  const isOwner = listing.user_id === user.id;
  const isBuyer = offer.buyer_user_id === user.id;

  if (body.action === 'withdraw') {
    if (!isBuyer) return forbidden();
    if (!['pending', 'countered'].includes(offer.status)) return badRequest('This offer has already been decided.');
    await decideOffer(db, offerId, 'withdrawn');
    return json({ ok: true });
  }

  if (body.action === 'counter') {
    // Whoever did NOT make the currently open proposal is the one who can respond with a new counter -- the
    // owner on a fresh pending offer (the buyer's original terms), or whichever side didn't just counter. Any
    // number of rounds, same as a real back-and-forth negotiation.
    let actingAs = null;
    if (offer.status === 'pending' && isOwner) actingAs = 'owner';
    else if (offer.status === 'countered' && offer.countered_by === 'owner' && isBuyer) actingAs = 'buyer';
    else if (offer.status === 'countered' && offer.countered_by === 'buyer' && isOwner) actingAs = 'owner';
    if (!actingAs) return (isOwner || isBuyer) ? badRequest('There is nothing to counter right now.') : forbidden();

    const validated = validateCounterInput(body);
    if (validated.error) return badRequest(validated.error);
    await counterOffer(db, offerId, { ...validated.data, counteredBy: actingAs });
    const notifyUserId = actingAs === 'owner' ? offer.buyer_user_id : listing.user_id;
    context.waitUntil(notifyOfferCounter(context, listingId, notifyUserId, validated.data.counterPrice, actingAs));
    return json({ ok: true });
  }

  if (body.action === 'accept_counter' || body.action === 'decline_counter') {
    if (offer.status !== 'countered') return badRequest('There is no counter-offer to respond to.');
    const responderIsBuyer = offer.countered_by === 'owner';
    const responderIsOwner = offer.countered_by === 'buyer';
    if (responderIsBuyer && !isBuyer) return forbidden();
    if (responderIsOwner && !isOwner) return forbidden();
    const accepted = body.action === 'accept_counter';
    if (accepted) await acceptCounter(db, offerId, offer.counter_price);
    else await decideOffer(db, offerId, 'declined');
    // Notify whoever proposed the counter being responded to -- the other side of this exchange.
    const notifyUserId = responderIsBuyer ? listing.user_id : offer.buyer_user_id;
    context.waitUntil(notifyCounterDecision(context, listingId, notifyUserId, accepted));
    return json({ ok: true });
  }

  // accept / decline -- only ever decided directly from a pending offer, by the owner (the first response to
  // the buyer's original terms). Once any counter has happened, accept_counter/decline_counter/counter take over.
  if (!isOwner) return forbidden();
  if (offer.status !== 'pending') return badRequest('This offer has already been decided.');
  await decideOffer(db, offerId, body.action === 'accept' ? 'accepted' : 'declined');
  context.waitUntil(notifyOfferDecision(context, offer.buyer_user_id, listingId, body.action === 'accept'));
  return json({ ok: true });
}
