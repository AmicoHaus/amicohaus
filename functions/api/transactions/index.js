import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { openTransactionRequest, fetchMyTransactionRequests, fetchOpenTransactionRequests } from '../../_lib/transactions.js';
import { notifyTransactionOpened, notifyAgentsNewRequest } from '../../_lib/marketplaceNotify.js';

// ?mine=1 for the ones a signed-in user is a party to (either side); otherwise
// every open one, for agents browsing.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);

  if (url.searchParams.get('mine') === '1') {
    const transactions = await fetchMyTransactionRequests(db, user.id);
    return json({ transactions });
  }

  const transactions = await fetchOpenTransactionRequests(db);
  return json({ transactions });
}

// Opened from an existing mutual match — the client passes the two listing
// ids from a match card it's already looking at (functions/_lib/transactions.js
// re-verifies the two actually mutually match before creating anything).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await openTransactionRequest(context.env.DB, user.id, body.listingIdA, body.listingIdB, body.note);
  if (result.error) return badRequest(result.error);

  const db = context.env.DB;
  const row = await db.prepare('SELECT user_a_id, user_b_id FROM transaction_requests WHERE id = ?').bind(result.id).first();
  const otherUserId = row.user_a_id === user.id ? row.user_b_id : row.user_a_id;
  context.waitUntil(notifyTransactionOpened(context, result.id, otherUserId, user.id));
  if (result.isNew) context.waitUntil(notifyAgentsNewRequest(context, 'transaction', result.id));

  return json({ id: result.id }, { status: 201 });
}
