import { locationMatches } from './matching.js';

// Rather than a cron job (which Pages Functions can't run on their own),
// every new listing is checked against everyone's saved searches at the
// moment it's created — arguably more useful than a periodic scan anyway,
// since the notification is immediate.
export async function notifySavedSearches(db, listing) {
  const searches = await db.prepare(
    'SELECT saved_searches.*, users.display_name FROM saved_searches JOIN users ON users.id = saved_searches.user_id'
  ).all();

  for (const search of searches.results) {
    if (search.user_id === listing.user_id) continue;
    const locations = (search.locations || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!locationMatches(locations, listing)) continue;
    if (search.property_type !== 'Any' && search.property_type !== listing.property_type) continue;
    if (search.price_max > 0 && listing.estimated_value > search.price_max) continue;
    if (search.price_min > 0 && listing.estimated_value < search.price_min) continue;

    await db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'saved_search', ?, '/')"
    ).bind(search.user_id, `A new listing matches your saved search: ${listing.property_type} in ${listing.city}, ${listing.state}`).run();
  }
}
