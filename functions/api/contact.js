import { getClientIp } from '../_lib/auth.js';
import { json, badRequest, clampString } from '../_lib/util.js';
import { sendEmail } from '../_lib/email.js';
import { sanitizeAttribution, describeAttribution } from '../_lib/attribution.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AGENT_EMAIL = 'rudypabloflores@gmail.com';

// Public lead-capture form ("talk to Rudy about this") — deliberately kept
// independent of the auth rate-limit table, since that table's `kind` column
// is schema-constrained to login/signup/forgot_password. Caps on both email
// and IP on the leads table itself are enough to deter spam here: email alone
// doesn't stop someone cycling through fake addresses from one source.
export async function onRequestPost(context) {
  const db = context.env.DB;
  const ip = getClientIp(context.request);

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const name = clampString(body.name, 100);
  const email = clampString(body.email, 200).toLowerCase();
  const phone = clampString(body.phone, 30);
  const message = clampString(body.message, 2000);
  const source = sanitizeAttribution(body.source);

  if (!name || !email || !message) return badRequest('Please fill in your name, email, and message.');
  if (!EMAIL_RE.test(email)) return badRequest('Enter a valid email address.');

  const recentByEmail = await db.prepare(
    `SELECT COUNT(*) AS n FROM leads WHERE email = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(email).first();
  const recentByIp = await db.prepare(
    `SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(ip).first();
  if (recentByEmail.n >= 3 || recentByIp.n >= 5) {
    return json({ error: 'Too many submissions. Please try again later.' }, { status: 429 });
  }

  await db.prepare(
    'INSERT INTO leads (name, email, phone, message, ip, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(name, email, phone, message, ip, source).run();

  // The lead is saved either way, so a failed email doesn't lose it, but say so rather than claim it was
  // sent (Rudy reads leads from his inbox).
  const sent = await sendEmail(context, {
    to: AGENT_EMAIL,
    subject: `New Amico Haus inquiry from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '(not provided)'}\nCame from: ${describeAttribution(source)}\n\nMessage:\n${message}`,
  }).catch(() => false);
  if (!sent) {
    return json({ error: "Thanks, your message was saved. If it's urgent, call or text Rudy at (619) 392-6714.", saved: true }, { status: 503 });
  }

  return json({ ok: true });
}
