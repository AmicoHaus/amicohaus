// Admin remove / restore for reviews of agents hired on Amico Haus (agent_reviews), with a required reason (Rudy
// 11.04). A review is removed by moving it out of agent_reviews into the admin audit log (the row as it was, plus the
// reason), so every place that shows ratings (profile, directory, proposals, favorites, Brag Cards) drops it at once,
// and a restore puts the same row back. agent_reviews has no hidden column, and this keeps the schema unchanged.
//
// Recusal: Amico Haus is run by Rudy Flores, an agent who may compete for the same homes. On a review of a home where
// any admin (operator) account sent a proposal, no admin can remove or restore it: the tool shows "recused" instead.
import { clampString } from './util.js';

export const REMOVE_ACTION = 'agent_review_remove';
export const RESTORE_ACTION = 'agent_review_restore';
export const RECUSED_ERROR = 'Recused: an Amico Haus admin account sent a proposal on this home, so admins can\'t remove or restore this review.';

// SQL: 1 when an admin account proposed on the review's home. reqType / reqId are SQL expressions.
export function operatorProposedSql(reqType, reqId) {
  return `EXISTS (SELECT 1 FROM service_bids sb JOIN users op ON op.id = sb.agent_user_id
                  WHERE sb.request_type = ${reqType} AND sb.request_id = ${reqId} AND op.role = 'admin')`;
}

export async function isRecused(db, requestType, requestId) {
  const row = await db.prepare(`SELECT ${operatorProposedSql('?1', '?2')} AS recused`).bind(requestType, requestId).first();
  return !!(row && row.recused);
}

export function moderationReason(value) {
  return clampString(String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' '), 300);
}

// The latest removal of this review that hasn't been restored since, as { logId, reason, removedAt, review }.
export async function findRemoval(db, reviewId) {
  const row = await db.prepare(
    `SELECT l.id, l.details, l.created_at FROM admin_audit_log l
     WHERE l.action = ?1 AND l.target_type = 'agent_review' AND l.target_id = ?2
       AND NOT EXISTS (SELECT 1 FROM admin_audit_log r WHERE r.action = ?3 AND r.target_type = 'agent_review'
                       AND r.target_id = l.target_id AND r.id > l.id)
     ORDER BY l.id DESC LIMIT 1`
  ).bind(REMOVE_ACTION, reviewId, RESTORE_ACTION).first();
  if (!row) return null;
  let details = null;
  try { details = JSON.parse(row.details || 'null'); } catch { details = null; }
  if (!details || !details.review) return null;
  return { logId: row.id, reason: details.reason || '', removedAt: row.created_at, review: details.review };
}
