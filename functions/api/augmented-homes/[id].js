import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../_lib/util.js';
import { validateAugmentedHomeInput, updateAugmentedHome, fetchAugmentedHomePhotos, setAugmentedHomeStatus } from '../../_lib/augmentedHomes.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const row = await db.prepare(
    `SELECT augmented_homes.*, users.display_name AS owner_name
     FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id WHERE augmented_homes.id = ?`
  ).bind(id).first();
  if (!row) return notFound('Listing not found.');

  const isOwner = user.id === row.user_id;
  const photos = await fetchAugmentedHomePhotos(db, id);

  const home = {
    id: row.id, userId: row.user_id, owner: row.owner_name, title: row.title, description: row.description,
    address: isOwner ? row.address : undefined, neighborhood: row.neighborhood, city: row.city, state: row.state, zip: row.zip,
    propertyType: row.property_type, beds: row.beds, baths: row.baths, sqft: row.sqft, askingPrice: row.asking_price,
    adaptations: JSON.parse(row.adaptations_json || '[]'), adaptationNotes: row.adaptation_notes,
    status: row.status, createdAt: row.created_at, photoIds: photos.map(p => p.id),
  };

  return json({ home, isOwner: !!isOwner });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, status FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Listing not found.');
  if (existing.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  if (body.action === 'set-status') {
    const result = await setAugmentedHomeStatus(db, id, body.status);
    if (result.error) return badRequest(result.error);
    return json(result);
  }

  if (existing.status !== 'active') return badRequest('Only an active listing can be edited.');
  const validated = validateAugmentedHomeInput(body);
  if (validated.error) return badRequest(validated.error);
  await updateAugmentedHome(db, id, validated.data);
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Listing not found.');
  if (existing.user_id !== user.id && user.role !== 'admin') return forbidden();

  await db.prepare('DELETE FROM augmented_homes WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
