import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { validListingReadyKeys, validTargetDate } from '../../../_lib/sellerPrep.js';

// The owner's private "get listing-ready" checklist and target list date. Owner-only and allowed in any status,
// like the disclosure checklist, since it stays useful after an agent is hired.
export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id, target_list_date FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const checked = validListingReadyKeys(body.checked);
  // Ticking items keeps working after listing day: only a changed date is checked.
  const target = (body.targetListDate || null) === preListing.target_list_date ? { value: preListing.target_list_date } : validTargetDate(body.targetListDate);
  if (target.error) return badRequest(target.error);
  await db.prepare('UPDATE pre_listings SET listing_ready_json = ?, target_list_date = ? WHERE id = ?')
    .bind(JSON.stringify(checked), target.value, id).run();
  return json({ checked, targetListDate: target.value });
}
