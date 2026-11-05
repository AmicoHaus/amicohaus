import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { hidePostAs, unhideContent, reasonFrom } from '../../../_lib/moderation.js';

// POST { reason } hides someone else's post (admins only, reason required; moderation.js). POST { action: 'unhide' }
// puts it back. The author is told why it was hidden.
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  const db = context.env.DB;
  const { body, reason } = await reasonFrom(context.request);

  if (body.action === 'unhide') {
    if (!(await unhideContent(db, 'post', id))) return notFound('Post not found.');
    await logAdminAction(db, user.id, 'unhide_post', 'post', id);
    return json({ ok: true, hidden: false });
  }

  const result = await hidePostAs(db, user, id, reason);
  if (result.notFound) return notFound('Post not found.');
  if (result.forbidden) return forbidden();
  if (result.error) return json({ error: result.error, code: result.code }, { status: 400 });
  await logAdminAction(db, user.id, 'hide_post', 'post', id, { reason: result.reason });
  return json({ ok: true, hidden: true });
}
