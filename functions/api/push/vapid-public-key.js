import { json } from '../../_lib/util.js';

// Public by design — this key identifies the server to push services, it's
// not a secret (the matching private key never leaves the Worker).
export async function onRequestGet(context) {
  return json({ publicKey: context.env.VAPID_PUBLIC_KEY || null });
}
