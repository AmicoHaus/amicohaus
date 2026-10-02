import { destroySession, clearSessionCookieHeader } from '../../_lib/auth.js';
import { json } from '../../_lib/util.js';

export async function onRequestPost(context) {
  await destroySession(context);
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookieHeader() } });
}
