import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, badRequest } from '../../../_lib/util.js';
import { verifyTotpCode } from '../../../_lib/totp.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (!user.totp_pending_secret) return badRequest('No two-factor setup in progress — start setup first.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const ok = await verifyTotpCode(user.totp_pending_secret, body.code);
  if (!ok) return badRequest('That code is incorrect or expired.');

  await context.env.DB.prepare(
    'UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = 1 WHERE id = ?'
  ).bind(user.id).run();

  return json({ ok: true });
}
