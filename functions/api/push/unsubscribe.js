import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!body.endpoint) return badRequest('endpoint required.');

  await context.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'
  ).bind(body.endpoint, user.id).run();

  return json({ ok: true });
}
