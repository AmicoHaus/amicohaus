import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { decideShowing, cancelShowing } from '../../../../_lib/showings.js';
import { notifyShowingDecision } from '../../../../_lib/marketplaceNotify.js';

// action: 'accept' | 'decline' (the owner only) or 'cancel' (the requesting agent only, while still pending).
export async function onRequestPut(context) {
  const { id, showingId } = context.params;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  const showing = await db.prepare('SELECT * FROM pre_listing_showings WHERE id = ? AND pre_listing_id = ?').bind(showingId, id).first();
  if (!showing) return notFound('Showing request not found.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  if (body.action === 'cancel') {
    if (showing.agent_user_id !== user.id) return forbidden();
    if (showing.status !== 'pending') return badRequest('Only a pending request can be canceled.');
    await cancelShowing(db, showingId);
    return json({ ok: true });
  }

  if (body.action === 'accept' || body.action === 'decline') {
    if (preListing.user_id !== user.id) return forbidden();
    if (showing.status !== 'pending') return badRequest('This request was already decided.');
    const accepted = body.action === 'accept';
    await decideShowing(db, showingId, accepted);
    context.waitUntil(notifyShowingDecision(context, id, showing.agent_user_id, accepted, showing.proposed_at));
    return json({ ok: true });
  }

  return badRequest('Unknown action.');
}
