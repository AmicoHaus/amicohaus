// Short "something needs you" emails to the site owner -- a new pre-listing, a new agent application -- so a lead
// that arrives from a video or ad doesn't sit unnoticed. Sent in the background (context.waitUntil) and never
// allowed to fail the request that triggered it.
import { sendEmail } from './email.js';
import { describeAttribution } from './attribution.js';

export const ADMIN_ALERT_EMAIL = 'rudypabloflores@gmail.com';

// Demo accounts and the automated test suite's accounts (Resend's @resend.dev test inboxes) never trigger alerts:
// the test suite creates pre-listings and applications on every run, and each email uses up the daily send quota.
export function isTestOrDemoEmail(email) {
  const e = String(email || '').toLowerCase();
  return e.endsWith('@demo.amicohaus.local') || e.endsWith('@resend.dev');
}

// Daily caps, counted from admin_alerts_sent (which deleting a pre-listing doesn't touch), so one account
// posting over and over can't flood Rudy's inbox or use up the daily email quota that signup links share.
const ALERTS_PER_PERSON_PER_DAY = 3;
const ALERTS_PER_DAY = 40;
// Kinds with their own daily budget, so a busy day of them never crowds out the pre-listing and agent alerts.
const OWN_DAILY_CAPS = { past_client_review: 10, signup: 25 };

export function alertAdmin(context, actor, { kind, subject, lines }) {
  if (!actor || isTestOrDemoEmail(actor.email)) return;
  // actor is the full users row, so the ad or video they signed up from rides along with every alert.
  const signedUpAs = actor.signup_intent ? ` (signed up as ${actor.signup_intent === 'agent' ? 'an agent' : 'a homeowner'})` : '';
  // Each line is flattened too: names, titles and brokerages are user-entered, and a line break in one
  // could add a fake line to the email.
  const flat = (line) => String(line ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
  const text = [...lines.map(flat), '', flat(`Came from: ${describeAttribution(actor.signup_source)}${signedUpAs}`), '', 'Open the admin page: https://amicohaus.com/admin-seed'].join('\n');
  // Subjects carry user-entered text (city, names), so line breaks are flattened.
  const safeSubject = String(subject).replace(/[\r\n]+/g, ' ').slice(0, 200);
  const db = context.env.DB;
  const ownCap = Object.hasOwn(OWN_DAILY_CAPS, kind) ? OWN_DAILY_CAPS[kind] : null;
  context.waitUntil((async () => {
    // total: today's alerts of this kind (a kind with its own budget), or of every kind without one.
    const sent = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM admin_alerts_sent WHERE user_id = ?1 AND created_at > datetime('now', '-1 day')) AS mine,
              (SELECT COUNT(*) FROM admin_alerts_sent WHERE created_at > datetime('now', '-1 day')
                 AND (CASE WHEN ?3 THEN kind = ?2 ELSE kind NOT IN (SELECT value FROM json_each(?4)) END)) AS total`
    ).bind(actor.id, kind, ownCap !== null ? 1 : 0, JSON.stringify(Object.keys(OWN_DAILY_CAPS))).first();
    if (sent.mine >= ALERTS_PER_PERSON_PER_DAY || sent.total >= (ownCap ?? ALERTS_PER_DAY)) return;
    await db.prepare('INSERT INTO admin_alerts_sent (user_id, kind) VALUES (?, ?)').bind(actor.id, kind).run();
    await sendEmail(context, { to: ADMIN_ALERT_EMAIL, subject: safeSubject, text });
  })().catch(err => console.log(`[admin alert failed] ${err.message}`)));
}

// A new real account just confirmed its email: a short note with where it came from, so a signup who never posts or
// applies isn't invisible. No name or email in it (Rudy only needs the count and the source); demo and test-suite
// accounts are skipped by alertAdmin, and the signup kind has its own daily budget.
export function alertNewSignup(context, user) {
  const as = user && user.signup_intent === 'agent' ? 'agent' : 'homeowner';
  alertAdmin(context, user, {
    kind: 'signup',
    subject: `New signup (${as})`,
    lines: [`A new ${as} account was confirmed on Amico Haus.`],
  });
}
