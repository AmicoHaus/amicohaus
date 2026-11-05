import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { releaseFoundingSpots, grantFoundingSpots } from '../../../_lib/zipBoard.js';

// Admin actions on one account.
// - verify / unverify: the internal is_verified flag. It's no longer shown anywhere publicly (no "Verified" badge:
//   the site doesn't vouch for anyone), but the flag and this toggle stay for the admin's own notes.
// - suspend / unsuspend: a suspended account is signed out everywhere, can't log in, and drops out of every list. A
//   suspended agent gives up their founding spots, so when reinstated they go to the back of the line (they get a
//   spot again only if one is open). An admin can't suspend themselves or another admin.
export async function onRequestPost(context) {
  const id = Number(context.params.id);
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['verify', 'unverify', 'suspend', 'unsuspend'].includes(body.action)) return badRequest('Invalid action.');

  const db = context.env.DB;
  const target = Number.isInteger(id) ? await db.prepare('SELECT id, role, status FROM users WHERE id = ?').bind(id).first() : null;
  if (!target) return notFound('User not found.');

  if (body.action === 'verify' || body.action === 'unverify') {
    const isVerified = body.action === 'verify' ? 1 : 0;
    await db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').bind(isVerified, id).run();
    await logAdminAction(db, user.id, `user_${body.action}`, 'user', id);
    return json({ ok: true });
  }

  if (body.action === 'suspend') {
    if (target.id === user.id || target.role === 'admin') return badRequest("An admin account can't be suspended here.");
    await db.batch([
      db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    ]);
    await releaseFoundingSpots(db, id, { all: true });
    await logAdminAction(db, user.id, 'user_suspend', 'user', id);
    return json({ ok: true, status: 'suspended' });
  }

  // unsuspend
  await db.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(id).run();
  const foundingZips = await grantFoundingSpots(db, id);
  await logAdminAction(db, user.id, 'user_unsuspend', 'user', id, foundingZips.length ? { foundingZips } : undefined);
  return json({ ok: true, status: 'active', foundingZips });
}
