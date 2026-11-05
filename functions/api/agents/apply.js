import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { submitAgentApplication, dreLookupUrl } from '../../_lib/agents.js';
import { checkAlertsForAgent } from '../../_lib/agentSearchAlerts.js';
import { alertAdmin } from '../../_lib/adminAlerts.js';
import { releaseFoundingSpots, grantFoundingSpots, foundingGrantedLine } from '../../_lib/zipBoard.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const db = context.env.DB;
  const result = await submitAgentApplication(db, user.id, body);
  if (result.error) return result.code ? json({ error: result.error, code: result.code }, { status: 400 }) : badRequest(result.error);
  if (!result.isNewApplication && (result.licenseChanged || result.brokerageChanged)) {
    // The license number or broker the admin checked (or is about to check) changed: say so, so it gets looked up
    // again (the DRE check was cleared for an approved agent, see submitAgentApplication).
    alertAdmin(context, user, {
      kind: 'agent_application',
      subject: `License or broker changed: ${user.display_name}`,
      lines: [
        `${user.display_name} (${user.email}) changed their DRE license number or broker (${result.status === 'approved' ? 'approved agent; the DRE check was cleared' : 'application still pending'}).`,
        `License: ${result.oldLicense || '(none)'} → ${result.licenseNumber}`,
        `Broker: ${result.oldBrokerage || '(none)'} → ${result.brokerageName || '(none)'}`,
        '',
        `Check it on the DRE: ${dreLookupUrl(result.licenseNumber)}`,
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
  if (result.status === 'approved') {
    context.waitUntil(checkAlertsForAgent(db, user.id));
  }
  // Founding spots follow the service area: ZIPs no longer served are given up, and an approved agent who adds a
  // launch ZIP takes an open spot there right away (no re-approval needed), the same first-come rule as an approval.
  await releaseFoundingSpots(db, user.id);
  if (result.status === 'approved') {
    const granted = await grantFoundingSpots(db, user.id);
    if (granted.length) {
      await db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)")
        .bind(user.id, foundingGrantedLine(granted).trim(), '/app#become-agent').run();
    }
  }
  return json(result, { status: 201 });
}
