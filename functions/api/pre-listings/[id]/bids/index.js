import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { upsertBid } from '../../../../_lib/marketplace.js';
import { notifyNewBid } from '../../../../_lib/marketplaceNotify.js';
import { proposalsSealed } from '../../../../_lib/decisionNight.js';

const PROPOSALS_PAUSED_ERROR = "This homeowner has paused new proposals for now. Check back soon: you'll be able to send one when they reopen.";

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can submit proposals.');

  const preListing = await db.prepare(
    `SELECT pre_listings.user_id, pre_listings.status, pre_listings.proposals_due_at, pre_listings.proposals_paused, users.contact_mode AS owner_contact_mode
     FROM pre_listings JOIN users ON users.id = pre_listings.user_id WHERE pre_listings.id = ?`
  ).bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id === user.id) return forbidden("You can't bid on your own pre-listing.");
  if (preListing.status !== 'open') return badRequest('This pre-listing is no longer open for proposals.');

  // Paused: an agent who already has a live proposal here can still update it; nobody new can start one (and a
  // withdrawn or declined one can't be sent again until the owner resumes). An agent the owner invited to this home
  // can still send one: the invite is the owner asking for it.
  if (preListing.proposals_paused) {
    const mine = await db.prepare("SELECT status FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ? AND agent_user_id = ?").bind(id, user.id).first();
    const invited = !mine && await db.prepare(
      "SELECT 1 AS yes FROM agent_invites WHERE request_type = 'pre_listing' AND request_id = ? AND agent_user_id = ? AND invited_by_user_id = ?"
    ).bind(id, user.id, preListing.user_id).first();
    if (!invited && (!mine || mine.status !== 'pending')) return json({ error: PROPOSALS_PAUSED_ERROR, code: 'proposals_paused' }, { status: 400 });
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await upsertBid(db, 'pre_listing', id, user.id, body);
  if (result.error) return badRequest(result.error);

  // While sealed, only a new proposal is mentioned (an edit would just repeat "a new proposal came in"). An owner
  // who chose Weekly or Quiet contact hears about an agent's FIRST proposal only: not each edit, and not a withdrawn
  // or declined one sent again (withdraw-and-resend would otherwise be a way to ping them over and over).
  const sealed = proposalsSealed(preListing);
  const quietOwner = preListing.owner_contact_mode === 'weekly' || preListing.owner_contact_mode === 'quiet';
  const notifyOwner = quietOwner ? !result.previousStatus : (result.isNew || !sealed);
  if (notifyOwner) context.waitUntil(notifyNewBid(context, 'pre_listing', id, preListing.user_id, user.id, { sealed, updated: !result.isNew }));
  return json({ ok: true }, { status: 201 });
}
