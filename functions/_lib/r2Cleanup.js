// Removes stored files (photos, videos, decks) from R2 once the rows that point at them are gone, so nothing is left
// behind when a home, a listing or an account is deleted. Read the keys BEFORE the D1 delete (the cascade takes the
// rows with it), then call this after it. Never prefix-delete `listings/{id}/`: a listing restored from the trash
// reuses its old keys.

// The R2 binding deletes up to 1000 keys per call.
const R2_DELETE_BATCH = 1000;

// keys: any mix of strings, null and duplicates (nulls and duplicates are dropped). Best effort: a storage hiccup is
// logged and never throws, so it can't undo or block the delete that came before it. Returns how many keys it asked
// R2 to remove.
export async function deleteR2Keys(bucket, keys) {
  const unique = [...new Set((keys || []).filter(k => typeof k === 'string' && k !== ''))];
  if (!bucket || unique.length === 0) return 0;
  for (let i = 0; i < unique.length; i += R2_DELETE_BATCH) {
    const chunk = unique.slice(i, i + R2_DELETE_BATCH);
    try {
      // R2 takes one key or a list; a single key is sent as is.
      await bucket.delete(chunk.length === 1 ? chunk[0] : chunk);
      console.log(`[r2 cleanup] removed ${chunk.length} file(s)`);
    } catch (err) {
      console.log(`[r2 cleanup failed] ${chunk.length} key(s): ${err && err.message}`);
    }
  }
  return unique.length;
}
