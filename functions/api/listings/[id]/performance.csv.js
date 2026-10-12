import { getSessionUser } from '../../../_lib/auth.js';
import { unauthorized, forbidden, notFound, toCsv, csvResponse } from '../../../_lib/util.js';
import { fetchListingPerformanceEvents } from '../../../_lib/listingPerformance.js';

// Owner-only (or admin) export of everything that's actually happened on this listing -- offers, price
// changes, favorites, and comments -- as one chronological CSV. Same shape as the Market Pulse export, just
// scoped to a single entity instead of platform-wide.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFound();

  const db = context.env.DB;
  const listing = await db.prepare('SELECT id, user_id, title FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return notFound();
  if (listing.user_id !== user.id && user.role !== 'admin') return forbidden();

  const events = await fetchListingPerformanceEvents(db, 'listing', id);
  const header = ['date', 'type', 'detail'];
  const rows = events.map(e => [e.date, e.type, e.detail]);
  return csvResponse(toCsv(header, rows), `listing-${id}-performance.csv`);
}
