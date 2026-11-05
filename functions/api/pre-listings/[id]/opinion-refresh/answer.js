import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { isEitherBlocked } from '../../../../_lib/blocks.js';
import { claimUserAction, rateLimited } from '../../../../_lib/rateLimits.js';
import { ownerIsActive } from '../../../../_lib/visibility.js';
import { answerOpinionRefresh } from '../../../../_lib/opinionTrail.js';
import { notifyOpinionRefreshAnswered } from '../../../../_lib/marketplaceNotify.js';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

// POST /api/pre-listings/:id/opinion-refresh/answer: an agent the homeowner asked for a fresh look answers Same or
// Update. The gates match the votes POST (a blocked pair or a suspended owner is a 404, as if the home weren't there),
// and a write shares the votes' per-home daily budget (price_vote).
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can answer a refresh request.');

  const row = await db.prepare('SELECT id, user_id, status, opinions_refreshed_at FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row || !(await ownerIsActive(db, row.user_id)) || await isEitherBlocked(db, user.id, row.user_id)) return notFound('Pre-listing not found.');
  if (row.user_id === user.id) return forbidden("You can't answer a refresh on your own pre-listing.");
  if (row.status !== 'open') return json({ error: "This homeowner isn't taking fresh price opinions right now.", code: 'not_open' }, { status: 400, headers: NO_STORE });

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!body || typeof body !== 'object') return badRequest('Invalid request body.');

  const result = await answerOpinionRefresh(db, row, user.id, body, {
    beforeWrite: () => claimUserAction(db, 'price_vote', user.id, `pre_listing:${Number(id)}`),
  });
  if (result.rateLimited) return rateLimited();
  if (result.error) {
    return json(result.code ? { error: result.error, code: result.code } : { error: result.error }, { status: 400, headers: NO_STORE });
  }
  context.waitUntil(notifyOpinionRefreshAnswered(context, row.user_id, user.id, Number(id), result.answer));
  return json({ ok: true, answer: result.answer }, { headers: NO_STORE });
}
