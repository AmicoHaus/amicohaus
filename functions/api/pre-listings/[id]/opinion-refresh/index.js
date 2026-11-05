import { getSessionUser } from '../../../../_lib/auth.js';
import { json, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { startOpinionRefresh } from '../../../../_lib/opinionTrail.js';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

// POST /api/pre-listings/:id/opinion-refresh: the homeowner asks the agents who gave a price opinion for a fresh look
// (Same or Update). Owner only (admins too get 403). Once per 90 days: the claim on opinions_refreshed_at is the limit,
// so there's no claimUserAction here. Allowed while the home is open (paused and a sealed Decision Night too: that
// seals proposals, not opinions); never after an award or close.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const row = await db.prepare('SELECT * FROM pre_listings WHERE id = ?').bind(context.params.id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden();
  const result = await startOpinionRefresh(context, row, user.id);
  if (result.error) {
    const out = { error: result.error, code: result.code };
    if (result.availableAt) out.availableAt = result.availableAt;
    return json(out, { status: 400, headers: NO_STORE });
  }
  return json({ ok: true, asked: result.asked }, { headers: NO_STORE });
}
