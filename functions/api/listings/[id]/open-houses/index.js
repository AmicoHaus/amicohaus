import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { validateOpenHouseInput, createOpenHouse, fetchOpenHouses } from '../../../../_lib/openHouses.js';
import { notifyOpenHouseScheduled } from '../../../../_lib/marketplaceNotify.js';
import { logMarketEventUnlessDemo } from '../../../../_lib/marketEvents.js';

// Public — same footing as the listing page itself; no sign-in needed to see when an open house is happening.
export async function onRequestGet(context) {
  const id = context.params.id;
  const viewer = await getSessionUser(context);
  const openHouses = await fetchOpenHouses(context.env.DB, id, viewer ? viewer.id : null);
  return json({ openHouses });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id, city, state FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return notFound('Listing not found.');
  if (listing.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOpenHouseInput(body);
  if (validated.error) return badRequest(validated.error);

  const openHouseId = await createOpenHouse(db, id, validated.data);

  const favoriters = await db.prepare("SELECT user_id FROM listing_feedback WHERE listing_id = ? AND feedback = 'up'").bind(id).all();
  context.waitUntil(notifyOpenHouseScheduled(context, `/listing/${id}`, favoriters.results.map(r => r.user_id), validated.data.startsAt));
  context.waitUntil(logMarketEventUnlessDemo(context.env.DB, listing.user_id, {
    eventType: 'open_house_scheduled', entityKind: 'listing', entityId: id,
    city: listing.city, state: listing.state,
    headline: `Open house scheduled in ${listing.city}, ${listing.state}`,
  }));

  return json({ id: openHouseId }, { status: 201 });
}
