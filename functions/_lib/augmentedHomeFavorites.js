// Bookmark a specific AugmentedHomes listing to revisit later -- distinct from an accessibility-needs-alert
// (a saved search), this is a saved listing. Also doubles as the subscriber list for price-drop notifications.
export async function toggleFavorite(db, userId, homeId) {
  const existing = await db.prepare('SELECT id FROM augmented_home_favorites WHERE user_id = ? AND augmented_home_id = ?').bind(userId, homeId).first();
  if (existing) {
    await db.prepare('DELETE FROM augmented_home_favorites WHERE id = ?').bind(existing.id).run();
    return { favorited: false };
  }
  await db.prepare('INSERT INTO augmented_home_favorites (user_id, augmented_home_id) VALUES (?, ?)').bind(userId, homeId).run();
  return { favorited: true };
}

export async function isFavorited(db, userId, homeId) {
  const row = await db.prepare('SELECT id FROM augmented_home_favorites WHERE user_id = ? AND augmented_home_id = ?').bind(userId, homeId).first();
  return !!row;
}

export async function fetchFavoriterIds(db, homeId) {
  const rows = await db.prepare('SELECT user_id FROM augmented_home_favorites WHERE augmented_home_id = ?').bind(homeId).all();
  return rows.results.map(r => r.user_id);
}

export async function fetchMyFavoriteHomeIds(db, userId) {
  const rows = await db.prepare('SELECT augmented_home_id FROM augmented_home_favorites WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all();
  return rows.results.map(r => r.augmented_home_id);
}

// Batch favorite counts for a "X saved this" social-proof badge on list/browse cards.
export async function fetchFavoriteCountBatch(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await db.prepare(
    `SELECT augmented_home_id, COUNT(*) AS n FROM augmented_home_favorites WHERE augmented_home_id IN (${ids.map(() => '?').join(',')}) GROUP BY augmented_home_id`
  ).bind(...ids).all();
  for (const r of rows.results) map.set(r.augmented_home_id, r.n);
  return map;
}
