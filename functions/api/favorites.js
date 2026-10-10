import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized, parseJsonSafe } from '../_lib/util.js';
import { fetchRecentActivityBatch } from '../_lib/marketEvents.js';
import { fetchListingFavoriteCountBatch } from '../_lib/priceSeries.js';
import { fetchCommentCountBatch } from '../_lib/dealThreads.js';

// Listings the current user thumbed up — feeds the app's "Saved" tab.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const rows = await db.prepare(
    `SELECT listings.id, listings.title, listings.neighborhood, listings.city, listings.state,
            listings.property_type, listings.beds, listings.baths, listings.sqft, listings.estimated_value, listings.price_tier,
            listings.status, listings.external_links, listings.created_at, users.display_name AS owner_name,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM listing_feedback
     JOIN listings ON listings.id = listing_feedback.listing_id
     JOIN users ON users.id = listings.user_id
     WHERE listing_feedback.user_id = ? AND listing_feedback.feedback = 'up'
     ORDER BY listing_feedback.created_at DESC`
  ).bind(user.id).all();

  const ids = rows.results.map(r => r.id);
  const [recentActivityById, favoriteCountById, commentCountById] = await Promise.all([
    fetchRecentActivityBatch(db, 'listing', ids),
    fetchListingFavoriteCountBatch(db, ids),
    fetchCommentCountBatch(db, 'listing', ids),
  ]);

  const listings = rows.results.map(r => ({
    ...r, external_links: parseJsonSafe(r.external_links, []),
    recent_activity: recentActivityById.get(r.id) || null,
    favorite_count: favoriteCountById.get(r.id) || 0,
    comment_count: commentCountById.get(r.id) || 0,
  }));
  return json({ listings });
}
