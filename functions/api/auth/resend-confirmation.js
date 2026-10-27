import { getClientIp, isRateLimited, recordAttempt, releaseAttemptAddress } from '../../_lib/auth.js';
import { json, badRequest, clampString } from '../../_lib/util.js';
import { sendConfirmationLink } from '../../_lib/emailConfirmation.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// login_attempts only accepts a fixed set of kinds (a CHECK constraint), and
// "email me a link" is the same abuse risk as forgot-password, so this shares
// that bucket: 5 per network per hour.
const KIND = 'forgot_password';

// "Send me a new link" for a signup that was started but never finished.
// The answer is the same whether or not the address is waiting on a link, so
// this can't be used to find out who has an account.
export async function onRequestPost(context) {
  const db = context.env.DB;
  const ip = getClientIp(context.request);

  if (await isRateLimited(db, KIND, ip)) {
    return json({ error: 'Too many requests. Try again in a little while.' }, { status: 429 });
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const email = clampString(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return badRequest('Enter a valid email address.');

  // At most one email per address every couple of minutes, no matter how many
  // networks ask, so this can't be used to flood somebody's inbox.
  const recent = await db.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts WHERE kind = ? AND email = ? AND created_at > datetime('now', '-2 minutes')`
  ).bind(KIND, email).first();
  await recordAttempt(db, KIND, ip, email);

  const answer = json({ ok: true, message: 'If that address is waiting for confirmation, a new link is on its way.' });
  if (recent.n > 0) return answer;

  const user = await db.prepare('SELECT id, email, display_name, email_confirmation_pending FROM users WHERE email = ?').bind(email).first();
  if (!user || !user.email_confirmation_pending) return answer;

  // Keeps an agent on the agent path: the confirm page uses this to decide where to send them next.
  const intent = ['homeowner', 'agent'].includes(body.intent) ? body.intent : '';
  const sent = await sendConfirmationLink(context, { id: user.id, email: user.email, displayName: user.display_name }, { intent });
  if (!sent) {
    // A send that never went out shouldn't block the retry for two minutes (it still counts toward
    // the 5-per-hour network limit).
    await releaseAttemptAddress(db, KIND, ip, email);
    return json({ error: "The email didn't go out just now. Give it a minute and try again." }, { status: 503 });
  }
  return answer;
}
