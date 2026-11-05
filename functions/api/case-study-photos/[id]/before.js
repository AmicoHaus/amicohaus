import { notFound } from '../../../_lib/util.js';
import { mediaCacheControl } from '../../../_lib/visibility.js';

// Same rule as agent-photos/[id].js: a case study is marketing material, public for an approved agent with an active
// account; a pending, rejected or suspended applicant's go only to themself and admins.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const row = await db.prepare(
    `SELECT c.before_r2_key AS key, c.before_content_type AS contentType, c.agent_user_id, ap.status AS agent_status, u.status AS user_status
     FROM agent_case_studies c JOIN users u ON u.id = c.agent_user_id LEFT JOIN agent_profiles ap ON ap.user_id = c.agent_user_id
     WHERE c.id = ?`
  ).bind(context.params.id).first();
  if (!row) return notFound('Photo not found.');
  const isPublic = row.agent_status === 'approved' && row.user_status === 'active';
  const cacheControl = await mediaCacheControl(context, isPublic, row.agent_user_id, 'public, max-age=31536000, immutable');
  if (!cacheControl) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');
  const object = await bucket.get(row.key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': row.contentType, 'Cache-Control': cacheControl },
  });
}
