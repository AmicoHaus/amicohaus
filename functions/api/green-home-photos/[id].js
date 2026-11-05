import { notFound } from '../../_lib/util.js';
import { mediaCacheControl } from '../../_lib/visibility.js';

// Public while the home is (anything but withdrawn, and its owner's account is active) -- GreenHomes is a browse
// marketplace, same footing as the regular Directory listings, and the public page's thumbnail and og:image keep
// working. A withdrawn home's or a suspended owner's photos go only to the owner and admins.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT green_home_photos.r2_key, green_home_photos.content_type, green_homes.user_id, green_homes.status, users.status AS owner_status
     FROM green_home_photos JOIN green_homes ON green_homes.id = green_home_photos.green_home_id JOIN users ON users.id = green_homes.user_id
     WHERE green_home_photos.id = ?`
  ).bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');
  const isPublic = photo.status !== 'withdrawn' && photo.owner_status === 'active';
  const cacheControl = await mediaCacheControl(context, isPublic, photo.user_id, 'public, max-age=31536000, immutable');
  if (!cacheControl) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': cacheControl },
  });
}
