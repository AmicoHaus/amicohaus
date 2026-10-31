// The emailed "magic link" that finishes signing up. Clicking it proves the
// person owns the address, and the page it opens is where they choose a
// password — so nobody can create an account on somebody else's email, and an
// account is never usable until its real owner has been through this.
import { generateToken, hashToken } from './auth.js';
import { sendEmail } from './email.js';
import { escapeHtml } from './util.js';

export const CONFIRMATION_LINK_HOURS = 24;

// The 6-digit code that goes with the link (see functions/api/auth/verify-code.js). Stored as an HMAC keyed with a
// server secret (CODE_SECRET, or the email key that's always set in production), so a copy of the database alone
// can't be used to work out pending codes; the account id is mixed in so the same code never stores the same value.
export async function confirmationCodeHash(env, userId, code) {
  const secret = String((env && (env.CODE_SECRET || env.RESEND_API_KEY)) || 'local-dev-only');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}:${code}`));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function newConfirmationCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
}

// Issues a fresh link for a pending account (replacing any earlier one, so
// only the newest email works) and sends it. Resolves to whether the email
// was accepted for delivery.
// `intent` ('homeowner' | 'agent' | '') only decides where the confirm page sends
// them afterwards; it is not stored and grants nothing.
// next: a past-client review link to come back to (validated by the caller), carried in the emailed link.
export async function sendConfirmationLink(context, user, { intent = '', next = '' } = {}) {
  const db = context.env.DB;
  const token = generateToken();
  const expires = new Date(Date.now() + CONFIRMATION_LINK_HOURS * 3600 * 1000).toISOString();
  const code = newConfirmationCode();
  await db.prepare('UPDATE users SET verify_token = ?, verify_token_expires = ?, verify_code_hash = ?, verify_code_attempts = 0 WHERE id = ?')
    .bind(await hashToken(token), expires, await confirmationCodeHash(context.env, user.id, code), user.id).run();
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

  const link = `${new URL(context.request.url).origin}/verify-email?token=${token}${intent ? `&as=${intent}` : ''}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  const name = user.displayName || 'there';

  const text = [
    `Hi ${name},`,
    '',
    'Welcome to Amico Haus! Open this link to confirm your email and finish creating your account:',
    '',
    link,
    '',
    `Signed up inside TikTok, Instagram or Facebook? Type this code on the sign-up page instead: ${spaced}`,
    '',
    `The link works once and expires in ${CONFIRMATION_LINK_HOURS} hours. If you didn't sign up, you can ignore this email — nothing will be created.`,
  ].join('\n');

  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2128">
  <p style="font-size:16px">Hi ${escapeHtml(name)},</p>
  <p style="font-size:16px">Welcome to Amico Haus! Confirm your email to finish creating your account.</p>
  <p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#a9793f;color:#201404;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;display:inline-block">Confirm my email</a></p>
  <p style="font-size:15px">Signed up inside TikTok, Instagram or Facebook? Type this code on the sign-up page instead:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 24px">${spaced}</p>
  <p style="font-size:13px;color:#667085">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
  <p style="font-size:13px;color:#667085">The link works once and expires in ${CONFIRMATION_LINK_HOURS} hours. If you didn't sign up, you can ignore this email — nothing will be created.</p>
</div>`;

  // A network error counts as "not sent" rather than failing the signup request. Only a delivered email starts the
  // 2-minute wait before a repeat signup sends another (see api/auth/signup.js).
  const sent = await sendEmail(context, { to: user.email, subject: 'Confirm your email to finish signing up', text, html }).catch(() => false);
  if (sent) await db.prepare("UPDATE users SET verify_sent_at = datetime('now') WHERE id = ?").bind(user.id).run();
  return sent;
}
