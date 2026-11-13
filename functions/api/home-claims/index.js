import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { validZip } from '../../_lib/ideaText.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import {
  MAX_HOME_CLAIMS, HOME_CLAIM_AGENT_ERROR, HOME_CLAIM_ACK_ERROR, HOME_CLAIM_MAX_ERROR, HOME_CLAIM_DUPLICATE_ERROR, UNKNOWN_ZIP_ERROR,
  validateStreet, fetchHomeClaims, homeClaimGuard,
} from '../../_lib/standingInterest.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// A homeowner's own note of where their home is (ZIP + optional street name, never a house number), so standing
// interest for that street or ZIP reaches them even when the home isn't on the site. Private: only the person who
// wrote it ever sees it, it is not checked, and it is never a badge.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  return json({ claims: await fetchHomeClaims(context.env.DB, user.id), max: MAX_HOME_CLAIMS }, NO_STORE);
}

// { zip, street, ack }. Refused for anyone with an agent profile. 3 statements + the session.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!validZip(body.zip)) return badRequest('ZIP code should be 5 digits.');
  const street = validateStreet(body.street);
  if (street.error) return badRequest(street.error);
  if (body.ack !== true) return badRequest(HOME_CLAIM_ACK_ERROR);

  const db = context.env.DB;
  const zip = String(body.zip);
  const guard = await homeClaimGuard(db, user.id, zip, street.key);
  if (guard.is_agent) return json({ error: HOME_CLAIM_AGENT_ERROR, code: 'claims_not_for_agents' }, { status: 403 });
  if (!guard.zip_known) return badRequest(UNKNOWN_ZIP_ERROR);
  if (guard.dup) return badRequest(HOME_CLAIM_DUPLICATE_ERROR);
  if (guard.claim_n >= MAX_HOME_CLAIMS) return badRequest(HOME_CLAIM_MAX_ERROR);
  if (!(await claimUserAction(db, 'home_claim', user.id))) return rateLimited();

  // The cap is checked again in the same statement, so two requests at once can't both get under it.
  const result = await db.prepare(
    `INSERT OR IGNORE INTO home_claims (user_id, zip, street_key, street_label) SELECT ?1, ?2, ?3, ?4
     WHERE (SELECT COUNT(*) FROM home_claims WHERE user_id = ?1) < ${MAX_HOME_CLAIMS}`
  ).bind(user.id, zip, street.key, street.label).run();
  if (!result.meta.changes) return badRequest(HOME_CLAIM_MAX_ERROR);
  return json({ id: result.meta.last_row_id, zip, street: street.label }, { status: 201, ...NO_STORE });
}
