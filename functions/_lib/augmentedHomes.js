import { clampString } from './util.js';
import { PROPERTY_TYPES, num } from './listings.js';
import { validAdaptationKeys } from './adaptations.js';
import { validLifeEventKeys } from './lifeEvents.js';

export function validateAugmentedHomeInput(body) {
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  const zip = clampString(body.zip, 10);
  const propertyType = PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : null;
  const beds = num(body.beds, { min: 0, max: 50 });
  const baths = num(body.baths, { min: 0, max: 50 });
  const askingPrice = num(body.askingPrice, { min: 1, max: 500000000 });
  const adaptations = validAdaptationKeys(body.adaptations);

  if (!city || !state || !propertyType || beds === null || baths === null) {
    return { error: 'Fill in city, state, property type, beds, and baths.' };
  }
  if (!/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit zip code.' };
  if (askingPrice === null) return { error: 'Enter an asking price.' };
  if (adaptations.length === 0) return { error: 'Check off at least one adaptation this home has.' };

  return {
    data: {
      title: clampString(body.title, 120),
      description: clampString(body.description, 2000),
      address: clampString(body.address, 150),
      neighborhood: clampString(body.neighborhood, 80),
      city, state, zip, propertyType, beds, baths,
      sqft: body.sqft ? num(body.sqft, { min: 0, max: 200000 }) : null,
      askingPrice, adaptations,
      adaptationNotes: clampString(body.adaptationNotes, 1000),
      // Purely informational context (why the home is being sold), same as listings.life_event_tags_json. Optional.
      lifeEventTags: validLifeEventKeys(body.lifeEventTags),
    },
  };
}

export async function insertAugmentedHome(db, userId, d) {
  const result = await db.prepare(
    `INSERT INTO augmented_homes (user_id, title, description, address, neighborhood, city, state, zip, property_type,
       beds, baths, sqft, asking_price, adaptations_json, adaptation_notes, life_event_tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip, d.propertyType,
    d.beds, d.baths, d.sqft, d.askingPrice, JSON.stringify(d.adaptations), d.adaptationNotes, JSON.stringify(d.lifeEventTags)
  ).run();
  return result.meta.last_row_id;
}

export async function updateAugmentedHome(db, id, d) {
  await db.prepare(
    `UPDATE augmented_homes SET title = ?, description = ?, address = ?, neighborhood = ?, city = ?, state = ?, zip = ?,
       property_type = ?, beds = ?, baths = ?, sqft = ?, asking_price = ?, adaptations_json = ?, adaptation_notes = ?,
       life_event_tags_json = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip, d.propertyType,
    d.beds, d.baths, d.sqft, d.askingPrice, JSON.stringify(d.adaptations), d.adaptationNotes, JSON.stringify(d.lifeEventTags), id
  ).run();
}

export async function fetchAugmentedHomePhotos(db, homeId) {
  const rows = await db.prepare(
    'SELECT id, position FROM augmented_home_photos WHERE augmented_home_id = ? ORDER BY position ASC'
  ).bind(homeId).all();
  return rows.results;
}

const STATUSES = ['active', 'under_contract', 'sold', 'withdrawn'];

export async function setAugmentedHomeStatus(db, id, status) {
  if (!STATUSES.includes(status)) return { error: 'Invalid status.' };
  await db.prepare("UPDATE augmented_homes SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id).run();
  return { ok: true };
}
