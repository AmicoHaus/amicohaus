import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../_lib/util.js';
import { fetchDueOpenHouseReminders, buildOpenHouseReminderEmail } from '../../_lib/openHouseReminders.js';
import { sendEmail } from '../../_lib/email.js';

// Admin-only, manual trigger -- always sends to the admin's OWN address, never a real RSVP'd user, same
// reasoning as send-digest-preview.js. Looks up to 30 days out (not just the live reminder window) purely so
// there's usually something real to preview with; it never marks anything as reminded and never emails an
// actual attendee.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const due = await fetchDueOpenHouseReminders(context.env.DB, 24 * 30);
  if (!due.length) return json({ sent: false, reason: 'No upcoming open houses in the next 30 days to preview.' });

  const email = buildOpenHouseReminderEmail(due[0], user.display_name);
  const sent = await sendEmail(context, { to: user.email, subject: `[PREVIEW] ${email.subject}`, text: email.text, html: email.html });
  return json({ sent });
}
