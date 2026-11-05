import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../../_lib/util.js';

// The reports queue. target_hidden: a reported post or comment that is already hidden, or a listing already paused by
// moderation (admin/reports/[id].js hides or pauses instead of deleting, so it's still there to look at).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT reports.*, users.display_name AS reporter_name,
            CASE reports.target_type
              WHEN 'post' THEN (SELECT hidden_at IS NOT NULL FROM posts WHERE posts.id = reports.target_id)
              WHEN 'comment' THEN (SELECT hidden_at IS NOT NULL FROM comments WHERE comments.id = reports.target_id)
              WHEN 'listing' THEN (SELECT hidden_at IS NOT NULL FROM listings WHERE listings.id = reports.target_id)
              ELSE 0 END AS target_hidden
     FROM reports JOIN users ON users.id = reports.reporter_id
     ORDER BY (reports.status = 'open') DESC, reports.created_at DESC LIMIT 200`
  ).all();

  return json({ reports: rows.results.map(r => ({ ...r, target_hidden: !!r.target_hidden })) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
