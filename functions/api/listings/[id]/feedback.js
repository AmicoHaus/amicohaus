import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../../_lib/util.js';

// 'up' saves the listing to the viewer's Saved tab; 'down' hides it from
// their own directory browsing going forward. One row per (user, listing) —
// PUT again with the other value just flips it.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const listingId = Number(context.params.id);
  if (!Number.isInteger(listingId)) return badRequest('Invalid listing id.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['up', 'down'].includes(body.feedback)) return badRequest('feedback must be "up" or "down".');

  const db = context.env.DB;
  const listing = await db.prepare('SELECT id FROM listings WHERE id = ?').bind(listingId).first();
  if (!listing) return notFound('Listing not found.');

  await db.prepare(
    `INSERT INTO listing_feedback (user_id, listing_id, feedback) VALUES (?, ?, ?)
     ON CONFLICT(user_id, listing_id) DO UPDATE SET feedback = excluded.feedback, created_at = datetime('now')`
  ).bind(user.id, listingId, body.feedback).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const listingId = Number(context.params.id);
  if (!Number.isInteger(listingId)) return badRequest('Invalid listing id.');

  await context.env.DB.prepare(
    'DELETE FROM listing_feedback WHERE user_id = ? AND listing_id = ?'
  ).bind(user.id, listingId).run();

  return json({ ok: true });
}
