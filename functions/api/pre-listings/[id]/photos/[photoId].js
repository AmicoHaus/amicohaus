import { getSessionUser } from '../../../../_lib/auth.js';
import { logAdminAction } from '../../../../_lib/audit.js';
import { scrubImageMetadata } from '../../../../_lib/imageMetadata.js';
import { claimUserAction, rateLimited } from '../../../../_lib/rateLimits.js';
import { deleteR2Keys } from '../../../../_lib/r2Cleanup.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

// Same checks and messages as a new photo (photos/index.js).
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Privacy Sweep, after the fact: the owner swept a photo that's already up (privacy-sweep.js "Sweep this photo") and
// sends the swept copy. It takes the old photo's place in the order under a NEW row id (never a new file under an old
// id, so nothing cached under the old id can show the new file or the other way round), and the old file is removed.
// Owner only: an admin takes a photo down instead (DELETE below). POST because client.js apiUpload only POSTs.
export async function onRequestPost(context) {
  const { id: preListingId, photoId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(preListingId).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();

  // Scoped to this pre-listing so its id can't be used to replace someone else's photo.
  const photo = await db.prepare('SELECT id, r2_key, position FROM pre_listing_photos WHERE id = ? AND pre_listing_id = ?').bind(photoId, preListingId).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }
  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photos must be JPEG, PNG, WEBP, or GIF.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');

  if (!(await claimUserAction(db, 'photo_sweep', user.id, `pre_listing:${preListingId}`))) return rateLimited();

  const swept = form.get('swept') === '1' ? 1 : 0;
  const key = `pre-listings/${preListingId}/${crypto.randomUUID()}`;
  await bucket.put(key, scrubImageMetadata(await file.arrayBuffer(), file.type), { httpMetadata: { contentType: file.type } });

  // One batch: the swept copy goes in at the old place and the old row goes, or neither happens.
  let results;
  try {
    results = await db.batch([
      db.prepare(
        `INSERT INTO pre_listing_photos (pre_listing_id, r2_key, content_type, position, swept_at)
         VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') END)`
      ).bind(preListingId, key, file.type, photo.position, swept),
      db.prepare('DELETE FROM pre_listing_photos WHERE id = ? AND pre_listing_id = ?').bind(photo.id, preListingId),
    ]);
  } catch (err) {
    await deleteR2Keys(bucket, [key]);
    throw err;
  }
  await deleteR2Keys(bucket, [photo.r2_key]);

  return json({ id: results[0].meta.last_row_id, replaced: photo.id }, NO_STORE);
}

// The owner (or an admin) can take a photo back down — e.g. one that shows the street number or a lockbox.
export async function onRequestDelete(context) {
  const { id: preListingId, photoId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(preListingId).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id && user.role !== 'admin') return forbidden();

  // Scoped to this pre-listing so its id can't be used to remove someone else's photo.
  const photo = await db.prepare('SELECT r2_key FROM pre_listing_photos WHERE id = ? AND pre_listing_id = ?').bind(photoId, preListingId).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (bucket) await bucket.delete(photo.r2_key);
  await db.prepare('DELETE FROM pre_listing_photos WHERE id = ?').bind(photoId).run();

  // An admin acting on someone else's content is on the admin activity log.
  if (preListing.user_id !== user.id) await logAdminAction(db, user.id, 'delete_pre_listing_photo', 'pre_listing', preListingId);
  return json({ ok: true });
}
