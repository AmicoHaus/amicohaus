import { notFound } from '../../_lib/util.js';
import { mediaCacheControl } from '../../_lib/visibility.js';

// Public while the home is (anything but withdrawn, and its owner's account is active) -- AugmentedHomes is a browse
// marketplace, same footing as the regular Directory listings (functions/api/photos/[id].js), and the public page's
// thumbnail and og:image keep working. A withdrawn home's or a suspended owner's photos go only to the owner and admins.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT augmented_home_photos.r2_key, augmented_home_photos.content_type, augmented_homes.user_id, augmented_homes.status, users.status AS owner_status
     FROM augmented_home_photos JOIN augmented_homes ON augmented_homes.id = augmented_home_photos.augmented_home_id JOIN users ON users.id = augmented_homes.user_id
     WHERE augmented_home_photos.id = ?`
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
