import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../../_lib/util.js';
import { insertCaseStudy } from '../../../_lib/caseStudies.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function validPhoto(file) {
  return file && typeof file !== 'string' && ALLOWED_TYPES.includes(file.type) && file.size <= MAX_PHOTO_BYTES;
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const agent = await db.prepare('SELECT 1 FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent) return badRequest('Apply to become an agent before adding case studies.');

  const bucket = context.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo storage is not configured yet.' }, { status: 503 });

  let form;
  try { form = await context.request.formData(); } catch { return badRequest('Expected a multipart form with "before" and "after" file fields.'); }

  const before = form.get('before');
  const after = form.get('after');
  if (!validPhoto(before) || !validPhoto(after)) {
    return badRequest('Both a before and after photo are required (JPEG, PNG, WEBP, or GIF, under 5MB each).');
  }

  const beforeKey = `agent-case-study/${user.id}/${crypto.randomUUID()}`;
  const afterKey = `agent-case-study/${user.id}/${crypto.randomUUID()}`;
  await bucket.put(beforeKey, await before.arrayBuffer(), { httpMetadata: { contentType: before.type } });
  await bucket.put(afterKey, await after.arrayBuffer(), { httpMetadata: { contentType: after.type } });

  const result = await insertCaseStudy(db, user.id, {
    title: String(form.get('title') || ''), resultNote: String(form.get('resultNote') || ''),
    beforeKey, beforeContentType: before.type, afterKey, afterContentType: after.type,
  });
  if (result.error) {
    await bucket.delete(beforeKey);
    await bucket.delete(afterKey);
    return badRequest(result.error);
  }
  return json({ id: result.id }, { status: 201 });
}
