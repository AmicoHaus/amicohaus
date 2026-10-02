import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized, forbidden, notFound } from '../../_lib/util.js';

// Unlike agent-photos/[id].js (public portfolio photos), this is gated to
// the agent themselves or an admin — a license photo can carry a name,
// license number, and sometimes a photo ID.
export async function onRequestGet(context) {
  const agentUserId = Number(context.params.agentUserId);
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.id !== agentUserId && user.role !== 'admin') return forbidden();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT license_photo_r2_key FROM agent_profiles WHERE user_id = ?').bind(agentUserId).first();
  if (!agent || !agent.license_photo_r2_key) return notFound('No license photo on file.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(agent.license_photo_r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': object.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, no-store' },
  });
}
