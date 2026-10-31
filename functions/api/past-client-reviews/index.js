import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { findInvite, validatePastClientReview } from '../../_lib/pastClientReviews.js';
import { notifyPastClientReview } from '../../_lib/marketplaceNotify.js';
import { alertAdmin } from '../../_lib/adminAlerts.js';

// One account can leave a few past-client reviews a day (for different agents); more than that looks like a farm.
const MAX_PER_REVIEWER_PER_DAY = 3;

// GET ?t=<token>: who the link is for (public, so the page can say "Review Jordan Ellis"), the period, and whether
// the signed-in visitor already reviewed them.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const token = new URL(context.request.url).searchParams.get('t');
  const invite = await findInvite(db, token);
  if (!invite) return notFound('This review link is no longer active. Ask the agent for a new one.');
  const user = await getSessionUser(context);
  let alreadyReviewed = false;
  if (user) {
    alreadyReviewed = !!(await db.prepare('SELECT 1 FROM past_client_reviews WHERE agent_user_id = ? AND reviewer_user_id = ?').bind(invite.user_id, user.id).first());
  }
  return json({
    agent: { userId: invite.user_id, name: invite.display_name, brokerage: invite.brokerage_name || '', licenseNumber: invite.license_number || '' },
    fromYear: invite.from_year, toYear: invite.to_year,
    signedIn: !!user, isTheAgent: !!user && user.id === invite.user_id, alreadyReviewed,
  });
}

// POST { token, rating, clientSide, saleYear, saleCity, saleAddress, comment }
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const invite = await findInvite(db, body.token);
  if (!invite) return notFound('This review link is no longer active. Ask the agent for a new one.');
  if (invite.user_id === user.id) return badRequest("You can't review yourself.");
  if (String(user.email || '').toLowerCase().endsWith('@demo.amicohaus.local')) return badRequest("Demo accounts can't leave reviews.");

  const checked = validatePastClientReview(body, { fromYear: invite.from_year, toYear: invite.to_year });
  if (checked.error) return badRequest(checked.error);
  // Someone who hired this agent on Amico Haus reviews them there, where it counts as a verified hire.
  const hiredHere = await db.prepare(
    `SELECT 1 FROM service_bids b
     LEFT JOIN pre_listings p ON b.request_type = 'pre_listing' AND p.id = b.request_id
     LEFT JOIN transaction_requests t ON b.request_type = 'transaction' AND t.id = b.request_id
     WHERE b.agent_user_id = ? AND b.status = 'accepted' AND (p.user_id = ? OR t.user_a_id = ? OR t.user_b_id = ?) LIMIT 1`
  ).bind(invite.user_id, user.id, user.id, user.id).first();
  if (hiredHere) return badRequest('You hired this agent on Amico Haus, so please leave your review on that request instead.');
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM past_client_reviews WHERE reviewer_user_id = ? AND created_at > datetime('now', '-1 day')").bind(user.id).first();
  if (recent.n >= MAX_PER_REVIEWER_PER_DAY) return badRequest('You have left several reviews today. Please come back tomorrow.');

  const d = checked.data;
  const r = await db.prepare(
    `INSERT OR IGNORE INTO past_client_reviews (agent_user_id, reviewer_user_id, rating, comment, client_side, sale_year, sale_city, sale_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(invite.user_id, user.id, d.rating, d.comment, d.clientSide, d.saleYear, d.saleCity, d.saleAddress).run();
  if (!r.meta || !r.meta.changes) return badRequest("You've already reviewed this agent.");

  context.waitUntil(notifyPastClientReview(context, invite.user_id).catch(() => {}));
  // A heads-up so reviews can be checked on the admin page: at most one per agent per day, and without the
  // reviewer's contact details or address (those stay on the admin page).
  // Claimed atomically on the agent's row, so two reviews at once can't both skip it or both send one.
  const due = await db.prepare(
    "UPDATE agent_profiles SET review_alert_sent_at = datetime('now') WHERE user_id = ? AND (review_alert_sent_at IS NULL OR review_alert_sent_at < datetime('now', '-1 day'))"
  ).bind(invite.user_id).run();
  if (due.meta && due.meta.changes === 1) {
    alertAdmin(context, user, {
      kind: 'past_client_review',
      subject: `New past-client review for ${invite.display_name}`,
      lines: [
        `A past client left a ${d.rating}-star review for ${invite.display_name} (${d.saleYear}, ${d.saleCity}).`,
        'Check it on the admin page under Past-client reviews.',
      ],
    });
  }
  return json({ ok: true }, { status: 201 });
}
