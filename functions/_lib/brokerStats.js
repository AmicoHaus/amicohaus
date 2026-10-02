import { buildEdges, findMutualMatches, findBuyerMatches, findRentalMatches, rowsToProfiles } from './matching.js';
import { DEMO_EMAIL_PATTERN } from './util.js';

// Shared by the broker dashboard (functions/api/broker/stats.js) and the CSV
// export (functions/api/listings/export.js) so match-counting logic — the
// expensive part — isn't duplicated between them.
const MAX_CANDIDATES = 1500;

const LISTING_FIELDS = `listings.id AS listing_id, listings.user_id, listings.title, listings.client_name,
            listings.property_type, listings.city, listings.state, listings.beds, listings.baths,
            listings.estimated_value, listings.views, listings.status,
            listings.is_buyer_only, listings.is_rental, listings.rent_amount, listings.is_portfolio,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min, desired_criteria.price_max`;

// A bundled member listing is only tradeable through its portfolio now — see
// functions/api/matches.js for the full reasoning on why this is a subquery
// rather than a denormalized flag.
const NOT_BUNDLED = `listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)`;

export async function computeBrokerStats(db, userId) {
  const mine = await db.prepare(
    `SELECT ${LISTING_FIELDS}, ${NOT_BUNDLED} AS not_bundled FROM listings
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.user_id = ?`
  ).bind(userId).all();

  const totalListings = mine.results.length;
  const activeListings = mine.results.filter(r => r.status === 'active').length;
  const totalViews = mine.results.reduce((sum, r) => sum + (r.views || 0), 0);

  // A rental has no desired_criteria row (no desired_type), so it wouldn't
  // otherwise qualify here — included explicitly so a landlord's own rental
  // still gets a match count. A bundled member listing still needs to appear
  // in `mine` above (so its card and "part of a portfolio" note still show),
  // but it must NOT feed the matching computation below — only its portfolio
  // is independently tradeable now.
  const activeMine = mine.results.filter(r => r.status === 'active' && r.not_bundled && (r.desired_type || r.is_rental || r.is_portfolio));
  const matchCountByListing = new Map();
  let totalMatches = 0;

  if (activeMine.length > 0) {
    // LEFT JOIN, not JOIN — a rental has no desired_criteria row at all, and
    // an inner join would silently drop every other landlord's rental out of
    // the candidate pool.
    const others = await db.prepare(
      `SELECT ${LISTING_FIELDS} FROM listings
       JOIN users ON users.id = listings.user_id
       LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
       WHERE listings.status = 'active' AND listings.user_id != ? AND users.email NOT LIKE ? AND ${NOT_BUNDLED} LIMIT ?`
    ).bind(userId, DEMO_EMAIL_PATTERN, MAX_CANDIDATES).all();

    const rows = [...activeMine, ...others.results];
    const profiles = rowsToProfiles(rows);
    // Buyer-only and rental profiles can't sit in a reciprocal edge — same
    // split as functions/api/matches.js.
    const sellerProfiles = profiles.filter(p => !p.isBuyerOnly && !p.isRental);
    const buyerProfiles = profiles.filter(p => p.isBuyerOnly);
    const rentalProfiles = profiles.filter(p => p.isRental);
    const edges = buildEdges(sellerProfiles);
    const allMatches = findMutualMatches(edges);
    const allBuyerHits = findBuyerMatches(buyerProfiles, sellerProfiles);
    const allRentalHits = findRentalMatches(sellerProfiles, rentalProfiles);
    const myListingIds = new Set(activeMine.map(r => r.listing_id));

    for (const m of allMatches) {
      const mine_a = myListingIds.has(m.a);
      const mine_b = myListingIds.has(m.b);
      if (!mine_a && !mine_b) continue;
      totalMatches++;
      if (mine_a) matchCountByListing.set(m.a, (matchCountByListing.get(m.a) || 0) + 1);
      if (mine_b) matchCountByListing.set(m.b, (matchCountByListing.get(m.b) || 0) + 1);
    }
    for (const hit of allBuyerHits) {
      const mineBuyer = myListingIds.has(hit.buyerId);
      const mineSeller = myListingIds.has(hit.sellerId);
      if (!mineBuyer && !mineSeller) continue;
      totalMatches++;
      if (mineBuyer) matchCountByListing.set(hit.buyerId, (matchCountByListing.get(hit.buyerId) || 0) + 1);
      if (mineSeller) matchCountByListing.set(hit.sellerId, (matchCountByListing.get(hit.sellerId) || 0) + 1);
    }
    for (const hit of allRentalHits) {
      const mineSeller = myListingIds.has(hit.sellerId);
      const mineRental = myListingIds.has(hit.rentalId);
      if (!mineSeller && !mineRental) continue;
      totalMatches++;
      if (mineSeller) matchCountByListing.set(hit.sellerId, (matchCountByListing.get(hit.sellerId) || 0) + 1);
      if (mineRental) matchCountByListing.set(hit.rentalId, (matchCountByListing.get(hit.rentalId) || 0) + 1);
    }
  }

  const listings = mine.results.map(r => ({
    id: r.listing_id, title: r.title, clientName: r.client_name, propertyType: r.property_type,
    city: r.city, state: r.state, status: r.status,
    views: r.views || 0, matches: matchCountByListing.get(r.listing_id) || 0,
  }));

  return { totalListings, activeListings, totalViews, totalMatches, listings };
}
