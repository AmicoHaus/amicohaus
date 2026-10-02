import { clampString, priceTierFor } from './util.js';
import { validateDesiredCriteria } from './listings.js';
import { syncGroupMemberships } from './groups.js';

const MAX_PORTFOLIO_SIZE = 20;

// A portfolio needs no changes to the matching engine at all — it's just
// another row in `listings` (is_portfolio = 1) with aggregated current-value
// fields and its own desired_criteria row, so buildEdges/findMutualMatches/
// findChains already score and chain it exactly like any other listing,
// including against another portfolio. This assembles that aggregate row
// from 2+ of the user's own existing listings.
export async function createPortfolio(db, userId, body) {
  const memberListingIds = [...new Set((Array.isArray(body.memberListingIds) ? body.memberListingIds : [])
    .map(id => Number(id)).filter(Number.isInteger))];

  if (memberListingIds.length < 2) return { error: 'Select at least 2 of your own listings to bundle into a portfolio.' };
  if (memberListingIds.length > MAX_PORTFOLIO_SIZE) return { error: `A portfolio can bundle at most ${MAX_PORTFOLIO_SIZE} properties.` };

  const placeholders = memberListingIds.map(() => '?').join(',');
  const members = await db.prepare(
    `SELECT * FROM listings WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...memberListingIds, userId).all();

  if (members.results.length !== memberListingIds.length) {
    return { error: "One of those listings doesn't belong to you or no longer exists." };
  }
  if (members.results.some(r => r.status !== 'active')) {
    return { error: 'Only active listings can be bundled into a portfolio.' };
  }
  if (members.results.some(r => r.is_portfolio || r.is_rental || r.is_buyer_only)) {
    return { error: 'Only plain trade listings (not rentals, buyer profiles, or other portfolios) can be bundled.' };
  }

  const alreadyBundled = await db.prepare(
    `SELECT member_listing_id FROM portfolio_members WHERE member_listing_id IN (${placeholders})`
  ).bind(...memberListingIds).all();
  if (alreadyBundled.results.length > 0) {
    return { error: 'One of those listings is already part of another portfolio — dissolve it first.' };
  }

  // Bundling properties that belong to different clients (or a mix of a
  // client's home and the broker's own) into one trade would mean trading
  // away a home on behalf of someone who never agreed to that specific deal —
  // every member has to represent the same underlying owner.
  const owners = new Set(members.results.map(r => r.client_name || null));
  if (owners.size > 1) {
    return { error: 'All bundled properties must belong to the same client (or all be your own) — a portfolio trade is one owner exchanging everything at once.' };
  }

  const desiredValidated = validateDesiredCriteria(body);
  if (desiredValidated.error) return { error: desiredValidated.error };
  const { locations, desiredType, priceMin, priceMax, minBeds, minBaths, mustHaves, cashMode, cashAmount } = desiredValidated.data;

  const primary = members.results.reduce((a, b) => (b.estimated_value > a.estimated_value ? b : a));
  const estimatedValue = members.results.reduce((sum, r) => sum + (r.estimated_value || 0), 0);
  const beds = members.results.reduce((sum, r) => sum + (r.beds || 0), 0);
  const baths = members.results.reduce((sum, r) => sum + (r.baths || 0), 0);
  const sqft = members.results.every(r => r.sqft) ? members.results.reduce((sum, r) => sum + r.sqft, 0) : null;

  const title = clampString(body.title, 120) || `Portfolio of ${members.results.length} Properties`;
  const memberList = members.results
    .map(r => `${r.title || r.property_type} in ${r.city}, ${r.state} (${money(r.estimated_value)})`)
    .join('; ');
  const description = `${clampString(body.description, 1500)}\n\nIncludes: ${memberList}`.trim();

  const priceTier = priceTierFor(estimatedValue);
  const result = await db.prepare(
    `INSERT INTO listings (user_id, title, description, address, neighborhood, client_name, city, state, property_type,
       beds, baths, sqft, estimated_value, price_tier, show_exact_address, external_links, is_portfolio)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', 1)`
  ).bind(
    userId, title, description, primary.neighborhood, primary.client_name || null,
    primary.city, primary.state, primary.property_type, beds, baths, sqft, estimatedValue, priceTier
  ).run();

  const portfolioListingId = result.meta.last_row_id;

  await db.prepare(
    `INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max, must_haves, cash_mode, cash_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(portfolioListingId, locations, desiredType, minBeds, minBaths, priceMin, priceMax, mustHaves, cashMode, cashAmount).run();

  const memberStatements = memberListingIds.map(id =>
    db.prepare('INSERT INTO portfolio_members (portfolio_listing_id, member_listing_id) VALUES (?, ?)').bind(portfolioListingId, id)
  );
  await db.batch(memberStatements);

  await syncGroupMemberships(db, userId, { city: primary.city, state: primary.state, estimatedValue });

  return { id: portfolioListingId };
}

export async function releasePortfolioMembers(db, portfolioListingId) {
  await db.prepare('DELETE FROM portfolio_members WHERE portfolio_listing_id = ?').bind(portfolioListingId).run();
}

// A portfolio's membership is fixed once created (dissolve and re-bundle to
// change what's included), but there's no reason changing your mind about
// price range or location should require that — this updates just the
// "what would make you move" side.
export async function updatePortfolioCriteria(db, portfolioListingId, body) {
  const validated = validateDesiredCriteria(body);
  if (validated.error) return validated;
  const { locations, desiredType, priceMin, priceMax, minBeds, minBaths, mustHaves, cashMode, cashAmount } = validated.data;

  await db.prepare(
    `UPDATE desired_criteria SET locations = ?, property_type = ?, min_beds = ?, min_baths = ?,
       price_min = ?, price_max = ?, must_haves = ?, cash_mode = ?, cash_amount = ? WHERE listing_id = ?`
  ).bind(locations, desiredType, minBeds, minBaths, priceMin, priceMax, mustHaves, cashMode, cashAmount, portfolioListingId).run();
  await db.prepare("UPDATE listings SET updated_at = datetime('now') WHERE id = ?").bind(portfolioListingId).run();

  return { ok: true };
}

// Attaches each portfolio's bundled properties for display — the directory,
// profile, and match cards all need to show what's actually inside a
// portfolio, not just its aggregated totals.
export async function fetchPortfolioMembers(db, portfolioListingIds) {
  const ids = [...new Set(portfolioListingIds)].filter(id => Number.isInteger(id));
  const map = new Map();
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT portfolio_members.portfolio_listing_id AS portfolio_id, listings.id, listings.title, listings.city, listings.state,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM portfolio_members
     JOIN listings ON listings.id = portfolio_members.member_listing_id
     WHERE portfolio_members.portfolio_listing_id IN (${placeholders})`
  ).bind(...ids).all();

  for (const r of rows.results) {
    if (!map.has(r.portfolio_id)) map.set(r.portfolio_id, []);
    map.get(r.portfolio_id).push({
      id: r.id, title: r.title, city: r.city, state: r.state, propertyType: r.property_type,
      beds: r.beds, baths: r.baths, estimatedValue: r.estimated_value, photoId: r.photo_id,
    });
  }
  return map;
}

function money(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US');
}
