import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Removes the person's own home claim.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) return notFound('Not found.');
  const result = await context.env.DB.prepare('DELETE FROM home_claims WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!result.meta.changes) return notFound('Not found.');
  return json({ ok: true }, NO_STORE);
}
