import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { validateOpenHouseInput, createOpenHouse, fetchOpenHouses } from '../../../../_lib/augmentedHomeOpenHouses.js';
import { notifyOpenHouseScheduled } from '../../../../_lib/marketplaceNotify.js';
import { fetchFavoriterIds } from '../../../../_lib/augmentedHomeFavorites.js';
import { logMarketEventUnlessDemo } from '../../../../_lib/marketEvents.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Mirrors functions/api/listings/[id]/open-houses/index.js exactly.
export async function onRequestGet(context) {
  const id = context.params.id;
  const db = context.env.DB;
  const viewer = await getSessionUser(context);
  // One row for the open-house extras: the owner gets the names of people going; the address (shared by the owner with
  // people going) is considered only while the home is active. Per viewer (imGoing, address), so never cached.
  const home = await db.prepare('SELECT user_id, address, status FROM augmented_homes WHERE id = ?').bind(id).first();
  const opts = home ? { ownerId: home.user_id, ...(home.status === 'active' ? { address: home.address } : {}) } : {};
  const openHouses = await fetchOpenHouses(db, id, viewer ? viewer.id : null, opts);
  return json({ openHouses }, NO_STORE);
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id, city, state FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');
  if (home.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOpenHouseInput(body);
  if (validated.error) return badRequest(validated.error);

  const openHouseId = await createOpenHouse(db, id, validated.data);

  const favoriters = await fetchFavoriterIds(db, id);
  context.waitUntil(notifyOpenHouseScheduled(context, `/app#augmented-home-${id}`, favoriters, validated.data.startsAt));
  context.waitUntil(logMarketEventUnlessDemo(context.env.DB, home.user_id, {
    eventType: 'open_house_scheduled', entityKind: 'augmented_home', entityId: id,
    city: home.city, state: home.state,
    headline: `Open house scheduled in ${home.city}, ${home.state}`,
  }));

  return json({ id: openHouseId }, { status: 201 });
}
