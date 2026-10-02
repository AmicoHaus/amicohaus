import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT user_blocks.blocked_id, users.display_name
     FROM user_blocks JOIN users ON users.id = user_blocks.blocked_id
     WHERE user_blocks.blocker_id = ? ORDER BY user_blocks.created_at DESC`
  ).bind(user.id).all();

  return json({ blocked: rows.results });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const blockedId = Number(body.userId);
  if (!Number.isFinite(blockedId) || blockedId === user.id) return badRequest('Invalid user.');

  const db = context.env.DB;
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(blockedId).first();
  if (!target) return notFound('User not found.');

  await db.prepare('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)').bind(user.id, blockedId).run();
  return json({ ok: true }, { status: 201 });
}
