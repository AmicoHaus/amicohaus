import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

const MAX_PHOTOS_PER_LISTING = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function onRequestGet(context) {
  const listingId = context.params.id;
  const db = context.env.DB;
  const rows = await db.prepare(
    'SELECT id, position, created_at FROM listing_photos WHERE listing_id = ? ORDER BY position ASC'
  ).bind(listingId).all();
  return json({ photos: rows.results });
}

export async function onRequestPost(context) {
  const listingId = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').bind(listingId).first();
  if (!listing) return notFound('Listing not found.');
  if (listing.user_id !== user.id && user.role !== 'admin') return forbidden();

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM listing_photos WHERE listing_id = ?').bind(listingId).first();
  if (countRow.n >= MAX_PHOTOS_PER_LISTING) return badRequest(`A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos.`);

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photos must be JPEG, PNG, WEBP, or GIF.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');

  const key = `listings/${listingId}/${crypto.randomUUID()}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const result = await db.prepare(
    'INSERT INTO listing_photos (listing_id, r2_key, content_type, position) VALUES (?, ?, ?, ?)'
  ).bind(listingId, key, file.type, countRow.n).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
