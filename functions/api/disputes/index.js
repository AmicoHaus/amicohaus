import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchMyDisputes } from '../../_lib/disputes.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const disputes = await fetchMyDisputes(context.env.DB, user.id);
  return json({ disputes });
}
