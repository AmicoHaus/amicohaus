import { getSessionUser } from '../../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

export async function onRequestDelete(context) {
  const { id: homeId, photoId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM augmented_homes WHERE id = ?').bind(homeId).first();
  if (!home) return notFound('Listing not found.');
  if (home.user_id !== user.id && user.role !== 'admin') return forbidden();

  const photo = await db.prepare('SELECT r2_key FROM augmented_home_photos WHERE id = ? AND augmented_home_id = ?').bind(photoId, homeId).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (bucket) await bucket.delete(photo.r2_key);
  await db.prepare('DELETE FROM augmented_home_photos WHERE id = ?').bind(photoId).run();

  return json({ ok: true });
}
