import { notFound } from '../../../_lib/util.js';

// Public — same reasoning as agent-photos/[id].js: a case study is
// marketing material meant to be seen by anyone reviewing a proposal.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const row = await db.prepare('SELECT before_r2_key AS key, before_content_type AS contentType FROM agent_case_studies WHERE id = ?').bind(context.params.id).first();
  if (!row) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');
  const object = await bucket.get(row.key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': row.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
