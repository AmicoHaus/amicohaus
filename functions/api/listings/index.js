import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, parseJsonSafe } from '../../_lib/util.js';
import { validateListingInput, insertListing } from '../../_lib/listings.js';
import { notifyNewMatches } from '../../_lib/matchNotify.js';
import { notifySavedSearches, savedSearchHome } from '../../_lib/savedSearches.js';
import { fetchPortfolioMembers } from '../../_lib/portfolios.js';
import { logMarketEventUnlessDemo, fetchRecentActivityBatch } from '../../_lib/marketEvents.js';
import { fetchPriceSeriesBatch, fetchListingFavoriteCountBatch } from '../../_lib/priceSeries.js';
import { fetchCommentCountBatch } from '../../_lib/dealThreads.js';
import { isApprovedAgent } from '../../_lib/agents.js';
import { liveTools } from '../../_lib/nuancedGate.js';
import { termsForCreate, creditTermsProblem } from '../../_lib/listingTerms.js';
import { validateHeadStart, headStartUntil, notifyWatchers } from '../../_lib/watchAreas.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';

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
  const ids = rows.results.map(l => l.id);
  const [seriesByListing, recentActivityByListing, favoriteCountByListing, commentCountByListing] = await Promise.all([
    fetchPriceSeriesBatch(db, 'listing', ids),
    fetchRecentActivityBatch(db, 'listing', ids),
    fetchListingFavoriteCountBatch(db, ids),
    fetchCommentCountBatch(db, 'listing', ids),
  ]);

  const listings = rows.results.map(l => ({
    ...l, external_links: parseJsonSafe(l.external_links, []),
    life_event_tags: parseJsonSafe(l.life_event_tags_json, []),
    portfolio_members: l.is_portfolio ? (membersByPortfolio.get(l.id) || []) : undefined,
    price_series: [...(seriesByListing.get(l.id) || []), l.estimated_value],
    recent_activity: recentActivityByListing.get(l.id) || null,
    favorite_count: favoriteCountByListing.get(l.id) || 0,
    comment_count: commentCountByListing.get(l.id) || 0,
  }));
  return json({ listings });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const validated = validateListingInput(body, { withTerms: true });
  if (validated.error) return badRequest(validated.error);
  const db = context.env.DB;
  const d = validated.data;
  // Nuanced-ideas tools (nuancedGate.js): a tool that isn't live for this person has its fields ignored (stored as
  // the defaults). With a financing flag on, the title and description can't state loan terms.
  const live = liveTools(context.env, user);
  d.terms = termsForCreate(d.terms, live);
  if (d.terms.ownerCarry || d.terms.assumable) {
    const creditError = creditTermsProblem(`${d.title} ${d.neighborhood || ''} ${d.description}`);
    if (creditError) return badRequest(creditError);
  }
  // Posting a home for a client (the Client name field) is for approved agents only (Rudy 11.05); a homeowner posts
  // their own home without it.
  if (validated.data.clientName && !(await isApprovedAgent(db, user.id))) {
    return forbidden('Only approved agents can post a home for a client.');
  }
  // "Duplicate" pre-fills this form from one of the person's listings and sends cloneOf: a listing paused by
  // moderation (hidden_at set) can't be re-posted that way.
  const cloneOf = Number(body.cloneOf);
  if (Number.isInteger(cloneOf) && cloneOf > 0) {
    const source = await db.prepare('SELECT hidden_at FROM listings WHERE id = ? AND user_id = ?').bind(cloneOf, user.id).first();
    if (source && source.hidden_at) {
      return json({ error: "This listing was paused by Amico Haus, so it can't be copied. Questions? Use Contact.", code: 'moderation_paused' }, { status: 409 });
    }
  }

  // Neighbors First head start (watchAreas.js): the owner's own home, shown first to members who watch its ZIP. The
  // listing is stored paused until the head start ends, so the three create-time alerts wait until it opens
  // (announceNewListing); only the ZIP's watchers are told now, in-app. Never for a home posted by or for an agent.
  if (live.headStart && !d.isBuyerOnly && body.headStart && Number(body.headStart.hours) > 0) {
    const headStart = validateHeadStart(body.headStart, { agentPosted: !!d.clientName || await isApprovedAgent(db, user.id), zip: d.zip });
    if (headStart.error) return badRequest(headStart.error);
    const until = headStart.data.hours > 0 ? headStartUntil(headStart.data.hours, Date.now()) : null;
    if (until) {
      if (!(await claimUserAction(db, 'head_start', user.id))) return rateLimited();
      const id = await insertListing(db, user.id, d, { headStartUntil: until });
      context.waitUntil(Promise.resolve(notifyWatchers(context, { kind: 'listing', id, ownerId: user.id, zip: d.zip, until }))
        .catch(err => console.log(`[watch notify failed] ${err.message}`)));
      return json({ id, headStartUntil: until }, { status: 201 });
    }
  }

  const listingId = await insertListing(context.env.DB, user.id, validated.data);
  // Backgrounded via waitUntil rather than awaited: a listing that happens to
  // clear the match threshold against a lot of existing listings can mean
  // dozens of sequential email/push sends, easily enough to blow past the
  // Worker's execution time limit if the client has to wait on it — which
  // surfaced as this endpoint returning a bare Cloudflare 1101 error instead
  // of the listing it had, in fact, already successfully created.
  context.waitUntil(notifyNewMatches(context, listingId));
  // Same reasoning for saved-search alerts (a buyer-only profile or a rental isn't a home anyone's search is for).
  const home = savedSearchHome(listingId, user.id, validated.data);
  if (home) {
    context.waitUntil(notifySavedSearches(context.env.DB, home).catch(err => console.log(`[saved search notify failed] ${err.message}`)));
  }
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
