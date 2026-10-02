import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { upsertBid } from '../../../../_lib/marketplace.js';
import { notifyNewBid } from '../../../../_lib/marketplaceNotify.js';

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can submit proposals.');

  const preListing = await db.prepare('SELECT user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id === user.id) return forbidden("You can't bid on your own pre-listing.");
  if (preListing.status !== 'open') return badRequest('This pre-listing is no longer open for proposals.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await upsertBid(db, 'pre_listing', id, user.id, body);
  if (result.error) return badRequest(result.error);

  context.waitUntil(notifyNewBid(context, 'pre_listing', id, preListing.user_id, user.id));
  return json({ ok: true }, { status: 201 });
}
