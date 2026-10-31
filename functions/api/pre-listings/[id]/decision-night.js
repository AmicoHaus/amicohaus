import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { validateDecisionTime, proposalsSealed, countSealedProposals } from '../../../_lib/decisionNight.js';

// The owner sets (or moves later) their Decision Night: { dueAt: ISO time }. { action: 'open' } opens every proposal
// now. Only while the pre-listing is open.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const row = await db.prepare('SELECT user_id, status, proposals_due_at FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden();
  if (row.status !== 'open') return badRequest('Decision Night is only for an open pre-listing.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  if (body.action === 'open') {
    if (!proposalsSealed(row)) return json({ ok: true, dueAt: row.proposals_due_at });
    // Opening early: the time becomes now, and they're already looking, so no "your proposals are open" message.
    const now = new Date().toISOString();
    await db.prepare("UPDATE pre_listings SET proposals_due_at = ?, proposals_open_notified_at = datetime('now') WHERE id = ?").bind(now, id).run();
    return json({ ok: true, dueAt: now });
  }

  // A Decision Night is set before any proposal is in (or moved later while it's still sealed). Once proposals have
  // been seen, or it has already opened, sealing them again would tell agents something untrue.
  if (!proposalsSealed(row)) {
    if (row.proposals_due_at) return badRequest('Your Decision Night already happened, so your proposals stay open.');
    if (await countSealedProposals(db, id) > 0) return badRequest('A Decision Night has to be set before the first proposal arrives. Your proposals are already open to you.');
  }
  const checked = validateDecisionTime(body.dueAt, proposalsSealed(row) ? row.proposals_due_at : null);
  if (checked.error) return badRequest(checked.error);
  await db.prepare('UPDATE pre_listings SET proposals_due_at = ?, proposals_open_notified_at = NULL WHERE id = ?').bind(checked.dueAt, id).run();
  return json({ ok: true, dueAt: checked.dueAt });
}
