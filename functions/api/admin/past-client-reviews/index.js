import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../../_lib/util.js';

// The newest past-client reviews (including removed ones), so an admin can take down any that break the rules. The
// reviewer's email and the private street address are left out unless that review itself has an OPEN report from
// someone who isn't an admin (POST /api/reports targetType 'past_client_review'): the address is used only while a
// review reported as fake is being looked at, and other agents' past clients never land on the operator's screen
// otherwise (Rudy 11.04). Once that report is dismissed or resolved they're hidden again. A report an admin files, or
// a report about the person over something else, doesn't reveal anything.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  // ?before=<id> pages back through older reviews, 50 at a time.
  const before = Number(new URL(context.request.url).searchParams.get('before')) || 0;
  const rows = await context.env.DB.prepare(
    `SELECT r.*, a.display_name AS agent_name, rv.display_name AS reviewer_name, rv.email AS reviewer_email,
            EXISTS (SELECT 1 FROM reports JOIN users rp ON rp.id = reports.reporter_id
                    WHERE reports.target_type = 'past_client_review' AND reports.target_id = r.id AND reports.status = 'open'
                      AND rp.role != 'admin') AS reported
     FROM past_client_reviews r JOIN users a ON a.id = r.agent_user_id JOIN users rv ON rv.id = r.reviewer_user_id
     WHERE (?1 = 0 OR r.id < ?1)
     ORDER BY r.id DESC LIMIT 51`
  ).bind(before).all();
  const more = rows.results.length > 50;
  rows.results = rows.results.slice(0, 50);
  return json({
    more,
    reviews: rows.results.map(r => ({
      id: r.id, agentUserId: r.agent_user_id, agentName: r.agent_name, reviewerUserId: r.reviewer_user_id, reviewerName: r.reviewer_name,
      reported: !!r.reported,
      reviewerEmail: r.reported ? r.reviewer_email : null,
      rating: r.rating, comment: r.comment, clientSide: r.client_side, saleYear: r.sale_year, saleCity: r.sale_city,
      saleAddress: r.reported ? (r.sale_address || '') : null,
      status: r.status, removedReason: r.removed_reason, createdAt: r.created_at,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
