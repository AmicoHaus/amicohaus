import { getSessionUser } from '../../../../_lib/auth.js';
import { scrubImageMetadata } from '../../../../_lib/imageMetadata.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { preListingAccess, agentsOnly } from '../../../../_lib/visibility.js';

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// The same people who can open the pre-listing (see visibility.js).
export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preListing = await db.prepare('SELECT id, user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  const { access } = await preListingAccess(db, user, preListing);
  if (access === 'agents_only') return agentsOnly();
  if (access === 'hidden') return notFound('Pre-listing not found.');
  const rows = await db.prepare(
    'SELECT id, position, created_at FROM pre_listing_photos WHERE pre_listing_id = ? ORDER BY position ASC'
  ).bind(id).all();
  return json({ photos: rows.results }, { headers: { 'Cache-Control': 'private, no-store' } });
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
  await bucket.put(key, scrubImageMetadata(await file.arrayBuffer(), file.type), { httpMetadata: { contentType: file.type } });

  // Privacy Sweep: swept=1 when the owner ticked "I checked this photo" on their device before it uploaded
  // (privacy-sweep.js). The mark is the owner's own and only ever shown to them.
  const swept = form.get('swept') === '1' ? 1 : 0;
  const result = await db.prepare(
    `INSERT INTO pre_listing_photos (pre_listing_id, r2_key, content_type, position, swept_at)
     VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') END)`
  ).bind(id, key, file.type, countRow.n, swept).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
