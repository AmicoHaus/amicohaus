import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { validateAugmentedHomeInput, insertAugmentedHome, fetchAugmentedHomePhotos } from '../../_lib/augmentedHomes.js';
import { checkAlertsForNewHome } from '../../_lib/accessibilityAlerts.js';
import { fetchMyFavoriteHomeIds } from '../../_lib/augmentedHomeFavorites.js';
import { logMarketEventUnlessDemo } from '../../_lib/marketEvents.js';

const LIST_FIELDS = `augmented_homes.id, augmented_homes.user_id, augmented_homes.title, augmented_homes.city,
  augmented_homes.state, augmented_homes.zip, augmented_homes.property_type, augmented_homes.beds,
  augmented_homes.baths, augmented_homes.asking_price, augmented_homes.adaptations_json, augmented_homes.life_event_tags_json,
  augmented_homes.status, augmented_homes.created_at, users.display_name AS owner_name`;

// ?mine=1 for a seller's own listings (any status); otherwise every active
// one, filterable by adaptation keys (?adaptation=key, repeatable) and
// city/state — open to anyone signed in to browse, same as pre-listings.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);

  let rows;
  if (url.searchParams.get('mine') === '1') {
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id
       WHERE augmented_homes.user_id = ? ORDER BY augmented_homes.created_at DESC`
    ).bind(user.id).all();
  } else if (url.searchParams.get('favorites') === '1') {
    const favoriteIds = await fetchMyFavoriteHomeIds(db, user.id);
    if (!favoriteIds.length) return json({ homes: [] });
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id
       WHERE augmented_homes.id IN (${favoriteIds.map(() => '?').join(',')}) ORDER BY augmented_homes.created_at DESC`
    ).bind(...favoriteIds).all();
  } else {
    const city = (url.searchParams.get('city') || '').trim();
    const state = (url.searchParams.get('state') || '').trim();
    const conditions = [`augmented_homes.status = 'active'`];
    const params = [];
    if (city) { conditions.push('augmented_homes.city LIKE ?'); params.push(`%${city}%`); }
    if (state) { conditions.push('augmented_homes.state LIKE ?'); params.push(`%${state}%`); }
    params.push(60);
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id
       WHERE ${conditions.join(' AND ')} ORDER BY augmented_homes.created_at DESC LIMIT ?`
    ).bind(...params).all();
  }

  const wantedAdaptations = url.searchParams.getAll('adaptation');
  const favoritesMode = url.searchParams.get('favorites') === '1';
  const skipFilter = url.searchParams.get('mine') === '1' || favoritesMode;
  const myFavoriteIds = favoritesMode ? null : new Set(await fetchMyFavoriteHomeIds(db, user.id));
  const homes = [];
  for (const r of rows.results) {
    const adaptations = JSON.parse(r.adaptations_json || '[]');
    if (!skipFilter && wantedAdaptations.length && !wantedAdaptations.some(k => adaptations.includes(k))) continue;
    const photos = await fetchAugmentedHomePhotos(db, r.id);
    homes.push({
      id: r.id, userId: r.user_id, owner: r.owner_name, title: r.title, city: r.city, state: r.state, zip: r.zip,
      propertyType: r.property_type, beds: r.beds, baths: r.baths, askingPrice: r.asking_price,
      adaptations, lifeEventTags: JSON.parse(r.life_event_tags_json || '[]'),
      status: r.status, createdAt: r.created_at, photoIds: photos.map(p => p.id),
      isFavorited: favoritesMode ? true : myFavoriteIds.has(r.id),
    });
  }
  return json({ homes });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const validated = validateAugmentedHomeInput(body);
  if (validated.error) return badRequest(validated.error);

  const id = await insertAugmentedHome(context.env.DB, user.id, validated.data);
  context.waitUntil(checkAlertsForNewHome(context.env.DB, id));
  const price = '$' + Number(validated.data.askingPrice).toLocaleString('en-US');
  context.waitUntil(logMarketEventUnlessDemo(context.env.DB, user.id, {
    eventType: 'new_listing', entityKind: 'augmented_home', entityId: id,
    city: validated.data.city, state: validated.data.state,
    headline: `New AugmentedHomes listing in ${validated.data.city}, ${validated.data.state} — ${price}`,
    amount: validated.data.askingPrice,
  }));
  return json({ id }, { status: 201 });
}
