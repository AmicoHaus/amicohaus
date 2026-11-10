import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { buildSellerReport } from '../../_lib/sellerReport.js';

// The Monday seller report (sellerReport.js) for the signed-in person: whether it's on, and this week's report
// (the same lines as the email; null when they have no home it covers). PUT { optOut: true|false } stops it or turns
// it back on. Per person: private, no-store.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const full = await buildSellerReport(context.env.DB, user.id);
  let report = null;
  if (full) { const { email, duty, ...rest } = full; report = rest; }
  return json({ optOut: !!user.seller_report_opt_out, report }, NO_STORE);
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (typeof body.optOut !== 'boolean') return badRequest('optOut must be true or false.');
  await context.env.DB.prepare('UPDATE users SET seller_report_opt_out = ? WHERE id = ?').bind(body.optOut ? 1 : 0, user.id).run();
  return json({ ok: true, optOut: body.optOut }, NO_STORE);
}
