import { getSessionUser } from '../../../../_lib/auth.js';
import { logAdminAction } from '../../../../_lib/audit.js';
import { deleteR2Keys } from '../../../../_lib/r2Cleanup.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { NO_STORE } from '../../../../_lib/thenNow.js';

// Take a photo pair down: the owner (any time, closed homes too, since taking something down is always allowed) or an
// admin (on the admin activity log). Both stored files are removed after the row.
export async function onRequestDelete(context) {
  const { id: preListingId, pairId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const home = await db.prepare('SELECT id, user_id FROM pre_listings WHERE id = ?').bind(preListingId).first();
  if (!home) return notFound('Pre-listing not found.');
  const isOwner = home.user_id === user.id;
  if (!isOwner && user.role !== 'admin') return forbidden();

  // Scoped to this pre-listing so its id can't be used to remove someone else's pair. Keys are read before the delete.
  const pair = await db.prepare('SELECT id, then_r2_key, now_r2_key FROM pre_listing_then_now WHERE id = ? AND pre_listing_id = ?')
    .bind(pairId, home.id).first();
  if (!pair) return notFound('Photo pair not found.');
  await db.prepare('DELETE FROM pre_listing_then_now WHERE id = ? AND pre_listing_id = ?').bind(pair.id, home.id).run();
  await deleteR2Keys(context.env.PHOTOS, [pair.then_r2_key, pair.now_r2_key]);

  if (!isOwner) await logAdminAction(db, user.id, 'delete_then_now', 'pre_listing', home.id);
  return json({ ok: true }, NO_STORE);
}
