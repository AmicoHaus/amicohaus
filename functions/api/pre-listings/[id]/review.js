import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { canReview, submitReview } from '../../../_lib/marketplace.js';

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT awarded_bid_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (!preListing.awarded_bid_id) return badRequest('This pre-listing has no awarded agent to review yet.');

  const bid = await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(preListing.awarded_bid_id).first();
  if (!(await canReview(db, 'pre_listing', id, user.id, bid.agent_user_id))) return forbidden("You can only review the agent awarded on your own pre-listing.");

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await submitReview(db, bid.agent_user_id, user.id, 'pre_listing', id, body);
  if (result.error) return badRequest(result.error);
  return json({ ok: true }, { status: 201 });
}
