import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { pacificToday } from '../../_lib/timingMatch.js';
import {
  TRIAL_CHECKLIST_ERROR, TRIAL_LONG_ERROR, TRIAL_PARTNER_ONLY_ERROR, TRIAL_CANCELED_ERROR, TRIAL_PAST_ERROR,
  validateTrialChecklist, fetchVisibleTrial, notifyTrialPartner, trialAgreedNotice, trialCanceledNotice,
} from '../../_lib/tradeTrials.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// { action: 'agree', checklist, longStayAck }: the owner who didn't suggest the dates says yes (the same checklist
// rule). { action: 'cancel' }: either owner, any time. A trial the viewer can't see (not theirs, a block, a
// suspension, a listing no longer active) answers 404. 3 statements + the session.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'testDrive', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) return notFound('Not found.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (body.action !== 'agree' && body.action !== 'cancel') return badRequest('Pick agree or cancel.');

  const db = context.env.DB;
  const row = await fetchVisibleTrial(db, user.id, id);
  if (!row) return notFound('Not found.');
  const iAmA = row.user_a_id === user.id;
  const partnerId = iAmA ? row.user_b_id : row.user_a_id;
  const notify = (text) => context.waitUntil(notifyTrialPartner(db, context.env, partnerId, text, id).catch(err => console.log(`[trial notice failed] ${err && err.message}`)));

  if (body.action === 'cancel') {
    const result = await db.prepare(
      "UPDATE trade_trials SET status = 'canceled', canceled_by_user_id = ?1, updated_at = datetime('now') WHERE id = ?2 AND status != 'canceled'"
    ).bind(user.id, id).run();
    if (result.meta.changes) notify(trialCanceledNotice(user.display_name));
    return json({ ok: true, status: 'canceled' }, NO_STORE);
  }

  if (row.status === 'canceled') return badRequest(TRIAL_CANCELED_ERROR);
  if (row.status === 'agreed' || (iAmA ? row.a_agreed_at : row.b_agreed_at)) {
    // Already said yes: nothing to change. The owner who suggested the dates can't also say yes for the other one.
    return row.status === 'agreed' ? json({ ok: true, status: 'agreed' }, NO_STORE) : badRequest(TRIAL_PARTNER_ONLY_ERROR);
  }
  if (row.start_date < pacificToday()) return badRequest(TRIAL_PAST_ERROR);
  const checklist = validateTrialChecklist(body.checklist);
  if (!checklist) return badRequest(TRIAL_CHECKLIST_ERROR);
  if (row.long_stay && body.longStayAck !== true) return badRequest(TRIAL_LONG_ERROR);

  // Only if the dates are still the ones this owner saw (the other owner may have changed them a moment ago).
  const mine = iAmA ? 'a' : 'b';
  const result = await db.prepare(
    `UPDATE trade_trials SET checklist_${mine}_json = ?1, ${mine}_agreed_at = datetime('now'), status = 'agreed', updated_at = datetime('now')
     WHERE id = ?2 AND status = 'proposed' AND start_date = ?3 AND end_date = ?4 AND ${mine}_agreed_at IS NULL`
  ).bind(JSON.stringify(checklist), id, row.start_date, row.end_date).run();
  if (!result.meta.changes) return json({ error: 'These dates just changed. Take another look.', code: 'trial_changed' }, { status: 409 });
  notify(trialAgreedNotice(user.display_name, row.start_date, row.end_date));
  return json({ ok: true, status: 'agreed' }, NO_STORE);
}
