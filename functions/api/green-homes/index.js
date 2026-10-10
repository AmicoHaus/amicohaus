import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { validateGreenHomeInput, insertGreenHome, fetchGreenHomePhotos } from '../../_lib/greenHomes.js';
import { checkGreenAlertsForNewHome } from '../../_lib/greenNeedsAlerts.js';
import { fetchMyFavoriteHomeIds } from '../../_lib/greenHomeFavorites.js';
import { logMarketEventUnlessDemo } from '../../_lib/marketEvents.js';
import { fetchPriceSeriesBatch } from '../../_lib/priceSeries.js';

const LIST_FIELDS = `green_homes.id, green_homes.user_id, green_homes.title, green_homes.city,
  green_homes.state, green_homes.zip, green_homes.property_type, green_homes.beds,
  green_homes.baths, green_homes.asking_price, green_homes.green_features_json, green_homes.life_event_tags_json,
  green_homes.status, green_homes.created_at, users.display_name AS owner_name`;

// ?mine=1 for a seller's own listings (any status); otherwise every active one, filterable by green feature
// keys (?feature=key, repeatable) and city/state -- open to anyone signed in to browse.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);

  let rows;
  if (url.searchParams.get('mine') === '1') {
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM green_homes JOIN users ON users.id = green_homes.user_id
       WHERE green_homes.user_id = ? ORDER BY green_homes.created_at DESC`
    ).bind(user.id).all();
  } else if (url.searchParams.get('favorites') === '1') {
    const favoriteIds = await fetchMyFavoriteHomeIds(db, user.id);
    if (!favoriteIds.length) return json({ homes: [] });
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM green_homes JOIN users ON users.id = green_homes.user_id
       WHERE green_homes.id IN (${favoriteIds.map(() => '?').join(',')}) ORDER BY green_homes.created_at DESC`
    ).bind(...favoriteIds).all();
  } else {
    const city = (url.searchParams.get('city') || '').trim();
    const state = (url.searchParams.get('state') || '').trim();
    const conditions = [`green_homes.status = 'active'`];
    const params = [];
    if (city) { conditions.push('green_homes.city LIKE ?'); params.push(`%${city}%`); }
    if (state) { conditions.push('green_homes.state LIKE ?'); params.push(`%${state}%`); }
    params.push(60);
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM green_homes JOIN users ON users.id = green_homes.user_id
       WHERE ${conditions.join(' AND ')} ORDER BY green_homes.created_at DESC LIMIT ?`
    ).bind(...params).all();
  }

  const wantedFeatures = url.searchParams.getAll('feature');
  const favoritesMode = url.searchParams.get('favorites') === '1';
  const skipFilter = url.searchParams.get('mine') === '1' || favoritesMode;
  const myFavoriteIds = favoritesMode ? null : new Set(await fetchMyFavoriteHomeIds(db, user.id));
  const seriesByHome = await fetchPriceSeriesBatch(db, 'green_home', rows.results.map(r => r.id));
  const homes = [];
  for (const r of rows.results) {
    const greenFeatures = JSON.parse(r.green_features_json || '[]');
    if (!skipFilter && wantedFeatures.length && !wantedFeatures.some(k => greenFeatures.includes(k))) continue;
    const photos = await fetchGreenHomePhotos(db, r.id);
    homes.push({
      id: r.id, userId: r.user_id, owner: r.owner_name, title: r.title, city: r.city, state: r.state, zip: r.zip,
      propertyType: r.property_type, beds: r.beds, baths: r.baths, askingPrice: r.asking_price,
      priceSeries: [...(seriesByHome.get(r.id) || []), r.asking_price],
      greenFeatures, lifeEventTags: JSON.parse(r.life_event_tags_json || '[]'),
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

  const validated = validateGreenHomeInput(body);
  if (validated.error) return badRequest(validated.error);

  const id = await insertGreenHome(context.env.DB, user.id, validated.data);
  context.waitUntil(checkGreenAlertsForNewHome(context.env.DB, id));
  const price = '$' + Number(validated.data.askingPrice).toLocaleString('en-US');
  context.waitUntil(logMarketEventUnlessDemo(context.env.DB, user.id, {
    eventType: 'new_listing', entityKind: 'green_home', entityId: id,
    city: validated.data.city, state: validated.data.state,
    headline: `New GreenHomes listing in ${validated.data.city}, ${validated.data.state} — ${price}`,
    amount: validated.data.askingPrice,
  }));
  return json({ id }, { status: 201 });
}
