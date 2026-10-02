import { createSession, sessionCookieHeader, publicUser } from '../../../_lib/auth.js';
import { json, badRequest } from '../../../_lib/util.js';
import { verifyTotpCode } from '../../../_lib/totp.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const pendingToken = String(body.pendingToken || '');
  if (!pendingToken) return badRequest('Missing pending token.');

  const pending = await db.prepare(
    `SELECT * FROM pending_2fa WHERE token = ? AND datetime(expires_at) > datetime('now')`
  ).bind(pendingToken).first();
  if (!pending) return badRequest('This login attempt has expired — log in again.');

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(pending.user_id).first();
  if (!user || !user.totp_enabled) return badRequest('Two-factor is not enabled on this account.');

  const ok = await verifyTotpCode(user.totp_secret, body.code);
  if (!ok) return badRequest('That code is incorrect or expired.');

  await db.prepare('DELETE FROM pending_2fa WHERE token = ?').bind(pendingToken).run();

  const { token, expiresAt } = await createSession(db, user.id);
  return json(
    { user: publicUser(user) },
    { headers: { 'Set-Cookie': sessionCookieHeader(token, expiresAt) } }
  );
}
