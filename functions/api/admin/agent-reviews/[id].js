import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { REMOVE_ACTION, RESTORE_ACTION, RECUSED_ERROR, isRecused, moderationReason, findRemoval } from '../../../_lib/agentReviewAdmin.js';

// PUT { action: 'remove' | 'restore', reason } on a review of an agent hired here (see agentReviewAdmin.js). A reason
// is always required and logged; the reviewer gets an in-app note when their review is removed. Recused reviews (an
// admin account proposed on that home) can't be touched by any admin.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound('Review not found.');
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['remove', 'restore'].includes(body.action)) return badRequest('action must be "remove" or "restore".');
  const reason = moderationReason(body.reason);
  if (!reason) return badRequest(`Give a reason to ${body.action} this review.`);

  const db = context.env.DB;
  if (body.action === 'remove') {
    const review = await db.prepare('SELECT * FROM agent_reviews WHERE id = ?').bind(id).first();
    if (!review) return notFound('Review not found.');
    if (await isRecused(db, review.request_type, review.request_id)) return json({ error: RECUSED_ERROR, code: 'recused' }, { status: 403 });
    const agent = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(review.agent_user_id).first();
    // One batch: the copy is logged, the review leaves every page, and the reviewer is told why.
    await db.batch([
      db.prepare('INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
        .bind(user.id, REMOVE_ACTION, 'agent_review', id, JSON.stringify({ reason, review })),
      db.prepare('DELETE FROM agent_reviews WHERE id = ?').bind(id),
      db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)")
        .bind(review.reviewer_user_id, `Your review of ${agent ? agent.display_name : 'an agent'} was removed: ${reason}`, `/profile/${review.agent_user_id}`),
    ]);
    return json({ ok: true, status: 'removed' });
  }

  // restore
  const removal = await findRemoval(db, id);
  if (!removal) return notFound('No removed review to restore.');
  const r = removal.review;
  if (await isRecused(db, r.request_type, r.request_id)) return json({ error: RECUSED_ERROR, code: 'recused' }, { status: 403 });
  const people = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?)').bind(r.agent_user_id, r.reviewer_user_id).first();
  if (people.n < (r.agent_user_id === r.reviewer_user_id ? 1 : 2)) return json({ error: 'The agent or the reviewer has deleted their account, so this review can\'t come back.', code: 'gone' }, { status: 409 });
  const newer = await db.prepare('SELECT 1 FROM agent_reviews WHERE id = ? OR (request_type = ? AND request_id = ? AND reviewer_user_id = ?)')
    .bind(id, r.request_type, r.request_id, r.reviewer_user_id).first();
  if (newer) return json({ error: 'This homeowner has posted a newer review of that hire, so the old one can\'t be restored.', code: 'conflict' }, { status: 409 });
  await db.batch([
    db.prepare(`INSERT INTO agent_reviews (id, agent_user_id, reviewer_user_id, request_type, request_id, rating, comment, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, r.agent_user_id, r.reviewer_user_id, r.request_type, r.request_id, r.rating, r.comment || '', r.created_at),
    db.prepare('INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, RESTORE_ACTION, 'agent_review', id, JSON.stringify({ reason })),
  ]);
  return json({ ok: true, status: 'published' });
}
