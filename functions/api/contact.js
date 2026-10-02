import { getClientIp } from '../_lib/auth.js';
import { json, badRequest, clampString } from '../_lib/util.js';
import { sendEmail } from '../_lib/email.js';

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
    'INSERT INTO leads (name, email, phone, message, ip) VALUES (?, ?, ?, ?, ?)'
  ).bind(name, email, phone, message, ip).run();

  await sendEmail(context, {
    to: AGENT_EMAIL,
    subject: `New Amico Haus inquiry from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '(not provided)'}\n\nMessage:\n${message}`,
  });

  return json({ ok: true });
}
