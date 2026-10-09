import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../_lib/util.js';
import { toggleFavorite } from '../../../_lib/greenHomeFavorites.js';

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT id FROM green_homes WHERE id = ?').bind(id).first();
  if (!home) return notFound('Listing not found.');

  const result = await toggleFavorite(db, user.id, id);
  return json(result);
}
