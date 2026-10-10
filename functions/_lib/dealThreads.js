// A "deal thread" is just a post that comments attach to, same as any feed post -- this file only finds or
// lazily creates that anchor post for a given listing/home/project, authored by the entity's owner. Everything
// else (posting a comment, liking, deleting, reporting) reuses the existing posts/comments API untouched.
const COLUMN_BY_KIND = {
  listing: 'listing_id',
  augmented_home: 'augmented_home_id',
  green_home: 'green_home_id',
  dev_project: 'dev_project_id',
};

export async function findOrCreateThreadPost(db, entityKind, entityId, ownerUserId) {
  const column = COLUMN_BY_KIND[entityKind];
  if (!column) throw new Error(`Unknown deal-thread entity kind: ${entityKind}`);

  const existing = await db.prepare(`SELECT id FROM posts WHERE ${column} = ? LIMIT 1`).bind(entityId).first();
  if (existing) return existing.id;

  const result = await db.prepare(`INSERT INTO posts (user_id, ${column}, body) VALUES (?, ?, '')`).bind(ownerUserId, entityId).run();
  return result.meta.last_row_id;
}

// Batch comment counts for a "💬 N" badge on list/browse cards -- never creates the anchor post (browsing a
// list shouldn't write anything), so an entity with no thread yet simply isn't in the returned map.
export async function fetchCommentCountBatch(db, entityKind, ids) {
  const map = new Map();
  const column = COLUMN_BY_KIND[entityKind];
  if (!column || !ids.length) return map;
  const rows = await db.prepare(
    `SELECT posts.${column} AS entity_id, COUNT(comments.id) AS n
     FROM posts JOIN comments ON comments.post_id = posts.id
     WHERE posts.${column} IN (${ids.map(() => '?').join(',')})
     GROUP BY posts.${column}`
  ).bind(...ids).all();
  for (const r of rows.results) map.set(r.entity_id, r.n);
  return map;
}
