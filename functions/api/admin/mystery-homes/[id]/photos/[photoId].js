import { getSessionUser } from '../../../../../_lib/auth.js';
import { logAdminAction } from '../../../../../_lib/audit.js';
import { deleteR2Keys } from '../../../../../_lib/r2Cleanup.js';
import { json, unauthorized, forbidden, notFound } from '../../../../../_lib/util.js';
import { mysteryState, MIN_MYSTERY_PHOTOS } from '../../../../../_lib/mysteryHomes.js';

// Remove one photo from a Mystery Home (admin only). Scoped to the home in the path. Not while the home is public; a
// scheduled home has to keep at least 3 photos (unschedule it first to go lower).
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  const id = Number(context.params.id);
  const db = context.env.DB;
  const home = Number.isInteger(id) && id > 0 ? await db.prepare('SELECT * FROM mystery_homes WHERE id = ?').bind(id).first() : null;
  if (!home) return notFound('Mystery Home not found.');
  const photo = await db.prepare('SELECT id, r2_key FROM mystery_home_photos WHERE id = ? AND mystery_home_id = ?').bind(context.params.photoId, id).first();
  if (!photo) return notFound('Photo not found.');
  const state = mysteryState(home, new Date().toISOString());
  if (state === 'live' || state === 'revealed') return json({ error: 'This Mystery Home is public now, so its photos stay as they are.', code: 'live' }, { status: 409, ...NO_STORE });
  if (home.status === 'scheduled') {
    const n = (await db.prepare('SELECT COUNT(*) AS n FROM mystery_home_photos WHERE mystery_home_id = ?').bind(id).first()).n;
    if (n - 1 < MIN_MYSTERY_PHOTOS) return json({ error: 'Not ready to schedule yet.', code: 'not_ready', missing: ['photos'] }, { status: 409, ...NO_STORE });
  }
  await db.prepare('DELETE FROM mystery_home_photos WHERE id = ? AND mystery_home_id = ?').bind(photo.id, id).run();
  await deleteR2Keys(context.env.PHOTOS, [photo.r2_key]);
  await logAdminAction(db, user.id, 'delete_mystery_home_photo', 'mystery_home', id, { photoId: photo.id });
  return json({ ok: true }, NO_STORE);
}
