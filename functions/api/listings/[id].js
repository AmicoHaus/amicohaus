import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString, parseJsonSafe } from '../../_lib/util.js';
import { logAdminAction } from '../../_lib/audit.js';
import { releasePortfolioMembers, updatePortfolioCriteria } from '../../_lib/portfolios.js';
import { validateListingEdit, updateListing, sourceOfIncomeLimitError } from '../../_lib/listings.js';
import { isApprovedAgent } from '../../_lib/agents.js';
import { pauseListingForModeration } from '../../_lib/moderation.js';
import { notifyNewMatches } from '../../_lib/matchNotify.js';
import { snapshotListingForTrash } from '../../_lib/trash.js';
import { DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { logMarketEventUnlessDemo } from '../../_lib/marketEvents.js';
import { deleteR2Keys } from '../../_lib/r2Cleanup.js';
import { liveTools } from '../../_lib/nuancedGate.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { termsForEdit, creditTermsProblem } from '../../_lib/listingTerms.js';
import { endHeadStart } from '../../_lib/watchAreas.js';

async function loadListing(db, id) {
  return db.prepare(
    `SELECT listings.*, users.display_name AS owner_name, users.status AS owner_status,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min,
            desired_criteria.price_max, desired_criteria.must_haves, desired_criteria.cash_mode, desired_criteria.cash_amount
     FROM listings
     JOIN users ON users.id = listings.user_id
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.id = ?`
  ).bind(id).first();
}

export async function onRequestGet(context) {
  const id = context.params.id;
  const db = context.env.DB;
  const listing = await loadListing(db, id);
  if (!listing) return notFound('Listing not found.');
  // Sample listings from the demo aren't part of the live site.
  if (await db.prepare('SELECT 1 FROM users WHERE id = ? AND email LIKE ?').bind(listing.user_id, DEMO_EMAIL_PATTERN).first()) {
    return notFound('Listing not found.');
  }

  const viewer = await getSessionUser(context);
  const isOwnerOrAdmin = !!viewer && (viewer.id === listing.user_id || viewer.role === 'admin');
  // Same rule as the public /listing/:id page: a paused listing, or one whose owner is suspended, isn't shown to others.
  if (!isOwnerOrAdmin && (listing.status !== 'active' || listing.owner_status !== 'active')) {
    return notFound('Listing not found.');
  }

  const safe = { ...listing };
  delete safe.owner_status;
  if (!isOwnerOrAdmin) {
    // The exact street address stays with the owner (and admins), the same as the /listing/:id page:
    // "Reveal exact address once matched" never hands it to every visitor.
    delete safe.address;
    // Owner-side only: the client an agent listed this for, and view counts.
    delete safe.client_name;
    delete safe.views;
    // The floor plan the owner typed is public only once they tick "List my home with ... my floor plan".
    if (Number(listing.plan_twins) !== 1) {
      delete safe.plan_builder;
      delete safe.plan_name;
      delete safe.plan_community;
      delete safe.plan_key;
    }
    // Nuanced-ideas columns (migration_v47): the head start is the owner's; the financing flags, the price schedule
    // and the terms wish list go out only when that tool is live for this viewer (nuancedGate.js).
    const live = liveTools(context.env, viewer);
    delete safe.head_start_until;
    if (!live.ownerCarry) { delete safe.owner_carry; delete safe.assumable; }
    if (!live.stepDown) { delete safe.step_down_json; delete safe.step_next_at; }
    if (!live.termsWishlist) delete safe.terms_wishlist_json;
  }
  safe.external_links = parseJsonSafe(listing.external_links, []);
  // Why the owner is moving (optional) is shown only to the owner and their matches (functions/api/matches.js),
  // never to every visitor.
  delete safe.life_event_tags_json;
  if (isOwnerOrAdmin) safe.life_event_tags = parseJsonSafe(listing.life_event_tags_json, []);
  // The body differs per viewer (the owner gets the address), so no shared cache may keep it.
  return json({ listing: safe, isOwner: isOwnerOrAdmin }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, is_buyer_only, is_rental, is_portfolio, estimated_value, hidden_at, hidden_reason, title, neighborhood, owner_carry, assumable, step_down_json, head_start_until, zip FROM listings WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Listing not found.');
  if (existing.user_id !== user.id && user.role !== 'admin') return forbidden();

  // A bundled member is frozen while its portfolio exists — pausing or
  // reactivating it independently would leave the portfolio's own aggregate
  // (and the portfolio's place in the match graph) silently out of sync with
  // what it actually still contains.
  const bundled = await db.prepare('SELECT 1 FROM portfolio_members WHERE member_listing_id = ?').bind(id).first();
  if (bundled) return badRequest('This property is part of a portfolio — dissolve the portfolio to manage it individually.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  // Moderation: an admin can hide (pause) or show again, or remove, someone else's listing, but never change what
  // the owner wrote, so no admin can be said to have altered a listing.
  const isAdminOnOthers = existing.user_id !== user.id;
  if (isAdminOnOthers && (body.action === 'edit' || body.description !== undefined || !body.status)) {
    return forbidden("An admin can hide or remove someone else's listing, but not edit it.");
  }

  // Nuanced-ideas tools (nuancedGate.js) as they are for the person making the change.
  const live = liveTools(context.env, user);

  // Full edit: the client sends the whole create-shaped payload plus
  // action: 'edit'. A portfolio's membership can't be edited (dissolve and
  // re-bundle for that), only its "what would make you move" side.
  let stepDownStopped = false;
  let stepDownStoppedFor = '';
  if (body.action === 'edit') {
    if (existing.is_portfolio) {
      const result = await updatePortfolioCriteria(db, id, body);
      if (result.error) return badRequest(result.error);
    } else {
      const validated = validateListingEdit(!!existing.is_buyer_only, !!existing.is_rental, body);
      if (validated.error) return badRequest(validated.error);
      // Posting a home for a client (Client name) is for approved agents only (Rudy 11.05), on edit too.
      if (validated.data.clientName && !(await isApprovedAgent(db, user.id))) {
        return forbidden('Only approved agents can post a home for a client.');
      }
      // Terms (wish list, financing flags): only what the body sent and this person's live tools cover is written.
      const d = validated.data;
      if (d.terms !== undefined) d.terms = termsForEdit(body.terms, d.terms, live);
      // With a financing flag on (as saved now, or as this edit leaves it), the text can't state loan terms.
      const flagged = d.terms && d.terms.ownerCarry !== undefined ? (d.terms.ownerCarry || d.terms.assumable) : (existing.owner_carry || existing.assumable);
      if (live.ownerCarry && flagged) {
        const creditError = creditTermsProblem(`${d.title} ${d.neighborhood || ''} ${d.description}`);
        if (creditError) return badRequest(creditError);
      }
      // Changing the price by hand stops a running price schedule (stepDown.js): the owner's new number stands. So
      // does naming a client: a home posted for a client never carries a schedule.
      const hasSchedule = !!existing.step_down_json && existing.step_down_json !== '{}';
      const priceChanged = Number(d.estimatedValue) !== Number(existing.estimated_value);
      stepDownStopped = hasSchedule && (priceChanged || !!d.clientName);
      if (stepDownStopped) { d.clearStepDown = true; if (!priceChanged) stepDownStoppedFor = 'client'; }
      // Moving a listing to another ZIP changes which standing interest reaches its owner (standingInterest.js), so
      // it counts toward the same small budget as a home claim. Only while that tool is on for this person.
      if (live.standingOffer && existing.zip && d.zip !== undefined && (d.zip || '') !== existing.zip) {
        if (!(await claimUserAction(db, 'home_claim', user.id))) return rateLimited();
      }
      await updateListing(db, id, existing.user_id, validated.data);
      // A home still in its Neighbors First head start (watchAreas.js) isn't public yet: no Market Pulse event.
      if (!existing.is_buyer_only && !existing.head_start_until && Number(validated.data.estimatedValue) < Number(existing.estimated_value)) {
        const oldPrice = '$' + Number(existing.estimated_value).toLocaleString('en-US');
        const newPrice = '$' + Number(validated.data.estimatedValue).toLocaleString('en-US');
        context.waitUntil(logMarketEventUnlessDemo(context.env.DB, existing.user_id, {
          eventType: 'price_drop', entityKind: 'listing', entityId: id,
          city: validated.data.city, state: validated.data.state,
          headline: `Price drop in ${validated.data.city}, ${validated.data.state}: ${oldPrice} → ${newPrice}`,
          amount: validated.data.estimatedValue, delta: validated.data.estimatedValue - existing.estimated_value,
        }));
      }
    }
    // Backgrounded, same reasoning as creating a listing — an edit that
    // widens a price range or drops a beds/baths minimum can surface a wave
    // of new matches at once.
    context.waitUntil(notifyNewMatches(context, id));
    return json(stepDownStopped ? { ok: true, stepDownStopped: true, ...(stepDownStoppedFor ? { stepDownStoppedFor } : {}) } : { ok: true });
  }

  if (body.status && !['active', 'paused'].includes(body.status)) return badRequest('Invalid status.');

  // A listing an admin paused (moderation, hidden_at set) stays paused until an admin makes it active again.
  if (user.role !== 'admin' && body.status === 'active' && existing.hidden_at) {
    return json({ error: 'Paused by Amico Haus: ' + (existing.hidden_reason || 'a rules problem'), code: 'moderation_paused' }, { status: 403 });
  }
  // ...and an admin only undoes a moderation pause: a listing its owner paused themselves is theirs to reactivate.
  if (isAdminOnOthers && body.status === 'active' && !existing.hidden_at) {
    return json({ error: "This listing wasn't paused by Amico Haus. Its owner paused it, so only they can reactivate it.", code: 'owner_paused' }, { status: 403 });
  }

  // An admin pausing someone else's listing is a moderation pause: the same helper (and the same notice to the owner)
  // as pausing it from the report queue.
  if (isAdminOnOthers && body.status === 'paused') {
    await pauseListingForModeration(db, id, clampString(body.reason, 300) || existing.hidden_reason || 'Paused by an admin');
    await logAdminAction(db, user.id, 'hide_listing', 'listing', id);
    return json({ ok: true });
  }

  // A rental's description can't limit renters by source of income (California law), the same rule as a full edit.
  if (body.description !== undefined && existing.is_rental) {
    const sourceOfIncomeError = sourceOfIncomeLimitError(clampString(body.description, 2000));
    if (sourceOfIncomeError) return badRequest(sourceOfIncomeError);
  }
  // A listing with a financing flag can't state loan terms in its text, the same rule as a full edit.
  if (body.description !== undefined && live.ownerCarry && (existing.owner_carry || existing.assumable)) {
    const creditError = creditTermsProblem(`${existing.title || ''} ${existing.neighborhood || ''} ${clampString(body.description, 2000)}`);
    if (creditError) return badRequest(creditError);
  }

  const fields = [];
  const values = [];
  // Neighbors First head start (watchAreas.js): making the listing active opens it to everyone now, with the alerts a
  // new listing sends (in the background, like a create); pausing it ends the head start for good.
  let openedFromHeadStart = false;
  if (existing.head_start_until && body.status === 'active' && !existing.hidden_at) {
    openedFromHeadStart = true;
    context.waitUntil(Promise.resolve(endHeadStart(context, id)).catch(err => console.log(`[head start open failed] ${err.message}`)));
  }
  if (body.status && !openedFromHeadStart) {
    fields.push('status = ?'); values.push(body.status);
    if (existing.head_start_until) fields.push('head_start_until = NULL');
  }
  if (user.role === 'admin' && body.status === 'active') {
    fields.push('hidden_at = NULL', 'hidden_reason = NULL');
  }
  // (The old "reveal exact address once matched" switch is gone: a listing's street address is only ever shown to
  // its owner, so showExactAddress is no longer accepted here.)
  if (body.description !== undefined) { fields.push('description = ?'); values.push(clampString(body.description, 2000)); }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await db.prepare(`UPDATE listings SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    // An admin acting on someone else's content is on the admin activity log.
    if (isAdminOnOthers) await logAdminAction(db, user.id, 'unhide_listing', 'listing', id);
  }

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, is_portfolio FROM listings WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Listing not found.');
  if (existing.user_id !== user.id && user.role !== 'admin') return forbidden();

  // Deleting a bundled member out from under its portfolio would leave the
  // portfolio's aggregated value/beds/baths silently wrong — dissolve the
  // portfolio (which releases every member back to independent, deletable
  // listings) instead.
  const bundled = await db.prepare('SELECT 1 FROM portfolio_members WHERE member_listing_id = ?').bind(id).first();
  if (bundled) return badRequest('This property is part of a portfolio — dissolve the portfolio first to delete it individually.');

  // Deleting a portfolio just dissolves it: every bundled property is
  // released back to being its own independent, active listing rather than
  // being deleted itself — the properties still exist, only the bundle does not.
  // A portfolio never goes through the trash/undo path below since dissolving
  // is already non-destructive. An admin removing someone ELSE's listing
  // (moderation) also skips it — that's often for cause, and letting the
  // affected user self-restore would defeat the point. Only the trash keeps
  // the photos (for a restore); otherwise they're read here, before the rows
  // cascade away, and removed from storage once the listing is gone.
  const toTrash = !existing.is_portfolio && existing.user_id === user.id;
  let photoKeys = [];
  if (existing.is_portfolio) {
    await releasePortfolioMembers(db, id);
  } else if (toTrash) {
    await snapshotListingForTrash(db, id);
  }
  if (!toTrash) {
    photoKeys = (await db.prepare('SELECT r2_key FROM listing_photos WHERE listing_id = ?').bind(id).all()).results.map(r => r.r2_key);
  }

  await db.prepare('DELETE FROM listings WHERE id = ?').bind(id).run();
  await deleteR2Keys(context.env.PHOTOS, photoKeys);
  if (user.role === 'admin' && existing.user_id !== user.id) {
    await logAdminAction(db, user.id, 'delete_listing', 'listing', id);
  }
  return json({ ok: true });
}
