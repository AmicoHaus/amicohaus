// Bookmark a specific GreenHomes listing to revisit later -- distinct from a green-needs-alert (a saved
// search), this is a saved listing. Also doubles as the subscriber list for price-drop notifications.
export async function toggleFavorite(db, userId, homeId) {
  const existing = await db.prepare('SELECT id FROM green_home_favorites WHERE user_id = ? AND green_home_id = ?').bind(userId, homeId).first();
  if (existing) {
    await db.prepare('DELETE FROM green_home_favorites WHERE id = ?').bind(existing.id).run();
    return { favorited: false };
  }
  await db.prepare('INSERT INTO green_home_favorites (user_id, green_home_id) VALUES (?, ?)').bind(userId, homeId).run();
  return { favorited: true };
}

export async function isFavorited(db, userId, homeId) {
  const row = await db.prepare('SELECT id FROM green_home_favorites WHERE user_id = ? AND green_home_id = ?').bind(userId, homeId).first();
  return !!row;
}

export async function fetchFavoriterIds(db, homeId) {
  const rows = await db.prepare('SELECT user_id FROM green_home_favorites WHERE green_home_id = ?').bind(homeId).all();
  return rows.results.map(r => r.user_id);
}

export async function fetchMyFavoriteHomeIds(db, userId) {
  const rows = await db.prepare('SELECT green_home_id FROM green_home_favorites WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all();
  return rows.results.map(r => r.green_home_id);
}
