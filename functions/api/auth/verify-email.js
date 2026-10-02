import { json } from '../../_lib/util.js';
import { hashPassword, hashToken, createSession, sessionCookieHeader, publicUser } from '../../_lib/auth.js';

// The page an emailed sign-up link opens. It does two things, split so a mail
// scanner that merely fetches the link can't use it up:
//   GET  ?token=…  peeks at the link (is it good? whose is it?) and changes nothing.
//   POST {token, password}  finishes the signup: sets the password, marks the
//        email confirmed, and signs the person in.

function failure(error, code, status = 400) {
  return json({ error, code }, { status });
}

// Resolves a link's token to the pending account it belongs to.
async function findPendingAccount(db, token) {
  if (!token) return { error: failure('This link is missing its token.', 'invalid') };
  const tokenHash = await hashToken(token);
  const user = await db.prepare('SELECT * FROM users WHERE verify_token = ? AND email_confirmation_pending = 1').bind(tokenHash).first();
  if (!user) return {};
  // Expiry is compared here rather than in SQL: the value is an ISO timestamp.
  if (!user.verify_token_expires || Date.parse(user.verify_token_expires) <= Date.now()) {
    return { error: failure('That link has expired. Enter your email below and we\'ll send a new one.', 'expired') };
  }
  return { user, tokenHash };
}

// Links sent by the old sign-up flow held the raw token, with no expiry, and
// only ever marked the email as verified (they never signed anyone in).
async function findLegacyToken(db, token) {
  if (!token) return null;
  return db.prepare('SELECT id FROM users WHERE verify_token = ? AND verify_token_expires IS NULL').bind(token).first();
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  const token = String(new URL(context.request.url).searchParams.get('token') || '');

  const { user, error } = await findPendingAccount(db, token);
  if (error) return error;
  if (user) return json({ ok: true, displayName: user.display_name, email: user.email });

  if (await findLegacyToken(db, token)) return json({ ok: true, legacy: true });
  return failure('That link is invalid or has already been used.', 'invalid');
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return failure('Invalid request body.', 'invalid'); }
  const token = String(body.token || '');

  const { user, tokenHash, error } = await findPendingAccount(db, token);
  if (error) return error;

  if (!user) {
    const legacy = await findLegacyToken(db, token);
    if (!legacy) return failure('That link is invalid or has already been used.', 'invalid');
    await db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').bind(legacy.id).run();
    return json({ ok: true, legacy: true });
  }

  const password = String(body.password || '');
  if (password.length < 8) return failure('Choose a password with at least 8 characters.', 'password_required');
  if (password.length > 200) return failure('That password is too long.', 'password_required');

  // Claim the link atomically: if two requests race, only one gets past here.
  const claimed = await db.prepare(
    `UPDATE users SET password_hash = ?, email_verified = 1, email_confirmation_pending = 0,
       verify_token = NULL, verify_token_expires = NULL
     WHERE id = ? AND verify_token = ? AND email_confirmation_pending = 1`
  ).bind(await hashPassword(password), user.id, tokenHash).run();
  if (!claimed.meta.changes) return failure('That link is invalid or has already been used.', 'invalid');

  const { token: sessionToken, expiresAt } = await createSession(db, user.id);
  return json(
    { ok: true, user: publicUser({ ...user, email_verified: 1 }) },
    { headers: { 'Set-Cookie': sessionCookieHeader(sessionToken, expiresAt) } }
  );
}
