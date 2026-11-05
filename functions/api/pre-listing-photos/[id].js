import { getSessionUser } from '../../_lib/auth.js';
import { notFound, unauthorized } from '../../_lib/util.js';
import { preListingAccess } from '../../_lib/visibility.js';

// Unlike a regular listing's photos (public while the listing is, see functions/api/photos/[id].js), these show the
// inside of a home that hasn't been listed anywhere yet, and the ids are sequential: only someone who may open the
// pre-listing itself (the owner, admins, approved agents; see visibility.js) gets the file. Anyone else gets a 404.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT pre_listing_photos.r2_key, pre_listing_photos.content_type, pre_listings.id, pre_listings.user_id, pre_listings.status
     FROM pre_listing_photos JOIN pre_listings ON pre_listings.id = pre_listing_photos.pre_listing_id WHERE pre_listing_photos.id = ?`
  ).bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');
  const { access } = await preListingAccess(db, user, photo);
  if (access !== 'ok') return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private, max-age=3600' },
  });
}
