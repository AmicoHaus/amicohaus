import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../_lib/util.js';
import { findOrCreateThreadPost } from '../../../_lib/dealThreads.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const project = await db.prepare('SELECT user_id FROM dev_projects WHERE id = ?').bind(id).first();
  if (!project) return notFound('Project not found.');

  const postId = await findOrCreateThreadPost(db, 'dev_project', id, project.user_id);
  return json({ postId });
}
