import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../../_lib/util.js';
import { canReviewHomeowners, submitHomeownerReview } from '../../../_lib/marketplace.js';

// The reciprocal side of review.js — the awarded agent rating the homeowner
// they worked with, so a homeowner's track record is visible to other
// agents deciding whether to bid, the same way Upwork lets a freelancer
// rate a client.
export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await canReviewHomeowners(db, 'pre_listing', id, user.id))) {
    return forbidden('You can only review the homeowner on a pre-listing you were awarded.');
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await submitHomeownerReview(db, user.id, 'pre_listing', id, body);
  if (result.error) return badRequest(result.error);
  return json({ ok: true }, { status: 201 });
}
