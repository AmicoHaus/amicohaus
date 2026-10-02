// The emailed "magic link" that finishes signing up. Clicking it proves the
// person owns the address, and the page it opens is where they choose a
// password — so nobody can create an account on somebody else's email, and an
// account is never usable until its real owner has been through this.
import { generateToken, hashToken } from './auth.js';
import { sendEmail } from './email.js';
import { escapeHtml } from './util.js';

export const CONFIRMATION_LINK_HOURS = 24;

// Issues a fresh link for a pending account (replacing any earlier one, so
// only the newest email works) and sends it. Resolves to whether the email
// was accepted for delivery.
// `intent` ('homeowner' | 'agent' | '') only decides where the confirm page sends
// them afterwards; it is not stored and grants nothing.
export async function sendConfirmationLink(context, user, { intent = '' } = {}) {
  const db = context.env.DB;
  const token = generateToken();
  const expires = new Date(Date.now() + CONFIRMATION_LINK_HOURS * 3600 * 1000).toISOString();
  await db.prepare('UPDATE users SET verify_token = ?, verify_token_expires = ? WHERE id = ?')
    .bind(await hashToken(token), expires, user.id).run();

  const link = `${new URL(context.request.url).origin}/verify-email?token=${token}${intent ? `&as=${intent}` : ''}`;
  const name = user.displayName || 'there';

  const text = [
    `Hi ${name},`,
    '',
    'Welcome to Amico Haus! Open this link to confirm your email and finish creating your account:',
    '',
    link,
    '',
    `The link works once and expires in ${CONFIRMATION_LINK_HOURS} hours. If you didn't sign up, you can ignore this email — nothing will be created.`,
  ].join('\n');

  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2128">
  <p style="font-size:16px">Hi ${escapeHtml(name)},</p>
  <p style="font-size:16px">Welcome to Amico Haus! Confirm your email to finish creating your account.</p>
  <p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#a9793f;color:#201404;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;display:inline-block">Confirm my email</a></p>
  <p style="font-size:13px;color:#667085">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
  <p style="font-size:13px;color:#667085">The link works once and expires in ${CONFIRMATION_LINK_HOURS} hours. If you didn't sign up, you can ignore this email — nothing will be created.</p>
</div>`;

  return sendEmail(context, { to: user.email, subject: 'Confirm your email to finish signing up', text, html });
}
