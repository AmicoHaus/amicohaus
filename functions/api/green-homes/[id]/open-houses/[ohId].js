import { getSessionUser } from '../../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';

export async function onRequestDelete(context) {
  const { id: homeId, ohId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const home = await db.prepare('SELECT user_id FROM green_homes WHERE id = ?').bind(homeId).first();
  if (!home) return notFound('Listing not found.');
  if (home.user_id !== user.id) return forbidden();

  await db.prepare('DELETE FROM green_home_open_houses WHERE id = ? AND green_home_id = ?').bind(ohId, homeId).run();
  return json({ ok: true });
}
