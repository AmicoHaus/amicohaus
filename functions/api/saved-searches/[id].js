import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../_lib/util.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { validateSearchTiming } from '../../_lib/timingMatch.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound('Saved search not found.');
  const db = context.env.DB;
  const search = await db.prepare('SELECT user_id FROM saved_searches WHERE id = ?').bind(id).first();
  if (!search) return notFound('Saved search not found.');
  if (search.user_id !== user.id) return forbidden();

  await db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return json({ ok: true });
}

// Timing Match: add, change or clear the move-in window and stay offer on one of your own saved searches. Only the
// timing changes here (the criteria stay as saved). A change counts against the same daily limit as a new search.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound('Saved search not found.');
  const db = context.env.DB;
  const search = await db.prepare('SELECT user_id, move_from, move_to, stay_offer_days FROM saved_searches WHERE id = ?').bind(id).first();
  if (!search) return notFound('Saved search not found.');
  if (search.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const checked = validateSearchTiming(body, search);
  if (checked.error) return badRequest(checked.error);
  const { moveFrom, moveTo, stayOfferDays } = checked.data;

  const unchanged = moveFrom === (search.move_from || null) && moveTo === (search.move_to || null)
    && stayOfferDays === (Number(search.stay_offer_days) || 0);
  if (!unchanged) {
    if (!(await claimUserAction(db, 'saved_search', user.id))) return rateLimited();
    await db.prepare('UPDATE saved_searches SET move_from = ?, move_to = ?, stay_offer_days = ? WHERE id = ? AND user_id = ?')
      .bind(moveFrom, moveTo, stayOfferDays, id, user.id).run();
  }
  return json({ ok: true, moveFrom, moveTo, stayOfferDays }, NO_STORE);
}
