// Thin email-sending abstraction. No provider is wired in yet — pick one
// (Resend, Postmark, SendGrid, etc.), set its API key as a Pages environment
// variable, and fill in the fetch() call below. Until then this logs and
// returns false instead of throwing, so signup/verification/password-reset
// flows keep working functionally (the token is generated and stored) — the
// user just won't actually receive the email yet.
//
// Shown below wired for Resend (https://resend.com) as a concrete example,
// since it needs only one API call and a verified sending domain — swap the
// fetch() target/body shape if a different provider is chosen instead.
//
// Two switches for the environment:
//   RESEND_API_KEY  - real sending (production).
//   EMAIL_DEV_LOG=1 - print the email to the console instead of sending it and
//                     report success, so sign-up links can be followed while
//                     developing locally. Never set this in production.
export async function sendEmail(context, { to, subject, text, html }) {
  if (context.env.EMAIL_DEV_LOG === '1') {
    console.log(`[email dev log] to ${to}: ${subject}
${text}`);
    return true;
  }

  const apiKey = context.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email not configured] Would send to ${to}: ${subject}
${text}`);
    return false;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: context.env.EMAIL_FROM || 'Amico Haus <noreply@amicohaus.com>',
      to, subject, text, ...(html ? { html } : {}),
    }),
  });
  if (!res.ok) console.log(`[email send failed] to ${to}: ${res.status} ${await res.text()}`);
  return res.ok;
}
