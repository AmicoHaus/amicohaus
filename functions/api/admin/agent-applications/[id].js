import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { reviewAgentApplication } from '../../../_lib/agents.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { checkAlertsForAgent } from '../../../_lib/agentSearchAlerts.js';

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const applicantId = context.params.id;
  const db = context.env.DB;
  const existing = await db.prepare('SELECT status FROM agent_profiles WHERE user_id = ?').bind(applicantId).first();
  if (!existing) return notFound('No application from this user.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['approve', 'reject'].includes(body.decision)) return badRequest('decision must be "approve" or "reject".');

  await reviewAgentApplication(db, user.id, applicantId, body.decision === 'approve', body.rejectionReason);
  await logAdminAction(db, user.id, `agent_application_${body.decision}`, 'agent_profile', applicantId);
  if (body.decision === 'approve') context.waitUntil(checkAlertsForAgent(db, Number(applicantId)));

  return json({ ok: true });
}
