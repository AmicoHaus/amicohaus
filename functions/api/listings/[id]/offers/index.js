import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { validateOfferInput, insertOffer, fetchOffersForOwner, fetchMyOffer } from '../../../../_lib/listingOffers.js';
import { notifyNewOffer } from '../../../../_lib/marketplaceNotify.js';

// The owner sees every offer; a buyer sees only their own (never a competitor's price) -- same shape as the
// pre-listing proposal marketplace's bids.
export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return notFound('Listing not found.');

  if (listing.user_id === user.id) {
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
  const listing = await db.prepare('SELECT user_id, status, is_rental, is_buyer_only FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return notFound('Listing not found.');
  if (listing.user_id === user.id) return badRequest("You can't make an offer on your own listing.");
  if (listing.status !== 'active') return badRequest('This listing is no longer active.');
  if (listing.is_rental || listing.is_buyer_only) return badRequest('Offers only apply to a home listed for sale or trade.');

  // A buyer can have several historical rows on the same listing (declined, withdrawn, from a prior round) --
  // checking just the first one found (arbitrary order) missed a currently-live one sitting behind it. Filter
  // for a live status directly so any accepted/declined/withdrawn history never masks an in-progress offer.
  const existing = await db.prepare("SELECT id FROM listing_offers WHERE listing_id = ? AND buyer_user_id = ? AND status IN ('pending', 'countered')").bind(id, user.id).first();
  if (existing) return badRequest('You already have an offer in progress on this listing — withdraw it first to submit a new one.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOfferInput(body);
  if (validated.error) return badRequest(validated.error);

  const offerId = await insertOffer(db, id, user.id, validated.data);
  context.waitUntil(notifyNewOffer(context, id, listing.user_id, user.id));
  return json({ id: offerId }, { status: 201 });
}
