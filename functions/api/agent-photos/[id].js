import { notFound } from '../../_lib/util.js';
import { mediaCacheControl } from '../../_lib/visibility.js';

// Public for an approved agent with an active account: portfolio photos are their marketing material, meant to be
// seen by anyone reviewing a proposal. A pending, rejected or suspended applicant's photos go only to themself and
// admins (so this is never free public image hosting).
export async function onRequestGet(context) {
  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT p.r2_key, p.content_type, p.agent_user_id, ap.status AS agent_status, u.status AS user_status
     FROM agent_portfolio_photos p JOIN users u ON u.id = p.agent_user_id LEFT JOIN agent_profiles ap ON ap.user_id = p.agent_user_id
     WHERE p.id = ?`
  ).bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');
  const isPublic = photo.agent_status === 'approved' && photo.user_status === 'active';
  const cacheControl = await mediaCacheControl(context, isPublic, photo.agent_user_id, 'public, max-age=31536000, immutable');
  if (!cacheControl) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': cacheControl },
  });
}
