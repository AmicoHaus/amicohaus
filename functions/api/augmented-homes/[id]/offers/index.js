import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../../../_lib/util.js';
import { validateOfferInput, insertOffer, fetchOffersForOwner, fetchMyOffer } from '../../../../_lib/augmentedHomeOffers.js';
import { notifyNewOffer } from '../../../../_lib/marketplaceNotify.js';

// Mirrors functions/api/listings/[id]/offers/index.js exactly, against augmented_homes/augmented_home_offers.
export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');

  if (home.user_id === user.id) {
    const offers = await fetchOffersForOwner(db, id);
    return json({ offers, myOffer: null, isOwner: true });
  }
  const myOffer = await fetchMyOffer(db, id, user.id);
  return json({ offers: null, myOffer, isOwner: false });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id, status FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');
  if (home.user_id === user.id) return badRequest("You can't make an offer on your own listing.");
  if (home.status !== 'active') return badRequest('This listing is no longer active.');

  const existing = await db.prepare("SELECT id FROM augmented_home_offers WHERE augmented_home_id = ? AND buyer_user_id = ? AND status IN ('pending', 'countered')").bind(id, user.id).first();
  if (existing) return badRequest('You already have an offer in progress on this listing — withdraw it first to submit a new one.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOfferInput(body);
  if (validated.error) return badRequest(validated.error);

  const offerId = await insertOffer(db, id, user.id, validated.data);
  context.waitUntil(notifyNewOffer(context, `/app#augmented-home-${id}`, home.user_id, user.id));
  return json({ id: offerId }, { status: 201 });
}
