import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound, clampString } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';

// { action: 'remove', reason } takes a past-client review down (fake, abusive, or about something other than the
// agent's work, e.g. a neighborhood's residents); { action: 'restore' } puts it back. Both are on the activity log.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  const db = context.env.DB;
  const id = context.params.id;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['remove', 'restore'].includes(body.action)) return badRequest('action must be "remove" or "restore".');
  const reason = clampString(body.reason, 300);
  if (body.action === 'remove' && !reason) return badRequest('Say why it is being removed (kept on the activity log).');
  // Never your own: the account that runs Amico Haus can compete as an agent, and its reviews follow the same rule
  // as everyone's, so they need another admin.
  const r = await db.prepare('UPDATE past_client_reviews SET status = ?, removed_reason = ? WHERE id = ? AND agent_user_id != ?')
    .bind(body.action === 'remove' ? 'removed' : 'published', body.action === 'remove' ? reason : null, id, user.id).run();
  if (!r.meta || !r.meta.changes) {
    const own = await db.prepare('SELECT 1 FROM past_client_reviews WHERE id = ? AND agent_user_id = ?').bind(id, user.id).first();
    return own ? forbidden('This review is about your own agent profile, so another admin has to decide on it.') : notFound('Review not found.');
  }
  await logAdminAction(db, user.id, body.action === 'remove' ? 'remove_past_client_review' : 'restore_past_client_review', 'past_client_review', id, reason ? { reason } : undefined);
  return json({ ok: true });
}
