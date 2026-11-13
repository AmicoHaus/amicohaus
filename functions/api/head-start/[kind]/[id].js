import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../_lib/util.js';
import { toolLive } from '../../../_lib/nuancedGate.js';
import { openHeadStartListing, announceOpenedListing } from '../../../_lib/watchAreas.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// "Open to everyone now": the owner ends their home's head start early (kind: listing or pre_listing).
// A trade listing becomes active in the request and the alerts it skipped at create run after the response; a
// pre-listing's member teaser simply stops waiting. A listing an admin paused stays paused.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'headStart', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const { kind } = context.params;
  const id = Number(context.params.id);
  if (!Number.isInteger(id) || (kind !== 'listing' && kind !== 'pre_listing')) return notFound('Not found.');
  const db = context.env.DB;

  if (kind === 'pre_listing') {
    const result = await db.prepare('UPDATE pre_listings SET head_start_until = NULL WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    if (!result.meta.changes) return notFound('Home not found.');
    return json({ ok: true, opened: true }, NO_STORE);
  }

  const opened = await openHeadStartListing(db, id, user.id);
  if (opened) {
    context.waitUntil(announceOpenedListing(context, id));
    return json({ ok: true, opened: true }, NO_STORE);
  }
  // Nothing changed. A second tap on the owner's own listing is fine; anything else isn't theirs to open.
  const mine = await db.prepare('SELECT 1 FROM listings WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!mine) return notFound('Home not found.');
  return json({ ok: true, opened: false }, NO_STORE);
}
