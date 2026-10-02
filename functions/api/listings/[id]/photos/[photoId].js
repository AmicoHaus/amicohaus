import { getSessionUser } from '../../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

export async function onRequestDelete(context) {
  const { id: listingId, photoId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').bind(listingId).first();
  if (!listing) return notFound('Listing not found.');
  if (listing.user_id !== user.id && user.role !== 'admin') return forbidden();

  const photo = await db.prepare('SELECT r2_key FROM listing_photos WHERE id = ? AND listing_id = ?').bind(photoId, listingId).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (bucket) await bucket.delete(photo.r2_key);
  await db.prepare('DELETE FROM listing_photos WHERE id = ?').bind(photoId).run();

  return json({ ok: true });
}
