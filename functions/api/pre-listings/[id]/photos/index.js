import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const rows = await db.prepare(
    'SELECT id, position, created_at FROM pre_listing_photos WHERE pre_listing_id = ? ORDER BY position ASC'
  ).bind(id).all();
  return json({ photos: rows.results });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM pre_listing_photos WHERE pre_listing_id = ?').bind(id).first();
  if (countRow.n >= MAX_PHOTOS) return badRequest(`A pre-listing can have at most ${MAX_PHOTOS} photos.`);

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photos must be JPEG, PNG, WEBP, or GIF.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');

  const key = `pre-listings/${id}/${crypto.randomUUID()}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const result = await db.prepare(
    'INSERT INTO pre_listing_photos (pre_listing_id, r2_key, content_type, position) VALUES (?, ?, ?, ?)'
  ).bind(id, key, file.type, countRow.n).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
