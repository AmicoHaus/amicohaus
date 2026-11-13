import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { sqlUtc } from '../../_lib/contactPolicy.js';
import { MAX_STANDING, STANDING_MAX_ERROR, STANDING_AGENT_ERROR, standingExpiresAt } from '../../_lib/standingInterest.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// { renew: true }: the poster's own interest runs another 90 days. Nobody is notified again. An account with an
// agent profile can't renew (agents can't post standing interest; the same answer as posting).
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) return notFound('Not found.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (body.renew !== true) return badRequest('Nothing to change.');

  const db = context.env.DB;
  const now = Date.now();
  const expiresAt = standingExpiresAt(now);
  // An interest that already lapsed counts toward the 5 at a time again when it comes back.
  const result = await db.prepare(
    `UPDATE standing_interests SET expires_at = ?3, updated_at = datetime('now')
     WHERE id = ?4 AND user_id = ?1 AND status = 'active'
       AND NOT EXISTS (SELECT 1 FROM agent_profiles WHERE user_id = ?1)
       AND (expires_at > ?2 OR (SELECT COUNT(*) FROM standing_interests WHERE user_id = ?1 AND status = 'active' AND expires_at > ?2) < ${MAX_STANDING})`
  ).bind(user.id, sqlUtc(now), expiresAt, id).run();
  if (result.meta.changes) return json({ ok: true, expiresAt }, NO_STORE);
  const mine = await db.prepare(
    "SELECT EXISTS (SELECT 1 FROM agent_profiles WHERE user_id = ?2) AS is_agent FROM standing_interests WHERE id = ?1 AND user_id = ?2 AND status = 'active'"
  ).bind(id, user.id).first();
  if (!mine) return notFound('Not found.');
  if (mine.is_agent) return json({ error: STANDING_AGENT_ERROR, code: 'interest_not_for_agents' }, { status: 403, ...NO_STORE });
  return badRequest(STANDING_MAX_ERROR);
}

// Withdraws the poster's own interest: owners stop seeing it at once.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) return notFound('Not found.');
  const result = await context.env.DB.prepare(
    "UPDATE standing_interests SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'active'"
  ).bind(id, user.id).run();
  if (!result.meta.changes) return notFound('Not found.');
  return json({ ok: true }, NO_STORE);
}
