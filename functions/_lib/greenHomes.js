import { clampString } from './util.js';
import { PROPERTY_TYPES, num } from './listings.js';
import { validGreenFeatureKeys } from './greenFeatures.js';
import { validLifeEventKeys } from './lifeEvents.js';

export function validateGreenHomeInput(body) {
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  const zip = clampString(body.zip, 10);
  const propertyType = PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : null;
  const beds = num(body.beds, { min: 0, max: 50 });
  const baths = num(body.baths, { min: 0, max: 50 });
  const askingPrice = num(body.askingPrice, { min: 1, max: 500000000 });
  const greenFeatures = validGreenFeatureKeys(body.greenFeatures);

  if (!city || !state || !propertyType || beds === null || baths === null) {
    return { error: 'Fill in city, state, property type, beds, and baths.' };
  }
  if (!/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit zip code.' };
  if (askingPrice === null) return { error: 'Enter an asking price.' };
  if (greenFeatures.length === 0) return { error: 'Check off at least one green feature this home has.' };

  return {
    data: {
      title: clampString(body.title, 120),
      description: clampString(body.description, 2000),
      address: clampString(body.address, 150),
      neighborhood: clampString(body.neighborhood, 80),
      city, state, zip, propertyType, beds, baths,
      sqft: body.sqft ? num(body.sqft, { min: 0, max: 200000 }) : null,
      askingPrice, greenFeatures,
      featureNotes: clampString(body.featureNotes, 1000),
      // Purely informational context (why the home is being sold), same as listings.life_event_tags_json. Optional.
      lifeEventTags: validLifeEventKeys(body.lifeEventTags),
    },
  };
}

export async function insertGreenHome(db, userId, d) {
  const result = await db.prepare(
    `INSERT INTO green_homes (user_id, title, description, address, neighborhood, city, state, zip, property_type,
       beds, baths, sqft, asking_price, green_features_json, feature_notes, life_event_tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip, d.propertyType,
    d.beds, d.baths, d.sqft, d.askingPrice, JSON.stringify(d.greenFeatures), d.featureNotes, JSON.stringify(d.lifeEventTags)
  ).run();
  return result.meta.last_row_id;
}

export async function updateGreenHome(db, id, d) {
  await db.prepare(
    `UPDATE green_homes SET title = ?, description = ?, address = ?, neighborhood = ?, city = ?, state = ?, zip = ?,
       property_type = ?, beds = ?, baths = ?, sqft = ?, asking_price = ?, green_features_json = ?, feature_notes = ?,
       life_event_tags_json = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip, d.propertyType,
    d.beds, d.baths, d.sqft, d.askingPrice, JSON.stringify(d.greenFeatures), d.featureNotes, JSON.stringify(d.lifeEventTags), id
  ).run();
}

export async function fetchGreenHomePhotos(db, homeId) {
  const rows = await db.prepare(
    'SELECT id, position FROM green_home_photos WHERE green_home_id = ? ORDER BY position ASC'
  ).bind(homeId).all();
  return rows.results;
}

const STATUSES = ['active', 'under_contract', 'sold', 'withdrawn'];

export async function setGreenHomeStatus(db, id, status) {
  if (!STATUSES.includes(status)) return { error: 'Invalid status.' };
  await db.prepare("UPDATE green_homes SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id).run();
  return { ok: true };
}
