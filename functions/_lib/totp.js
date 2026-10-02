// TOTP (RFC 6238) implemented on Web Crypto's HMAC-SHA1 — no external
// library needed, and compatible with any standard authenticator app
// (Google Authenticator, Authy, 1Password, etc.). SHA-1 here is not a
// security weakness the way it would be for, say, password hashing — it's
// simply the algorithm the TOTP standard and every authenticator app expect.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substr(i, 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) {
    const val = BASE32_ALPHABET.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return new Uint8Array(bytes);
}

function counterToBytes(counter) {
  const bytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  return bytes;
}

async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return new Uint8Array(sig);
}

export function generateTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function generateTotpCode(secretBase32, forTimeMs = Date.now(), timeStepSec = 30) {
  const counter = Math.floor(forTimeMs / 1000 / timeStepSec);
  const hmac = await hmacSha1(base32Decode(secretBase32), counterToBytes(counter));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binary % 1000000).toString().padStart(6, '0');
}

// Allows +/- one 30s step for clock drift between server and phone.
export async function verifyTotpCode(secretBase32, token, window = 1) {
  const clean = String(token || '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Date.now();
  for (let step = -window; step <= window; step++) {
    const code = await generateTotpCode(secretBase32, now + step * 30000);
    if (code === clean) return true;
  }
  return false;
}

export function otpauthUri(secret, email, issuer = 'Amico Haus') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
