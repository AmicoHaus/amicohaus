import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../../_lib/util.js';
import { REMOVE_ACTION, RESTORE_ACTION, operatorProposedSql } from '../../../_lib/agentReviewAdmin.js';

const PAGE = 100;

// Admin list of reviews of agents hired here: the newest published ones (?before=<id> pages back), and every removed
// one that hasn't been restored, with its reason. recused = an admin account proposed on that home, so the admin page
// shows "recused" instead of Remove / Restore.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const db = context.env.DB;
  const before = Number(new URL(context.request.url).searchParams.get('before'));
  const rows = await db.prepare(
    `SELECT r.id, r.agent_user_id, r.reviewer_user_id, r.request_type, r.request_id, r.rating, r.comment, r.created_at,
            agent.display_name AS agent_name, reviewer.display_name AS reviewer_name,
            ${operatorProposedSql('r.request_type', 'r.request_id')} AS recused
     FROM agent_reviews r
     JOIN users agent ON agent.id = r.agent_user_id JOIN users reviewer ON reviewer.id = r.reviewer_user_id
     WHERE (?1 = 0 OR r.id < ?1)
     ORDER BY r.id DESC LIMIT ${PAGE + 1}`
  ).bind(Number.isInteger(before) && before > 0 ? before : 0).all();
  const more = rows.results.length > PAGE;
  const reviews = rows.results.slice(0, PAGE).map(r => ({
    id: r.id, agentUserId: r.agent_user_id, agentName: r.agent_name, reviewerUserId: r.reviewer_user_id, reviewerName: r.reviewer_name,
    requestType: r.request_type, requestId: r.request_id, rating: r.rating, comment: r.comment, createdAt: r.created_at,
    status: 'published', recused: !!r.recused,
  }));

  // Removed and not restored since (the latest action on each review is a removal), and not back in the table.
  const removedRows = await db.prepare(
    `SELECT l.target_id, l.details, l.created_at FROM admin_audit_log l
     WHERE l.action = ?1 AND l.target_type = 'agent_review'
       AND NOT EXISTS (SELECT 1 FROM admin_audit_log x WHERE x.target_type = 'agent_review' AND x.target_id = l.target_id
                       AND x.action IN (?1, ?2) AND x.id > l.id)
       AND NOT EXISTS (SELECT 1 FROM agent_reviews WHERE agent_reviews.id = l.target_id)
     ORDER BY l.id DESC LIMIT 200`
  ).bind(REMOVE_ACTION, RESTORE_ACTION).all();
  const removed = [];
  for (const row of removedRows.results) {
    let d = null;
    try { d = JSON.parse(row.details || 'null'); } catch { d = null; }
    if (!d || !d.review) continue;
    const rv = d.review;
    const names = await db.prepare(
      `SELECT (SELECT display_name FROM users WHERE id = ?1) AS agent_name, (SELECT display_name FROM users WHERE id = ?2) AS reviewer_name,
              ${operatorProposedSql('?3', '?4')} AS recused`
    ).bind(rv.agent_user_id, rv.reviewer_user_id, rv.request_type, rv.request_id).first();
    removed.push({
      id: row.target_id, agentUserId: rv.agent_user_id, agentName: names.agent_name || '(deleted account)',
      reviewerUserId: rv.reviewer_user_id, reviewerName: names.reviewer_name || '(deleted account)',
      requestType: rv.request_type, requestId: rv.request_id, rating: rv.rating, comment: rv.comment, createdAt: rv.created_at,
      status: 'removed', removedAt: row.created_at, reason: d.reason || '', recused: !!names.recused,
    });
  }

  return json({ reviews, removed, more });
}
