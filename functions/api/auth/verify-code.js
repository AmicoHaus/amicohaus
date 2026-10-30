import { getClientIp, generateToken, hashToken } from '../../_lib/auth.js';
import { json, badRequest, clampString } from '../../_lib/util.js';
import { confirmationCodeHash } from '../../_lib/emailConfirmation.js';

// Finishing a signup by typing the 6-digit code from the email, for people who signed up inside an app's built-in
// browser (TikTok, Instagram, Facebook), where opening the emailed link would land them in a different browser.
// A correct code swaps in a fresh one-time link token and hands it back, and the page then goes to the usual
// /verify-email screen (choose a password) in the same window. The code proves the same thing the link does:
// whoever has it can read that inbox.
//
// Guessing is capped three ways, each counted BEFORE the code is compared so a burst of parallel requests can't
// all slip through on a stale count:
//   - each try is recorded first, then this network's recent tries are counted (8 per 15 minutes);
//   - each try spends one of the code's 5 attempts in a single atomic UPDATE, and only a spent attempt is compared;
//   - an address gets at most 10 code tries a day across every code it is sent (new emails don't reset that), after
//     which only the emailed link works.
// The answer is the same whether the address doesn't exist, isn't pending, or the code is wrong.
const MAX_ATTEMPTS = 5;
const MAX_PER_NETWORK = 8;
const MAX_PER_ADDRESS_PER_DAY = 10;
const MISS = "That code didn't match or has expired. Check the latest email from Amico Haus, or send yourself a new one.";

export async function onRequestPost(context) {
  const db = context.env.DB;
  const ip = getClientIp(context.request);

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const email = clampString(body.email, 200).toLowerCase();
  const code = String(body.code || '').replace(/\D/g, '');
  if (code.length !== 6) return badRequest('Type the 6-digit code from the email.');

  // Record first, count after: every request in a burst sees every other one.
  await db.prepare("INSERT INTO login_attempts (kind, ip, email) VALUES ('login', ?, ?)").bind(ip, email).run();
  const byNetwork = await db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'login' AND ip = ? AND created_at > datetime('now', '-15 minutes')").bind(ip).first();
  if (byNetwork.n > MAX_PER_NETWORK) return json({ error: 'Too many tries. Wait a few minutes, or open the link in the email.' }, { status: 429 });
  const byAddress = await db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'login' AND email = ? AND created_at > datetime('now', '-1 day')").bind(email).first();
  if (byAddress.n > MAX_PER_ADDRESS_PER_DAY) return badRequest('Too many tries on this address today. Open the link in the email instead.');

  // Spend one attempt atomically; no row back means no usable code (wrong address, not pending, or used up).
  const user = await db.prepare(
    `UPDATE users SET verify_code_attempts = verify_code_attempts + 1
     WHERE email = ? AND email_confirmation_pending = 1 AND verify_code_hash IS NOT NULL AND verify_code_attempts < ?
     RETURNING id, verify_code_hash, verify_token_expires, signup_intent`
  ).bind(email, MAX_ATTEMPTS).first();
  if (!user || !user.verify_token_expires || Date.parse(user.verify_token_expires) <= Date.now()) return badRequest(MISS);
  if (await confirmationCodeHash(context.env, user.id, code) !== user.verify_code_hash) return badRequest(MISS);

  // Claim the code atomically (a second request with the same code gets nothing), and issue a fresh link token.
  const token = generateToken();
  const claimed = await db.prepare(
    `UPDATE users SET verify_token = ?, verify_code_hash = NULL, verify_code_attempts = 0, verify_sent_at = NULL
     WHERE id = ? AND verify_code_hash = ? AND verify_code_attempts <= ? AND email_confirmation_pending = 1`
  ).bind(await hashToken(token), user.id, user.verify_code_hash, MAX_ATTEMPTS).run();
  if (!claimed.meta.changes) return badRequest(MISS);
  return json({ token, as: ['homeowner', 'agent'].includes(user.signup_intent) ? user.signup_intent : '' });
}
