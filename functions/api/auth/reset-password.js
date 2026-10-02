import { hashPassword } from '../../_lib/auth.js';
import { json, badRequest } from '../../_lib/util.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const token = String(body.token || '');
  const password = String(body.password || '');
  if (!token) return badRequest('Missing reset token.');
  if (password.length < 8) return badRequest('Password must be at least 8 characters.');

  const user = await db.prepare(
    `SELECT id FROM users WHERE reset_token = ? AND datetime(reset_token_expires) > datetime('now')`
  ).bind(token).first();
  if (!user) return badRequest('That reset link is invalid or has expired — request a new one.');

  const passwordHash = await hashPassword(password);
  // Following the emailed reset link also proves the mailbox is theirs, so it
  // finishes a signup that was never confirmed.
  await db.prepare(
    `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL,
       email_verified = 1, email_confirmation_pending = 0, verify_token = NULL, verify_token_expires = NULL
     WHERE id = ?`
  ).bind(passwordHash, user.id).run();

  // Log out of every existing session as a safety measure for the account
  // takeover scenario (someone else's session should not survive a reset).
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

  return json({ ok: true });
}
