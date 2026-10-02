import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, badRequest } from '../../../_lib/util.js';
import { generateTotpSecret, otpauthUri } from '../../../_lib/totp.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.totp_enabled) return badRequest('Two-factor is already enabled — disable it first to reconfigure.');

  const secret = generateTotpSecret();
  await context.env.DB.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?').bind(secret, user.id).run();

  return json({ secret, otpauthUri: otpauthUri(secret, user.email) });
}
