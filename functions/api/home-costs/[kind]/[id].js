import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { HOME_KINDS, validateHomeCosts } from '../../../_lib/homeCosts.js';

// Saves the Mello-Roos / HOA snapshot on one of the owner's own homes. The create and edit forms of all four kinds
// call this right after saving the home itself, the same way they upload photos afterwards.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const table = Object.hasOwn(HOME_KINDS, context.params.kind) ? HOME_KINDS[context.params.kind] : null;
  if (!table) return notFound('Unknown kind of home.');

  const db = context.env.DB;
  const home = await db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).bind(context.params.id).first();
  if (!home) return notFound('Home not found.');
  if (home.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateHomeCosts(body);
  if (validated.error) return badRequest(validated.error);
  const d = validated.data;
  await db.prepare(`UPDATE ${table} SET mello_roos_annual = ?, hoa_monthly = ?, hoa_details_json = ? WHERE id = ?`)
    .bind(d.melloRoosAnnual, d.hoaMonthly, JSON.stringify(d.hoaDetails), context.params.id).run();
  return json({ ok: true, costs: d });
}
