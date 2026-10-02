import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { upsertBid } from '../../../../_lib/marketplace.js';
import { notifyNewBid } from '../../../../_lib/marketplaceNotify.js';

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can submit proposals.');

  const transaction = await db.prepare('SELECT user_a_id, user_b_id, status FROM transaction_requests WHERE id = ?').bind(id).first();
  if (!transaction) return notFound('Transaction request not found.');
  if (transaction.user_a_id === user.id || transaction.user_b_id === user.id) {
    return forbidden("You can't bid on your own transaction.");
  }
  if (transaction.status !== 'open') return badRequest('This transaction request is no longer open for proposals.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await upsertBid(db, 'transaction', id, user.id, body);
  if (result.error) return badRequest(result.error);

  context.waitUntil(notifyNewBid(context, 'transaction', id, [transaction.user_a_id, transaction.user_b_id], user.id));
  return json({ ok: true }, { status: 201 });
}
