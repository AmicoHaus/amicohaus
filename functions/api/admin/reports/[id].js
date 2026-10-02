import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';

const DELETE_TABLE = { post: 'posts', comment: 'comments', listing: 'listings' };

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const action = body.action;
  if (!['resolve', 'dismiss', 'delete_target'].includes(action)) return badRequest('Invalid action.');

  const db = context.env.DB;
  const report = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return notFound('Report not found.');

  if (action === 'delete_target') {
    const table = DELETE_TABLE[report.target_type];
    if (table) {
      await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(report.target_id).run();
      await logAdminAction(db, user.id, 'delete_reported_content', report.target_type, report.target_id, { reportId: id });
    }
  }

  const status = action === 'dismiss' ? 'dismissed' : 'resolved';
  await db.prepare("UPDATE reports SET status = ?, resolved_at = datetime('now') WHERE id = ?").bind(status, id).run();
  await logAdminAction(db, user.id, `report_${status}`, 'report', id);

  return json({ ok: true });
}
