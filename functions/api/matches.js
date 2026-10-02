import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized, DEMO_EMAIL_PATTERN } from '../_lib/util.js';
import { buildEdges, findMutualMatches, findChains, findBuyerMatches, findRentalMatches, rowsToProfiles, matchScoreBreakdown } from '../_lib/matching.js';
import { fetchPortfolioMembers } from '../_lib/portfolios.js';

// The matching algorithm is O(n^2) over the candidate listings (every seeker
// compared against every owner), which is fine at dozens or hundreds of
// listings but would be millions of comparisons — and real risk of hitting
// the Worker's CPU time limit — at a few thousand. MAX_CANDIDATES bounds the
// platform-wide pool while always guaranteeing the current user's own
// listings are included (so seeded/demo volume can't make someone's own
// matches page break or come back empty).
const MAX_CANDIDATES = 1500;

const LISTING_FIELDS = `listings.id AS listing_id, listings.user_id, listings.city, listings.state, listings.neighborhood,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value, listings.created_at,
            listings.is_buyer_only, listings.is_rental, listings.rent_amount, listings.min_lease_months, listings.is_portfolio,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min, desired_criteria.price_max,
            users.display_name AS owner_name`;

// A match can sit around indefinitely with neither side ever reaching out —
// after this many days with no message between them, flag it so the UI can
// nudge whoever's looking at it, rather than it just quietly going stale.
const GONE_QUIET_DAYS = 4;

// A bundled member listing is only tradeable through its portfolio now, so
// it must never surface as an independent candidate on either side of a
// match — this subquery (not a denormalized flag) is the single source of
// truth for "is this listing currently part of a portfolio."
const NOT_BUNDLED = `listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)`;

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;

  // LEFT JOIN, not JOIN — a rental listing has no desired_criteria row at
  // all (it isn't looking for anything back), so an inner join would silently
  // drop it and a landlord with only a rental listing would see "no matches".
  const mine = await db.prepare(
    `SELECT ${LISTING_FIELDS}
     FROM listings JOIN users ON users.id = listings.user_id LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.status = 'active' AND listings.user_id = ? AND ${NOT_BUNDLED}`
  ).bind(user.id).all();

  if (mine.results.length === 0) return json({ matches: [], archived: [], chains: [] });

  const [others, feedbackRows] = await Promise.all([
    db.prepare(
      `SELECT ${LISTING_FIELDS}
       FROM listings JOIN users ON users.id = listings.user_id LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
       WHERE listings.status = 'active' AND listings.user_id != ? AND users.email NOT LIKE ? AND ${NOT_BUNDLED}
       ORDER BY listings.created_at DESC LIMIT ?`
    ).bind(user.id, DEMO_EMAIL_PATTERN, MAX_CANDIDATES).all(),
    db.prepare('SELECT listing_a_id, listing_b_id, feedback FROM match_feedback WHERE user_id = ?').bind(user.id).all(),
  ]);

  const pairKey = (x, y) => (x < y ? `${x}-${y}` : `${y}-${x}`);
  const feedbackByPair = new Map(feedbackRows.results.map(r => [pairKey(r.listing_a_id, r.listing_b_id), r.feedback]));

  const rows = { results: [...mine.results, ...others.results] };

  const portfolioIds = rows.results.filter(r => r.is_portfolio).map(r => r.listing_id);
  const membersByPortfolio = await fetchPortfolioMembers(db, portfolioIds);

  const summaryById = new Map(rows.results.map(r => [r.listing_id, {
    listingId: r.listing_id, userId: r.user_id, owner: r.owner_name,
    city: r.city, state: r.state, neighborhood: r.neighborhood,
    propertyType: r.property_type, beds: r.beds, baths: r.baths, estimatedValue: r.estimated_value,
    isBuyerOnly: !!r.is_buyer_only, isRental: !!r.is_rental, rentAmount: r.rent_amount, minLeaseMonths: r.min_lease_months,
    isPortfolio: !!r.is_portfolio, portfolioMembers: r.is_portfolio ? (membersByPortfolio.get(r.listing_id) || []) : undefined,
    createdAtMs: new Date(r.created_at + 'Z').getTime(),
  }]));
  const profiles = rowsToProfiles(rows.results);
  // A buyer-only profile has no home to offer and a rental has nothing it's
  // seeking — neither can sit in a reciprocal edge or a chain cycle, which
  // only ever run over regular trade listings.
  const sellerProfiles = profiles.filter(p => !p.isBuyerOnly && !p.isRental);
  const buyerProfiles = profiles.filter(p => p.isBuyerOnly);
  const rentalProfiles = profiles.filter(p => p.isRental);
  const edges = buildEdges(sellerProfiles);
  const allMatches = findMutualMatches(edges);
  const allChains = findChains(edges, sellerProfiles.map(p => p.id));
  const allBuyerHits = findBuyerMatches(buyerProfiles, sellerProfiles);
  const allRentalHits = findRentalMatches(sellerProfiles, rentalProfiles);

  const myListingIds = new Set(rows.results.filter(r => r.user_id === user.id).map(r => r.listing_id));

  const myMatches = [];
  const myArchived = [];
  for (const m of allMatches) {
    if (!myListingIds.has(m.a) && !myListingIds.has(m.b)) continue;
    const entry = {
      a: summaryById.get(m.a), b: summaryById.get(m.b),
      scoreAWantsB: m.scoreAWantsB, scoreBWantsA: m.scoreBWantsA,
      breakdownAWantsB: m.breakdownAWantsB, breakdownBWantsA: m.breakdownBWantsA,
    };
    const feedback = feedbackByPair.get(pairKey(m.a, m.b));
    if (feedback) myArchived.push({ ...entry, feedback });
    else myMatches.push(entry);
  }

  // One-directional: the buyer wants the seller's home, but there's nothing
  // reciprocal to score, so the same score is used for both sides purely so
  // existing "average of the two" display code keeps working unchanged.
  for (const hit of allBuyerHits) {
    if (!myListingIds.has(hit.buyerId) && !myListingIds.has(hit.sellerId)) continue;
    const entry = {
      a: summaryById.get(hit.buyerId), b: summaryById.get(hit.sellerId),
      scoreAWantsB: hit.score, scoreBWantsA: hit.score, isBuyerMatch: true,
      breakdownAWantsB: hit.breakdown,
    };
    const feedback = feedbackByPair.get(pairKey(hit.buyerId, hit.sellerId));
    if (feedback) myArchived.push({ ...entry, feedback });
    else myMatches.push(entry);
  }

  // Also one-directional — the % score is how well the rental fits what the
  // seller said would make them move (same matchScore as every other match
  // type), and the year range is on top of that: how long the seller's
  // proceeds could cover it. Duplicated into scoreAWantsB/scoreBWantsA (both
  // the same value) so the existing "average of the two" display code keeps
  // working unchanged, same as isBuyerMatch above.
  for (const hit of allRentalHits) {
    if (!myListingIds.has(hit.sellerId) && !myListingIds.has(hit.rentalId)) continue;
    const entry = {
      a: summaryById.get(hit.sellerId), b: summaryById.get(hit.rentalId),
      scoreAWantsB: hit.score, scoreBWantsA: hit.score,
      isRentalMatch: true, yearsLow: hit.yearsLow, yearsHigh: hit.yearsHigh,
      breakdownAWantsB: hit.breakdown,
    };
    const feedback = feedbackByPair.get(pairKey(hit.sellerId, hit.rentalId));
    if (feedback) myArchived.push({ ...entry, feedback });
    else myMatches.push(entry);
  }

  const myChains = allChains
    .filter(c => c.path.some(id => myListingIds.has(id)))
    .map(c => ({
      avg: c.avg,
      path: c.path.map(id => summaryById.get(id)),
    }));

  // A % match doesn't mean anyone actually reached out — flag the ones that
  // have sat unmessaged a while so the Matches tab can nudge instead of
  // letting a good match silently go stale.
  const otherUserIds = [...new Set(myMatches.map(m => (m.a.userId === user.id ? m.b.userId : m.a.userId)))];
  let messagedUserIds = new Set();
  if (otherUserIds.length > 0) {
    const placeholders = otherUserIds.map(() => '?').join(',');
    const convRows = await db.prepare(
      `SELECT CASE WHEN conversations.user_a_id = ? THEN conversations.user_b_id ELSE conversations.user_a_id END AS other_user_id,
              (SELECT COUNT(*) FROM messages WHERE messages.conversation_id = conversations.id) AS message_count
       FROM conversations
       WHERE (conversations.user_a_id = ? AND conversations.user_b_id IN (${placeholders}))
          OR (conversations.user_b_id = ? AND conversations.user_a_id IN (${placeholders}))`
    ).bind(user.id, user.id, ...otherUserIds, user.id, ...otherUserIds).all();
    messagedUserIds = new Set(convRows.results.filter(r => r.message_count > 0).map(r => r.other_user_id));
  }
  const now = Date.now();
  for (const entry of myMatches) {
    const otherUserId = entry.a.userId === user.id ? entry.b.userId : entry.a.userId;
    const matchAgeMs = now - Math.max(entry.a.createdAtMs, entry.b.createdAtMs);
    entry.goneQuiet = !messagedUserIds.has(otherUserId) && matchAgeMs >= GONE_QUIET_DAYS * 86400000;
  }

  // A raw % or "no matches yet" doesn't tell someone what to actually change.
  // When there's truly nothing, look at why — across every active listing
  // that could theoretically match (skipping rentals, which aren't "seeking"
  // anything so this diagnostic doesn't apply to them) — and name whichever
  // single factor is blocking the most candidates.
  let guidance = null;
  if (myMatches.length === 0 && myArchived.length === 0) {
    const myDesiredListings = mine.results.filter(r => !r.is_rental);
    const candidates = others.results.filter(r => !r.is_rental);
    if (myDesiredListings.length > 0 && candidates.length > 0) {
      const tally = { location: 0, price: 0, type: 0, bedsBaths: 0, total: 0 };
      for (const listing of myDesiredListings) {
        const desired = {
          locations: (listing.locations || '').split(',').map(s => s.trim()).filter(Boolean),
          type: listing.desired_type, minBeds: listing.min_beds, minBaths: listing.min_baths,
          priceMin: listing.price_min, priceMax: listing.price_max,
        };
        for (const cand of candidates) {
          const home = {
            city: cand.city, state: cand.state, neighborhood: cand.neighborhood,
            type: cand.property_type, beds: cand.beds, baths: cand.baths, price: cand.estimated_value,
          };
          const b = matchScoreBreakdown(desired, home);
          tally.total++;
          if (!b.location.ok) tally.location++;
          else if (!b.price.ok) tally.price++;
          else if (!b.type.ok) tally.type++;
          else if (!b.beds.ok || !b.baths.ok) tally.bedsBaths++;
        }
      }
      if (tally.total > 0) {
        if (tally.location / tally.total > 0.6) {
          guidance = "Most active listings right now are outside the areas you've selected — try widening your target locations.";
        } else if (tally.price / tally.total > 0.5) {
          guidance = 'Your price range is narrower than most active listings nearby — try widening it.';
        } else if (tally.type / tally.total > 0.5) {
          guidance = "Try setting property type to \"Any\" to see more potential matches.";
        } else if (tally.bedsBaths / tally.total > 0.5) {
          guidance = 'Lowering your minimum beds/baths could surface more matches.';
        } else {
          guidance = "There's a smaller pool of active listings right now — check back as new ones are added, or widen your search criteria.";
        }
      }
    }
  }

  return json({ matches: myMatches, archived: myArchived, chains: myChains, guidance });
}
