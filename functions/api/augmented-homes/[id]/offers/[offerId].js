import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { decideOffer, validateCounterInput, counterOffer, acceptCounter } from '../../../../_lib/augmentedHomeOffers.js';
import { notifyOfferDecision, notifyOfferCounter, notifyCounterDecision } from '../../../../_lib/marketplaceNotify.js';

// Mirrors functions/api/listings/[id]/offers/[offerId].js exactly, against augmented_homes/augmented_home_offers.
const VALID_ACTIONS = ['accept', 'decline', 'withdraw', 'counter', 'accept_counter', 'decline_counter'];

export async function onRequestPut(context) {
  const { id: homeId, offerId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!VALID_ACTIONS.includes(body.action)) return badRequest('Invalid action.');

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM augmented_homes WHERE id = ?').bind(homeId).first();
  if (!home) return notFound('Listing not found.');
  const offer = await db.prepare('SELECT id, buyer_user_id, status, counter_price, countered_by FROM augmented_home_offers WHERE id = ? AND augmented_home_id = ?').bind(offerId, homeId).first();
  if (!offer) return notFound('Offer not found.');
  const isOwner = home.user_id === user.id;
  const isBuyer = offer.buyer_user_id === user.id;
  const link = `/app#augmented-home-${homeId}`;

  if (body.action === 'withdraw') {
    if (!isBuyer) return forbidden();
    if (!['pending', 'countered'].includes(offer.status)) return badRequest('This offer has already been decided.');
    await decideOffer(db, offerId, 'withdrawn');
    return json({ ok: true });
  }

  if (body.action === 'counter') {
    let actingAs = null;
    if (offer.status === 'pending' && isOwner) actingAs = 'owner';
    else if (offer.status === 'countered' && offer.countered_by === 'owner' && isBuyer) actingAs = 'buyer';
    else if (offer.status === 'countered' && offer.countered_by === 'buyer' && isOwner) actingAs = 'owner';
    if (!actingAs) return (isOwner || isBuyer) ? badRequest('There is nothing to counter right now.') : forbidden();

    const validated = validateCounterInput(body);
    if (validated.error) return badRequest(validated.error);
    await counterOffer(db, offerId, { ...validated.data, counteredBy: actingAs });
    const notifyUserId = actingAs === 'owner' ? offer.buyer_user_id : home.user_id;
    context.waitUntil(notifyOfferCounter(context, link, notifyUserId, validated.data.counterPrice, actingAs));
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
    const notifyUserId = responderIsBuyer ? home.user_id : offer.buyer_user_id;
    context.waitUntil(notifyCounterDecision(context, link, notifyUserId, accepted));
    return json({ ok: true });
  }

  if (!isOwner) return forbidden();
  if (offer.status !== 'pending') return badRequest('This offer has already been decided.');
  await decideOffer(db, offerId, body.action === 'accept' ? 'accepted' : 'declined');
  context.waitUntil(notifyOfferDecision(context, offer.buyer_user_id, link, body.action === 'accept'));
  return json({ ok: true });
}
