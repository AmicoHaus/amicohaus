import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchMyDisputes, DISPUTES_GONE_ERROR } from '../../_lib/disputes.js';

// The signed-in person's own dispute history (filed before disputes were replaced by "Report a rules problem").
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const disputes = await fetchMyDisputes(context.env.DB, user.id);
  return json({ disputes, notice: DISPUTES_GONE_ERROR }, { headers: { 'Cache-Control': 'private, no-store' } });
}
