import { notFound } from '../../_lib/util.js';
import { mediaCacheControl } from '../../_lib/visibility.js';

// Public while the listing is (active, and its owner's account is active: the same rule as the public /listing/:id
// page, so its thumbnail and og:image keep working) — listing photos aren't sensitive the way an exact street
// address is. A paused listing's or a suspended owner's photos go only to the owner and admins.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT listing_photos.r2_key, listing_photos.content_type, listings.user_id, listings.status, users.status AS owner_status
     FROM listing_photos JOIN listings ON listings.id = listing_photos.listing_id JOIN users ON users.id = listings.user_id
     WHERE listing_photos.id = ?`
  ).bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');
  const isPublic = photo.status === 'active' && photo.owner_status === 'active';
  const cacheControl = await mediaCacheControl(context, isPublic, photo.user_id, 'public, max-age=31536000, immutable');
  if (!cacheControl) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: {
      'Content-Type': photo.content_type,
      'Cache-Control': cacheControl,
    },
  });
}
