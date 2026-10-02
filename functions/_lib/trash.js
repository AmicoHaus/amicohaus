// Soft-delete/undo for listings. Portfolios deliberately never pass through
// here — dissolving one already preserves every bundled property as its own
// listing, so there's nothing destructive to protect against there. This is
// specifically for the truly irreversible case: deleting an actual property,
// buyer profile, or rental.
const TRASH_RETENTION_DAYS = 7;

export async function snapshotListingForTrash(db, id) {
  const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return;
  const desiredCriteria = await db.prepare('SELECT * FROM desired_criteria WHERE listing_id = ?').bind(id).first();
  // R2 objects are never deleted when a listing is (only the DB rows
  // cascade), so saving just the photo metadata is enough to fully restore
  // them later — the underlying image bytes are still sitting in the bucket.
  const photos = await db.prepare(
    'SELECT r2_key, content_type, position FROM listing_photos WHERE listing_id = ? ORDER BY position ASC'
  ).bind(id).all();

  const snapshot = { listing, desiredCriteria: desiredCriteria || null, photos: photos.results };
  await db.prepare('INSERT INTO deleted_listings (user_id, snapshot) VALUES (?, ?)').bind(listing.user_id, JSON.stringify(snapshot)).run();
}

export async function purgeExpiredTrash(db) {
  await db.prepare(`DELETE FROM deleted_listings WHERE deleted_at < datetime('now', '-${TRASH_RETENTION_DAYS} day')`).run();
}

export async function listTrash(db, userId) {
  await purgeExpiredTrash(db);
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

  const result = await db.prepare(
    `INSERT INTO listings (user_id, title, description, address, neighborhood, client_name, city, state, property_type,
       beds, baths, sqft, estimated_value, price_tier, show_exact_address, external_links, is_buyer_only,
       is_rental, rent_amount, min_lease_months, is_portfolio, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active')`
  ).bind(
    userId, l.title, l.description, l.address, l.neighborhood, l.client_name,
    l.city, l.state, l.property_type, l.beds, l.baths, l.sqft, l.estimated_value, l.price_tier,
    l.show_exact_address, l.external_links, l.is_buyer_only, l.is_rental, l.rent_amount, l.min_lease_months
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

export async function purgeOneFromTrash(db, userId, trashId) {
  await db.prepare('DELETE FROM deleted_listings WHERE id = ? AND user_id = ?').bind(trashId, userId).run();
}
