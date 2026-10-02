import { notFound } from '../../../_lib/util.js';

export async function onRequestGet(context) {
  const db = context.env.DB;
  const row = await db.prepare('SELECT after_r2_key AS key, after_content_type AS contentType FROM agent_case_studies WHERE id = ?').bind(context.params.id).first();
  if (!row) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');
  const object = await bucket.get(row.key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': row.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
