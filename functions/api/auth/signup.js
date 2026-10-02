import { getClientIp, isRateLimited, recordAttempt, generateReferralCode } from '../../_lib/auth.js';
import { json, badRequest, clampString } from '../../_lib/util.js';
import { sendConfirmationLink } from '../../_lib/emailConfirmation.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Signing up only needs a name and an email. The account is created "pending"
// (no password, no session) and an emailed link finishes it: opening the link
// proves the person owns the address, and the page it opens is where they
// choose a password (see api/auth/verify-email.js). Until then nobody can log
// in as that account, so typing someone else's address gets an attacker nothing.
export async function onRequestPost(context) {
  const db = context.env.DB;
  const ip = getClientIp(context.request);

  if (await isRateLimited(db, 'signup', ip)) {
    return json({ error: 'Too many signups from this network. Try again later.' }, { status: 429 });
  }
  await recordAttempt(db, 'signup', ip, null);

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const email = clampString(body.email, 200).toLowerCase();
  const displayName = clampString(body.displayName, 80);
  // Which side of the marketplace they came for; only steers where the emailed link lands them.
  const intent = ['homeowner', 'agent'].includes(body.intent) ? body.intent : '';

  if (!EMAIL_RE.test(email)) return badRequest('Enter a valid email address.');
  if (!displayName) return badRequest('Enter your name.');

  // Signups nobody confirmed within a week are abandoned; drop them so they
  // don't sit on an address forever.
  await db.prepare("DELETE FROM users WHERE email_confirmation_pending = 1 AND created_at < datetime('now', '-7 days')").run();

  const existing = await db.prepare('SELECT id, email_confirmation_pending FROM users WHERE email = ?').bind(email).first();
  if (existing && !existing.email_confirmation_pending) {
    return badRequest('That email is already registered — try logging in instead.');
  }

  let userId;
  let isNewRow = false;
  if (existing) {
    // Started before but never confirmed. There's no password to overwrite, so
    // just refresh the name and send a new link; whoever owns the mailbox is
    // the only one who can finish it.
    userId = existing.id;
    await db.prepare("UPDATE users SET display_name = ?, created_at = datetime('now') WHERE id = ?").bind(displayName, userId).run();
  } else {
    let referredBy = null;
    const refCode = clampString(body.referralCode, 20);
    if (refCode) {
      const referrer = await db.prepare('SELECT id FROM users WHERE referral_code = ?').bind(refCode.toUpperCase()).first();
      if (referrer) referredBy = referrer.id;
    }

    const insert = (code) => db.prepare(
      `INSERT INTO users (email, password_hash, display_name, role, referral_code, referred_by, email_confirmation_pending)
       VALUES (?, NULL, ?, 'user', ?, ?, 1)`
    ).bind(email, displayName, code, referredBy).run();

    let result;
    try {
      result = await insert(generateReferralCode());
    } catch (err) {
      const msg = String(err && err.message).toLowerCase();
      if (!msg.includes('unique')) throw err;

      if (msg.includes('referral_code')) {
        // 7 chars from a 33-char alphabet: a collision is astronomically
        // unlikely, but retry once rather than fail the whole signup.
        result = await insert(generateReferralCode());
      } else {
        // Two concurrent signups for the same email can both pass the SELECT
        // above before either INSERT commits — this catches that race.
        return badRequest('That email is already registered — try logging in instead.');
      }
    }
    userId = result.meta.last_row_id;
    isNewRow = true;
  }

  const sent = await sendConfirmationLink(context, { id: userId, email, displayName }, { intent });
  if (!sent) {
    // Fail loudly rather than leave someone with an account they can never
    // finish. A row we just created is removed so they can simply try again.
    if (isNewRow) await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    return json({ error: "We couldn't send your confirmation email right now. Please try again in a few minutes." }, { status: 503 });
  }

  return json({ pendingConfirmation: true, email }, { status: 201 });
}
