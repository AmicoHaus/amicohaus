import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { liveTools } from '../../../_lib/nuancedGate.js';
import { validateListingTerms, termsForEdit, termsUpdateSql, creditTermsProblem } from '../../../_lib/listingTerms.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const TERMS_KINDS = { listing: 'listings', pre_listing: 'pre_listings' };

// Saves the owner's terms on one of their own homes: the ranked wish list (fixed keys, never free text) and the two
// yes/no financing flags. The pre-listing form and the in-place editors call this; a trade listing also sends its
// terms in the listing body (one request, so a saved search sees them at create). Only what the body sent AND this
// person's live tools cover (nuancedGate.js) is written. With a financing flag on, the home's title, neighborhood
// and description can't state loan terms. One UPDATE; 2 statements + the session.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  const live = liveTools(context.env, user);
  if (!live.termsWishlist && !live.ownerCarry) return notFound('Not found.');
  if (!user) return unauthorized();
  const kind = context.params.kind;
  const table = Object.hasOwn(TERMS_KINDS, kind) ? TERMS_KINDS[kind] : null;
  if (!table) return notFound('Unknown kind of home.');

  const db = context.env.DB;
  const home = await db.prepare(
    `SELECT user_id, title, neighborhood, description${table === 'listings' ? ', is_rental, is_portfolio, is_buyer_only' : ''} FROM ${table} WHERE id = ?`
  ).bind(context.params.id).first();
  if (!home) return notFound('Home not found.');
  if (home.user_id !== user.id) return forbidden();
  // A portfolio is several homes and a buyer profile has none, so neither has sale terms of its own.
  if (home.is_portfolio || home.is_buyer_only) {
    return json({ error: 'Terms are for a single home you own.', code: 'terms_not_for_this_listing' }, { status: 400 });
  }

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateListingTerms(body, { kind, isRental: !!home.is_rental });
  if (validated.error) return badRequest(validated.error);
  const partial = termsForEdit(body, validated.data, live);
  // Checked when the flags are saved (a flagged home's text is checked again whenever that text is edited).
  if (partial.ownerCarry !== undefined && (partial.ownerCarry || partial.assumable)) {
    const creditError = creditTermsProblem(`${home.title || ''} ${home.neighborhood || ''} ${home.description || ''}`);
    if (creditError) return badRequest(creditError);
  }
  const { cols, values } = termsUpdateSql(partial);
  if (cols.length) await db.prepare(`UPDATE ${table} SET ${cols.join(', ')} WHERE id = ?`).bind(...values, context.params.id).run();
  return json({ ok: true, terms: partial }, NO_STORE);
}
