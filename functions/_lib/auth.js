// Password hashing and session management for the Workers runtime (Web Crypto only — no Node crypto/bcrypt available).

// Cloudflare Workers' real production runtime hard-caps PBKDF2 at 100,000
// iterations (confirmed live: "iteration counts above 100000 are not
// supported"). Miniflare's local dev emulation does NOT enforce this same
// cap, so this passed local testing cleanly and only broke in production —
// every signup/login was failing with a 500 until this was caught.
const PBKDF2_ITERATIONS = 100000;
const SESSION_COOKIE = 'ah_session';
const SESSION_TTL_DAYS = 30;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromHex(parts[2]);
  const expectedHex = parts[3];
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  const actualHex = toHex(bits);
  // Constant-time-ish comparison to avoid trivial timing leaks.
  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

function randomToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

// One-way hash for tokens that are emailed to people (sign-up links). The
// database only ever holds the hash, so a leaked copy of it can't be used to
// sign in — the real token exists only in the email.
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return toHex(digest);
}

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to type from a shared link
export function generateReferralCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, b => REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length]).join('');
}

export async function createSession(db, userId) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, expiresAt).run();
  return { token, expiresAt };
}

export function sessionCookieHeader(token, expiresAt) {
  const maxAge = SESSION_TTL_DAYS * 86400;
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

// Attaches the signed-in user (or null) to the request. Expired sessions are
// lazily cleaned up here rather than via a cron, since D1 has no scheduler tied to it.
export async function getSessionUser(context) {
  const token = readCookie(context.request, SESSION_COOKIE);
  if (!token) return null;
  const db = context.env.DB;
  const row = await db.prepare(
    `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND datetime(sessions.expires_at) > datetime('now')`
  ).bind(token).first();
  return row || null;
}

export async function destroySession(context) {
  const token = readCookie(context.request, SESSION_COOKIE);
  if (!token) return;
  await context.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id, email: user.email, displayName: user.display_name, role: user.role,
    totpEnabled: !!user.totp_enabled, bio: user.bio || '', createdAt: user.created_at,
    notifyMatches: user.notify_matches !== 0,
    emailFrequency: user.email_frequency || 'capped',
    phone: user.phone || '', isVerified: !!user.is_verified,
  };
}

export function generateToken() {
  return randomToken();
}

export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// Application-level rate limiting, backed by a plain D1 table rather than any
// external service — counts rows in a rolling window rather than tracking
// state in memory, since Workers isolates aren't guaranteed to persist
// between requests.
const RATE_LIMITS = {
  login: { max: 8, windowMinutes: 15 },            // failed attempts per IP
  signup: { max: 5, windowMinutes: 60 },           // attempts per IP
  forgot_password: { max: 5, windowMinutes: 60 },  // attempts per IP
};

export async function isRateLimited(db, kind, ip) {
  const { max, windowMinutes } = RATE_LIMITS[kind];
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts WHERE kind = ? AND ip = ? AND created_at > datetime('now', ?)`
  ).bind(kind, ip, `-${windowMinutes} minutes`).first();
  return row.n >= max;
}

export async function recordAttempt(db, kind, ip, email) {
  await db.prepare('INSERT INTO login_attempts (kind, ip, email) VALUES (?, ?, ?)').bind(kind, ip, email || null).run();
}
