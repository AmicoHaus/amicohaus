import { getSessionUser } from '../../_lib/auth.js';
import { notFound, unauthorized } from '../../_lib/util.js';

// Signed-in users only. Unlike a regular listing's photos (public, see
// functions/api/photos/[id].js), these show the inside of a home that hasn't
// been listed anywhere yet, and the ids are sequential.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const photo = await db.prepare('SELECT r2_key, content_type FROM pre_listing_photos WHERE id = ?').bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private, max-age=86400' },
  });
}
