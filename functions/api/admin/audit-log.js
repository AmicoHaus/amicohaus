import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../_lib/util.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT admin_audit_log.*, users.display_name AS admin_name
     FROM admin_audit_log JOIN users ON users.id = admin_audit_log.admin_user_id
     ORDER BY admin_audit_log.created_at DESC LIMIT 200`
  ).all();

  return json({ log: rows.results });
}
