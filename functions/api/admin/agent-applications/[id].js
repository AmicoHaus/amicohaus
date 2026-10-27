import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString } from '../../../_lib/util.js';
import { reviewAgentApplication } from '../../../_lib/agents.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { checkAlertsForAgent } from '../../../_lib/agentSearchAlerts.js';
import { sendEmail } from '../../../_lib/email.js';
import { isTestOrDemoEmail } from '../../../_lib/adminAlerts.js';

// Tells the applicant how their application went: an in-app notification always, and an email when it's a real
// address (test-suite and demo inboxes are skipped so they don't use up the daily send quota).
async function notifyApplicantOfDecision(context, applicantId, approved, rejectionReason) {
  const db = context.env.DB;
  const applicant = await db.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(applicantId).first();
  if (!applicant) return;
  const body = approved
    ? "You're approved as an agent on Amico Haus! You can now send proposals on homeowners' pre-listings."
    : `Your agent application wasn't approved this time.${rejectionReason ? ` Reason: ${rejectionReason}${/[.!?]$/.test(rejectionReason) ? '' : '.'}` : ''} You can update your profile and apply again.`;
  await db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)")
    .bind(applicantId, body, '/app#become-agent').run();
  if (isTestOrDemoEmail(applicant.email)) return;
  const subject = approved ? "You're approved as an agent on Amico Haus" : 'Your Amico Haus agent application';
  const text = `Hi ${applicant.display_name},\n\n${body}\n\nOpen Amico Haus: https://amicohaus.com/app#become-agent\n\nPresented by Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West`;
  context.waitUntil(sendEmail(context, { to: applicant.email, subject, text }).catch(err => console.log(`[agent decision email failed] ${err.message}`)));
}

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

  // Re-deciding the same way (a double-click, or an already-approved agent) doesn't notify them twice.
  const alreadyDecided = existing.status === (body.decision === 'approve' ? 'approved' : 'rejected');
  await reviewAgentApplication(db, user.id, applicantId, body.decision === 'approve', body.rejectionReason);
  await logAdminAction(db, user.id, `agent_application_${body.decision}`, 'agent_profile', applicantId);
  if (body.decision === 'approve') context.waitUntil(checkAlertsForAgent(db, Number(applicantId)));
  if (!alreadyDecided) await notifyApplicantOfDecision(context, Number(applicantId), body.decision === 'approve', clampString(body.rejectionReason, 500));

  return json({ ok: true });
}
