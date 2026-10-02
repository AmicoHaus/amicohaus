import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized } from '../_lib/util.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').bind(user.id).first();

  return json({ referralCode: user.referral_code, referredCount: count.n });
}
