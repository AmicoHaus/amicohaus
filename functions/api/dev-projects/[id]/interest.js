import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../_lib/util.js';
import { toggleInterest } from '../../../_lib/devProjects.js';
import { notifyNewProjectInterest } from '../../../_lib/marketplaceNotify.js';

// Toggles the signed-in user's "I'm interested" flag on a project. Posting
// your own project back to yourself is just a no-op from the owner's own
// list, not an error — there's nothing meaningfully wrong with it, so this
// doesn't special-case it the way messaging-yourself does.
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const project = await db.prepare('SELECT user_id FROM dev_projects WHERE id = ?').bind(id).first();
  if (!project) return notFound('Project not found.');

  let body = {};
  try { body = await context.request.json(); } catch {}

  const result = await toggleInterest(db, id, user.id, body.note || '');
  if (result.interested && project.user_id !== user.id) {
    context.waitUntil(notifyNewProjectInterest(context, id, project.user_id, user.id));
  }
  return json(result);
}
