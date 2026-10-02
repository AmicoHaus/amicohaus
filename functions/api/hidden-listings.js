import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized, parseJsonSafe } from '../_lib/util.js';

// Listings the current user thumbed down — hidden from their own directory
// browsing (see functions/api/directory.js). Surfaced back here so a
// misclick is recoverable instead of a dead end.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const rows = await context.env.DB.prepare(
    `SELECT listings.id, listings.title, listings.neighborhood, listings.city, listings.state,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value, listings.price_tier,
            listings.status, listings.external_links, users.display_name AS owner_name,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM listing_feedback
     JOIN listings ON listings.id = listing_feedback.listing_id
     JOIN users ON users.id = listings.user_id
     WHERE listing_feedback.user_id = ? AND listing_feedback.feedback = 'down'
     ORDER BY listing_feedback.created_at DESC`
  ).bind(user.id).all();

  const listings = rows.results.map(r => ({ ...r, external_links: parseJsonSafe(r.external_links, []) }));
  return json({ listings });
}
