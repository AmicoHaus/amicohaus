import { locationMatches } from './matching.js';
import { DEMO_EMAIL_PATTERN } from './util.js';
import { notBlockedSql } from './blocks.js';

// Rather than a cron job (which Pages Functions can't run on their own),
// every new listing is checked against everyone's saved searches at the
// moment it's created — arguably more useful than a periodic scan anyway,
// since the notification is immediate. Run in the background
// (context.waitUntil) by the create endpoints, never inside the request.
//
// listings: one new trade listing, or an array of them from one owner (the bulk upload):
//   { id, user_id, city, state, neighborhood, property_type, estimated_value }
// Only real, active owners alert anyone; demo, suspended and blocked people are left out both ways; each person gets
// ONE alert however many of their searches (or of the new listings) match.
export async function notifySavedSearches(db, listings) {
  const list = (Array.isArray(listings) ? listings : [listings]).filter(l => l && l.id && l.user_id);
  const byOwner = new Map();
  for (const l of list) byOwner.set(l.user_id, [...(byOwner.get(l.user_id) || []), l]);

  for (const [ownerId, homes] of byOwner) {
    const owner = await db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active' AND email NOT LIKE ?")
      .bind(ownerId, DEMO_EMAIL_PATTERN).first();
    if (!owner) continue;
    const searches = await db.prepare(
      `SELECT s.user_id, s.locations, s.property_type, s.price_min, s.price_max
       FROM saved_searches s JOIN users ON users.id = s.user_id
       WHERE users.status = 'active' AND users.email NOT LIKE ?1 AND s.user_id != ?2
         AND ${notBlockedSql('s.user_id', '?2')}
       LIMIT 5000`
    ).bind(DEMO_EMAIL_PATTERN, ownerId).all();

    // person -> the new homes that match any of their searches (in upload order)
    const hits = new Map();
    for (const s of searches.results) {
      const locs = (s.locations || '').split(',').map(x => x.trim()).filter(Boolean);
      for (const home of homes) {
        if (!locationMatches(locs, home)) continue;
        if (s.property_type !== 'Any' && s.property_type !== home.property_type) continue;
        if (s.price_max > 0 && home.estimated_value > s.price_max) continue;
        if (s.price_min > 0 && home.estimated_value < s.price_min) continue;
        const mine = hits.get(s.user_id) || new Set();
        mine.add(home);
        hits.set(s.user_id, mine);
      }
    }
    if (!hits.size) continue;

    const stmts = [...hits].map(([uid, matched]) => {
      const ordered = homes.filter(h => matched.has(h));
      const first = ordered[0];
      const where = `${first.neighborhood ? first.neighborhood + ', ' : ''}${first.city}, ${first.state}`;
      const body = ordered.length === 1
        ? `A new listing matches your saved search: ${first.property_type} in ${where}`
        : `${ordered.length} new listings match your saved search, including ${first.property_type} in ${where}`;
      return db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'saved_search', ?, ?)")
        .bind(uid, body, `/listing/${first.id}`);
    });
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  }
}

// The fields notifySavedSearches needs, from a validated listing (validateListingInput's data) and its new id.
// null for a listing that isn't a home for sale or trade (a buyer-only profile or a rental).
export function savedSearchHome(id, userId, d) {
  if (!id || d.isBuyerOnly || d.isRental) return null;
  return {
    id, user_id: userId, city: d.city, state: d.state, neighborhood: d.neighborhood || '',
    property_type: d.propertyType, estimated_value: d.estimatedValue,
  };
}
