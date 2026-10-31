import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { validateDebriefReasons, sendFinalistDebrief } from '../../../_lib/decisionNight.js';

// After hiring, the homeowner can tell the finalists they didn't pick what tipped the decision: { reasons: [...] },
// up to 3 keys from DEBRIEF_REASONS. Each finalist hears it once; nobody learns who was hired or any fee.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const row = await db.prepare(
    `SELECT pre_listings.user_id, pre_listings.status, service_bids.agent_user_id AS hired_agent_id
     FROM pre_listings LEFT JOIN service_bids ON service_bids.id = pre_listings.awarded_bid_id
     WHERE pre_listings.id = ?`
  ).bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden();
  if (row.status !== 'awarded') return badRequest('You can send finalist feedback after you hire an agent.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const checked = validateDebriefReasons(body.reasons);
  if (checked.error) return badRequest(checked.error);

  const sent = await sendFinalistDebrief(context, id, row.hired_agent_id, checked.reasons);
  return json({ ok: true, sent });
}
