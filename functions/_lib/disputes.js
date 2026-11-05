// Disputes are gone (Rudy 11.04): Amico Haus doesn't decide disputes between homeowners and agents, and the person
// who runs it is an agent who may compete for the same homes. "Report a rules problem" replaces them: it goes to the
// normal reports queue (POST /api/reports, targetType 'user'), and fee or service problems go to the agent's managing
// broker, the California DRE or small claims court. Every create endpoint answers disputesGone(). Old rows stay as
// read-only history: the parties see what was filed (no admin notes, no verdict), the admin sees the full record.
import { json } from './util.js';

export const DISPUTES_GONE_ERROR = 'Disputes have been replaced by Report a rules problem.';

export function disputesGone() {
  return json({ error: DISPUTES_GONE_ERROR, code: 'gone' }, { status: 410 });
}

// For reading old rows. 'payment_dispute' is shown as a fee question, which belongs with the agent's broker.
export const DISPUTE_REASON_LABELS = {
  work_not_done: 'Work not done',
  quality_issue: 'Quality issue',
  communication: 'Communication problem',
  payment_dispute: "Fee question (contact the agent's broker)",
  other: 'Other',
};

const SELECT_DISPUTES = `SELECT disputes.*, ru.display_name AS raised_by_name, au.display_name AS against_name
     FROM disputes JOIN users ru ON ru.id = disputes.raised_by_user_id JOIN users au ON au.id = disputes.against_user_id`;

function mapDisputeRow(r) {
  return {
    id: r.id, requestType: r.request_type, requestId: r.request_id,
    raisedByUserId: r.raised_by_user_id, raisedByName: r.raised_by_name,
    againstUserId: r.against_user_id, againstName: r.against_name,
    reason: r.reason, reasonLabel: DISPUTE_REASON_LABELS[r.reason] || 'Other', description: r.description,
    createdAt: r.created_at,
  };
}

// A party's own history: what was filed and when. No status and no admin notes, so nothing reads as a ruling.
export async function fetchMyDisputes(db, userId) {
  const rows = await db.prepare(
    `${SELECT_DISPUTES}
     WHERE disputes.raised_by_user_id = ? OR disputes.against_user_id = ?
     ORDER BY disputes.created_at DESC`
  ).bind(userId, userId).all();
  return rows.results.map(mapDisputeRow);
}

// The admin's read-only history, newest first. status: 'open' | 'resolved' | 'dismissed' | 'all'.
export async function fetchAdminDisputes(db, status = 'all') {
  const rows = await db.prepare(
    `${SELECT_DISPUTES}
     WHERE (?1 = 'all' OR disputes.status = ?1) ORDER BY disputes.created_at DESC LIMIT 200`
  ).bind(status).all();
  return rows.results.map(r => ({
    ...mapDisputeRow(r), status: r.status, adminNotes: r.admin_notes, resolvedAt: r.resolved_at,
  }));
}
