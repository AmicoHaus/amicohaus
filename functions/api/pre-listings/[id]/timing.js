import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { validateOwnerTiming, pacificToday } from '../../../_lib/timingMatch.js';
import { buyerDemandDetailForDisplay } from '../../../_lib/buyerDemand.js';
import { priceIsOpen } from '../../../_lib/preListings.js';
import { claimUserAction, rateLimited } from '../../../_lib/rateLimits.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Timing Match: the owner's ideal closing window and how long they'd like to stay after closing. Owner only (no
// admins), while the home is open or awarded. Only the three timing fields are read: no money is ever taken or
// stored for a stay, and the agents write any rent-back terms. Changes are limited (timing_edit), since each one
// changes what the owner's "buyers whose timing fits" count shows.
export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const row = await db.prepare(
    `SELECT id, user_id, status, city, state, neighborhood, property_type, asking_price, beds, baths,
            close_from, close_to, stay_after_days
     FROM pre_listings WHERE id = ?`
  ).bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden();
  if (row.status === 'closed') {
    return json({ error: "This pre-listing is closed, so its timing can't change.", code: 'not_open' }, { status: 400 });
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const checked = validateOwnerTiming(body, row);
  if (checked.error) return badRequest(checked.error);
  const t = checked.data;

  const unchanged = t.closeFrom === (row.close_from || null) && t.closeTo === (row.close_to || null)
    && t.stayAfterDays === (Number(row.stay_after_days) || 0);
  if (!unchanged) {
    if (!(await claimUserAction(db, 'timing_edit', user.id))) return rateLimited();
    await db.prepare('UPDATE pre_listings SET close_from = ?, close_to = ?, stay_after_days = ? WHERE id = ?')
      .bind(t.closeFrom, t.closeTo, t.stayAfterDays, row.id).run();
  }

  // The same home the detail GET builds, so the count here matches the one on the page (null under 3).
  const { timingDemand } = await buyerDemandDetailForDisplay(db, {
    userId: row.user_id, city: row.city, state: row.state, neighborhood: row.neighborhood,
    propertyType: row.property_type, price: row.asking_price, priceOpen: priceIsOpen(row.asking_price), beds: row.beds, baths: row.baths,
    closeFrom: t.closeFrom, closeTo: t.closeTo, stayAfterDays: t.stayAfterDays,
  });
  const timing = { ...t, windowPassed: !!t.closeTo && t.closeTo < pacificToday() };
  return json({ timing, timingDemand }, NO_STORE);
}
