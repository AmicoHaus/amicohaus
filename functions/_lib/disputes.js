// Admin-mediated disputes over an awarded engagement. This only tracks
// status and notes for a human admin to work through out-of-band — there's
// no escrow to freeze or refund here (see bid_milestones for why), so
// "resolving" a dispute is purely a record-keeping action on the platform.
import { clampString } from './util.js';

const REASONS = ['work_not_done', 'quality_issue', 'communication', 'payment_dispute', 'other'];

export async function partiesForRequest(db, requestType, requestId) {
  const row = requestType === 'pre_listing'
    ? await db.prepare('SELECT user_id AS a, NULL AS b, awarded_bid_id FROM pre_listings WHERE id = ?').bind(requestId).first()
    : await db.prepare('SELECT user_a_id AS a, user_b_id AS b, awarded_bid_id FROM transaction_requests WHERE id = ?').bind(requestId).first();
  if (!row || !row.awarded_bid_id) return null;
  const bid = await db.prepare('SELECT agent_user_id FROM service_bids WHERE id = ?').bind(row.awarded_bid_id).first();
  if (!bid) return null;
  return { homeowners: [row.a, row.b].filter(Boolean), agentUserId: bid.agent_user_id };
}

export function validateDisputeInput(body) {
  const reason = REASONS.includes(body.reason) ? body.reason : null;
  const description = clampString(body.description, 2000);
  if (!reason) return { error: 'Pick a reason for the dispute.' };
  if (!description) return { error: 'Describe what happened.' };
  return { data: { reason, description } };
}

export async function raiseDispute(db, requestType, requestId, raisedByUserId, body) {
  const parties = await partiesForRequest(db, requestType, requestId);
  if (!parties) return { error: 'This request has no awarded engagement to dispute.' };

  const isHomeowner = parties.homeowners.includes(raisedByUserId);
  const isAgent = parties.agentUserId === raisedByUserId;
  if (!isHomeowner && !isAgent) return { error: 'You were not a party to this engagement.' };

  const againstUserId = isAgent ? parties.homeowners[0] : parties.agentUserId;
  const validated = validateDisputeInput(body);
  if (validated.error) return validated;
  const d = validated.data;

  const result = await db.prepare(
    `INSERT INTO disputes (request_type, request_id, raised_by_user_id, against_user_id, reason, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(requestType, requestId, raisedByUserId, againstUserId, d.reason, d.description).run();
  return { id: result.meta.last_row_id };
}

function mapDisputeRow(r) {
  return {
    id: r.id, requestType: r.request_type, requestId: r.request_id,
    raisedByUserId: r.raised_by_user_id, raisedByName: r.raised_by_name,
    againstUserId: r.against_user_id, againstName: r.against_name,
    reason: r.reason, description: r.description, status: r.status,
    adminNotes: r.admin_notes, resolvedAt: r.resolved_at, createdAt: r.created_at,
  };
}

export async function fetchMyDisputes(db, userId) {
  const rows = await db.prepare(
    `SELECT disputes.*, ru.display_name AS raised_by_name, au.display_name AS against_name
     FROM disputes JOIN users ru ON ru.id = disputes.raised_by_user_id JOIN users au ON au.id = disputes.against_user_id
     WHERE disputes.raised_by_user_id = ? OR disputes.against_user_id = ?
     ORDER BY disputes.created_at DESC`
  ).bind(userId, userId).all();
  return rows.results.map(mapDisputeRow);
}

export async function fetchAdminDisputes(db, status) {
  const rows = await db.prepare(
    `SELECT disputes.*, ru.display_name AS raised_by_name, au.display_name AS against_name
     FROM disputes JOIN users ru ON ru.id = disputes.raised_by_user_id JOIN users au ON au.id = disputes.against_user_id
     WHERE disputes.status = ? ORDER BY disputes.created_at DESC`
  ).bind(status).all();
  return rows.results.map(mapDisputeRow);
}

export async function resolveDispute(db, disputeId, adminUserId, status, adminNotes) {
  await db.prepare(
    `UPDATE disputes SET status = ?, admin_notes = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`
  ).bind(status, clampString(adminNotes, 2000), adminUserId, disputeId).run();
}
