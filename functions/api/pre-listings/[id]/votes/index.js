import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { castPriceVote, getVoteTally, fetchMyVote, sealTally, priceIsOpen } from '../../../../_lib/preListings.js';
import { notifyNewVote, notifyNewPriceOpinion } from '../../../../_lib/marketplaceNotify.js';
import { isEitherBlocked } from '../../../../_lib/blocks.js';
import { claimUserAction, rateLimited } from '../../../../_lib/rateLimits.js';
import { preListingAccess, agentsOnly, ownerIsActive } from '../../../../_lib/visibility.js';

// Who gets the tally: the same people who can open the pre-listing (visibility.js preListingAccess). The owner and
// admins get it in full, unless the admin also competes as an approved agent (the operator account, Fair Play); an
// approved agent gets it sealed until they've voted (see sealTally). Never across a block (404, as if the home weren't
// there); nobody else.
export async function onRequestGet(context) {
  const viewer = await getSessionUser(context);
  if (!viewer) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const home = await db.prepare('SELECT id, user_id, status, zip, asking_price FROM pre_listings WHERE id = ?').bind(id).first();
  if (!home) return notFound('Pre-listing not found.');
  const { access, isOwner, isApprovedAgent: agentViewer } = await preListingAccess(db, viewer, home);
  if (access === 'agents_only') return agentsOnly();
  if (access === 'hidden') return notFound('Pre-listing not found.');
  const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
  const tally = await getVoteTally(db, id, home);
  if (!isOwner && agentViewer) {
    const mine = await fetchMyVote(db, id, viewer.id);
    if (!(mine && mine.vote)) return json({ votes: sealTally(tally) }, noStore);
  }
  return json({ votes: tally }, noStore);
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can vote on pricing.');

  const preListing = await db.prepare('SELECT user_id, status, asking_price FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing || !(await ownerIsActive(db, preListing.user_id)) || await isEitherBlocked(db, user.id, preListing.user_id)) return notFound('Pre-listing not found.');
  if (preListing.user_id === user.id) return forbidden("You can't vote on your own pre-listing.");
  if (preListing.status !== 'open') return badRequest('This pre-listing is closed, so it is no longer taking price votes.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  // No price yet: there's nothing to vote on, so the agent's suggested list price is the whole opinion, and the
  // owner hears about it once (the first time this agent shares one).
  const priceOpen = priceIsOpen(preListing.asking_price);
  const result = await castPriceVote(db, id, user.id, body, {
    priceOpen, beforeWrite: () => claimUserAction(db, 'price_vote', user.id, `pre_listing:${Number(id)}`),
  });
  if (result.rateLimited) return rateLimited();
  if (result.error) return badRequest(result.error);
  if (priceOpen) {
    if (result.opinionNew) context.waitUntil(notifyNewPriceOpinion(context, preListing.user_id, user.id, id));
  } else if (result.voteChanged) {
    context.waitUntil(notifyNewVote(context, id, preListing.user_id, user.id, body.vote));
  }
  return json({ ok: true });
}
