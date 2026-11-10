import { getSessionUser } from '../../_lib/auth.js';
import { notFound } from '../../_lib/util.js';
import { mysteryState } from '../../_lib/mysteryHomes.js';

// A Mystery Home photo. Public (cached 5 minutes) only while its home is live or revealed. A draft, scheduled or
// retired home's photos are for an admin's preview only (private, no-store); everyone else gets a 404. This is the
// only Mystery Home route that reads the session, and only for a home that isn't public.
export async function onRequestGet(context) {
  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound('Photo not found.');
  const db = context.env.DB;
  const photo = await db.prepare(
    `SELECT mystery_home_photos.r2_key, mystery_home_photos.content_type, mystery_homes.status, mystery_homes.publish_at,
            mystery_homes.reveal_at, mystery_homes.retire_at
     FROM mystery_home_photos JOIN mystery_homes ON mystery_homes.id = mystery_home_photos.mystery_home_id
     WHERE mystery_home_photos.id = ?`
  ).bind(id).first();
  if (!photo) return notFound('Photo not found.');
  const state = mysteryState(photo, new Date().toISOString());
  const isPublic = state === 'live' || state === 'revealed';
  if (!isPublic) {
    const user = await getSessionUser(context);
    if (!user || user.role !== 'admin') return notFound('Photo not found.');
  }
  const bucket = context.env.PHOTOS;
  if (!bucket) return notFound('Photo storage is not configured.');
  const object = await bucket.get(photo.r2_key);
  if (!object) return notFound('Photo not found.');
  return new Response(object.body, {
    headers: { 'Content-Type': photo.content_type, 'Cache-Control': isPublic ? 'public, max-age=300' : 'private, no-store' },
  });
}
