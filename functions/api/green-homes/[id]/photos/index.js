import { getSessionUser } from '../../../../_lib/auth.js';
import { scrubImageMetadata } from '../../../../_lib/imageMetadata.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { mediaCacheControl } from '../../../../_lib/visibility.js';

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Public while the home is (anything but withdrawn, and its owner's account is active: the same rule as the photo
// files); otherwise only the owner and admins see the list.
export async function onRequestGet(context) {
  const id = context.params.id;
  const db = context.env.DB;
  const home = await db.prepare(
    'SELECT green_homes.user_id, green_homes.status, users.status AS owner_status FROM green_homes JOIN users ON users.id = green_homes.user_id WHERE green_homes.id = ?'
  ).bind(id).first();
  if (!home) return notFound('Listing not found.');
  const isPublic = home.status !== 'withdrawn' && home.owner_status === 'active';
  const cacheControl = await mediaCacheControl(context, isPublic, home.user_id, 'no-cache');
  if (!cacheControl) return notFound('Listing not found.');
  const rows = await db.prepare(
    'SELECT id, position, created_at FROM green_home_photos WHERE green_home_id = ? ORDER BY position ASC'
  ).bind(id).all();
  return json({ photos: rows.results }, { headers: { 'Cache-Control': cacheControl } });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM green_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');
  if (home.user_id !== user.id) return forbidden();

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM green_home_photos WHERE green_home_id = ?').bind(id).first();
  if (countRow.n >= MAX_PHOTOS) return badRequest(`A listing can have at most ${MAX_PHOTOS} photos.`);

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photos must be JPEG, PNG, WEBP, or GIF.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');

  const key = `green-homes/${id}/${crypto.randomUUID()}`;
  await bucket.put(key, scrubImageMetadata(await file.arrayBuffer(), file.type), { httpMetadata: { contentType: file.type } });

  const result = await db.prepare(
    'INSERT INTO green_home_photos (green_home_id, r2_key, content_type, position) VALUES (?, ?, ?, ?)'
  ).bind(id, key, file.type, countRow.n).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
