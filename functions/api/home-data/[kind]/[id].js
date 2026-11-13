import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { HOME_DATA_KINDS, HOME_DATA_GROUPS, validateHomeData } from '../../../_lib/homeData.js';
import { homeFactsFromRow } from '../../../_lib/homeFacts.js';
import { toolLive } from '../../../_lib/nuancedGate.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Saves the owner's bills and solar details, measurements, and signal tests on one of their own homes (a trade
// listing or a pre-listing). Body { runCosts?, fit?, signal? }: only the groups present are checked and written, and a
// group whose tool isn't live for this person is ignored (nuancedGate.js). The home forms call this right after saving
// the home, its costs and its facts. Nobody is notified and nothing is added up. 2 statements + the session.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const kind = context.params.kind;
  const table = Object.hasOwn(HOME_DATA_KINDS, kind) ? HOME_DATA_KINDS[kind] : null;
  if (!table) return notFound('Unknown kind of home.');

  const db = context.env.DB;
  const home = await db.prepare(`SELECT user_id, home_facts_json${table === 'listings' ? ', is_portfolio, is_buyer_only' : ''} FROM ${table} WHERE id = ?`)
    .bind(context.params.id).first();
  if (!home) return notFound('Home not found.');
  if (home.user_id !== user.id) return forbidden();
  // A portfolio is several homes and a buyer profile has none, so neither has one set of bills or rooms to describe.
  if (home.is_portfolio || home.is_buyer_only) {
    return json({ error: 'These details are for a single home you own.', code: 'data_not_for_this_listing' }, { status: 400 });
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const given = {};
  for (const [group, { tool }] of Object.entries(HOME_DATA_GROUPS)) {
    if (body && typeof body === 'object' && Object.hasOwn(body, group) && toolLive(context.env, tool, user)) given[group] = body[group];
  }
  const validated = validateHomeData(given, { kind, facts: homeFactsFromRow(home) });
  if (validated.error) return badRequest(validated.error);

  const groups = Object.keys(validated.data);
  if (groups.length) {
    await db.prepare(`UPDATE ${table} SET ${groups.map(g => `${HOME_DATA_GROUPS[g].column} = ?`).join(', ')} WHERE id = ?`)
      .bind(...groups.map(g => JSON.stringify(validated.data[g])), context.params.id).run();
  }
  return json({ ok: true, data: validated.data }, NO_STORE);
}
