import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../../_lib/util.js';
import { canReviewHomeowners, submitHomeownerReview } from '../../../_lib/marketplace.js';

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await canReviewHomeowners(db, 'transaction', id, user.id))) {
    return forbidden('You can only review the homeowners on a transaction you were awarded.');
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await submitHomeownerReview(db, user.id, 'transaction', id, body);
  if (result.error) return badRequest(result.error);
  return json({ ok: true }, { status: 201 });
}
