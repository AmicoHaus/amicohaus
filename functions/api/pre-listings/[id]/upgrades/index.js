import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../../../_lib/util.js';
import { ownerHomeForWrite, validateUpgrade, NO_STORE, MAX_UPGRADES, UPGRADE_CAP_ERROR } from '../../../../_lib/thenNow.js';

// Then & Now: add one upgrade to the owner's dated list (owner only, no admins, while open or awarded).
// Body { category, doneYear, doneMonth?, note?, permit? }; nothing else is read (no cost, ever).
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const gate = await ownerHomeForWrite(db, id, user);
  if (gate.response) return gate.response;

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const checked = validateUpgrade(body);
  if (checked.error) return badRequest(checked.error);
  const u = checked.data;

  // Counted and added in one statement, so two saves at the same moment can't pass the cap.
  const result = await db.prepare(
    `INSERT INTO pre_listing_upgrades (pre_listing_id, category, done_year, done_month, note, permit, position)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, (SELECT COUNT(*) FROM pre_listing_upgrades WHERE pre_listing_id = ?1)
     WHERE (SELECT COUNT(*) FROM pre_listing_upgrades WHERE pre_listing_id = ?1) < ?7`
  ).bind(gate.row.id, u.category, u.doneYear, u.doneMonth, u.note, u.permit, MAX_UPGRADES).run();
  if (!result.meta || !result.meta.changes) return badRequest(UPGRADE_CAP_ERROR);
  return json({ id: result.meta.last_row_id }, { status: 201, ...NO_STORE });
}
