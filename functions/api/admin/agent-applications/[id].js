import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { reviewAgentApplication, rejectionReasonText } from '../../../_lib/agents.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { checkAlertsForAgent } from '../../../_lib/agentSearchAlerts.js';
import { sendEmail } from '../../../_lib/email.js';
import { isTestOrDemoEmail } from '../../../_lib/adminAlerts.js';
import { grantFoundingSpots, releaseFoundingSpots, foundingGrantedLine } from '../../../_lib/zipBoard.js';

// Tells the applicant how their application went: an in-app notification always, and an email when it's a real
// address (test-suite and demo inboxes are skipped so they don't use up the daily send quota). Founding spots are
// described as recognition only (foundingGrantedLine).
async function notifyApplicantOfDecision(context, applicantId, approved, rejectionReason, foundingZips = []) {
  const db = context.env.DB;
  const applicant = await db.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(applicantId).first();
  if (!applicant) return;
  const body = approved
    ? `You're approved as an agent on Amico Haus! You can now send proposals on homeowners' pre-listings.${foundingGrantedLine(foundingZips)}`
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
  const existing = await db.prepare('SELECT status, license_number, license_verified FROM agent_profiles WHERE user_id = ?').bind(applicantId).first();
  if (!existing) return notFound('No application from this user.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['approve', 'reject'].includes(body.decision)) return badRequest('decision must be "approve" or "reject".');
  // Approval goes with the license number the admin was shown, and only after it was marked checked on the DRE
  // (PUT .../verify). A license or broker change by the agent clears that check, so it has to be done again first.
  if (body.decision === 'approve') {
    if (!body.licenseNumber) return badRequest('Send the license number you checked.');
    if (String(body.licenseNumber) !== existing.license_number) {
      return json({ error: "This agent's license number changed since the page loaded. Reload, then check the new number on the DRE." }, { status: 409 });
    }
    if (!Number(existing.license_verified)) {
      return json({ error: 'Mark the license checked on the DRE before approving.', code: 'license_not_checked' }, { status: 409 });
    }
  }
  // A rejection uses the fixed list of reasons (REJECTION_REASONS in agents.js, also sent with the application list).
  let reasonText = '';
  if (body.decision === 'reject') {
    const reason = rejectionReasonText(body.rejectionReason, body.rejectionNote);
    if (reason.error) return badRequest(reason.error);
    reasonText = reason.text;
  }

  // Re-deciding the same way (a double-click, or an already-approved agent) doesn't notify them twice.
  const alreadyDecided = existing.status === (body.decision === 'approve' ? 'approved' : 'rejected');
  await reviewAgentApplication(db, user.id, applicantId, body.decision === 'approve', reasonText);
  await logAdminAction(db, user.id, `agent_application_${body.decision}`, 'agent_profile', applicantId, reasonText ? { reason: reasonText } : undefined);
  let granted = [];
  if (body.decision === 'approve') {
    context.waitUntil(checkAlertsForAgent(db, Number(applicantId)));
    granted = await grantFoundingSpots(db, Number(applicantId));
  } else {
    // Rejecting (including removing an approval): the DRE check and any founding spots go with it, so a later
    // re-application starts fresh and the spots open up for the next agent in those ZIPs.
    await db.prepare('UPDATE agent_profiles SET license_verified = 0, license_verified_at = NULL, license_verified_by = NULL WHERE user_id = ?').bind(applicantId).run();
    await releaseFoundingSpots(db, Number(applicantId), { all: true });
  }
  if (!alreadyDecided) {
    await notifyApplicantOfDecision(context, Number(applicantId), body.decision === 'approve', reasonText, granted);
  } else if (granted.length) {
    // Re-approving an agent who has since added a launch ZIP can open a founding spot; tell them in the app.
    await db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)")
      .bind(Number(applicantId), foundingGrantedLine(granted).trim(), '/app#become-agent').run();
  }

  return json({ ok: true });
}
