import { getSessionUser } from '../../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

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

  return json({ ok: true });
}
