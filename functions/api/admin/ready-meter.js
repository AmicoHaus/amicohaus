import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../_lib/util.js';
import { readyTotals } from '../../_lib/readyMeter.js';

// Ready Meter totals for the admin page: each real homeowner's latest weekly check-in from the last 90 days, shown
// only once 20 or more homeowners have checked in. Totals only: no home, person, week, ZIP or city, ever.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  return json(await readyTotals(context.env.DB), { headers: { 'Cache-Control': 'private, no-store' } });
}
