import { notFound } from '../../_lib/util.js';

// Public — AugmentedHomes is a browse marketplace, same footing as the
// regular Directory listings (functions/api/photos/[id].js).
export async function onRequestGet(context) {
  const db = context.env.DB;
  const photo = await db.prepare('SELECT r2_key, content_type FROM augmented_home_photos WHERE id = ?').bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
