import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';

// Admin-only: daily signup and new-listing counts for the last 30 days, for the admin overview's growth
// chart. "New listing" is combined across all 4 marketplaces (a homeowner listing, an AugmentedHomes or
// GreenHomes home, or a FinderMine project) -- one line, not four, since the question is "is the platform
// growing", not a per-vertical breakdown (that's what Market Pulse is for). Demo accounts excluded, same as
// every other admin/public count on the site.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const db = context.env.DB;
  const [signupRows, listingRows] = await Promise.all([
    db.prepare(
      `SELECT DATE(created_at) AS day, COUNT(*) AS n FROM users
       WHERE email NOT LIKE ? AND created_at > datetime('now', '-30 days')
       GROUP BY day ORDER BY day`
    ).bind(DEMO_EMAIL_PATTERN).all(),
    db.prepare(
      `SELECT DATE(combined.created_at) AS day, COUNT(*) AS n FROM (
         SELECT created_at, user_id FROM listings
         UNION ALL SELECT created_at, user_id FROM augmented_homes
         UNION ALL SELECT created_at, user_id FROM green_homes
         UNION ALL SELECT created_at, user_id FROM dev_projects
       ) combined JOIN users ON users.id = combined.user_id
       WHERE users.email NOT LIKE ? AND combined.created_at > datetime('now', '-30 days')
       GROUP BY day ORDER BY day`
    ).bind(DEMO_EMAIL_PATTERN).all(),
  ]);

  // Fill in every day of the window, even ones with zero activity, so the chart's x-axis is continuous
  // rather than skipping straight over a quiet day.
  const signupsByDay = new Map(signupRows.results.map(r => [r.day, r.n]));
  const listingsByDay = new Map(listingRows.results.map(r => [r.day, r.n]));
  const days = [];
  const signups = [];
  const listings = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push(d);
    signups.push(signupsByDay.get(d) || 0);
    listings.push(listingsByDay.get(d) || 0);
  }

  return json({ days, signups, listings });
}
