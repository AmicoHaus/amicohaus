import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { hideContent, pauseListingForModeration, cleanReason, REASON_REQUIRED_ERROR } from '../../../_lib/moderation.js';

// { action: 'resolve' | 'dismiss' } closes a report. { action: 'hide_target', reason } (the older 'delete_target'
// means the same) takes the reported thing down without deleting it (Rudy 11.04): a post or comment is hidden and its
// author is told the reason; a listing is paused and its owner is told. A reported person can't be "hidden": the
// admin resolves the report and, if needed, suspends the account from the user page.
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const action = body.action === 'delete_target' ? 'hide_target' : body.action;
  if (!['resolve', 'dismiss', 'hide_target'].includes(action)) return badRequest('Invalid action.');

  const db = context.env.DB;
  const report = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return notFound('Report not found.');

  if (action === 'hide_target') {
    const reason = cleanReason(body.reason);
    if (!reason) return json({ error: REASON_REQUIRED_ERROR, code: 'reason_required' }, { status: 400 });
    if (report.target_type === 'post' || report.target_type === 'comment') {
      await hideContent(db, report.target_type, report.target_id, reason);
    } else if (report.target_type === 'listing') {
      // hidden_at marks the pause as moderation, so the owner can't simply reactivate it (listings/[id].js PUT); the
      // owner gets the same notice as when an admin pauses it directly.
      await pauseListingForModeration(db, report.target_id, reason);
    } else if (report.target_type === 'past_client_review') {
      return badRequest('Remove a past-client review with the past-client review tool (Admin › Past-client reviews), then resolve this report.');
    } else {
      return badRequest('A report about a person is resolved or dismissed; suspend the account from the user page if needed.');
    }
    await logAdminAction(db, user.id, 'hide_reported_content', report.target_type, report.target_id, { reportId: id, reason });
  }

  const status = action === 'dismiss' ? 'dismissed' : 'resolved';
  await db.prepare("UPDATE reports SET status = ?, resolved_at = datetime('now') WHERE id = ?").bind(status, id).run();
  await logAdminAction(db, user.id, `report_${status}`, 'report', id);

  return json({ ok: true });
}
