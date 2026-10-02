import { getClientIp, isRateLimited, recordAttempt, generateToken } from '../../_lib/auth.js';
import { json, badRequest, clampString } from '../../_lib/util.js';
import { sendEmail } from '../../_lib/email.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const ip = getClientIp(context.request);

  if (await isRateLimited(db, 'forgot_password', ip)) {
    return json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }
  await recordAttempt(db, 'forgot_password', ip, null);

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const email = clampString(body.email, 200).toLowerCase();
  if (!email) return badRequest('Enter your email.');

  // Always return the same success response whether or not the email is
  // registered, so this can't be used to check who has an account.
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (user) {
    const token = generateToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    await db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').bind(token, expires, user.id).run();

    const origin = new URL(context.request.url).origin;
    await sendEmail(context, {
      to: email,
      subject: 'Reset your Amico Haus password',
      text: `Reset your password: ${origin}/reset-password?token=${token}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    });
  }

  return json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
}
