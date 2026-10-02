import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../../_lib/util.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT reports.*, users.display_name AS reporter_name
     FROM reports JOIN users ON users.id = reports.reporter_id
     ORDER BY (reports.status = 'open') DESC, reports.created_at DESC LIMIT 200`
  ).all();

  return json({ reports: rows.results });
}
