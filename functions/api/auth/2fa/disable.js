import { getSessionUser, verifyPassword } from '../../../_lib/auth.js';
import { json, unauthorized, badRequest } from '../../../_lib/util.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const ok = await verifyPassword(String(body.password || ''), user.password_hash);
  if (!ok) return badRequest('Incorrect password.');

  await context.env.DB.prepare(
    'UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = 0 WHERE id = ?'
  ).bind(user.id).run();

  return json({ ok: true });
}
