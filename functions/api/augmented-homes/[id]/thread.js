import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../_lib/util.js';
import { findOrCreateThreadPost } from '../../../_lib/dealThreads.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM augmented_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');

  const postId = await findOrCreateThreadPost(db, 'augmented_home', id, home.user_id);
  return json({ postId });
}
