import { getSessionUser, publicUser } from '../_lib/auth.js';
import { json, badRequest, unauthorized, clampString } from '../_lib/util.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  return json({ user: publicUser(user) });
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

  let phone = user.phone;
  if (body.phone !== undefined) {
    phone = clampString(body.phone, 30);
    if (phone && !/^[0-9()+\-.\s]{7,30}$/.test(phone)) return badRequest('That doesn\'t look like a valid phone number.');
  }

  await context.env.DB.prepare('UPDATE users SET bio = ?, notify_matches = ?, email_frequency = ?, phone = ? WHERE id = ?')
    .bind(bio, notifyMatches, emailFrequency, phone, user.id).run();

  return json({ user: publicUser({ ...user, bio, notify_matches: notifyMatches, email_frequency: emailFrequency, phone }) });
}
