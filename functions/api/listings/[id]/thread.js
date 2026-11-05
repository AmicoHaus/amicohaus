import { json, notFound } from '../../../_lib/util.js';
import { findOrCreateThreadPost } from '../../../_lib/dealThreads.js';

// Returns the deal-thread's anchor post id (creating it on first use), so the frontend can then read/write
// comments on it through the existing /api/posts/{id}/comments endpoints -- no new comment logic needed.
// Reading the comments (and posting one) requires sign-in, the same as the discussion on the listing page.
export async function onRequestGet(context) {
  const id = context.params.id;
  const db = context.env.DB;
  const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return notFound('Listing not found.');

  const postId = await findOrCreateThreadPost(db, 'listing', id, listing.user_id);
  return json({ postId });
}
