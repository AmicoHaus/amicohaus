import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { castPriceVote, getVoteTally, fetchMyVote, sealTally } from '../../../../_lib/preListings.js';
import { notifyNewVote } from '../../../../_lib/marketplaceNotify.js';

export async function onRequestGet(context) {
  const viewer = await getSessionUser(context);
  if (!viewer) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const tally = await getVoteTally(db, id);
  // Sealed until this agent has voted (see sealTally).
  const owner = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  const isOtherAgent = owner && owner.user_id !== viewer.id && (await isApprovedAgent(db, viewer.id));
  if (isOtherAgent) {
    const mine = await fetchMyVote(db, id, viewer.id);
    if (!(mine && mine.vote)) return json({ votes: sealTally(tally) });
  }
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
  if (result.voteChanged) context.waitUntil(notifyNewVote(context, id, preListing.user_id, user.id, body.vote));
  return json({ ok: true });
}
