import { getSessionUser } from '../../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

export async function onRequestDelete(context) {
  const { id: projectId, photoId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const project = await db.prepare('SELECT user_id FROM dev_projects WHERE id = ?').bind(projectId).first();
  if (!project) return notFound('Project not found.');
  if (project.user_id !== user.id && user.role !== 'admin') return forbidden();

  const photo = await db.prepare('SELECT r2_key FROM dev_project_photos WHERE id = ? AND dev_project_id = ?').bind(photoId, projectId).first();
  if (!photo) return notFound('Photo not found.');

  const bucket = context.env.PHOTOS;
  if (bucket) await bucket.delete(photo.r2_key);
  await db.prepare('DELETE FROM dev_project_photos WHERE id = ?').bind(photoId).run();

  return json({ ok: true });
}
