import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../_lib/util.js';
import { isApprovedAgent } from '../../_lib/agents.js';
import { newInviteToken, validateInvitePeriod, fetchPastClientSummary } from '../../_lib/pastClientReviews.js';

// The agent's own past-client review link (Bring Your Reviews). GET: the current link, period and review count.
// PUT { fromYear, toYear, attest: true }: a new link for that period (any older link stops working).
// DELETE: turn the link off (reviews already left stay; the agent can't remove them).
async function current(db, userId) {
  const row = await db.prepare('SELECT review_invite_token, review_invite_from_year, review_invite_to_year FROM agent_profiles WHERE user_id = ?').bind(userId).first();
  const summary = await fetchPastClientSummary(db, userId);
  return {
    link: row && row.review_invite_token ? `/past-client-review?t=${row.review_invite_token}` : null,
    fromYear: row ? row.review_invite_from_year : null, toYear: row ? row.review_invite_to_year : null,
    reviewCount: summary.count, avgRating: summary.avgRating,
  };
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (!(await isApprovedAgent(context.env.DB, user.id))) return forbidden('Only approved agents have a past-client review link.');
  return json(await current(context.env.DB, user.id));
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents have a past-client review link.');
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const period = validateInvitePeriod(body);
  if (period.error) return badRequest(period.error);
  await db.prepare("UPDATE agent_profiles SET review_invite_token = ?, review_invite_from_year = ?, review_invite_to_year = ?, review_invite_attested_at = datetime('now') WHERE user_id = ?")
    .bind(newInviteToken(), period.fromYear, period.toYear, user.id).run();
  return json(await current(db, user.id));
}

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  await db.prepare('UPDATE agent_profiles SET review_invite_token = NULL WHERE user_id = ?').bind(user.id).run();
  return json(await current(db, user.id));
}
