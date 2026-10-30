import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { submitAgentApplication, dreLookupUrl } from '../../_lib/agents.js';
import { checkAlertsForAgent } from '../../_lib/agentSearchAlerts.js';
import { alertAdmin } from '../../_lib/adminAlerts.js';
import { releaseFoundingSpots } from '../../_lib/zipBoard.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await submitAgentApplication(context.env.DB, user.id, body);
  if (result.error) return badRequest(result.error);
  if (!result.isNewApplication && result.licenseChanged) {
    // The number the admin checked (or is about to check) changed: say so, so it gets looked up again.
    alertAdmin(context, user, {
      kind: 'agent_application',
      subject: `License number changed: ${user.display_name}`,
      lines: [
        `${user.display_name} (${user.email}) changed their DRE license number to ${result.licenseNumber} (${result.status === 'approved' ? 'approved agent; the DRE check was cleared' : 'application still pending'}).`,
        '',
        `Check the new number on the DRE: ${dreLookupUrl(result.licenseNumber)}`,
      ],
    });
  }
  if (result.isNewApplication) {
    alertAdmin(context, user, {
      kind: 'agent_application',
      subject: `New agent application: ${user.display_name}`,
      lines: [
        `${user.display_name} (${user.email}) applied to be an agent on Amico Haus.`,
        `Brokerage: ${String(body.brokerageName || '').slice(0, 120) || '(not given)'}`,
        `DRE license #: ${result.licenseNumber}`,
        '',
        `Check the license on the DRE before approving: ${dreLookupUrl(result.licenseNumber)}`,
      ],
    });
  }
  // An already-approved agent editing their profile can newly match a saved
  // search (a pending/rejected one isn't in the directory yet, so this is a
  // harmless no-op for them).
  // Founding spots are only granted when an admin approves; an edit can only give up spots for ZIPs no longer served.
  if (result.status === 'approved') {
    context.waitUntil(checkAlertsForAgent(context.env.DB, user.id));
  }
  await releaseFoundingSpots(context.env.DB, user.id);
  return json(result, { status: 201 });
}
