import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { stopSharingContact } from '../../../../_lib/addressViews.js';

// "Stop sharing": the agent no longer sees the address, phone and email on this pre-listing (they may have noted
// them already; the owner's copy says so). Owner only, in any status. The "Who saw my address" record stays.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const preListing = await db.prepare('SELECT id, user_id FROM pre_listings WHERE id = ?').bind(context.params.id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();
  const agentId = Number(context.params.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) return badRequest('Pick an agent.');

  await stopSharingContact(db, preListing.id, agentId);
  return json({ ok: true });
}
