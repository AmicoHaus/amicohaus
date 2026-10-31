import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { acceptBid, withdrawBid, isAgentActive } from '../../../../_lib/marketplace.js';
import { notifyBidDecision } from '../../../../_lib/marketplaceNotify.js';
import { wrapUpSellerPrep } from '../../../../_lib/sellerPrepWrapUp.js';
import { proposalsSealed } from '../../../../_lib/decisionNight.js';

const OWNER_PICKS = { shortlist: 'shortlist', pass: 'pass', clear: null };

export async function onRequestPut(context) {
  const { id, bidId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const bid = await db.prepare('SELECT agent_user_id, status FROM service_bids WHERE id = ? AND request_type = ? AND request_id = ?')
    .bind(bidId, 'pre_listing', id).first();
  if (!bid) return notFound('Proposal not found.');

  if (body.action === 'withdraw') {
    if (bid.agent_user_id !== user.id) return forbidden();
    await withdrawBid(db, bidId, user.id);
    return json({ ok: true });
  }

  const preListing = await db.prepare('SELECT user_id, status, proposals_due_at FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();
  // Nothing can be decided on a proposal the owner can't see yet.
  if (proposalsSealed(preListing)) return badRequest('Your proposals open together on your Decision Night. You can decide then, or open them now.');

  if (body.action === 'accept') {
    if (preListing.status !== 'open') return badRequest('This pre-listing is no longer open.');
    if (bid.status !== 'pending') return badRequest('This proposal is no longer pending.');
    if (!(await isAgentActive(db, bid.agent_user_id))) return badRequest("This agent's account isn't active right now, so this proposal can't be accepted.");

    const declined = await acceptBid(db, 'pre_listing', id, bidId);
    context.waitUntil(notifyBidDecision(context, bid.agent_user_id, 'pre_listing', id, true));
    // Everyone else hears it was decided, rather than waiting on a proposal that's already closed.
    for (const agentId of declined) context.waitUntil(notifyBidDecision(context, agentId, 'pre_listing', id, false).catch(() => {}));
    await wrapUpSellerPrep(context, id, { keepAgentId: bid.agent_user_id });
    return json({ ok: true });
  }

  // The homeowner's private shortlist / pass from the pitch reels (agents never see it). Shortlisted agents are
  // listed first when choosing who to interview.
  if (Object.hasOwn(OWNER_PICKS, body.action)) {
    if (preListing.status !== 'open') return badRequest('This pre-listing is no longer open.');
    if (bid.status === 'withdrawn') return badRequest('This proposal was withdrawn.');
    await db.prepare('UPDATE service_bids SET owner_pick = ? WHERE id = ?').bind(OWNER_PICKS[body.action], bidId).run();
    return json({ ok: true, ownerPick: OWNER_PICKS[body.action] });
  }

  return badRequest('action must be "accept", "withdraw", "shortlist", "pass" or "clear".');
}
