import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../_lib/util.js';

export async function onRequestDelete(context) {
  const { photoId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const photo = await db.prepare('SELECT agent_user_id, r2_key FROM agent_portfolio_photos WHERE id = ?').bind(photoId).first();
  if (!photo) return notFound('Photo not found.');
  if (photo.agent_user_id !== user.id && user.role !== 'admin') return forbidden();

  const bucket = context.env.PHOTOS;
  if (bucket) await bucket.delete(photo.r2_key);
  await db.prepare('DELETE FROM agent_portfolio_photos WHERE id = ?').bind(photoId).run();

  return json({ ok: true });
}
