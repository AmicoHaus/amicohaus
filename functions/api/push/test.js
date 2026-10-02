import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { sendPushToUser } from '../../_lib/webpush.js';

// Lets a signed-in user (or an admin checking the setup) fire a real push at
// their own subscribed devices and see the push service's actual response —
// otherwise a bad VAPID key fails silently with nothing but a Worker log line.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const result = await sendPushToUser(context, user.id);
  return json(result);
}
