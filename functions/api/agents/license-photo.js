import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';

// Private, unlike agent_portfolio_photos — a license photo is sensitive
// (name, license number, sometimes a photo ID), so only the agent
// themselves and an admin can ever fetch it back (see
// functions/api/license-photos/[agentUserId].js). Re-uploading clears any
// prior verification, since the new photo hasn't been reviewed yet.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT license_photo_r2_key FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent) return badRequest('Apply to become an agent before uploading a license photo.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photo must be JPEG, PNG, or WEBP.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');

  if (agent.license_photo_r2_key) await bucket.delete(agent.license_photo_r2_key);

  const key = `agent-license/${user.id}/${crypto.randomUUID()}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  await db.prepare(
    'UPDATE agent_profiles SET license_photo_r2_key = ?, license_verified = 0, license_verified_at = NULL, license_verified_by = NULL WHERE user_id = ?'
  ).bind(key, user.id).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT license_photo_r2_key FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent || !agent.license_photo_r2_key) return notFound('No license photo to remove.');

  const bucket = context.env.PHOTOS;
  if (bucket) await bucket.delete(agent.license_photo_r2_key);
  await db.prepare(
    'UPDATE agent_profiles SET license_photo_r2_key = NULL, license_verified = 0, license_verified_at = NULL, license_verified_by = NULL WHERE user_id = ?'
  ).bind(user.id).run();

  return json({ ok: true });
}
