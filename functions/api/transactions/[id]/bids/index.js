import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { upsertBid } from '../../../../_lib/marketplace.js';
import { notifyNewBid } from '../../../../_lib/marketplaceNotify.js';
import { claimUserAction, rateLimited } from '../../../../_lib/rateLimits.js';
import { blockedWithPartners, DUAL_AGENCY_LINE } from '../../../../_lib/transactions.js';

export async function onRequestPost(context) {
  // A whole number, so '05' or '5.0' can't pose as a different request and slip past the per-request limit below.
  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound('Transaction request not found.');
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can submit proposals.');

  const transaction = await db.prepare('SELECT user_a_id, user_b_id, status, partner_confirmed_at FROM transaction_requests WHERE id = ?').bind(id).first();
  if (!transaction) return notFound('Transaction request not found.');
  if (transaction.user_a_id === user.id || transaction.user_b_id === user.id) {
    return forbidden("You can't bid on your own transaction.");
  }
  // Not shared with agents until the other partner confirms, and never across a block with either partner: the same
  // answer as a request that doesn't exist.
  if (!transaction.partner_confirmed_at || await blockedWithPartners(db, transaction, user.id)) return notFound('Transaction request not found.');
  if (transaction.status !== 'open') return badRequest('This transaction request is no longer open for proposals.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  // Per-person limit (rateLimits.js), counted once the proposal is valid and right before it's saved.
  const result = await upsertBid(db, 'transaction', id, user.id, body, {
    beforeWrite: () => claimUserAction(db, 'proposal', user.id, `transaction:${id}`),
  });
  if (result.rateLimited) return rateLimited();
  if (result.error) return badRequest(result.error);

  context.waitUntil(notifyNewBid(context, 'transaction', id, [transaction.user_a_id, transaction.user_b_id], user.id));
  return json({ ok: true, dualAgencyNote: DUAL_AGENCY_LINE }, { status: 201 });
}
