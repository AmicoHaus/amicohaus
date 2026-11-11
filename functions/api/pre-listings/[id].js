import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { validatePreListingInput, updatePreListing, fetchPreListingPhotos, getVoteTally, fetchMyVote, sealTally, fetchPriceOpinions, priceIsOpen, shownAskingPrice } from '../../_lib/preListings.js';
import { fetchContactShares, fetchAddressViews, fetchSharedContact } from '../../_lib/addressViews.js';
import { fetchBids, fetchMyBid } from '../../_lib/marketplace.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from '../../_lib/geo.js';
import { buyerDemandDetailForDisplay } from '../../_lib/buyerDemand.js';
import { timingForViewer } from '../../_lib/timingMatch.js';
import { readyMeterForOwner, agentViewFor } from '../../_lib/readyMeter.js';
import { attachOpinionTrails, fetchMyOpinionTrail, fetchMyRefreshAsk } from '../../_lib/opinionTrail.js';
import { homeCostsFromRow } from '../../_lib/homeCosts.js';
import { homeFactsFromRow } from '../../_lib/homeFacts.js';
import { wrapUpSellerPrep } from '../../_lib/sellerPrepWrapUp.js';
import { LAUNCH_ZIPS, FOUNDING_SPOTS, LIVE_FOUNDERS_SQL } from '../../_lib/zipBoard.js';
import { proposalsSealed, countSealedProposals, fetchFinalists, sqlTime } from '../../_lib/decisionNight.js';
import { logAdminAction } from '../../_lib/audit.js';
import { countAgentsOnDuty } from '../../_lib/agentDuty.js';
import { preListingAccess, agentsOnly } from '../../_lib/visibility.js';
import { deleteR2Keys } from '../../_lib/r2Cleanup.js';
import { momentForOwner } from '../../_lib/moment.js';
import { allUnionAll } from '../../_lib/compoundSelect.js';

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

  // Only the owner, admins and approved agents open a pre-listing (see visibility.js); everyone else gets the browse
  // teaser, and a blocked agent gets the same 404 as a home that doesn't exist.
  const { access, isOwner, isAdmin, agentProfile, isApprovedAgent: isApprovedAgentViewer } = await preListingAccess(db, user, row);
  if (access === 'agents_only') return agentsOnly();
  if (access === 'hidden') return notFound('Pre-listing not found.');
  // Notes for agents go only to the owner, admins, the agent they hired and agents they shared their contact info
  // with, not to every approved agent. The operator account (admin + approved agent) is treated like any other agent
  // here (Rudy 11.05); an admin with no agent profile keeps seeing them.
  let canSeeInstructions = isOwner || (user.role === 'admin' && !isApprovedAgentViewer);
  if (!canSeeInstructions && row.awarded_bid_id) {
    const hired = await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(row.awarded_bid_id).first();
    canSeeInstructions = !!hired && hired.agent_user_id === user.id;
  }
  if (!canSeeInstructions) {
    canSeeInstructions = !!(await db.prepare('SELECT 1 AS yes FROM contact_shares WHERE pre_listing_id = ? AND agent_id = ?').bind(row.id, user.id).first());
  }
  const photos = await fetchPreListingPhotos(db, id);
  const votes = await getVoteTally(db, id, row);
  const priceOpen = priceIsOpen(row.asking_price);
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
    // The target list date and checklist stay owner-only here; the Ready Meter shares a count and the month with agents
    // only if the owner opts in (readyMeter.js agentViewFor).
    listingReady: isOwner ? JSON.parse(row.listing_ready_json || '[]') : undefined,
    targetListDate: isOwner ? row.target_list_date : undefined,
    hasVideo: !!row.video_r2_key, videoVersion: row.video_r2_key ? row.video_r2_key.slice(-8) : null,
    propertyType: row.property_type, beds: row.beds, baths: row.baths, sqft: row.sqft,
    // priceOpen: the owner left the price blank ("Open to price opinions"); askingPrice is then 0.
    askingPrice: shownAskingPrice(row.asking_price), priceOpen,
    proposalsPaused: !!row.proposals_paused,
    status: row.status, awardedBidId: row.awarded_bid_id, createdAt: row.created_at,
    photoIds: photos.map(p => p.id), votes, costs: homeCostsFromRow(row),
    facts: homeFactsFromRow(row),
    priceHistory: priceHistoryRows.results.map(r => ({ oldPrice: r.old_price, newPrice: r.new_price, changedAt: r.changed_at })),
  };
  // Timing Match: the owner's closing window and stay (always for the owner; for admins and approved agents once set).
  const timing = timingForViewer(row, { isOwner, isAdmin, isAgent: isApprovedAgentViewer });
  if (timing) preListing.timing = timing;
  // Privacy Sweep: which photos the owner marked "Sweep done" (owner only; agents never see a badge).
  if (isOwner) preListing.sweptPhotoIds = photos.filter(ph => ph.swept_at).map(ph => ph.id);

  // The owner sees every proposal; an agent sees only their own (they're not
  // meant to see competitors' numbers, same as a real proposal marketplace);
  // anyone else sees neither.
  let bids = null;
  let myBid = null;
  let myVote = null;
  let priceOpinions = null;
  let myOpinionTrail = null;
  let myRefreshAsk = null;

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
    // Opinion Refresh: each agent's price opinion history and the refresh status (owner only).
    await attachOpinionTrails(db, row, priceOpinions);
    // Ready Meter: this week's check-in and the owner's settings. Owner only: never an agent, never an admin.
    preListing.readyMeter = await readyMeterForOwner(db, row);
    // You're in Control: who the owner shared their contact info with, and every agent the exact address was shown
    // to (by a share or a broker preview RSVP). Never sent to anyone but the owner.
    preListing.contactShares = await fetchContactShares(db, id);
    preListing.addressViews = await fetchAddressViews(db, id);
    // After hiring: the finalists who could get feedback, and whether it was sent.
    if (row.status === 'awarded') {
      const hired = bids.find(b => b.id === row.awarded_bid_id);
      const finalists = await fetchFinalists(db, id, hired ? hired.agentUserId : 0);
      const sent = await db.prepare('SELECT COUNT(*) AS n FROM finalist_debriefs WHERE pre_listing_id = ?').bind(id).first();
      preListing.debrief = { finalists, sent: sent.n > 0 };
    }
    // Share Your Moment: the owner's own facts for Reveal Mode and the Hired! story, and their repost OKs (owner only).
    const moment = await momentForOwner(db, row, bids);
    if (moment) preListing.moment = moment;
  } else if (isApprovedAgentViewer) {
    myBid = await fetchMyBid(db, 'pre_listing', id, user.id);
    myVote = await fetchMyVote(db, id, user.id);
    // Opinion Refresh: this agent's own history on this home and any refresh request waiting for them (never anyone else's).
    myOpinionTrail = await fetchMyOpinionTrail(db, id, user.id);
    myRefreshAsk = await fetchMyRefreshAsk(db, row, user.id);
    // Sealed until this agent has voted: they see how many agents weighed in, not how. No exception for staff
    // (Fair Play): an admin account that also competes as an agent plays by the same rule.
    if (!(myVote && myVote.vote)) preListing.votes = sealTally(votes);
    // The owner shared their contact info with this agent: the exact address, phone and email (each look is
    // logged for the owner's "Who saw my address" list).
    const shared = await fetchSharedContact(db, row, user.id);
    if (shared) preListing.sharedContact = shared;
    // The owner invited this agent, so they can send a proposal even while new proposals are paused.
    if (row.proposals_paused) {
      const invite = await db.prepare(
        "SELECT 1 AS yes FROM agent_invites WHERE request_type = 'pre_listing' AND request_id = ? AND agent_user_id = ? AND invited_by_user_id = ?"
      ).bind(id, user.id, row.user_id).first();
      if (invite) preListing.invitedByOwner = true;
    }
  }

  if (isApprovedAgentViewer && agentProfile.serviceZips.length > 0) {
    const coords = await lookupZipCoords(db, [...agentProfile.serviceZips, row.zip]);
    const d = nearestServiceDistance(coords.get(row.zip), agentProfile.serviceZips, coords);
    preListing.distanceMiles = d === null ? null : Math.round(d);
    preListing.inServiceArea = d === null ? null : d <= SERVICE_RADIUS_MILES;
  }

  // The owner and approved agents see how many buyers are looking for a home like this (3 or more only). Only the
  // owner sees how many of them have a move-in window that fits theirs (3 or more only).
  if (isOwner || isApprovedAgentViewer) {
    const demand = await buyerDemandDetailForDisplay(db, {
      userId: row.user_id, city: row.city, state: row.state, neighborhood: row.neighborhood,
      propertyType: row.property_type, price: row.asking_price, priceOpen, beds: row.beds, baths: row.baths,
      closeFrom: row.close_from, closeTo: row.close_to, stayAfterDays: row.stay_after_days,
    });
    preListing.buyerDemand = demand.buyerDemand;
    if (isOwner) preListing.timingDemand = demand.timingDemand;
  }
  // Ready Meter: "What agents see" (open homes; the owner sees exactly what agents see).
  const agentView = await agentViewFor(db, row, { isOwner, isAgent: isApprovedAgentViewer, photoCount: photos.length });
  if (agentView) preListing.agentView = agentView;

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

  // Per-viewer (the owner's address, a shared phone and email): never stored by a browser or the edge.
  return json({ preListing, bids, myBid, myVote, priceOpinions, isOwner: !!isOwner, myOpinionTrail, myRefreshAsk }, { headers: { 'Cache-Control': 'private, no-store' } });
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

  // "Pause new proposals": agents who already sent one can still update it; nobody new can start one until the
  // owner resumes. Open pre-listings only.
  if (body.action === 'pause' || body.action === 'resume') {
    if (existing.status !== 'open') return badRequest('Only an open pre-listing can pause or resume proposals.');
    const paused = body.action === 'pause' ? 1 : 0;
    await db.prepare("UPDATE pre_listings SET proposals_paused = ?, updated_at = datetime('now') WHERE id = ?").bind(paused, id).run();
    return json({ ok: true, proposalsPaused: !!paused });
  }

  if (existing.status !== 'open') return badRequest('Only an open pre-listing can be edited.');
  const validated = validatePreListingInput(body);
  if (validated.error) return badRequest(validated.error);
  await updatePreListing(db, id, validated.data);

  // The price votes were opinions about the old asking price; once it changes they'd be misleading, so agents
  // start fresh. Proposals stay: they are about strategy and fees, not the price. Going from a price to blank
  // ("open to price opinions"), or back, is a price change too (the history then shows 0 for "no price").
  let votesCleared = 0;
  const oldPrice = shownAskingPrice(existing.asking_price);
  if (validated.data.askingPrice !== oldPrice) {
    const cleared = await db.prepare('DELETE FROM pre_listing_price_votes WHERE pre_listing_id = ?').bind(id).run();
    votesCleared = (cleared.meta && cleared.meta.changes) || 0;
    // Clearing the votes without a trace would look like nothing happened — logged so anyone viewing (owner or
    // a bidding agent) can see the price actually moved, same transparency a real listing's price history gives.
    await db.prepare('INSERT INTO pre_listing_price_history (pre_listing_id, old_price, new_price) VALUES (?, ?, ?)')
      .bind(id, oldPrice, validated.data.askingPrice).run();
  }
  return json({ ok: true, votesCleared, priceOpen: validated.data.priceOpen });
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
  // Removing someone else's pre-listing (moderation) is on the admin activity log, like other admin deletes.
  if (existing.user_id !== user.id) await logAdminAction(db, user.id, 'delete_pre_listing', 'pre_listing', id);
  // Everything in storage (photos, the walkthrough video, price-opinion decks, pitch reels, Then & Now photo pairs) is
  // read before the rows go, then removed.
  // In chunks of at most 5 terms: D1 refuses a longer compound SELECT (compoundSelect.js).
  const stored = await allUnionAll(db,
    `SELECT r2_key AS k FROM pre_listing_photos WHERE pre_listing_id = ?1
     UNION ALL SELECT video_r2_key FROM pre_listings WHERE id = ?1
     UNION ALL SELECT deck_r2_key FROM pre_listing_price_opinions WHERE pre_listing_id = ?1
     UNION ALL SELECT pitch_video_r2_key FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ?1
     UNION ALL SELECT then_r2_key FROM pre_listing_then_now WHERE pre_listing_id = ?1
     UNION ALL SELECT now_r2_key FROM pre_listing_then_now WHERE pre_listing_id = ?1`,
    [Number(id)], ['k']);
  // Proposals, invites and the hire checklist point at the pre-listing by type and id (no foreign key), so the
  // delete doesn't cascade to them: they go in the same batch.
  await db.batch([
    db.prepare("DELETE FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ?").bind(Number(id)),
    db.prepare("DELETE FROM agent_invites WHERE request_type = 'pre_listing' AND request_id = ?").bind(Number(id)),
    db.prepare("DELETE FROM bid_milestones WHERE request_type = 'pre_listing' AND request_id = ?").bind(Number(id)),
    db.prepare('DELETE FROM pre_listings WHERE id = ?').bind(Number(id)),
  ]);
  await deleteR2Keys(context.env.PHOTOS, stored.map(r => r.k));
  return json({ ok: true });
}
