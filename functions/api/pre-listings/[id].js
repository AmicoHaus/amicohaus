import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { validatePreListingInput, updatePreListing, fetchPreListingPhotos, getVoteTally, fetchMyVote, sealTally, fetchPriceOpinions, deleteOpinionDecks } from '../../_lib/preListings.js';
import { fetchBids, fetchMyBid, fetchHomeownerRatingSummary } from '../../_lib/marketplace.js';
import { getAgentProfile } from '../../_lib/agents.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from '../../_lib/geo.js';
import { buyerDemandForDisplay } from '../../_lib/buyerDemand.js';
import { homeCostsFromRow } from '../../_lib/homeCosts.js';
import { wrapUpSellerPrep } from '../../_lib/sellerPrepWrapUp.js';
import { LAUNCH_ZIPS, FOUNDING_SPOTS, LIVE_FOUNDERS_SQL } from '../../_lib/zipBoard.js';
import { proposalsSealed, countSealedProposals, fetchFinalists, sqlTime } from '../../_lib/decisionNight.js';
import { logAdminAction } from '../../_lib/audit.js';
import { countAgentsOnDuty } from '../../_lib/agentDuty.js';

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
  const priceHistoryRows = await db.prepare(
    'SELECT old_price, new_price, changed_at FROM pre_listing_price_history WHERE pre_listing_id = ? ORDER BY changed_at ASC'
  ).bind(id).all();

  const preListing = {
    id: row.id, userId: row.user_id, owner: row.owner_name,
    title: row.title, description: row.description, city: row.city, state: row.state, neighborhood: row.neighborhood,
    zip: row.zip, occupancyStatus: row.occupancy_status, showingNoticeHours: row.showing_notice_hours,
    specialInstructions: canSeeInstructions ? row.special_instructions : undefined,
    minYearsExperience: row.min_years_experience, preferredLanguage: row.preferred_language,
    requireDedicatedContact: !!row.require_dedicated_contact, prefersExclusive: !!row.prefers_exclusive,
    preferredAgreementMonths: row.preferred_agreement_months, prefersLocalSpecialist: !!row.prefers_local_specialist,
    address: isOwner ? row.address : undefined,
    disclosureChecklist: isOwner ? JSON.parse(row.disclosure_checklist_json || '[]') : undefined,
    listingReady: isOwner ? JSON.parse(row.listing_ready_json || '[]') : undefined,
    targetListDate: isOwner ? row.target_list_date : undefined,
    hasVideo: !!row.video_r2_key, videoVersion: row.video_r2_key ? row.video_r2_key.slice(-8) : null,
    propertyType: row.property_type, beds: row.beds, baths: row.baths, sqft: row.sqft, askingPrice: row.asking_price,
    status: row.status, awardedBidId: row.awarded_bid_id, createdAt: row.created_at,
    photoIds: photos.map(p => p.id), votes, costs: homeCostsFromRow(row),
    priceHistory: priceHistoryRows.results.map(r => ({ oldPrice: r.old_price, newPrice: r.new_price, changedAt: r.changed_at })),
  };

  // The owner sees every proposal; an agent sees only their own (they're not
  // meant to see competitors' numbers, same as a real proposal marketplace);
  // anyone else sees neither.
  let bids = null;
  let myBid = null;
  let myVote = null;
  let priceOpinions = null;

  // Decision Night: the owner and agents both see the time; until then the owner sees how many proposals came in,
  // not the proposals themselves.
  const sealed = proposalsSealed(row);
  if (row.proposals_due_at && (isOwner || isApprovedAgentViewer)) preListing.decisionNight = { dueAt: row.proposals_due_at, sealed };

  if (isOwner) {
    if (sealed) {
      bids = [];
      preListing.decisionNight.sealedCount = await countSealedProposals(db, id);
    } else {
      bids = await fetchBids(db, 'pre_listing', id, { dueAt: row.proposals_due_at });
      if (row.proposals_due_at) {
        const due = Date.parse(row.proposals_due_at);
        for (const b of bids) b.afterDecisionNight = sqlTime(b.submittedAt) > due;
        // They're looking at them now, so the "your proposals are open" message would be old news.
        if (!row.proposals_open_notified_at) await db.prepare("UPDATE pre_listings SET proposals_open_notified_at = datetime('now') WHERE id = ? AND proposals_open_notified_at IS NULL").bind(id).run();
      }
    }
    priceOpinions = await fetchPriceOpinions(db, id);
    // After hiring: the finalists who could get feedback, and whether it was sent.
    if (row.status === 'awarded') {
      const hired = bids.find(b => b.id === row.awarded_bid_id);
      const finalists = await fetchFinalists(db, id, hired ? hired.agentUserId : 0);
      const sent = await db.prepare('SELECT COUNT(*) AS n FROM finalist_debriefs WHERE pre_listing_id = ?').bind(id).first();
      preListing.debrief = { finalists, sent: sent.n > 0 };
    }
  } else if (isApprovedAgentViewer) {
    myBid = await fetchMyBid(db, 'pre_listing', id, user.id);
    myVote = await fetchMyVote(db, id, user.id);
    // Sealed until this agent has voted: they see how many agents weighed in, not how. No exception for staff
    // (Fair Play): an admin account that also competes as an agent plays by the same rule.
    if (!(myVote && myVote.vote)) preListing.votes = sealTally(votes);
  }

  if (isApprovedAgentViewer && agentProfile.serviceZips.length > 0) {
    const coords = await lookupZipCoords(db, [...agentProfile.serviceZips, row.zip]);
    const d = nearestServiceDistance(coords.get(row.zip), agentProfile.serviceZips, coords);
    preListing.distanceMiles = d === null ? null : Math.round(d);
    preListing.inServiceArea = d === null ? null : d <= SERVICE_RADIUS_MILES;
  }

  // The owner and approved agents see how many buyers are looking for a home like this (3 or more only).
  if (isOwner || isApprovedAgentViewer) {
    preListing.buyerDemand = await buyerDemandForDisplay(db, {
      userId: row.user_id, city: row.city, state: row.state, neighborhood: row.neighborhood,
      propertyType: row.property_type, price: row.asking_price, beds: row.beds, baths: row.baths,
    });
  }

  // Founding agents in this ZIP aim to send a first price opinion within 48 hours of posting; the owner also sees how
  // many approved agents serve the ZIP, to invite more when there are few.
  if (Object.hasOwn(LAUNCH_ZIPS, String(row.zip)) && (isOwner || isApprovedAgentViewer)) {
    const founding = await db.prepare(`SELECT agent_user_id FROM (${LIVE_FOUNDERS_SQL}) WHERE zip = ?`).bind(String(row.zip)).all();
    const serving = await db.prepare(
      `SELECT COUNT(DISTINCT agent_profiles.user_id) AS n FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id, json_each(agent_profiles.service_zips_json) z
       WHERE agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ? AND CAST(z.value AS TEXT) = ?`
    ).bind(DEMO_EMAIL_PATTERN, String(row.zip)).first();
    preListing.zipCoverage = {
      zip: String(row.zip), agentsServing: serving.n, foundingAgents: founding.results.length, foundingSpots: FOUNDING_SPOTS,
      firstOpinionBy: founding.results.length ? new Date(Date.parse(row.created_at.replace(' ', 'T') + 'Z') + 48 * 3600000).toISOString() : null,
      viewerIsFounding: !isOwner && founding.results.some(f => f.agent_user_id === user.id),
    };
  }

  // Farm Radar: how many agents who serve this ZIP are on duty right now (shown only when at least one).
  if (isOwner && row.status === 'open' && row.zip) preListing.agentsOnDuty = await countAgentsOnDuty(db, row.zip);

  const homeownerRating = await fetchHomeownerRatingSummary(db, row.user_id);

  return json({ preListing, bids, myBid, myVote, priceOpinions, isOwner: !!isOwner, homeownerRating });
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
    await wrapUpSellerPrep(context, id);
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
    // Clearing the votes without a trace would look like nothing happened — logged so anyone viewing (owner or
    // a bidding agent) can see the price actually moved, same transparency a real listing's price history gives.
    await db.prepare('INSERT INTO pre_listing_price_history (pre_listing_id, old_price, new_price) VALUES (?, ?, ?)')
      .bind(id, existing.asking_price, validated.data.askingPrice).run();
  }
  return json({ ok: true, votesCleared });
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Pre-listing not found.');
  if (existing.user_id !== user.id && user.role !== 'admin') return forbidden();
  // Same protection as closing or editing — an awarded pre-listing has a real agent and a milestone checklist
  // attached; it isn't the owner's to delete out from under them. An admin can still override for moderation.
  if (existing.status === 'awarded' && user.role !== 'admin') return badRequest('An awarded pre-listing can\'t be deleted — close it instead once the engagement wraps up.');

  await wrapUpSellerPrep(context, id);
  await deleteOpinionDecks(db, context.env.PHOTOS, id);
  // Pitch reels live in storage, not just in the rows the delete cascades away.
  const pitches = await db.prepare("SELECT pitch_video_r2_key FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ? AND pitch_video_r2_key IS NOT NULL").bind(id).all();
  if (context.env.PHOTOS) await Promise.all(pitches.results.map(p => context.env.PHOTOS.delete(p.pitch_video_r2_key).catch(() => {})));
  // Removing someone else's pre-listing (moderation) is on the admin activity log, like other admin deletes.
  if (existing.user_id !== user.id) await logAdminAction(db, user.id, 'delete_pre_listing', 'pre_listing', id);
  const video = await db.prepare('SELECT video_r2_key FROM pre_listings WHERE id = ?').bind(id).first();
  if (video && video.video_r2_key && context.env.PHOTOS) {
    try { await context.env.PHOTOS.delete(video.video_r2_key); } catch (err) { console.log(`[video delete failed] ${err.message}`); }
  }
  await db.prepare('DELETE FROM pre_listings WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
