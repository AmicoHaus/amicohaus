import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized, notFound } from '../../_lib/util.js';

// Sign-in only, like the FinderMine project pages (Rudy 11.04): a photo of an open project by an active poster, or
// any of the poster's own photos for them and for admins. Never stored by a shared cache.
export async function onRequestGet(context) {
  const viewer = await getSessionUser(context);
  if (!viewer) return unauthorized();
  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT dev_project_photos.r2_key, dev_project_photos.content_type, dev_projects.user_id, dev_projects.status, users.status AS owner_status
     FROM dev_project_photos JOIN dev_projects ON dev_projects.id = dev_project_photos.dev_project_id
     JOIN users ON users.id = dev_projects.user_id
     WHERE dev_project_photos.id = ?`
  ).bind(context.params.id).first();
  if (!photo) return notFound('Photo not found.');
  const ownerOrAdmin = viewer.id === photo.user_id || viewer.role === 'admin';
  if (!ownerOrAdmin && (photo.status !== 'open' || photo.owner_status !== 'active')) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');

  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');

  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': ownerOrAdmin ? 'private, no-store' : 'private, max-age=3600' },
  });
}
