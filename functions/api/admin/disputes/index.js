import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, forbidden } from '../../../_lib/util.js';
import { fetchAdminDisputes } from '../../../_lib/disputes.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const url = new URL(context.request.url);
  const status = ['open', 'resolved', 'dismissed'].includes(url.searchParams.get('status'))
    ? url.searchParams.get('status') : 'open';

  const disputes = await fetchAdminDisputes(context.env.DB, status);
  return json({ disputes });
}
