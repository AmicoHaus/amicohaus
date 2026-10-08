import { getSessionUser } from '../../../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../../../_lib/util.js';
import { toggleRsvp } from '../../../../../_lib/openHouses.js';

export async function onRequestPost(context) {
  const { id: listingId, ohId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const openHouse = await db.prepare('SELECT id FROM open_houses WHERE id = ? AND listing_id = ?').bind(ohId, listingId).first();
  if (!openHouse) return notFound('Open house not found.');

  const result = await toggleRsvp(db, ohId, user.id);
  return json(result);
}
