import { notFound } from '../../_lib/util.js';

// Public — an agent's portfolio photos are their marketing material, meant
// to be seen by anyone reviewing a proposal.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const photo = await db.prepare('SELECT r2_key, content_type FROM agent_portfolio_photos WHERE id = ?').bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
