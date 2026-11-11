import { getSessionUser, publicUser } from '../_lib/auth.js';
import { json, badRequest, unauthorized, clampString } from '../_lib/util.js';
import { CURRENT_TERMS_VERSION, TERMS_UPDATED_LABEL, termsCurrent } from '../_lib/terms.js';

// Per viewer, so never cached. termsCurrent / currentTermsVersion drive the one-time "We updated our Terms" notice in
// /app (accepted through /api/account/accept-terms).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!user) return json({ user: null }, { headers });
  return json({
    user: {
      ...publicUser(user),
      termsVersion: user.terms_version || null,
      termsCurrent: termsCurrent(user),
      currentTermsVersion: CURRENT_TERMS_VERSION,
      termsUpdatedLabel: TERMS_UPDATED_LABEL,
      // Display language (users.ui_lang): private to the person, used only for display.
      uiLang: user.ui_lang || 'en',
    },
  }, { headers });
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const bio = body.bio !== undefined ? clampString(body.bio, 500) : user.bio;
  const notifyMatches = body.notifyMatches !== undefined ? (body.notifyMatches ? 1 : 0) : user.notify_matches;
  const emailFrequency = body.emailFrequency !== undefined
    ? (['every', 'capped'].includes(body.emailFrequency) ? body.emailFrequency : user.email_frequency)
    : user.email_frequency;

  // 'en' or 'es'; anything else keeps what's stored.
  const uiLang = ['en', 'es'].includes(body.uiLang) ? body.uiLang : (user.ui_lang || 'en');

  let phone = user.phone;
  if (body.phone !== undefined) {
    phone = clampString(body.phone, 30);
    if (phone && !/^[0-9()+\-.\s]{7,30}$/.test(phone)) return badRequest('That doesn\'t look like a valid phone number.');
  }

  // Removing the phone number also turns off "Show my phone number", so a number added later starts private again.
  await context.env.DB.prepare("UPDATE users SET bio = ?, notify_matches = ?, email_frequency = ?, phone = ?, phone_public = CASE WHEN TRIM(COALESCE(?, '')) = '' THEN 0 ELSE phone_public END, ui_lang = ? WHERE id = ?")
    .bind(bio, notifyMatches, emailFrequency, phone, phone, uiLang, user.id).run();

  return json({ user: { ...publicUser({ ...user, bio, notify_matches: notifyMatches, email_frequency: emailFrequency, phone }), uiLang } });
}
