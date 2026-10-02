import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../../_lib/util.js';
import { resolveDispute } from '../../../_lib/disputes.js';
import { logAdminAction } from '../../../_lib/audit.js';

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const id = context.params.id;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['resolved', 'dismissed'].includes(body.status)) return badRequest('status must be "resolved" or "dismissed".');

  await resolveDispute(context.env.DB, id, user.id, body.status, body.adminNotes);
  await logAdminAction(context.env.DB, user.id, `dispute_${body.status}`, 'dispute', id);

  return json({ ok: true });
}
