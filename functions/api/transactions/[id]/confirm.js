import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../../_lib/util.js';
import { confirmTransactionRequest, notifyOpenerConfirmed } from '../../../_lib/transactions.js';
import { notifyAgentsNewRequest } from '../../../_lib/marketplaceNotify.js';

// POST: the partner who didn't open the trade request confirms it. Only then do approved agents hear about it, see
// it, send proposals, or get hired (one agent for both homes, or two agents under the same brokerage, is dual agency
// and needs both owners).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) return notFound('Transaction request not found.');

  const result = await confirmTransactionRequest(db, id, user.id);
  if (result.notFound) return notFound('Transaction request not found.');
  if (result.error) return badRequest(result.error);
  if (result.confirmedNow) {
    context.waitUntil(notifyOpenerConfirmed(db, id, result.row.opened_by_user_id, user.display_name));
    if (result.row.status === 'open') {
      context.waitUntil(notifyAgentsNewRequest(context, 'transaction', id, null, [result.row.user_a_id, result.row.user_b_id]));
    }
  }
  return json({ ok: true, partnerConfirmed: true });
}
