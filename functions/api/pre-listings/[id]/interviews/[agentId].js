import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString } from '../../../../_lib/util.js';
import { validateScores, parseJsonArray } from '../../../../_lib/sellerPrep.js';
import { notifyInterviewScheduled, notifyInterviewCanceled } from '../../../../_lib/marketplaceNotify.js';

// The agent picks one of the offered times ({ chosenSlot }); the owner cancels ({ action: 'cancel' }), or saves
// their private scorecard and notes ({ scores, ownerNotes, done }).
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const agentId = Number(context.params.agentId);
  const row = await db.prepare(
    `SELECT i.*, pre_listings.user_id AS owner_id, pre_listings.status AS pre_listing_status FROM pre_listing_interviews i JOIN pre_listings ON pre_listings.id = i.pre_listing_id
     WHERE i.pre_listing_id = ? AND i.agent_user_id = ?`
  ).bind(id, agentId).first();
  if (!row) return notFound('Interview not found.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  if (user.id === agentId) {
    if (row.pre_listing_status !== 'open' || !['requested', 'scheduled'].includes(row.status)) return badRequest('This interview is no longer open.');
    const slot = String(body.chosenSlot || '');
    if (row.status === 'scheduled' && row.chosen_slot === slot) return json({ ok: true, status: 'scheduled', chosenSlot: slot });
    if (!parseJsonArray(row.slots_json).includes(slot)) return badRequest('Pick one of the times the homeowner offered.');
    if (new Date(slot).getTime() <= Date.now()) return badRequest('That time has already passed. Ask the homeowner for new times.');
    await db.prepare("UPDATE pre_listing_interviews SET chosen_slot = ?, status = 'scheduled', updated_at = datetime('now') WHERE id = ?").bind(slot, row.id).run();
    context.waitUntil(notifyInterviewScheduled(context, id, row.owner_id, agentId, slot).catch(err => console.log(`[interview notify failed] ${err.message}`)));
    return json({ ok: true, status: 'scheduled', chosenSlot: slot });
  }

  if (user.id !== row.owner_id) return forbidden();
  if (body.action === 'cancel') {
    if (row.status === 'canceled') return json({ ok: true, status: 'canceled' });
    await db.prepare("UPDATE pre_listing_interviews SET status = 'canceled', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
    context.waitUntil(notifyInterviewCanceled(context, id, agentId).catch(err => console.log(`[interview notify failed] ${err.message}`)));
    return json({ ok: true, status: 'canceled' });
  }
  const scores = validateScores(body.scores);
  const status = body.done && row.status !== 'canceled' ? 'done' : row.status;
  await db.prepare("UPDATE pre_listing_interviews SET scores_json = ?, owner_notes = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(JSON.stringify(scores), clampString(body.ownerNotes, 1000), status, row.id).run();
  return json({ ok: true, status, scores });
}
