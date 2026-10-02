import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, clampString } from '../../_lib/util.js';

const TARGET_TYPES = ['post', 'comment', 'listing', 'user'];

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const targetType = TARGET_TYPES.includes(body.targetType) ? body.targetType : null;
  const targetId = Number(body.targetId);
  const reason = clampString(body.reason, 500);
  if (!targetType || !Number.isFinite(targetId) || !reason) {
    return badRequest('Missing target type, target id, or reason.');
  }

  const db = context.env.DB;
  await db.prepare(
    'INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)'
  ).bind(user.id, targetType, targetId, reason).run();

  return json({ ok: true }, { status: 201 });
}
