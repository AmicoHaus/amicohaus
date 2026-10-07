import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function onRequestGet(context) {
  const id = context.params.id;
  const rows = await context.env.DB.prepare(
    'SELECT id, position, created_at FROM augmented_home_photos WHERE augmented_home_id = ? ORDER BY position ASC'
  ).bind(id).all();
  return json({ photos: rows.results });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');
  if (home.user_id !== user.id) return forbidden();

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM augmented_home_photos WHERE augmented_home_id = ?').bind(id).first();
  if (countRow.n >= MAX_PHOTOS) return badRequest(`A listing can have at most ${MAX_PHOTOS} photos.`);

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photos must be JPEG, PNG, WEBP, or GIF.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');

  const key = `augmented-homes/${id}/${crypto.randomUUID()}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const result = await db.prepare(
    'INSERT INTO augmented_home_photos (augmented_home_id, r2_key, content_type, position) VALUES (?, ?, ?, ?)'
  ).bind(id, key, file.type, countRow.n).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
