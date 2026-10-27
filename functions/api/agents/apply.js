import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { submitAgentApplication } from '../../_lib/agents.js';
import { checkAlertsForAgent } from '../../_lib/agentSearchAlerts.js';
import { alertAdmin } from '../../_lib/adminAlerts.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await submitAgentApplication(context.env.DB, user.id, body);
  if (result.error) return badRequest(result.error);
  if (result.isNewApplication) {
    alertAdmin(context, user, {
      kind: 'agent_application',
      subject: `New agent application: ${user.display_name}`,
      lines: [
        `${user.display_name} (${user.email}) applied to be an agent on Amico Haus.`,
        `Brokerage: ${String(body.brokerageName || '').slice(0, 120) || '(not given)'}`,
        `License #: ${String(body.licenseNumber || '').slice(0, 40) || '(not given)'}`,
        '',
        'Check the license on the DRE public lookup before approving: https://www2.dre.ca.gov/PublicASP/pplinfo.asp',
      ],
    });
  }
  // An already-approved agent editing their profile can newly match a saved
  // search (a pending/rejected one isn't in the directory yet, so this is a
  // harmless no-op for them).
  if (result.status === 'approved') context.waitUntil(checkAlertsForAgent(context.env.DB, user.id));
  return json(result, { status: 201 });
}
