import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { proposalsSealed } from '../../../_lib/decisionNight.js';
import { MOMENTS, setRepostOk } from '../../../_lib/moment.js';
import { alertAdmin } from '../../../_lib/adminAlerts.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Share Your Moment: the homeowner OKs (or takes back) Rudy reposting their own recording of Reveal Mode or their
// Hired! story. { moment: 'reveal'|'hired', ok: boolean }. Homeowner only (admins too get a 403). The recording itself
// never comes through here: the owner sends it to Rudy themselves.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const row = await db.prepare('SELECT id, user_id, status, city, state, proposals_due_at FROM pre_listings WHERE id = ?').bind(id).first();
  if (!row) return notFound('Pre-listing not found.');
  if (row.user_id !== user.id) return forbidden('Only the homeowner can do this.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const moment = body && body.moment;
  if (!MOMENTS.includes(moment)) return badRequest('Pick reveal or hired.');
  const ok = body.ok === true;

  // Taking an OK back is always allowed; giving one needs the moment to exist for this home.
  if (ok) {
    const available = moment === 'reveal'
      ? !!row.proposals_due_at && !proposalsSealed(row) && (row.status === 'open' || row.status === 'awarded')
      : row.status === 'awarded';
    if (!available) return json({ error: "This isn't available for this home yet.", code: 'not_available' }, { status: 409, ...NO_STORE });
  }

  const repost = await setRepostOk(db, row.id, user.id, moment, ok);
  if (ok) {
    // Capped like every admin alert; demo and test accounts never send one (alertAdmin skips them).
    alertAdmin(context, user, {
      kind: 'repost_ok',
      subject: 'A homeowner OK\'d a repost on Amico Haus',
      lines: [
        `Pre-listing #${row.id} in ${row.city}, ${row.state}`,
        `Moment: ${moment === 'reveal' ? 'Reveal Mode' : 'Hired! story'}`,
        'They send the recording themselves. See Repost OKs on the admin page.',
      ],
    });
  }
  return json({ ok: true, repost }, NO_STORE);
}
