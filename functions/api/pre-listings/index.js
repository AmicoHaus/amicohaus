import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { validatePreListingInput, insertPreListing, fetchPreListingPhotos, getVoteTally } from '../../_lib/preListings.js';
import { getAgentProfile } from '../../_lib/agents.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from '../../_lib/geo.js';
import { notifyAgentsNewRequest } from '../../_lib/marketplaceNotify.js';

const LIST_FIELDS = `pre_listings.id, pre_listings.user_id, pre_listings.title, pre_listings.city, pre_listings.state,
            pre_listings.zip, pre_listings.occupancy_status,
            pre_listings.property_type, pre_listings.beds, pre_listings.baths, pre_listings.asking_price,
            pre_listings.status, pre_listings.created_at, users.display_name AS owner_name`;

// ?mine=1 for a homeowner's own pre-listings (any status); otherwise every
// open one, for agents browsing the marketplace — approved-agent status
// isn't required just to look, only to bid or vote.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);

  let rows;
  if (url.searchParams.get('mine') === '1') {
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM pre_listings JOIN users ON users.id = pre_listings.user_id
       WHERE pre_listings.user_id = ? ORDER BY pre_listings.created_at DESC`
    ).bind(user.id).all();
  } else {
    const city = (url.searchParams.get('city') || '').trim();
    const state = (url.searchParams.get('state') || '').trim();
    const conditions = [`pre_listings.status = 'open'`];
    const params = [];
    if (city) { conditions.push('pre_listings.city LIKE ?'); params.push(`%${city}%`); }
    if (state) { conditions.push('pre_listings.state LIKE ?'); params.push(`%${state}%`); }
    params.push(60);
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM pre_listings JOIN users ON users.id = pre_listings.user_id
       WHERE ${conditions.join(' AND ')} ORDER BY pre_listings.created_at DESC LIMIT ?`
    ).bind(...params).all();
  }

  // If the viewer is an approved agent with a declared service area, show
  // each result's distance from their nearest service zip so they don't
  // have to guess from city/state alone — same fixed 20-mile radius the
  // agent set up on their profile, not a separate filter to configure here.
  let agentZipCoords = null;
  let serviceZips = null;
  if (user) {
    const agentProfile = await getAgentProfile(db, user.id);
    if (agentProfile && agentProfile.status === 'approved' && agentProfile.serviceZips.length > 0) {
      serviceZips = agentProfile.serviceZips;
      agentZipCoords = await lookupZipCoords(db, serviceZips);
    }
  }
  const listingZipCoords = serviceZips ? await lookupZipCoords(db, rows.results.map(r => r.zip)) : null;

  const mine = url.searchParams.get('mine') === '1';
  const preListings = [];
  for (const r of rows.results) {
    const photos = await fetchPreListingPhotos(db, r.id);
    const votes = await getVoteTally(db, r.id);
    let distanceMiles = null;
    if (serviceZips) {
      distanceMiles = nearestServiceDistance(listingZipCoords.get(r.zip), serviceZips, agentZipCoords);
    }
    // Only computed for the owner's own list — these drive the "needs your attention" counts on the summary
    // card, which nobody browsing someone else's open pre-listing needs to see.
    let pendingBidCount = null, pendingShowingCount = null;
    if (mine) {
      pendingBidCount = (await db.prepare("SELECT COUNT(*) AS n FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ? AND status = 'pending'").bind(r.id).first()).n;
      pendingShowingCount = (await db.prepare("SELECT COUNT(*) AS n FROM pre_listing_showings WHERE pre_listing_id = ? AND status = 'pending'").bind(r.id).first()).n;
    }
    preListings.push({
      id: r.id, userId: r.user_id, owner: r.owner_name, title: r.title, city: r.city, state: r.state, zip: r.zip,
      occupancyStatus: r.occupancy_status,
      propertyType: r.property_type, beds: r.beds, baths: r.baths, askingPrice: r.asking_price,
      status: r.status, createdAt: r.created_at, photoIds: photos.map(p => p.id), votes,
      distanceMiles: distanceMiles === null ? null : Math.round(distanceMiles),
      inServiceArea: distanceMiles === null ? null : distanceMiles <= SERVICE_RADIUS_MILES,
      pendingBidCount, pendingShowingCount,
    });
  }
  return json({ preListings });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const validated = validatePreListingInput(body);
  if (validated.error) return badRequest(validated.error);

  const id = await insertPreListing(context.env.DB, user.id, validated.data);
  context.waitUntil(notifyAgentsNewRequest(context, 'pre_listing', id, validated.data.zip));
  return json({ id }, { status: 201 });
}
