import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../../_lib/util.js';

const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT status FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent) return badRequest('Apply to become an agent before adding portfolio photos.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM agent_portfolio_photos WHERE agent_user_id = ?').bind(user.id).first();
  if (countRow.n >= MAX_PHOTOS) return badRequest(`You can have at most ${MAX_PHOTOS} portfolio photos.`);

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with a "photo" file field.'); }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return badRequest('No photo file provided.');
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Photos must be JPEG, PNG, WEBP, or GIF.');
  if (file.size > MAX_PHOTO_BYTES) return badRequest('Photo must be under 5MB.');

  const caption = String(form.get('caption') || '').trim().slice(0, 200);
  const key = `agent-portfolio/${user.id}/${crypto.randomUUID()}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const result = await db.prepare(
    'INSERT INTO agent_portfolio_photos (agent_user_id, r2_key, content_type, caption, position) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, key, file.type, caption, countRow.n).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
