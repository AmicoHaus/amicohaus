import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { hideCommentAs, unhideContent, reasonFrom } from '../../../_lib/moderation.js';

// POST { reason } hides a comment (moderation.js): an admin with a reason, or the home's owner on their own home's
// thread. POST { action: 'unhide' } puts it back (admins only). The author is told why it was hidden.
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const { body, reason } = await reasonFrom(context.request);

  if (body.action === 'unhide') {
    if (user.role !== 'admin') return forbidden('Admin only.');
    if (!(await unhideContent(db, 'comment', id))) return notFound('Comment not found.');
    await logAdminAction(db, user.id, 'unhide_comment', 'comment', id);
    return json({ ok: true, hidden: false });
  }

  const result = await hideCommentAs(db, user, id, reason);
  if (result.notFound) return notFound('Comment not found.');
  if (result.forbidden) return forbidden();
  if (result.error) return json({ error: result.error, code: result.code }, { status: 400 });
  if (result.asAdmin) await logAdminAction(db, user.id, 'hide_comment', 'comment', id, { reason: result.reason });
  return json({ ok: true, hidden: true });
}
