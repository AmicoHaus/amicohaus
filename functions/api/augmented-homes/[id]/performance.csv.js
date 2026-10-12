import { getSessionUser } from '../../../_lib/auth.js';
import { unauthorized, forbidden, notFound, toCsv, csvResponse } from '../../../_lib/util.js';
import { fetchListingPerformanceEvents } from '../../../_lib/listingPerformance.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFound();

  const db = context.env.DB;
  const home = await db.prepare('SELECT id, user_id FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound();
  if (home.user_id !== user.id && user.role !== 'admin') return forbidden();

  const events = await fetchListingPerformanceEvents(db, 'augmented_home', id);
  const header = ['date', 'type', 'detail'];
  const rows = events.map(e => [e.date, e.type, e.detail]);
  return csvResponse(toCsv(header, rows), `augmented-home-${id}-performance.csv`);
}
