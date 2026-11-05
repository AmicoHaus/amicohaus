import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../../../_lib/util.js';
import { validateOfferInput, insertOffer, fetchOffersForOwner, fetchMyOffer } from '../../../../_lib/greenHomeOffers.js';
import { notifyNewOffer } from '../../../../_lib/marketplaceNotify.js';
import { isEitherBlocked } from '../../../../_lib/blocks.js';

// Mirrors functions/api/listings/[id]/offers/index.js exactly, against green_homes/green_home_offers.
export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM green_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');

  if (home.user_id === user.id) {
    // No "verified" badge beside a buyer (the site doesn't vouch for anyone): the shared offers helper still reads
    // the old flag, so it's dropped here.
    const offers = (await fetchOffersForOwner(db, id)).map(({ buyerVerified, ...o }) => o);
    return json({ offers, myOffer: null, isOwner: true });
  }
  const mine = await fetchMyOffer(db, id, user.id);
  const myOffer = mine ? (({ buyerVerified, ...o }) => o)(mine) : null;
  return json({ offers: null, myOffer, isOwner: false });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id, status FROM green_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');
  if (home.user_id === user.id) return badRequest("You can't make an offer on your own listing.");
  // A block either way: the same answer as if the home weren't there (blocks.js).
  if (await isEitherBlocked(db, user.id, home.user_id)) return notFound('Listing not found.');
  if (home.status !== 'active') return badRequest('This listing is no longer active.');

  const existing = await db.prepare("SELECT id FROM green_home_offers WHERE green_home_id = ? AND buyer_user_id = ? AND status IN ('pending', 'countered')").bind(id, user.id).first();
  if (existing) return badRequest('You already have an offer in progress on this listing — withdraw it first to submit a new one.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOfferInput(body);
  if (validated.error) return badRequest(validated.error);

  const offerId = await insertOffer(db, id, user.id, validated.data);
  context.waitUntil(notifyNewOffer(context, `/app#green-home-${id}`, home.user_id, user.id));
  return json({ id: offerId }, { status: 201 });
}
