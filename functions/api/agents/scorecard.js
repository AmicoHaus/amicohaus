import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../_lib/util.js';
import { buildScorecard } from '../../_lib/scorecard.js';

// The agent's own week (the same numbers as the Monday email) for their dashboard. PUT { optOut: true|false } turns
// the Monday email off or back on.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const card = await buildScorecard(context.env.DB, user.id);
  if (!card) return forbidden('The weekly scorecard is for approved agents.');
  const { email, ...rest } = card;
  return json({ scorecard: rest });
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (typeof body.optOut !== 'boolean') return badRequest('optOut must be true or false.');
  const r = await context.env.DB.prepare("UPDATE agent_profiles SET scorecard_opt_out = ? WHERE user_id = ? AND status = 'approved'").bind(body.optOut ? 1 : 0, user.id).run();
  if (!r.meta || !r.meta.changes) return forbidden('The weekly scorecard is for approved agents.');
  return json({ ok: true, optOut: body.optOut });
}
