import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { submitAgentApplication } from '../../_lib/agents.js';
import { checkAlertsForAgent } from '../../_lib/agentSearchAlerts.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await submitAgentApplication(context.env.DB, user.id, body);
  if (result.error) return badRequest(result.error);
  // An already-approved agent editing their profile can newly match a saved
  // search (a pending/rejected one isn't in the directory yet, so this is a
  // harmless no-op for them).
  if (result.status === 'approved') context.waitUntil(checkAlertsForAgent(context.env.DB, user.id));
  return json(result, { status: 201 });
}
