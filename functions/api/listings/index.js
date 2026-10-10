import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, parseJsonSafe } from '../../_lib/util.js';
import { validateListingInput, insertListing } from '../../_lib/listings.js';
import { notifyNewMatches } from '../../_lib/matchNotify.js';
import { fetchPortfolioMembers } from '../../_lib/portfolios.js';
import { logMarketEventUnlessDemo } from '../../_lib/marketEvents.js';
import { fetchPriceSeriesBatch } from '../../_lib/priceSeries.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT listings.*, desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min,
            desired_criteria.price_max, desired_criteria.must_haves, desired_criteria.cash_mode, desired_criteria.cash_amount,
            portfolio_members.portfolio_listing_id AS bundled_into
     FROM listings
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     LEFT JOIN portfolio_members ON portfolio_members.member_listing_id = listings.id
     WHERE listings.user_id = ? ORDER BY listings.created_at DESC`
  ).bind(user.id).all();

  const portfolioIds = rows.results.filter(l => l.is_portfolio).map(l => l.id);
  const membersByPortfolio = await fetchPortfolioMembers(db, portfolioIds);
  const seriesByListing = await fetchPriceSeriesBatch(db, 'listing', rows.results.map(l => l.id));

  const listings = rows.results.map(l => ({
    ...l, external_links: parseJsonSafe(l.external_links, []),
    life_event_tags: parseJsonSafe(l.life_event_tags_json, []),
    portfolio_members: l.is_portfolio ? (membersByPortfolio.get(l.id) || []) : undefined,
    price_series: [...(seriesByListing.get(l.id) || []), l.estimated_value],
  }));
  return json({ listings });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const validated = validateListingInput(body);
  if (validated.error) return badRequest(validated.error);

  const listingId = await insertListing(context.env.DB, user.id, validated.data);
  // Backgrounded via waitUntil rather than awaited: a listing that happens to
  // clear the match threshold against a lot of existing listings can mean
  // dozens of sequential email/push sends, easily enough to blow past the
  // Worker's execution time limit if the client has to wait on it — which
  // surfaced as this endpoint returning a bare Cloudflare 1101 error instead
  // of the listing it had, in fact, already successfully created.
  context.waitUntil(notifyNewMatches(context, listingId));
  // Buyer-only "profiles" and bundled portfolio members aren't a standalone property to list on the ticker.
  if (!validated.data.isBuyerOnly) {
    const price = '$' + Number(validated.data.estimatedValue).toLocaleString('en-US');
    context.waitUntil(logMarketEventUnlessDemo(context.env.DB, user.id, {
      eventType: 'new_listing', entityKind: 'listing', entityId: listingId,
      city: validated.data.city, state: validated.data.state,
      headline: `New listing: ${validated.data.propertyType || 'Home'} in ${validated.data.city}, ${validated.data.state} — ${price}`,
      amount: validated.data.estimatedValue,
    }));
  }
  return json({ id: listingId }, { status: 201 });
}
