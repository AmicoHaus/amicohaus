import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';

// Verification is a trust signal shown on a user's public profile and their
// listings — deliberately admin-only (not self-service) since it's meant to
// mean "an admin checked this," not "this user claims to be an agent."
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['verify', 'unverify'].includes(body.action)) return badRequest('Invalid action.');

  const db = context.env.DB;
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!target) return notFound('User not found.');

  const isVerified = body.action === 'verify' ? 1 : 0;
  await db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').bind(isVerified, id).run();
  await logAdminAction(db, user.id, `user_${body.action}`, 'user', id);

  return json({ ok: true });
}
