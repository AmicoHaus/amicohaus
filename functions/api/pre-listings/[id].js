import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../_lib/util.js';
import { validatePreListingInput, updatePreListing, fetchPreListingPhotos, getVoteTally, fetchMyVote } from '../../_lib/preListings.js';
import { fetchBids, fetchMyBid, fetchHomeownerRatingSummary } from '../../_lib/marketplace.js';
import { getAgentProfile } from '../../_lib/agents.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from '../../_lib/geo.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const row = await db.prepare(
    `SELECT pre_listings.*, users.display_name AS owner_name
     FROM pre_listings JOIN users ON users.id = pre_listings.user_id WHERE pre_listings.id = ?`
  ).bind(id).first();
  if (!row) return notFound('Pre-listing not found.');

  const isOwner = user.id === row.user_id;
  const agentProfile = await getAgentProfile(db, user.id);
  const isApprovedAgentViewer = !!agentProfile && agentProfile.status === 'approved';
  // Lockbox and access notes go only to the owner and vetted agents (and
  // admins) — not to every registered account.
  const canSeeInstructions = isOwner || isApprovedAgentViewer || user.role === 'admin';
  const photos = await fetchPreListingPhotos(db, id);
  const votes = await getVoteTally(db, id);

  const preListing = {
    id: row.id, userId: row.user_id, owner: row.owner_name,
    title: row.title, description: row.description, city: row.city, state: row.state, neighborhood: row.neighborhood,
    zip: row.zip, occupancyStatus: row.occupancy_status, showingNoticeHours: row.showing_notice_hours,
    specialInstructions: canSeeInstructions ? row.special_instructions : undefined,
    minYearsExperience: row.min_years_experience, preferredLanguage: row.preferred_language,
    requireDedicatedContact: !!row.require_dedicated_contact, prefersExclusive: !!row.prefers_exclusive,
    preferredAgreementMonths: row.preferred_agreement_months, prefersLocalSpecialist: !!row.prefers_local_specialist,
    address: isOwner ? row.address : undefined,
    propertyType: row.property_type, beds: row.beds, baths: row.baths, sqft: row.sqft, askingPrice: row.asking_price,
    status: row.status, awardedBidId: row.awarded_bid_id, createdAt: row.created_at,
    photoIds: photos.map(p => p.id), votes,
  };

  // The owner sees every proposal; an agent sees only their own (they're not
  // meant to see competitors' numbers, same as a real proposal marketplace);
  // anyone else sees neither.
  let bids = null;
  let myBid = null;
  let myVote = null;

  if (isOwner) {
    bids = await fetchBids(db, 'pre_listing', id);
  } else if (isApprovedAgentViewer) {
    myBid = await fetchMyBid(db, 'pre_listing', id, user.id);
    myVote = await fetchMyVote(db, id, user.id);
  }

  if (isApprovedAgentViewer && agentProfile.serviceZips.length > 0) {
    const coords = await lookupZipCoords(db, [...agentProfile.serviceZips, row.zip]);
    const d = nearestServiceDistance(coords.get(row.zip), agentProfile.serviceZips, coords);
    preListing.distanceMiles = d === null ? null : Math.round(d);
    preListing.inServiceArea = d === null ? null : d <= SERVICE_RADIUS_MILES;
  }

  const homeownerRating = await fetchHomeownerRatingSummary(db, row.user_id);

  return json({ preListing, bids, myBid, myVote, isOwner: !!isOwner, homeownerRating });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, status, asking_price FROM pre_listings WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Pre-listing not found.');
  if (existing.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  if (body.action === 'close') {
    // An awarded pre-listing has an agent and a milestone checklist attached; it isn't the owner's to "close" away.
    if (existing.status !== 'open') return badRequest('Only an open pre-listing can be closed.');
    await db.prepare("UPDATE pre_listings SET status = 'closed', updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  if (existing.status !== 'open') return badRequest('Only an open pre-listing can be edited.');
  const validated = validatePreListingInput(body);
  if (validated.error) return badRequest(validated.error);
  await updatePreListing(db, id, validated.data);

  // The price votes were opinions about the old asking price; once it changes they'd be misleading, so agents
  // start fresh. Proposals stay: they are about strategy and fees, not the price.
  let votesCleared = 0;
  if (Number(validated.data.askingPrice) !== Number(existing.asking_price)) {
    const cleared = await db.prepare('DELETE FROM pre_listing_price_votes WHERE pre_listing_id = ?').bind(id).run();
    votesCleared = (cleared.meta && cleared.meta.changes) || 0;
  }
  return json({ ok: true, votesCleared });
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Pre-listing not found.');
  if (existing.user_id !== user.id && user.role !== 'admin') return forbidden();

  await db.prepare('DELETE FROM pre_listings WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
