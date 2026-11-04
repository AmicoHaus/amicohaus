import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { proposeShowing, fetchShowings } from '../../../../_lib/showings.js';
import { notifyNewShowingRequest } from '../../../../_lib/marketplaceNotify.js';
import { contactDecision, SHOWING_QUIET_ERROR } from '../../../../_lib/contactPolicy.js';

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');

  const isOwner = preListing.user_id === user.id;
  if (!isOwner && !(await isApprovedAgent(db, user.id))) return forbidden();

  const showings = await fetchShowings(db, id, isOwner ? {} : { forAgentUserId: user.id });
  return json({ showings });
}

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can request a showing.');

  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id === user.id) return forbidden("You can't request a showing of your own pre-listing.");

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  // The homeowner's contact dial: Quiet turns showing requests off (unless they already work with this agent).
  // Weekly doesn't hold showings, only messages.
  const dial = await contactDecision(db, user.id, preListing.user_id);
  if (dial.appliesToSender && !dial.exempt && dial.mode === 'quiet') {
    return json({ error: SHOWING_QUIET_ERROR, code: 'contact_quiet' }, { status: 403 });
  }

  const result = await proposeShowing(db, id, user.id, body);
  if (result.error) return result.code ? json({ error: result.error, code: result.code }, { status: 400 }) : badRequest(result.error);
  context.waitUntil(notifyNewShowingRequest(context, id, preListing.user_id, user.id, body.proposedAt));
  return json({ id: result.id }, { status: 201 });
}
