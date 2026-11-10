import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../../../_lib/util.js';
import { ownerHomeForWrite, validateUpgrade, NO_STORE } from '../../../../_lib/thenNow.js';

// Then & Now: change or remove one upgrade on the owner's list (owner only, no admins). Changes need the home open
// or awarded; removing works on a closed home too (taking something down is always allowed). A photo pair linked to
// a removed upgrade stays, unlinked (ON DELETE SET NULL).
export async function onRequestPut(context) {
  const { id, upgradeId } = context.params;
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

  const result = await db.prepare(
    `UPDATE pre_listing_upgrades SET category = ?, done_year = ?, done_month = ?, note = ?, permit = ?, updated_at = datetime('now')
     WHERE id = ? AND pre_listing_id = ?`
  ).bind(u.category, u.doneYear, u.doneMonth, u.note, u.permit, upgradeId, gate.row.id).run();
  if (!result.meta || !result.meta.changes) return notFound('Upgrade not found.');
  return json({ ok: true }, NO_STORE);
}

export async function onRequestDelete(context) {
  const { id, upgradeId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const gate = await ownerHomeForWrite(db, id, user, { allowClosed: true });
  if (gate.response) return gate.response;

  const result = await db.prepare('DELETE FROM pre_listing_upgrades WHERE id = ? AND pre_listing_id = ?').bind(upgradeId, gate.row.id).run();
  if (!result.meta || !result.meta.changes) return notFound('Upgrade not found.');
  return json({ ok: true }, NO_STORE);
}
