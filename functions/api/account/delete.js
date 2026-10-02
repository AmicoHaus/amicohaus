import { getSessionUser, verifyPassword, clearSessionCookieHeader } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';

// Deletes the account and everything the schema cascades from it (listings,
// posts, comments, messages, notifications, sessions, etc. all reference
// users.id with ON DELETE CASCADE).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const ok = await verifyPassword(String(body.password || ''), user.password_hash);
  if (!ok) return badRequest('Incorrect password.');

  const db = context.env.DB;
  const photos = context.env.PHOTOS;

  // R2 objects aren't referenced by the schema's FK cascades, so they'd
  // otherwise be orphaned once the listing_photos rows disappear with the user.
  if (photos) {
    const rows = await db.prepare(
      `SELECT listing_photos.r2_key FROM listing_photos
       JOIN listings ON listings.id = listing_photos.listing_id
       WHERE listings.user_id = ?`
    ).bind(user.id).all();
    await Promise.all(rows.results.map(row => photos.delete(row.r2_key).catch(() => {})));
  }

  await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookieHeader() } });
}
