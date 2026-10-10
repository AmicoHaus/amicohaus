// Batch-fetches a compact price-history series per entity, for sparklines on list/browse cards. Reads from
// whichever source actually has granularity for that vertical: AugmentedHomes/GreenHomes already track every
// edit in their own price_history table (full history, not just from today); regular listings have no such
// table (none was ever built for them), so their series comes from market_events instead -- sparser since it
// only exists from when that table was created, but real, and it grows forward from here.
// Returns a Map<entityId, number[]> of HISTORICAL prices only, oldest first -- callers append the current
// price themselves as the final point, since they already have it in hand from their own row.
export async function fetchPriceSeriesBatch(db, kind, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');

  if (kind === 'augmented_home' || kind === 'green_home') {
    const table = kind === 'augmented_home' ? 'augmented_home_price_history' : 'green_home_price_history';
    const col = kind === 'augmented_home' ? 'augmented_home_id' : 'green_home_id';
    const rows = await db.prepare(
      `SELECT ${col} AS entity_id, old_price, new_price FROM ${table} WHERE ${col} IN (${placeholders}) ORDER BY changed_at ASC`
    ).bind(...ids).all();
    for (const r of rows.results) {
      if (!map.has(r.entity_id)) map.set(r.entity_id, [r.old_price]);
      map.get(r.entity_id).push(r.new_price);
    }
  } else if (kind === 'listing') {
    const rows = await db.prepare(
      `SELECT entity_id, amount FROM market_events WHERE entity_kind = 'listing' AND entity_id IN (${placeholders})
       AND event_type IN ('new_listing', 'price_drop') AND amount IS NOT NULL ORDER BY created_at ASC`
    ).bind(...ids).all();
    for (const r of rows.results) {
      if (!map.has(r.entity_id)) map.set(r.entity_id, []);
      map.get(r.entity_id).push(r.amount);
    }
  }
  return map;
}
