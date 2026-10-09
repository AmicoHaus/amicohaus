import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../_lib/util.js';
import { buildEdges, findMutualMatches, findChains, findBuyerMatches, findRentalMatches, rowsToProfiles } from '../../_lib/matching.js';

// Admin-only, platform-wide view of matches/chains — unlike /api/matches
// (which only shows the signed-in user's own matches), this is for
// demonstrating the engine's output across every seeded/real listing at
// once. Capped for the same CPU-time-safety reason as /api/matches.
const MAX_LISTINGS = 3000;
// Real volume, not a token handful — matches MAX_RAW_CYCLES as a safety
// ceiling, not a deliberate display-shaping cap.
const MAX_SURFACED = 2000;

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const db = context.env.DB;

  const userCount = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  const listingCount = await db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'active'").first();
  const postCount = await db.prepare('SELECT COUNT(*) AS n FROM posts').first();
  const augmentedHomeCount = await db.prepare("SELECT COUNT(*) AS n FROM augmented_homes WHERE status = 'active'").first();
  const greenHomeCount = await db.prepare("SELECT COUNT(*) AS n FROM green_homes WHERE status = 'active'").first();
  const devProjectCount = await db.prepare("SELECT COUNT(*) AS n FROM dev_projects WHERE status = 'open'").first();

  // LEFT JOIN, not JOIN — a rental listing has no desired_criteria row at all,
  // and an inner join would silently drop every rental out of this view.
  // Bundled member listings are excluded the same way as matches.js — only
  // their portfolio is independently tradeable.
  const rows = await db.prepare(
    `SELECT listings.id AS listing_id, listings.user_id, listings.city, listings.state, listings.neighborhood,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value,
            listings.is_buyer_only, listings.is_rental, listings.rent_amount, listings.is_portfolio,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min, desired_criteria.price_max,
            users.display_name AS owner_name
     FROM listings
     JOIN users ON users.id = listings.user_id
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.status = 'active' AND listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)
     ORDER BY listings.created_at DESC LIMIT ?`
  ).bind(MAX_LISTINGS).all();

  const summaryById = new Map(rows.results.map(r => [r.listing_id, {
    owner: r.owner_name, userId: r.user_id, city: r.city, state: r.state, neighborhood: r.neighborhood,
    propertyType: r.property_type, beds: r.beds, baths: r.baths, estimatedValue: r.estimated_value,
    isBuyerOnly: !!r.is_buyer_only, isRental: !!r.is_rental, rentAmount: r.rent_amount, isPortfolio: !!r.is_portfolio,
  }]));
  const profiles = rowsToProfiles(rows.results);
  const sellerProfiles = profiles.filter(p => !p.isBuyerOnly && !p.isRental);
  const buyerProfiles = profiles.filter(p => p.isBuyerOnly);
  const rentalProfiles = profiles.filter(p => p.isRental);
  const edges = buildEdges(sellerProfiles);
  const matches = findMutualMatches(edges);
  const chains = findChains(edges, sellerProfiles.map(p => p.id));
  const buyerHits = findBuyerMatches(buyerProfiles, sellerProfiles);
  const rentalHits = findRentalMatches(sellerProfiles, rentalProfiles);

  // Every post platform-wide — global feed and every group's feed combined —
  // so admin can see the whole conversation in one place, not just their own
  // view of it.
  const feed = await db.prepare(
    `SELECT posts.id, posts.body, posts.created_at, users.display_name AS author_name,
            groups.label AS group_label,
            (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
     FROM posts
     JOIN users ON users.id = posts.user_id
     LEFT JOIN groups ON groups.id = posts.group_id
     ORDER BY posts.created_at DESC LIMIT 150`
  ).all();

  return json({
    stats: {
      users: userCount.n, activeListings: listingCount.n, posts: postCount.n, considered: rows.results.length,
      matches: Math.min(matches.length, MAX_SURFACED), chains: Math.min(chains.length, MAX_SURFACED),
      buyerMatches: Math.min(buyerHits.length, MAX_SURFACED),
      rentalMatches: Math.min(rentalHits.length, MAX_SURFACED),
      augmentedHomes: augmentedHomeCount.n, greenHomes: greenHomeCount.n, devProjects: devProjectCount.n,
    },
    matches: matches.slice(0, 100).map(m => ({ a: summaryById.get(m.a), b: summaryById.get(m.b), scoreAWantsB: m.scoreAWantsB, scoreBWantsA: m.scoreBWantsA })),
    chains: chains.slice(0, 100).map(c => ({ avg: c.avg, path: c.path.map(id => summaryById.get(id)) })),
    buyerMatches: buyerHits.slice(0, 100).map(h => ({ a: summaryById.get(h.buyerId), b: summaryById.get(h.sellerId), score: h.score })),
    rentalMatches: rentalHits.slice(0, 100).map(h => ({ a: summaryById.get(h.sellerId), b: summaryById.get(h.rentalId), score: h.score, yearsLow: h.yearsLow, yearsHigh: h.yearsHigh })),
    feed: feed.results,
  });
}
