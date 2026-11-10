import { getSessionUser } from '../../../../../_lib/auth.js';
import { logAdminAction } from '../../../../../_lib/audit.js';
import { scrubImageMetadata } from '../../../../../_lib/imageMetadata.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../../_lib/util.js';
import { mysteryState, MAX_MYSTERY_PHOTOS } from '../../../../../_lib/mysteryHomes.js';

// Add a photo to a Mystery Home (admin only). The admin page sends it through Privacy Sweep first; `swept` = '1' when
// "I checked this photo" was ticked. Location and camera data are scrubbed before it's stored. Same types and size
// limit as pre-listing photos. A home that is public (live or revealed) or retired can't change its photos; a
// scheduled one only takes swept photos (every photo must be swept before it goes public).
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  const id = Number(context.params.id);
  const db = context.env.DB;
  const home = Number.isInteger(id) && id > 0 ? await db.prepare('SELECT * FROM mystery_homes WHERE id = ?').bind(id).first() : null;
  if (!home) return notFound('Mystery Home not found.');
  const state = mysteryState(home, new Date().toISOString());
  if (state === 'live' || state === 'revealed') return json({ error: 'This Mystery Home is public now, so its photos stay as they are.', code: 'live' }, { status: 409, ...NO_STORE });
  if (state === 'retired') return json({ error: 'This Mystery Home is retired.', code: 'retired' }, { status: 409, ...NO_STORE });

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });
  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM mystery_home_photos WHERE mystery_home_id = ?').bind(id).first();
  if (countRow.n >= MAX_MYSTERY_PHOTOS) return badRequest(`A Mystery Home can have at most ${MAX_MYSTERY_PHOTOS} photos.`);

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }
  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photos must be JPEG, PNG, WEBP, or GIF.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');
  const swept = form.get('swept') === '1';
  if (home.status === 'scheduled' && !swept) return json({ error: 'Not ready to schedule yet.', code: 'not_ready', missing: ['sweep'] }, { status: 409, ...NO_STORE });

  const key = `mystery/${id}/${crypto.randomUUID()}`;
  await bucket.put(key, scrubImageMetadata(await file.arrayBuffer(), file.type), { httpMetadata: { contentType: file.type } });
  let result;
  try {
    result = await db.prepare(
      `INSERT INTO mystery_home_photos (mystery_home_id, r2_key, content_type, position, swept_at) VALUES (?, ?, ?, ?, ${swept ? "datetime('now')" : 'NULL'})`
    ).bind(id, key, file.type, countRow.n).run();
  } catch (err) {
    await bucket.delete(key);
    throw err;
  }
  const photoId = result.meta.last_row_id;
  await logAdminAction(db, user.id, 'add_mystery_home_photo', 'mystery_home', id, { photoId, swept });
  return json({ id: photoId }, { status: 201, ...NO_STORE });
}
