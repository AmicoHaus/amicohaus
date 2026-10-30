import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { validateInterviewRequest, MAX_ACTIVE_INTERVIEWS, parseJsonArray, parseJsonObject } from '../../../../_lib/sellerPrep.js';
import { notifyInterviewRequested } from '../../../../_lib/marketplaceNotify.js';

// "Interview your top 3": the owner asks agents who sent a proposal for a short interview, offering up to 3 times;
// the agent picks one. The owner's scorecard and notes are private to the owner: an agent only ever sees their
// own request (times, format, status).
function interviewJson(r, { forOwner }) {
  return {
    agentUserId: r.agent_user_id, agentName: r.agent_name, format: r.format, slots: parseJsonArray(r.slots_json),
    chosenSlot: r.chosen_slot, status: r.status, createdAt: r.created_at,
    scores: forOwner ? parseJsonObject(r.scores_json) : undefined,
    ownerNotes: forOwner ? r.owner_notes : undefined,
  };
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id FROM pre_listings WHERE id = ?').bind(context.params.id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  const isOwner = preListing.user_id === user.id;
  const rows = await db.prepare(
    `SELECT i.*, users.display_name AS agent_name FROM pre_listing_interviews i JOIN users ON users.id = i.agent_user_id
     WHERE i.pre_listing_id = ? ${isOwner ? '' : 'AND i.agent_user_id = ?'} ORDER BY i.created_at ASC`
  ).bind(...(isOwner ? [context.params.id] : [context.params.id, user.id])).all();
  return json({ interviews: rows.results.map(r => interviewJson(r, { forOwner: isOwner })) });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const preListing = await db.prepare('SELECT user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();
  if (preListing.status !== 'open') return badRequest('Only an open pre-listing can schedule interviews.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const agentUserId = Number(body.agentUserId);
  // Only agents who sent this owner a proposal (still pending, or hired) and whose account is active.
  const bid = await db.prepare(
    `SELECT service_bids.id FROM service_bids JOIN users ON users.id = service_bids.agent_user_id
     WHERE request_type = 'pre_listing' AND request_id = ? AND agent_user_id = ? AND service_bids.status IN ('pending','accepted') AND users.status = 'active'`
  ).bind(id, agentUserId).first();
  if (!bid || !(await isApprovedAgent(db, agentUserId))) return badRequest('You can interview agents who sent you a proposal.');
  const validated = validateInterviewRequest(body);
  if (validated.error) return badRequest(validated.error);

  const others = await db.prepare(
    "SELECT status, slots_json FROM pre_listing_interviews WHERE pre_listing_id = ? AND agent_user_id != ? AND status IN ('requested','scheduled')"
  ).bind(id, agentUserId).all();
  const live = others.results.filter(r => r.status === 'scheduled' || parseJsonArray(r.slots_json).some(s => new Date(s).getTime() > Date.now()));
  if (live.length >= MAX_ACTIVE_INTERVIEWS) return badRequest(`You can have up to ${MAX_ACTIVE_INTERVIEWS} interviews going at once. Cancel or finish one first.`);

  // Asking again (new times, or after canceling) replaces the earlier request but keeps the owner's scorecard. The
  // same request sent twice doesn't notify the agent twice.
  const prior = await db.prepare('SELECT status, format, slots_json FROM pre_listing_interviews WHERE pre_listing_id = ? AND agent_user_id = ?').bind(id, agentUserId).first();
  const unchanged = prior && prior.status === 'requested' && prior.format === validated.data.format && prior.slots_json === JSON.stringify(validated.data.slots);
  await db.prepare(
    `INSERT INTO pre_listing_interviews (pre_listing_id, agent_user_id, format, slots_json, status)
     VALUES (?, ?, ?, ?, 'requested')
     ON CONFLICT(pre_listing_id, agent_user_id) DO UPDATE SET format = excluded.format, slots_json = excluded.slots_json,
       chosen_slot = NULL, status = 'requested', updated_at = datetime('now')`
  ).bind(id, agentUserId, validated.data.format, JSON.stringify(validated.data.slots)).run();
  if (!unchanged) context.waitUntil(notifyInterviewRequested(context, id, agentUserId).catch(err => console.log(`[interview notify failed] ${err.message}`)));
  return json({ ok: true }, { status: 201 });
}
