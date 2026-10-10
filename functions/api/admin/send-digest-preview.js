import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../_lib/util.js';
import { buildWeeklyDigest } from '../../_lib/weeklyDigest.js';
import { sendEmail } from '../../_lib/email.js';

// Admin-only, manual trigger -- always sends to the admin's OWN address, never anyone else's, so testing
// the digest template can never accidentally reach a real user. This is NOT the weekly send mechanism;
// there isn't one yet (see weeklyDigest.js's header comment for what's still needed before there is).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const digest = await buildWeeklyDigest(context.env.DB, user);
  if (!digest) return json({ sent: false, reason: "Nothing to report this week — no platform activity and no alert matches." });

  const sent = await sendEmail(context, { to: user.email, subject: `[PREVIEW] ${digest.subject}`, text: digest.text, html: digest.html });
  return json({ sent });
}
