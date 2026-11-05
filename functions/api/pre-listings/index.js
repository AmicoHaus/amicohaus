import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { validatePreListingInput, insertPreListing, fetchPreListingPhotos, getVoteTally, sealTally, fetchVotedIds, priceIsOpen, shownAskingPrice } from '../../_lib/preListings.js';
import { getAgentProfile } from '../../_lib/agents.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from '../../_lib/geo.js';
import { notifyAgentsNewRequest } from '../../_lib/marketplaceNotify.js';
import { alertAdmin } from '../../_lib/adminAlerts.js';
import { fetchPriceSeriesBatch } from '../../_lib/priceSeries.js';
import { notBlockedSql } from '../../_lib/blocks.js';
import { validateOwnerTiming, timingAlertLine } from '../../_lib/timingMatch.js';
import { timingFitIdsFor } from '../../_lib/buyerDemand.js';

const LIST_FIELDS = `pre_listings.id, pre_listings.user_id, pre_listings.title, pre_listings.city, pre_listings.state,
            pre_listings.zip, pre_listings.occupancy_status,
            pre_listings.property_type, pre_listings.beds, pre_listings.baths, pre_listings.sqft, pre_listings.asking_price,
            pre_listings.status, pre_listings.proposals_paused, pre_listings.created_at, users.display_name AS owner_name,
            pre_listings.close_from, pre_listings.close_to, pre_listings.stay_after_days`;

// The browse list and the owner's own list differ per viewer, so no browser or shared cache keeps them.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// ?mine=1 for a homeowner's own pre-listings (any status); otherwise every open one. Approved agents (and admins)
// get the full card; everyone else signed in gets a teaser (area, type, size and price only), since a pre-listing
// shows the inside of a home that isn't on the market yet. Homes whose owner blocked the viewer, or that the viewer
// blocked, are left out either way. The browse also sends timingFitIds: the homes whose timing fits one of the
// viewer's own timed saved searches (a "Timing fits" tag; the owner's dates never leave the server).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const mine = url.searchParams.get('mine') === '1';
  const agentProfile = await getAgentProfile(db, user.id);
  const isApprovedAgent = !!agentProfile && agentProfile.status === 'approved';

  let rows;
  let timingFitIds = null;
  if (mine) {
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM pre_listings JOIN users ON users.id = pre_listings.user_id
       WHERE pre_listings.user_id = ? ORDER BY pre_listings.created_at DESC`
    ).bind(user.id).all();
  } else {
    const city = (url.searchParams.get('city') || '').trim();
    const state = (url.searchParams.get('state') || '').trim();
    // ?1 is the viewer. A suspended owner's pre-listings drop out of the browse (and the teaser).
    const conditions = [`pre_listings.status = 'open'`, `users.status = 'active'`, notBlockedSql('pre_listings.user_id', '?1')];
    const params = [user.id];
    if (city) { params.push(`%${city}%`); conditions.push(`pre_listings.city LIKE ?${params.length}`); }
    if (state) { params.push(`%${state}%`); conditions.push(`pre_listings.state LIKE ?${params.length}`); }
    params.push(60);
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM pre_listings JOIN users ON users.id = pre_listings.user_id
       WHERE ${conditions.join(' AND ')} ORDER BY pre_listings.created_at DESC LIMIT ?${params.length}`
    ).bind(...params).all();
    timingFitIds = await timingFitIdsFor(db, user.id, rows.results);
    if (!isApprovedAgent && user.role !== 'admin') {
      const preListings = rows.results.map(r => ({
        id: r.id, city: r.city, state: r.state, zip: r.zip, propertyType: r.property_type, beds: r.beds, baths: r.baths,
        askingPrice: shownAskingPrice(r.asking_price), priceOpen: priceIsOpen(r.asking_price), proposalsPaused: !!r.proposals_paused,
        createdAt: r.created_at, teaser: true,
      }));
      return json({ preListings, timingFitIds }, NO_STORE);
    }
  }

  // If the viewer is an approved agent with a declared service area, show
  // each result's distance from their nearest service zip so they don't
  // have to guess from city/state alone — same fixed 20-mile radius the
  // agent set up on their profile, not a separate filter to configure here.
  let agentZipCoords = null;
  let serviceZips = null;
  // An approved agent sees vote tallies only on pre-listings they've voted on themselves (see sealTally).
  let votedIds = null;
  if (isApprovedAgent) {
    votedIds = await fetchVotedIds(db, user.id);
    if (agentProfile.serviceZips.length > 0) {
      serviceZips = agentProfile.serviceZips;
      agentZipCoords = await lookupZipCoords(db, serviceZips);
    }
  }
  const listingZipCoords = serviceZips ? await lookupZipCoords(db, rows.results.map(r => r.zip)) : null;

  const seriesById = await fetchPriceSeriesBatch(db, 'pre_listing', rows.results.map(r => r.id));
  const preListings = [];
  for (const r of rows.results) {
    const photos = await fetchPreListingPhotos(db, r.id);
    const tally = await getVoteTally(db, r.id, r);
    const votes = votedIds && r.user_id !== user.id && !votedIds.has(r.id) ? sealTally(tally) : tally;
    let distanceMiles = null;
    if (serviceZips) {
      distanceMiles = nearestServiceDistance(listingZipCoords.get(r.zip), serviceZips, agentZipCoords);
    }
    // Only computed for the owner's own list — these drive the "needs your attention" counts on the summary
    // card, which nobody browsing someone else's open pre-listing needs to see.
    let pendingBidCount = null, pendingShowingCount = null;
    if (mine) {
      // Same rule as the proposal comparison (fetchBids): a suspended or blocked agent's pending proposal is hidden
      // there and can't be accepted, so it mustn't count as one "waiting on you" either. ?2 is the owner.
      pendingBidCount = (await db.prepare(
        `SELECT COUNT(*) AS n FROM service_bids JOIN users ON users.id = service_bids.agent_user_id
         WHERE service_bids.request_type = 'pre_listing' AND service_bids.request_id = ?1 AND service_bids.status = 'pending' AND users.status = 'active'
           AND ${notBlockedSql('service_bids.agent_user_id', '?2')}`
      ).bind(r.id, user.id).first()).n;
      pendingShowingCount = (await db.prepare(
        `SELECT COUNT(*) AS n FROM pre_listing_showings s WHERE s.pre_listing_id = ?1 AND s.status = 'pending'
           AND ${notBlockedSql('s.agent_user_id', '?2')}`
      ).bind(r.id, user.id).first()).n;
    }
    preListings.push({
      id: r.id, userId: r.user_id, owner: r.owner_name, title: r.title, city: r.city, state: r.state, zip: r.zip,
      occupancyStatus: r.occupancy_status,
      propertyType: r.property_type, beds: r.beds, baths: r.baths, sqft: r.sqft,
      // priceOpen: no price yet ("Open to price opinions"), askingPrice 0. proposalsPaused: no new proposals for now.
      askingPrice: shownAskingPrice(r.asking_price), priceOpen: priceIsOpen(r.asking_price), proposalsPaused: !!r.proposals_paused,
      priceSeries: [...(seriesById.get(r.id) || []), shownAskingPrice(r.asking_price)],
      status: r.status, createdAt: r.created_at, photoIds: photos.map(p => p.id), votes,
      distanceMiles: distanceMiles === null ? null : Math.round(distanceMiles),
      inServiceArea: distanceMiles === null ? null : distanceMiles <= SERVICE_RADIUS_MILES,
      pendingBidCount, pendingShowingCount,
    });
  }
  return json(mine ? { preListings } : { preListings, timingFitIds }, NO_STORE);
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const validated = validatePreListingInput(body);
  if (validated.error) return badRequest(validated.error);
  // Timing Match: the optional closing window and stay are checked before anything is saved.
  const timing = validateOwnerTiming(body);
  if (timing.error) return badRequest(timing.error);

  const id = await insertPreListing(context.env.DB, user.id, validated.data);
  const t = timing.data;
  if (t.closeFrom || t.stayAfterDays > 0) {
    await context.env.DB.prepare('UPDATE pre_listings SET close_from = ?, close_to = ?, stay_after_days = ? WHERE id = ?')
      .bind(t.closeFrom, t.closeTo, t.stayAfterDays, id).run();
  }
  context.waitUntil(notifyAgentsNewRequest(context, 'pre_listing', id, validated.data.zip, [user.id]));
  const d = validated.data;
  alertAdmin(context, user, {
    kind: 'pre_listing',
    subject: `New pre-listing: ${d.propertyType} in ${d.city}, ${d.state}`,
    lines: [
      `${user.display_name} (${user.email}) just posted a pre-listing on Amico Haus.`,
      '',
      `${d.title || d.propertyType} · ${d.beds}bd/${d.baths}ba · ${d.city}, ${d.state} ${d.zip}`,
      d.priceOpen ? 'Asking: open to price opinions' : `Asking: $${Number(d.askingPrice).toLocaleString('en-US')}`,
      ...(timingAlertLine(t) ? [timingAlertLine(t)] : []),
    ],
  });
  return json({ id }, { status: 201 });
}
