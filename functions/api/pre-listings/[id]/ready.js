import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { validCheckIn, readyWriteStatements, readyMeterForOwner, agentViewFor } from '../../../_lib/readyMeter.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Ready Meter: the owner's weekly check-in ({ readiness, topic }, open homes only) and their two settings
// ({ shareReadiness }, { remindersOff }, any status). Owner only: admins and agents get 403 too. No rate limit:
// nothing here notifies anyone, and one check-in per home per week caps the rows.
export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const row = await db.prepare('SELECT * FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!body || typeof body !== 'object') return badRequest('Invalid request body.');

  // Everything is checked before anything is written, so a refused check-in saves nothing.
  const wantsCheckIn = body.readiness !== undefined || body.topic !== undefined;
  let checkIn = null;
  if (wantsCheckIn) {
    const v = validCheckIn(body);
    if (v.error) return badRequest(v.error);
    if (row.status !== 'open') return json({ error: 'Weekly check-ins are for open pre-listings.', code: 'not_open' }, { status: 400, ...NO_STORE });
    checkIn = v.data;
  }
  const shareReadiness = typeof body.shareReadiness === 'boolean' ? body.shareReadiness : undefined;
  const remindersOff = typeof body.remindersOff === 'boolean' ? body.remindersOff : undefined;
  if (!checkIn && shareReadiness === undefined && remindersOff === undefined) return badRequest('Nothing to save.');

  await db.batch(readyWriteStatements(db, row.id, { checkIn, shareReadiness, remindersOff }));

  const fresh = await db.prepare('SELECT * FROM pre_listings WHERE id = ?').bind(row.id).first();
  const photos = await db.prepare('SELECT COUNT(*) AS n FROM pre_listing_photos WHERE pre_listing_id = ?').bind(row.id).first();
  const readyMeter = await readyMeterForOwner(db, fresh);
  const agentView = await agentViewFor(db, fresh, { isOwner: true, photoCount: photos ? photos.n : 0 });
  return json({ readyMeter, agentView }, NO_STORE);
}
