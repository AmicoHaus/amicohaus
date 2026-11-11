import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { HOME_KINDS, validateHomeFacts } from '../../../_lib/homeFacts.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Saves the owner's home facts (yard and sun, parking and garage, pets; on a pre-listing also the floor plan) on one
// of their own homes. The pre-listing, AugmentedHomes and GreenHomes forms and the in-place editors call this right
// after saving the home and its costs; a regular listing sends its facts in the listing body instead (one request,
// so a saved search sees them at create). Text runs the fair-housing, address and code checks (homeFacts.js).
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const kind = context.params.kind;
  const table = Object.hasOwn(HOME_KINDS, kind) ? HOME_KINDS[kind] : null;
  if (!table) return notFound('Unknown kind of home.');

  const db = context.env.DB;
  const home = await db.prepare(`SELECT user_id${table === 'listings' ? ', is_rental, is_portfolio, is_buyer_only' : ''} FROM ${table} WHERE id = ?`)
    .bind(context.params.id).first();
  if (!home) return notFound('Home not found.');
  if (home.user_id !== user.id) return forbidden();
  // A portfolio is several homes and a buyer profile has none, so neither has one yard or garage to describe.
  if (home.is_portfolio || home.is_buyer_only) {
    return json({ error: 'Home facts are for a single home you own.', code: 'facts_not_for_this_listing' }, { status: 400 });
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateHomeFacts(body, { kind, isRental: !!home.is_rental });
  if (validated.error) return badRequest(validated.error);
  await db.prepare(`UPDATE ${table} SET home_facts_json = ? WHERE id = ?`).bind(JSON.stringify(validated.data), context.params.id).run();
  return json({ ok: true, facts: validated.data }, NO_STORE);
}
