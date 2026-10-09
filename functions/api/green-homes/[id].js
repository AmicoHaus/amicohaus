import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../_lib/util.js';
import { validateGreenHomeInput, updateGreenHome, fetchGreenHomePhotos, setGreenHomeStatus } from '../../_lib/greenHomes.js';
import { isFavorited, fetchFavoriterIds } from '../../_lib/greenHomeFavorites.js';
import { notifyPriceDrop } from '../../_lib/marketplaceNotify.js';
import { logMarketEventUnlessDemo } from '../../_lib/marketEvents.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const row = await db.prepare(
    `SELECT green_homes.*, users.display_name AS owner_name
     FROM green_homes JOIN users ON users.id = green_homes.user_id WHERE green_homes.id = ?`
  ).bind(id).first();
  if (!row) return notFound('Listing not found.');

  const isOwner = user.id === row.user_id;
  const photos = await fetchGreenHomePhotos(db, id);
  const priceHistoryRows = await db.prepare(
    'SELECT old_price, new_price, changed_at FROM green_home_price_history WHERE green_home_id = ? ORDER BY changed_at ASC'
  ).bind(id).all();

  const home = {
    id: row.id, userId: row.user_id, owner: row.owner_name, title: row.title, description: row.description,
    address: isOwner ? row.address : undefined, neighborhood: row.neighborhood, city: row.city, state: row.state, zip: row.zip,
    propertyType: row.property_type, beds: row.beds, baths: row.baths, sqft: row.sqft, askingPrice: row.asking_price,
    greenFeatures: JSON.parse(row.green_features_json || '[]'), featureNotes: row.feature_notes,
    lifeEventTags: JSON.parse(row.life_event_tags_json || '[]'),
    status: row.status, createdAt: row.created_at, photoIds: photos.map(p => p.id),
    priceHistory: priceHistoryRows.results.map(r => ({ oldPrice: r.old_price, newPrice: r.new_price, changedAt: r.changed_at })),
    isFavorited: isOwner ? false : await isFavorited(db, user.id, id),
  };

  return json({ home, isOwner: !!isOwner });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, status, asking_price, city, state FROM green_homes WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Listing not found.');
  if (existing.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  if (body.action === 'set-status') {
    const result = await setGreenHomeStatus(db, id, body.status);
    if (result.error) return badRequest(result.error);
    return json(result);
  }

  if (existing.status !== 'active') return badRequest('Only an active listing can be edited.');
  const validated = validateGreenHomeInput(body);
  if (validated.error) return badRequest(validated.error);
  await updateGreenHome(db, id, validated.data);
  if (Number(validated.data.askingPrice) !== Number(existing.asking_price)) {
    await db.prepare('INSERT INTO green_home_price_history (green_home_id, old_price, new_price) VALUES (?, ?, ?)')
      .bind(id, existing.asking_price, validated.data.askingPrice).run();
    const favoriters = await fetchFavoriterIds(db, id);
    context.waitUntil(notifyPriceDrop(context, `/app#green-home-${id}`, favoriters, existing.asking_price, validated.data.askingPrice));
    if (Number(validated.data.askingPrice) < Number(existing.asking_price)) {
      const oldPrice = '$' + Number(existing.asking_price).toLocaleString('en-US');
      const newPrice = '$' + Number(validated.data.askingPrice).toLocaleString('en-US');
      context.waitUntil(logMarketEventUnlessDemo(context.env.DB, existing.user_id, {
        eventType: 'price_drop', entityKind: 'green_home', entityId: id,
        city: existing.city, state: existing.state,
        headline: `Price drop in ${existing.city}, ${existing.state}: ${oldPrice} → ${newPrice}`,
        amount: validated.data.askingPrice, delta: validated.data.askingPrice - existing.asking_price,
      }));
    }
  }
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id FROM green_homes WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Listing not found.');
  if (existing.user_id !== user.id && user.role !== 'admin') return forbidden();

  await db.prepare('DELETE FROM green_homes WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
