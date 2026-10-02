// Web Push (RFC 8030 + VAPID/RFC 8292) using only the Workers-native
// WebCrypto API — no npm dependency, since this project has no bundling step
// for Functions (each file is deployed as-is).
//
// Deliberately sends every push with an EMPTY body instead of implementing
// RFC 8291 payload encryption (ECDH + HKDF + aes128gcm) — that's a much
// larger, easy-to-get-subtly-wrong piece of crypto, and an empty push still
// triggers a real OS notification via the service worker's 'push' handler.
// The tradeoff: the notification text can't carry per-event details (who
// matched, what the message said) since there's no payload to read — it's
// always the generic text baked into service-worker.js. Good enough to let
// a user know to open the app; not a substitute for the in-app/email detail.

function base64UrlEncode(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cachedPrivateKey = null;
let cachedPrivateKeyJwk = null;

async function getVapidPrivateKey(jwkString) {
  if (cachedPrivateKey && cachedPrivateKeyJwk === jwkString) return cachedPrivateKey;
  const jwk = JSON.parse(jwkString);
  cachedPrivateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  cachedPrivateKeyJwk = jwkString;
  return cachedPrivateKey;
}

async function buildVapidJWT(privateKey, audience, subject) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const encoder = new TextEncoder();
  const unsigned = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(unsigned));
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// Fire-and-forget push to every device a user has subscribed on. Expired/
// revoked subscriptions (404/410 from the push service) are cleaned up as
// they're discovered rather than needing a separate sweep job. Returns a
// per-subscription result summary — existing callers (matchNotify.js,
// messages.js) ignore it, but functions/api/push/test.js surfaces it so a
// user (or admin) can actually see whether their VAPID setup is working
// instead of it failing silently into a log nobody's watching.
export async function sendPushToUser(context, userId) {
  const db = context.env.DB;
  const privateJwk = context.env.VAPID_PRIVATE_KEY_JWK;
  const publicKey = context.env.VAPID_PUBLIC_KEY;
  const subject = context.env.VAPID_SUBJECT;
  if (!privateJwk || !publicKey || !subject) return { configured: false, results: [] };

  const subs = await db.prepare('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?').bind(userId).all();
  if (subs.results.length === 0) return { configured: true, results: [] };

  const privateKey = await getVapidPrivateKey(privateJwk);
  const results = [];

  for (const sub of subs.results) {
    try {
      const audience = new URL(sub.endpoint).origin;
      const jwt = await buildVapidJWT(privateKey, audience, subject);
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { Authorization: `vapid t=${jwt}, k=${publicKey}`, TTL: '60', 'Content-Length': '0' },
      });
      if (res.status === 404 || res.status === 410) {
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        results.push({ subscriptionId: sub.id, ok: false, status: res.status, note: 'expired, removed' });
      } else {
        results.push({ ok: res.ok, status: res.status, subscriptionId: sub.id, body: res.ok ? undefined : await res.text() });
      }
    } catch (e) {
      results.push({ subscriptionId: sub.id, ok: false, error: e.message });
    }
  }
  return { configured: true, results };
}
