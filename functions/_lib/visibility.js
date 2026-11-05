// Who may see a pre-listing, and who may fetch the photos and videos behind the public pages (Batch L1).
import { getSessionUser } from './auth.js';
import { getAgentProfile } from './agents.js';
import { isEitherBlocked } from './blocks.js';
import { json } from './util.js';

// A pre-listing shows the inside of a home that isn't on the market yet, so only these people open one:
// - the owner and admins: everything, as before. The operator account (an admin who is also an approved agent, so it
//   competes for homes) sees exactly what any other agent sees (Rudy 11.05): blocks, suspended owners and closed
//   pre-listings it never took part in apply to it too. Moderation is done from an admin account with no agent
//   profile, which keeps full access;
// - an approved agent: any open pre-listing, and one that's since been awarded or closed only if they took part in
//   it (a proposal, a price vote or opinion, an invite from the owner, an interview). Never across a block, either
//   way: they get the same 404 as a home that doesn't exist, never "you're blocked";
// - anyone else signed in (homeowners, buyers, pending or rejected applicants): only the browse teaser.
// A suspended owner's pre-listing is gone (404) for everyone but the owner and admins without an agent profile.
// row: the pre_listings row ({ id, user_id, status }). Returns access 'ok', 'hidden' (answer 404) or 'agents_only'
// (answer agentsOnly()), plus what the caller needs to shape the answer.
export async function preListingAccess(db, user, row) {
  const isOwner = user.id === row.user_id;
  const isAdmin = user.role === 'admin';
  const agentProfile = await getAgentProfile(db, user.id);
  // The session only ever belongs to an active account, so approved here means approved and active.
  const isApprovedAgent = !!agentProfile && agentProfile.status === 'approved';
  let access = 'ok';
  if (!isOwner) {
    if ((!isAdmin || isApprovedAgent) && !(await ownerIsActive(db, row.user_id))) access = 'hidden';
    else if (!isAdmin && !isApprovedAgent) access = 'agents_only';
    else if (isApprovedAgent && await isEitherBlocked(db, user.id, row.user_id)) access = 'hidden';
    else if ((!isAdmin || isApprovedAgent) && row.status !== 'open' && !(await agentTookPart(db, row.id, user.id))) access = 'hidden';
  }
  return { access, isOwner, isAdmin, agentProfile, isApprovedAgent };
}

// False for a suspended (or missing) account (admin/users/[id].js): its pre-listings drop out of every list, and
// agents can't open them or send anything to them (the same 404 as a home that isn't there).
export async function ownerIsActive(db, userId) {
  const row = await db.prepare("SELECT 1 AS yes FROM users WHERE id = ? AND status = 'active'").bind(userId).first();
  return !!row;
}

// Did this agent take part in this pre-listing? Any proposal (even withdrawn), price vote or opinion, invite or
// interview counts, so the hired agent and past bidders keep their way back in after the home closes.
export async function agentTookPart(db, preListingId, agentUserId) {
  const row = await db.prepare(
    `SELECT 1 AS yes WHERE
       EXISTS (SELECT 1 FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM pre_listing_price_votes WHERE pre_listing_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM pre_listing_price_opinions WHERE pre_listing_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM agent_invites WHERE request_type = 'pre_listing' AND request_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM pre_listing_interviews WHERE pre_listing_id = ?1 AND agent_user_id = ?2)`
  ).bind(Number(preListingId), agentUserId).first();
  return !!row;
}

// The answer for a signed-in viewer who isn't an approved agent (the app shows "Pre-listings open to approved local
// agents" on code agents_only).
export function agentsOnly() {
  return json({ error: 'Only approved agents can open pre-listings.', code: 'agents_only' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
}

// Photos and videos behind a public page (a listing, an AugmentedHomes or GreenHomes home, an agent's portfolio):
// anyone may fetch them while the page itself is public (cached the way it always was). Otherwise only the owner
// (or the agent themself) and admins can, never stored by a shared cache. Returns the Cache-Control to answer
// with, or null for "answer 404" (as if it didn't exist).
export async function mediaCacheControl(context, isPublic, ownerUserId, publicCache) {
  if (isPublic) return publicCache;
  const viewer = await getSessionUser(context);
  if (viewer && (viewer.id === ownerUserId || viewer.role === 'admin')) return 'private, no-store';
  return null;
}
