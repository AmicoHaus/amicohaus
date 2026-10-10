import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized, DEMO_EMAIL_PATTERN } from '../_lib/util.js';

// One query box across all 4 marketplaces -- matches title/city/property-type, a handful per vertical.
// Signed-in only: 3 of the 4 verticals already require sign-in to browse at all, so a mixed-results search
// that worked anonymously would just be confusing (results you can click but can't actually open).
const PER_KIND_LIMIT = 5;

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const q = (new URL(context.request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ results: [] });
  const like = `%${q}%`;

  const [listings, augmented, green, projects] = await Promise.all([
    db.prepare(
      `SELECT listings.id, listings.title, listings.property_type, listings.city, listings.state, listings.estimated_value
       FROM listings JOIN users ON users.id = listings.user_id
       WHERE listings.status = 'active' AND listings.is_buyer_only = 0 AND users.email NOT LIKE ?
         AND (listings.title LIKE ? OR listings.city LIKE ? OR listings.property_type LIKE ?)
       ORDER BY listings.created_at DESC LIMIT ?`
    ).bind(DEMO_EMAIL_PATTERN, like, like, like, PER_KIND_LIMIT).all(),
    db.prepare(
      `SELECT augmented_homes.id, augmented_homes.title, augmented_homes.property_type, augmented_homes.city, augmented_homes.state, augmented_homes.asking_price
       FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id
       WHERE augmented_homes.status = 'active' AND users.email NOT LIKE ?
         AND (augmented_homes.title LIKE ? OR augmented_homes.city LIKE ? OR augmented_homes.property_type LIKE ?)
       ORDER BY augmented_homes.created_at DESC LIMIT ?`
    ).bind(DEMO_EMAIL_PATTERN, like, like, like, PER_KIND_LIMIT).all(),
    db.prepare(
      `SELECT green_homes.id, green_homes.title, green_homes.property_type, green_homes.city, green_homes.state, green_homes.asking_price
       FROM green_homes JOIN users ON users.id = green_homes.user_id
       WHERE green_homes.status = 'active' AND users.email NOT LIKE ?
         AND (green_homes.title LIKE ? OR green_homes.city LIKE ? OR green_homes.property_type LIKE ?)
       ORDER BY green_homes.created_at DESC LIMIT ?`
    ).bind(DEMO_EMAIL_PATTERN, like, like, like, PER_KIND_LIMIT).all(),
    db.prepare(
      `SELECT dev_projects.id, dev_projects.title, dev_projects.project_type, dev_projects.city, dev_projects.state, dev_projects.funding_goal
       FROM dev_projects JOIN users ON users.id = dev_projects.user_id
       WHERE dev_projects.status = 'open' AND users.email NOT LIKE ?
         AND (dev_projects.title LIKE ? OR dev_projects.city LIKE ? OR dev_projects.project_type LIKE ?)
       ORDER BY dev_projects.created_at DESC LIMIT ?`
    ).bind(DEMO_EMAIL_PATTERN, like, like, like, PER_KIND_LIMIT).all(),
  ]);

  const results = [
    ...listings.results.map(r => ({ kind: 'listing', id: r.id, title: r.title || r.property_type, city: r.city, state: r.state, amount: r.estimated_value })),
    ...augmented.results.map(r => ({ kind: 'augmented_home', id: r.id, title: r.title || r.property_type, city: r.city, state: r.state, amount: r.asking_price })),
    ...green.results.map(r => ({ kind: 'green_home', id: r.id, title: r.title || r.property_type, city: r.city, state: r.state, amount: r.asking_price })),
    ...projects.results.map(r => ({ kind: 'dev_project', id: r.id, title: r.title, city: r.city, state: r.state, amount: r.funding_goal })),
  ];
  return json({ results });
}
