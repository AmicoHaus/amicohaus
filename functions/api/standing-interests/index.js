import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { sqlUtc } from '../../_lib/contactPolicy.js';
import {
  MAX_STANDING, STANDING_AGENT_ERROR, STANDING_MAX_ERROR, UNKNOWN_ZIP_ERROR, HOME_NOT_FOUND,
  validateStandingTarget, validateStandingTerms, standingGuard, standingExpiresAt, notifyStandingOwners,
  fetchMyStandingInterests, fetchReachingInterests,
} from '../../_lib/standingInterest.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Standing interest ("Not an offer to purchase", standingInterest.js). Mine: what I posted. ?for=owner: active
// interest that reaches my home (a home claim, an open pre-listing or an active trade listing of mine), terms only,
// newest first, never the member's name or anything about them. Never public. 1 statement + the session.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (new URL(context.request.url).searchParams.get('for') === 'owner') {
    return json({ interests: await fetchReachingInterests(db, user.id) }, NO_STORE);
  }
  return json({ interests: await fetchMyStandingInterests(db, user.id), max: MAX_STANDING }, NO_STORE);
}

// { target, amount, propertyType, minBeds, financing, timing, ack }: fixed choices and one amount; there is no
// free-text field and unknown keys are ignored. Not for anyone with an agent profile. The same target again updates
// the row and renews it. Owners it reaches get one in-app notice (never the operator). 4 statements + the session.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'standingOffer', user)) return notFound('Not found.');
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const target = validateStandingTarget(body.target);
  if (target.error) return target.status === 404 ? notFound(target.error) : badRequest(target.error);
  const terms = validateStandingTerms(body);

  const db = context.env.DB;
  const now = Date.now();
  const t = target.data;
  const guard = await standingGuard(db, user.id, t, now);
  if (guard.is_agent) return json({ error: STANDING_AGENT_ERROR, code: 'interest_not_for_agents' }, { status: 403 });
  if (terms.error) return badRequest(terms.error);
  if (t.kind === 'area' && !guard.zip_known) return badRequest(UNKNOWN_ZIP_ERROR);
  if (t.kind === 'pre_listing' && guard.pl_zip === null) return notFound(HOME_NOT_FOUND);
  // A new interest, or one that had expired or been withdrawn, counts toward the 5 at a time.
  const wasLive = !!guard.existing_live;
  if (!wasLive && guard.active_n >= MAX_STANDING) return badRequest(STANDING_MAX_ERROR);
  if (!(await claimUserAction(db, 'standing_interest', user.id))) return rateLimited();

  const d = terms.data;
  const nowSql = sqlUtc(now);
  const expiresAt = standingExpiresAt(now);
  // The cap is checked again inside the write, so two requests at once can't both get under it.
  const underCap = `(SELECT COUNT(*) FROM standing_interests WHERE user_id = ?1 AND status = 'active' AND expires_at > ?2) < ${MAX_STANDING}`;
  let id = guard.existing_id;
  let result;
  if (id) {
    result = await db.prepare(
      `UPDATE standing_interests SET amount = ?3, property_type = ?4, min_beds = ?5, financing = ?6, timing = ?7, street_label = ?8,
         status = 'active', expires_at = ?9, updated_at = datetime('now')${wasLive ? '' : ", created_at = datetime('now')"}
       WHERE id = ?10 AND user_id = ?1 AND ((status = 'active' AND expires_at > ?2) OR ${underCap})`
    ).bind(user.id, nowSql, d.amount, d.propertyType, d.minBeds, d.financing, d.timing, t.streetLabel, expiresAt, id).run();
  } else {
    result = await db.prepare(
      `INSERT INTO standing_interests (user_id, target_kind, zip, street_key, street_label, pre_listing_id, amount, property_type, min_beds, financing, timing, expires_at)
       SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13 WHERE ${underCap}`
    ).bind(user.id, nowSql, t.kind, t.zip, t.streetKey, t.streetLabel, t.preListingId, d.amount, d.propertyType, d.minBeds, d.financing, d.timing, expiresAt).run();
    id = result.meta.last_row_id;
  }
  if (!result.meta.changes) return badRequest(STANDING_MAX_ERROR);

  // Owners hear about a new interest (or one posted again after it lapsed), not about every edit of a live one.
  if (!wasLive) {
    context.waitUntil(notifyStandingOwners(db, context.env, { userId: user.id, kind: t.kind, zip: t.zip, streetKey: t.streetKey, preListingId: t.preListingId })
      .catch(err => console.log(`[standing interest notice failed] ${err && err.message}`)));
  }
  return json({ id, expiresAt, renewed: !!guard.existing_id }, { status: 201, ...NO_STORE });
}
