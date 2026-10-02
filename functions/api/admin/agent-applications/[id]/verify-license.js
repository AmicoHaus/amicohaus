import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { logAdminAction } from '../../../../_lib/audit.js';

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const applicantId = context.params.id;
  const db = context.env.DB;
  const existing = await db.prepare('SELECT license_photo_r2_key FROM agent_profiles WHERE user_id = ?').bind(applicantId).first();
  if (!existing) return notFound('No application from this user.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const verified = !!body.verified;
  if (verified && !existing.license_photo_r2_key) return badRequest('This agent has not uploaded a license photo yet.');

  await db.prepare(
    "UPDATE agent_profiles SET license_verified = ?, license_verified_at = datetime('now'), license_verified_by = ? WHERE user_id = ?"
  ).bind(verified ? 1 : 0, user.id, applicantId).run();
  await logAdminAction(db, user.id, verified ? 'license_verified' : 'license_unverified', 'agent_profile', applicantId);

  return json({ ok: true });
}
