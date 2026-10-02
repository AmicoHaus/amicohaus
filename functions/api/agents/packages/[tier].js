import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../../_lib/util.js';
import { upsertPackage, deletePackage, PACKAGE_TIERS } from '../../../_lib/agentPackages.js';
import { checkAlertsForAgent } from '../../../_lib/agentSearchAlerts.js';

export async function onRequestPut(context) {
  const tier = context.params.tier;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (!PACKAGE_TIERS.includes(tier)) return badRequest('Invalid package tier.');

  const db = context.env.DB;
  const agent = await db.prepare('SELECT 1 FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
  if (!agent) return badRequest('Apply to become an agent before setting up packages.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await upsertPackage(db, user.id, tier, body);
  if (result.error) return badRequest(result.error);
  context.waitUntil(checkAlertsForAgent(db, user.id));
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const tier = context.params.tier;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (!PACKAGE_TIERS.includes(tier)) return badRequest('Invalid package tier.');

  await deletePackage(context.env.DB, user.id, tier);
  return json({ ok: true });
}
