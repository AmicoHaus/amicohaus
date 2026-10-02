import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString, parseJsonSafe } from '../../_lib/util.js';
import { logAdminAction } from '../../_lib/audit.js';
import { releasePortfolioMembers, updatePortfolioCriteria } from '../../_lib/portfolios.js';
import { validateListingEdit, updateListing } from '../../_lib/listings.js';
import { notifyNewMatches } from '../../_lib/matchNotify.js';
import { snapshotListingForTrash } from '../../_lib/trash.js';
import { DEMO_EMAIL_PATTERN } from '../../_lib/util.js';

async function loadListing(db, id) {
  return db.prepare(
    `SELECT listings.*, users.display_name AS owner_name,
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
  const isOwnerOrAdmin = viewer && (viewer.id === listing.user_id || viewer.role === 'admin');

  const safe = { ...listing };
  if (!isOwnerOrAdmin) {
    if (!safe.show_exact_address) delete safe.address;
    // Owner-side only: the client an agent listed this for, and view counts.
    delete safe.client_name;
    delete safe.views;
  }
  safe.external_links = parseJsonSafe(listing.external_links, []);
  return json({ listing: safe, isOwner: isOwnerOrAdmin });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, is_buyer_only, is_rental, is_portfolio FROM listings WHERE id = ?').bind(id).first();
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

  // Full edit: the client sends the whole create-shaped payload plus
  // action: 'edit'. A portfolio's membership can't be edited (dissolve and
  // re-bundle for that), only its "what would make you move" side.
  if (body.action === 'edit') {
    if (existing.is_portfolio) {
      const result = await updatePortfolioCriteria(db, id, body);
      if (result.error) return badRequest(result.error);
    } else {
      const validated = validateListingEdit(!!existing.is_buyer_only, !!existing.is_rental, body);
      if (validated.error) return badRequest(validated.error);
      await updateListing(db, id, existing.user_id, validated.data);
    }
    // Backgrounded, same reasoning as creating a listing — an edit that
    // widens a price range or drops a beds/baths minimum can surface a wave
    // of new matches at once.
    context.waitUntil(notifyNewMatches(context, id));
    return json({ ok: true });
  }

  if (body.status && !['active', 'paused'].includes(body.status)) return badRequest('Invalid status.');

  const fields = [];
  const values = [];
  if (body.status) { fields.push('status = ?'); values.push(body.status); }
  if (typeof body.showExactAddress === 'boolean') { fields.push('show_exact_address = ?'); values.push(body.showExactAddress ? 1 : 0); }
  if (body.description !== undefined) { fields.push('description = ?'); values.push(clampString(body.description, 2000)); }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await db.prepare(`UPDATE listings SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
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
  // affected user self-restore would defeat the point.
  if (existing.is_portfolio) {
    await releasePortfolioMembers(db, id);
  } else if (existing.user_id === user.id) {
    await snapshotListingForTrash(db, id);
  }

  await db.prepare('DELETE FROM listings WHERE id = ?').bind(id).run();
  if (user.role === 'admin' && existing.user_id !== user.id) {
    await logAdminAction(db, user.id, 'delete_listing', 'listing', id);
  }
  return json({ ok: true });
}
