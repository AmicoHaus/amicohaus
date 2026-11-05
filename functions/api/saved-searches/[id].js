import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../_lib/util.js';

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound('Saved search not found.');
  const db = context.env.DB;
  const search = await db.prepare('SELECT user_id FROM saved_searches WHERE id = ?').bind(id).first();
  if (!search) return notFound('Saved search not found.');
  if (search.user_id !== user.id) return forbidden();

  await db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return json({ ok: true });
}
