import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { validDisclosureKeys } from '../../../_lib/disclosures.js';

// Owner-only, regardless of status — unlike votes/proposals this is purely the homeowner's own private
// checklist, useful to keep ticking off even after the pre-listing is awarded or closed.
export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const checked = validDisclosureKeys(body.checked);
  await db.prepare("UPDATE pre_listings SET disclosure_checklist_json = ? WHERE id = ?").bind(JSON.stringify(checked), id).run();
  return json({ checked });
}
