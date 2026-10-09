import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../_lib/util.js';
import { toggleFavorite } from '../../../_lib/devProjectFavorites.js';

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const project = await db.prepare('SELECT id FROM dev_projects WHERE id = ?').bind(id).first();
  if (!project) return notFound('Project not found.');

  const result = await toggleFavorite(db, user.id, id);
  return json(result);
}
