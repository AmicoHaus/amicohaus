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
