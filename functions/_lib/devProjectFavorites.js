// Bookmark a specific FinderMine project to revisit later -- distinct from expressing interest (a public
// signal the owner sees), this is a private saved-for-later list, same role as the other favorites tables.
export async function toggleFavorite(db, userId, projectId) {
  const existing = await db.prepare('SELECT id FROM dev_project_favorites WHERE user_id = ? AND dev_project_id = ?').bind(userId, projectId).first();
  if (existing) {
    await db.prepare('DELETE FROM dev_project_favorites WHERE id = ?').bind(existing.id).run();
    return { favorited: false };
  }
  await db.prepare('INSERT INTO dev_project_favorites (user_id, dev_project_id) VALUES (?, ?)').bind(userId, projectId).run();
  return { favorited: true };
}

export async function isFavorited(db, userId, projectId) {
  const row = await db.prepare('SELECT id FROM dev_project_favorites WHERE user_id = ? AND dev_project_id = ?').bind(userId, projectId).first();
  return !!row;
}

export async function fetchMyFavoriteProjectIds(db, userId) {
  const rows = await db.prepare('SELECT dev_project_id FROM dev_project_favorites WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all();
  return rows.results.map(r => r.dev_project_id);
}

// Batch favorite counts for a "X saved this" social-proof badge on list/browse cards.
export async function fetchFavoriteCountBatch(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await db.prepare(
    `SELECT dev_project_id, COUNT(*) AS n FROM dev_project_favorites WHERE dev_project_id IN (${ids.map(() => '?').join(',')}) GROUP BY dev_project_id`
  ).bind(...ids).all();
  for (const r of rows.results) map.set(r.dev_project_id, r.n);
  return map;
}
