// Soft-delete/undo for listings. Portfolios deliberately never pass through
// here — dissolving one already preserves every bundled property as its own
// listing, so there's nothing destructive to protect against there. This is
// specifically for the truly irreversible case: deleting an actual property,
// buyer profile, or rental.
import { deleteR2Keys } from './r2Cleanup.js';

const TRASH_RETENTION_DAYS = 7;

export async function snapshotListingForTrash(db, id) {
  const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return;
  const desiredCriteria = await db.prepare('SELECT * FROM desired_criteria WHERE listing_id = ?').bind(id).first();
  // R2 objects aren't deleted when a listing goes to the trash (only the DB
  // rows cascade), so saving just the photo metadata is enough to fully
  // restore them later — the image bytes stay in the bucket until the trash
  // entry itself is purged (purgeTrashRows below).
  const photos = await db.prepare(
    'SELECT r2_key, content_type, position FROM listing_photos WHERE listing_id = ? ORDER BY position ASC'
  ).bind(id).all();

  const snapshot = { listing, desiredCriteria: desiredCriteria || null, photos: photos.results };
  await db.prepare('INSERT INTO deleted_listings (user_id, snapshot) VALUES (?, ?)').bind(listing.user_id, JSON.stringify(snapshot)).run();
}

// Removes trash entries for good, photos included: the snapshot's photo keys are read before the rows go, then
// deleted from storage. A key a live listing still uses is kept (a restore reuses the old keys, so never
// prefix-delete listings/{id}/). where: the SQL condition picking the rows, with its params.
async function purgeTrashRows(db, bucket, where, params) {
  const rows = await db.prepare(`SELECT id, snapshot FROM deleted_listings WHERE ${where}`).bind(...params).all();
  if (rows.results.length === 0) return;
  const keys = rows.results.flatMap(r => {
    try { return (JSON.parse(r.snapshot).photos || []).map(p => p.r2_key); } catch { return []; }
  });
  // By id, so a row can't slip past the key read (one that expired in between waits for the next purge).
  await db.prepare('DELETE FROM deleted_listings WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.results.map(r => r.id))).run();
  if (!bucket || keys.length === 0) return;
  const inUse = await db.prepare('SELECT r2_key FROM listing_photos WHERE r2_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all();
  const keep = new Set(inUse.results.map(r => r.r2_key));
  await deleteR2Keys(bucket, keys.filter(k => !keep.has(k)));
}

// bucket: the PHOTOS binding (context.env.PHOTOS).
export async function purgeExpiredTrash(db, bucket) {
  await purgeTrashRows(db, bucket, `deleted_at < datetime('now', '-${TRASH_RETENTION_DAYS} day')`, []);
}

// The lazy-jobs runner (functions/api/_middleware.js) passes the request context, so expired trash (with its address,
// client name and photos) goes even when its owner never opens the trash again.
export async function runPurgeExpiredTrash(context) {
  await purgeExpiredTrash(context.env.DB, context.env.PHOTOS);
}

export async function listTrash(db, userId, bucket) {
  await purgeExpiredTrash(db, bucket);
  const rows = await db.prepare(
    'SELECT id, snapshot, deleted_at FROM deleted_listings WHERE user_id = ? ORDER BY deleted_at DESC'
  ).bind(userId).all();
  return rows.results.map(r => {
    const snap = JSON.parse(r.snapshot);
    return {
      trashId: r.id, deletedAt: r.deleted_at,
      title: snap.listing.title, propertyType: snap.listing.property_type,
      city: snap.listing.city, state: snap.listing.state, estimatedValue: snap.listing.estimated_value,
      isBuyerOnly: !!snap.listing.is_buyer_only, isRental: !!snap.listing.is_rental,
      photoCount: snap.photos.length,
    };
  });
}

export async function restoreFromTrash(db, userId, trashId) {
  const row = await db.prepare('SELECT snapshot FROM deleted_listings WHERE id = ? AND user_id = ?').bind(trashId, userId).first();
  if (!row) return { error: "Nothing here to restore — it may already be gone." };
  const snap = JSON.parse(row.snapshot);
  const l = snap.listing;

  // The owner's costs, home facts, floor plan and moving reasons come back too (an older snapshot without them gets
  // the column defaults). So do the ZIP, the terms wish list, the two financing flags and the owner's bills, sizes
  // and signal notes (migration_v47). A price schedule and a head start are NOT restored: the listing comes back with
  // neither. 40 bound params, one statement.
  const result = await db.prepare(
    `INSERT INTO listings (user_id, title, description, address, neighborhood, client_name, city, state, property_type,
       beds, baths, sqft, estimated_value, price_tier, show_exact_address, external_links, is_buyer_only,
       is_rental, rent_amount, min_lease_months, is_portfolio, status, hidden_at, hidden_reason,
       life_event_tags_json, mello_roos_annual, hoa_monthly, hoa_details_json, home_facts_json,
       plan_builder, plan_name, plan_community, plan_key, plan_twins,
       zip, terms_wishlist_json, owner_carry, assumable, run_costs_json, fit_json, signal_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, l.title, l.description, l.address, l.neighborhood, l.client_name,
    l.city, l.state, l.property_type, l.beds, l.baths, l.sqft, l.estimated_value, l.price_tier,
    0, l.external_links, l.is_buyer_only, l.is_rental, l.rent_amount, l.min_lease_months, // 0: the reveal box is gone
    // A listing an admin paused (moderation) comes back still paused, so delete + restore can't undo the pause.
    l.hidden_at ? 'paused' : 'active', l.hidden_at || null, l.hidden_at ? (l.hidden_reason || null) : null,
    l.life_event_tags_json ?? '[]', l.mello_roos_annual ?? null, l.hoa_monthly ?? null, l.hoa_details_json ?? '{}',
    l.home_facts_json ?? '{}', l.plan_builder ?? null, l.plan_name ?? null, l.plan_community ?? null, l.plan_key ?? null,
    l.plan_twins ?? 0,
    l.zip ?? '', l.terms_wishlist_json ?? '[]', l.owner_carry ?? 0, l.assumable ?? 0,
    l.run_costs_json ?? '{}', l.fit_json ?? '{}', l.signal_json ?? '{}'
  ).run();
  const newId = result.meta.last_row_id;

  if (snap.desiredCriteria) {
    const d = snap.desiredCriteria;
    await db.prepare(
      `INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max, must_haves, cash_mode, cash_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId, d.locations, d.property_type, d.min_beds, d.min_baths, d.price_min, d.price_max, d.must_haves, d.cash_mode, d.cash_amount).run();
  }
  if (snap.photos.length > 0) {
    const stmts = snap.photos.map(p =>
      db.prepare('INSERT INTO listing_photos (listing_id, r2_key, content_type, position) VALUES (?, ?, ?, ?)')
        .bind(newId, p.r2_key, p.content_type, p.position)
    );
    await db.batch(stmts);
  }

  await db.prepare('DELETE FROM deleted_listings WHERE id = ?').bind(trashId).run();
  return { id: newId };
}

export async function purgeOneFromTrash(db, userId, trashId, bucket) {
  await purgeTrashRows(db, bucket, 'id = ? AND user_id = ?', [trashId, userId]);
}
