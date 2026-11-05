import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { isApprovedAgent } from '../../_lib/agents.js';
import { openTransactionRequest, fetchMyTransactionRequests, fetchOpenTransactionRequests, notifyPartnerToConfirm, notifyOpenerConfirmed } from '../../_lib/transactions.js';
import { notifyAgentsNewRequest } from '../../_lib/marketplaceNotify.js';

const PRIVATE = { headers: { 'Cache-Control': 'private, no-store' } };

// ?mine=1 for the ones a signed-in user is a party to (either side); otherwise every open one both partners
// confirmed, for approved agents browsing (anyone else gets an empty list: the two homes and owners aren't public).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);

  if (url.searchParams.get('mine') === '1') {
    const transactions = await fetchMyTransactionRequests(db, user.id);
    return json({ transactions }, PRIVATE);
  }

  if (user.role !== 'admin' && !(await isApprovedAgent(db, user.id))) return json({ transactions: [] }, PRIVATE);
  const transactions = await fetchOpenTransactionRequests(db, user.id);
  return json({ transactions }, PRIVATE);
}

// Opened from an existing mutual match — the client passes the two listing
// ids from a match card it's already looking at (functions/_lib/transactions.js
// re-verifies the two actually mutually match before creating anything).
// A new request waits for the other partner to confirm (POST /api/transactions/:id/confirm); agents hear about it
// only then. The other partner asking for the same trade counts as confirming.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const db = context.env.DB;
  const result = await openTransactionRequest(db, user.id, body.listingIdA, body.listingIdB, body.note);
  if (result.error) return badRequest(result.error);

  const row = await db.prepare('SELECT user_a_id, user_b_id, opened_by_user_id, partner_confirmed_at FROM transaction_requests WHERE id = ?').bind(result.id).first();
  const otherUserId = row.user_a_id === user.id ? row.user_b_id : row.user_a_id;
  if (result.isNew) context.waitUntil(notifyPartnerToConfirm(db, result.id, otherUserId, user.display_name));
  if (result.confirmedNow) {
    context.waitUntil(notifyOpenerConfirmed(db, result.id, row.opened_by_user_id, user.display_name));
    context.waitUntil(notifyAgentsNewRequest(context, 'transaction', result.id, null, [row.user_a_id, row.user_b_id]));
  }

  return json({ id: result.id, partnerConfirmed: !!row.partner_confirmed_at }, { status: 201 });
}
