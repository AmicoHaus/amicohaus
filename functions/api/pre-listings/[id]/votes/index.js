import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { castPriceVote, getVoteTally } from '../../../../_lib/preListings.js';

export async function onRequestGet(context) {
  const viewer = await getSessionUser(context);
  if (!viewer) return unauthorized();
  const tally = await getVoteTally(context.env.DB, context.params.id);
  return json({ votes: tally });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can vote on pricing.');

  const preListing = await db.prepare('SELECT user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id === user.id) return forbidden("You can't vote on your own pre-listing.");
  if (preListing.status !== 'open') return badRequest('This pre-listing is closed, so it is no longer taking price votes.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await castPriceVote(db, id, user.id, body);
  if (result.error) return badRequest(result.error);
  return json({ ok: true });
}
