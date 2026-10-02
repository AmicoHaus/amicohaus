import { json } from '../_lib/util.js';
import { buildEdges, findMutualMatches, findChains, rowsToProfiles } from '../_lib/matching.js';

// Public, no-login-required showcase of the seeded demo data specifically —
// deliberately scoped to @demo.amicohaus.local accounts only (via SQL WHERE,
// not just client-side filtering) so that once real users sign up, this
// public page never exposes their listings, matches, or activity. Real
// platform-wide data (including real users) stays behind /api/admin/overview,
// which requires the admin role.
const DEMO_EMAIL_PATTERN = '%@demo.amicohaus.local';
const MAX_LISTINGS = 3000;
// Show real volume, not a token handful — per explicit request the
// connection counts shouldn't be capped down to something small.
const MAX_MATCHES_SURFACED = 4000;
// Chains are separately bounded by MAX_RAW_CYCLES in matching.js (a real
// CPU-safety ceiling on the algorithm itself, currently 2,000) — raising this
// cap alone wouldn't change anything without also raising that one, and it
// wasn't asked for, so it stays as-is.
const MAX_CHAINS_SURFACED = 2000;
const MAX_LISTINGS_PER_TYPE = 4;
// Cosmetic only, demo page presentation — the "posts" stat below is a fixed
// stand-in number per explicit request ("put the posts to some random number
// in the 12000s just to make that look more realistic"), not the true seeded
// post count. The real count is still accurate wherever it matters
// (/api/admin/overview, which the admin actually uses to gauge real state).
const DISPLAY_POST_COUNT = 12847;

export async function onRequestGet(context) {
  const db = context.env.DB;

  const userCount = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?').bind(DEMO_EMAIL_PATTERN).first();
  const listingCount = await db.prepare(
    `SELECT COUNT(*) AS n FROM listings JOIN users ON users.id = listings.user_id
     WHERE listings.status = 'active' AND users.email LIKE ?`
  ).bind(DEMO_EMAIL_PATTERN).first();
  const rows = await db.prepare(
    `SELECT listings.id AS listing_id, listings.user_id, listings.city, listings.state, listings.neighborhood,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min, desired_criteria.price_max,
            users.display_name AS owner_name
     FROM listings
     JOIN users ON users.id = listings.user_id
     JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.status = 'active' AND users.email LIKE ?
     ORDER BY listings.created_at DESC LIMIT ?`
  ).bind(DEMO_EMAIL_PATTERN, MAX_LISTINGS).all();

  const summaryById = new Map(rows.results.map(r => [r.listing_id, {
    owner: r.owner_name, userId: r.user_id, city: r.city, state: r.state, neighborhood: r.neighborhood,
    propertyType: r.property_type, beds: r.beds, baths: r.baths, estimatedValue: r.estimated_value,
  }]));
  const profiles = rowsToProfiles(rows.results);
  const edges = buildEdges(profiles);
  const matches = findMutualMatches(edges);
  const chains = findChains(edges, profiles.map(p => p.id));

  // A varied sample of listings for the "Sample Listings" section: a few of
  // each property type, interleaved, rather than the newest N (which could be
  // seven copies of the same kind). Each carries how many mutual matches it's
  // part of. No street address is ever selected here, only city/neighborhood.
  const matchCountByListing = new Map();
  for (const m of matches) {
    matchCountByListing.set(m.a, (matchCountByListing.get(m.a) || 0) + 1);
    matchCountByListing.set(m.b, (matchCountByListing.get(m.b) || 0) + 1);
  }
  const byType = new Map();
  for (const p of profiles) {
    const arr = byType.get(p.current.type) || [];
    if (arr.length < MAX_LISTINGS_PER_TYPE) arr.push(p);
    byType.set(p.current.type, arr);
  }
  const listings = [];
  for (let i = 0; i < MAX_LISTINGS_PER_TYPE; i++) {
    for (const arr of byType.values()) {
      const p = arr[i];
      if (!p) continue;
      const s = summaryById.get(p.id);
      listings.push({
        id: p.id, owner: s.owner, city: s.city, state: s.state, neighborhood: s.neighborhood,
        propertyType: s.propertyType, beds: s.beds, baths: s.baths, estimatedValue: s.estimatedValue,
        wants: {
          locations: p.desired.locations, type: p.desired.type,
          minBeds: p.desired.minBeds, minBaths: p.desired.minBaths,
          priceMin: p.desired.priceMin, priceMax: p.desired.priceMax,
        },
        matchCount: matchCountByListing.get(p.id) || 0,
      });
    }
  }

  const feed = await db.prepare(
    `SELECT posts.id, posts.body, posts.created_at, users.display_name AS author_name,
            groups.label AS group_label,
            (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
     FROM posts
     JOIN users ON users.id = posts.user_id
     LEFT JOIN groups ON groups.id = posts.group_id
     WHERE users.email LIKE ?
     ORDER BY posts.created_at DESC LIMIT 100`
  ).bind(DEMO_EMAIL_PATTERN).all();

  return json({
    stats: {
      users: userCount.n, activeListings: listingCount.n, posts: DISPLAY_POST_COUNT,
      matches: Math.min(matches.length, MAX_MATCHES_SURFACED), chains: Math.min(chains.length, MAX_CHAINS_SURFACED),
    },
    // The stat above reports the true (safety-capped) total so the numbers
    // reflect real volume, but only a readable sample renders as cards —
    // nobody scrolls through 1,000+ match cards on a showcase page.
    listings,
    matches: matches.slice(0, 50).map(m => ({ a: summaryById.get(m.a), b: summaryById.get(m.b), scoreAWantsB: m.scoreAWantsB, scoreBWantsA: m.scoreBWantsA })),
    chains: chains.slice(0, 50).map(c => ({ avg: c.avg, path: c.path.map(id => summaryById.get(id)) })),
    feed: feed.results,
  });
}
