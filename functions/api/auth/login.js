import { verifyPassword, createSession, sessionCookieHeader, publicUser, getClientIp, isRateLimited, recordAttempt, generateToken } from '../../_lib/auth.js';
import { json, badRequest, clampString } from '../../_lib/util.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const ip = getClientIp(context.request);

  if (await isRateLimited(db, 'login', ip)) {
    return json({ error: 'Too many login attempts. Try again in a few minutes.' }, { status: 429 });
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const email = clampString(body.email, 200).toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return badRequest('Enter your email and password.');

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  // Same generic error whether the email doesn't exist or the password is wrong,
  // so login can't be used to enumerate registered emails.
  const genericError = async () => {
    await recordAttempt(db, 'login', ip, email);
    return json({ error: 'Incorrect email or password.' }, { status: 401 });
  };

  // Signed up but never opened the emailed link, so there's no password yet.
  // Say so plainly instead of "incorrect password" — nothing here needs a secret.
  if (user && user.email_confirmation_pending) {
    return json({
      error: "You haven't finished signing up yet. Open the confirmation link we emailed you, or request a new one.",
      code: 'email_unconfirmed',
    }, { status: 403 });
  }

  if (!user || !user.password_hash) return genericError();
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return genericError();
  if (user.status === 'suspended') return json({ error: 'This account has been suspended.' }, { status: 403 });

  if (user.totp_enabled) {
    const pendingToken = generateToken();
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes to enter the code
    await db.prepare('INSERT INTO pending_2fa (token, user_id, expires_at) VALUES (?, ?, ?)').bind(pendingToken, user.id, expires).run();
    return json({ requiresTwoFactor: true, pendingToken });
  }

  const { token, expiresAt } = await createSession(db, user.id);
  return json(
    { user: publicUser(user) },
    { headers: { 'Set-Cookie': sessionCookieHeader(token, expiresAt) } }
  );
}
