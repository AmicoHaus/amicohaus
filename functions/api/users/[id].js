import { json, notFound, parseJsonSafe, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { fetchPortfolioMembers } from '../../_lib/portfolios.js';

// Public profile view — deliberately no auth required (like /api/directory),
// since this is the "click a name, see their profile" social-media pattern.
// Never exposes street address, matching the same privacy rule as the
// directory and listing detail endpoints.
export async function onRequestGet(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFound('User not found.');

  const db = context.env.DB;
  // Seeded demo accounts (no password, can never reply) are excluded even
  // from direct-by-id lookup — real users can no longer discover one through
  // the directory or matches, but this closes the loop for a stale link.
  const user = await db.prepare(
    `SELECT id, display_name, bio, phone, is_verified, created_at FROM users WHERE id = ? AND email NOT LIKE ?`
  ).bind(id, DEMO_EMAIL_PATTERN).first();
  if (!user) return notFound('User not found.');

  // A bundled member listing is only tradeable through its portfolio now —
  // excluded here the same way as the public directory, so it doesn't show
  // up twice (standalone, and again inside its portfolio's breakdown).
  const listings = await db.prepare(
    `SELECT listings.id, listings.title, listings.neighborhood, listings.city, listings.state,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value, listings.price_tier,
            listings.external_links, listings.is_rental, listings.rent_amount, listings.min_lease_months, listings.is_portfolio,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.price_min, desired_criteria.price_max,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM listings
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.user_id = ? AND listings.status = 'active' AND listings.is_buyer_only = 0
       AND listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)
     ORDER BY listings.created_at DESC LIMIT 20`
  ).bind(id).all();

  const portfolioIds = listings.results.filter(l => l.is_portfolio).map(l => l.id);
  const membersByPortfolio = await fetchPortfolioMembers(db, portfolioIds);

  const posts = await db.prepare(
    `SELECT posts.id, posts.body, posts.created_at,
            (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
     FROM posts WHERE posts.user_id = ? ORDER BY posts.created_at DESC LIMIT 15`
  ).bind(id).all();

  return json({
    user: {
      id: user.id, displayName: user.display_name, bio: user.bio || '', createdAt: user.created_at,
      phone: user.phone || '', isVerified: !!user.is_verified,
    },
    listings: listings.results.map(l => ({
      ...l, external_links: parseJsonSafe(l.external_links, []),
      portfolio_members: l.is_portfolio ? (membersByPortfolio.get(l.id) || []) : undefined,
    })),
    posts: posts.results,
  });
}
