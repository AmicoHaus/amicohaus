import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { saveAlert, fetchMyAlerts } from '../../_lib/agentSearchAlerts.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const alerts = await fetchMyAlerts(context.env.DB, user.id);
  return json({ alerts });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await saveAlert(context.env.DB, user.id, body);
  if (result.error) return badRequest(result.error);
  return json(result, { status: 201 });
}
