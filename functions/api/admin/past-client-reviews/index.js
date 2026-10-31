import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../../_lib/util.js';

// The newest past-client reviews (including removed ones), with the private address and the reviewer's email, so an
// admin can check them and take down any that break the rules.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  // ?before=<id> pages back through older reviews, 50 at a time.
  const before = Number(new URL(context.request.url).searchParams.get('before')) || 0;
  const rows = await context.env.DB.prepare(
    `SELECT r.*, a.display_name AS agent_name, rv.display_name AS reviewer_name, rv.email AS reviewer_email
     FROM past_client_reviews r JOIN users a ON a.id = r.agent_user_id JOIN users rv ON rv.id = r.reviewer_user_id
     WHERE (?1 = 0 OR r.id < ?1)
     ORDER BY r.id DESC LIMIT 51`
  ).bind(before).all();
  const more = rows.results.length > 50;
  rows.results = rows.results.slice(0, 50);
  return json({
    more,
    reviews: rows.results.map(r => ({
      id: r.id, agentUserId: r.agent_user_id, agentName: r.agent_name, reviewerName: r.reviewer_name, reviewerEmail: r.reviewer_email,
      rating: r.rating, comment: r.comment, clientSide: r.client_side, saleYear: r.sale_year, saleCity: r.sale_city, saleAddress: r.sale_address,
      status: r.status, removedReason: r.removed_reason, createdAt: r.created_at,
    })),
  });
}
