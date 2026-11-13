import { notFound } from '../../_lib/util.js';
import { mediaCacheControl } from '../../_lib/visibility.js';
import { getSessionUser } from '../../_lib/auth.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { inHeadStart, watcherMaySeeListing } from '../../_lib/watchAreas.js';

// Public while the listing is (active, and its owner's account is active: the same rule as the public /listing/:id
// page, so its thumbnail and og:image keep working) — listing photos aren't sensitive the way an exact street
// address is. A paused listing's or a suspended owner's photos go only to the owner and admins.
// One more case (Neighbors First, watchAreas.js): a listing in a live head start is stored paused, and a signed-in
// member who watches its ZIP (with no block either way with the owner) gets its photos too, never from a shared
// cache. Everyone else keeps the answer above.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT listing_photos.r2_key, listing_photos.content_type, listings.user_id, listings.status, users.status AS owner_status,
            listings.head_start_until, listings.zip, listings.hidden_at
     FROM listing_photos JOIN listings ON listings.id = listing_photos.listing_id JOIN users ON users.id = listings.user_id
     WHERE listing_photos.id = ?`
  ).bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');
  const isPublic = photo.status === 'active' && photo.owner_status === 'active';
  // A live, not-hidden head start of an active owner's listing: the one case a watcher can be let in.
  const earlyLook = !isPublic && photo.status === 'paused' && photo.owner_status === 'active' && !photo.hidden_at && inHeadStart(photo);
  let cacheControl;
  if (earlyLook) {
    // The session is read once here (the owner and admins as always, then a watcher of the ZIP: one more statement).
    const viewer = await getSessionUser(context);
    if (viewer && (viewer.id === photo.user_id || viewer.role === 'admin')) cacheControl = 'private, no-store';
    else if (viewer && toolLive(context.env, 'headStart', viewer) && await watcherMaySeeListing(db, viewer.id, photo)) cacheControl = 'private, no-store';
    else cacheControl = null;
  } else {
    cacheControl = await mediaCacheControl(context, isPublic, photo.user_id, 'public, max-age=31536000, immutable');
  }
  if (!cacheControl) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: {
      'Content-Type': photo.content_type,
      'Cache-Control': cacheControl,
    },
  });
}
