import { getSessionUser } from '../../../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../../../_lib/util.js';
import { toggleRsvp } from '../../../../../_lib/greenHomeOpenHouses.js';

export async function onRequestPost(context) {
  const { id: homeId, ohId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const openHouse = await db.prepare('SELECT id FROM green_home_open_houses WHERE id = ? AND green_home_id = ?').bind(ohId, homeId).first();
  if (!openHouse) return notFound('Open house not found.');

  const result = await toggleRsvp(db, ohId, user.id);
  return json(result);
}
