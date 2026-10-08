import { getSessionUser } from '../../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

export async function onRequestDelete(context) {
  const { id: listingId, ohId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').bind(listingId).first();
  if (!listing) return notFound('Listing not found.');
  if (listing.user_id !== user.id) return forbidden();

  // Scoped to this listing so its id can't be used to remove someone else's open house.
  await db.prepare('DELETE FROM open_houses WHERE id = ? AND listing_id = ?').bind(ohId, listingId).run();
  return json({ ok: true });
}
