// Photo ids for a whole page of browse cards in one query per chunk, instead of one query per card.
// Chunked because D1 caps the number of bound parameters in a single query.
const PHOTO_TABLES = {
  augmented_home: { table: 'augmented_home_photos', fk: 'augmented_home_id' },
  green_home: { table: 'green_home_photos', fk: 'green_home_id' },
  dev_project: { table: 'dev_project_photos', fk: 'dev_project_id' },
};
const CHUNK = 90;

// Returns Map<entityId, photoId[]>, each list in display order (position, then upload order).
export async function fetchPhotoIdsBatch(db, kind, ids) {
  const map = new Map();
  const c = PHOTO_TABLES[kind];
  if (!c || !ids.length) return map;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await db.prepare(
      `SELECT id, ${c.fk} AS entity_id FROM ${c.table} WHERE ${c.fk} IN (${chunk.map(() => '?').join(',')}) ORDER BY position ASC, id ASC`
    ).bind(...chunk).all();
    for (const r of rows.results) {
      if (!map.has(r.entity_id)) map.set(r.entity_id, []);
      map.get(r.entity_id).push(r.id);
    }
  }
  return map;
}
