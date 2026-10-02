import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { createPortfolio } from '../../_lib/portfolios.js';
import { notifyNewMatches } from '../../_lib/matchNotify.js';

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await createPortfolio(context.env.DB, user.id, body);
  if (result.error) return badRequest(result.error);

  // Same reasoning as a plain listing's create endpoint: backgrounded so a
  // portfolio that happens to clear the match threshold against a lot of
  // existing listings can't blow past the Worker's execution time limit.
  context.waitUntil(notifyNewMatches(context, result.id));
  return json({ id: result.id }, { status: 201 });
}
