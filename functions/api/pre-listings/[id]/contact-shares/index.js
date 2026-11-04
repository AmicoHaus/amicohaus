import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { SHARE_NOT_ENGAGED, isActiveApprovedAgent, hasEngagedWithPreListing, shareContact } from '../../../../_lib/addressViews.js';
import { notifyContactShared } from '../../../../_lib/marketplaceNotify.js';
import { releaseHeldMessages } from '../../../../_lib/contactPolicy.js';

// "Share my contact info with this agent": the owner picks one agent who has already sent them something for this
// home, and that agent then sees the exact address, phone number and email on the pre-listing. Owner only.
// Sharing again is fine (nothing changes, and the agent isn't told twice).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const preListing = await db.prepare('SELECT id, user_id, status, title, property_type, city FROM pre_listings WHERE id = ?').bind(context.params.id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();
  if (preListing.status !== 'open' && preListing.status !== 'awarded') return badRequest('This pre-listing is closed, so there is no one to share your contact info with here.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const agentId = Number(body.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0 || agentId === user.id) return badRequest(SHARE_NOT_ENGAGED);
  if (!(await isActiveApprovedAgent(db, agentId)) || !(await hasEngagedWithPreListing(db, preListing.id, agentId))) return badRequest(SHARE_NOT_ENGAGED);

  const share = await shareContact(db, preListing.id, user.id, agentId);
  // Sharing makes this agent exempt from the owner's contact dial, so a message of theirs still waiting for the
  // weekly delivery arrives now (the same as when the owner writes back).
  await releaseHeldMessages(db, user.id, { senderId: agentId });
  if (share.isNew) {
    const title = preListing.title || `their ${String(preListing.property_type || 'home').toLowerCase()} in ${preListing.city}`;
    context.waitUntil(Promise.resolve(notifyContactShared(context, agentId, user.display_name, preListing.id, title))
      .catch(err => console.log(`[contact share notify failed] ${err.message}`)));
  }
  return json({ ok: true, share: { agentId, sharedAt: share.sharedAt } });
}
