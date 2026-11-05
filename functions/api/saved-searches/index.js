import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, clampString } from '../../_lib/util.js';
import { PROPERTY_TYPES, num } from '../../_lib/listings.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { validateSearchTiming } from '../../_lib/timingMatch.js';

const MAX_SAVED_SEARCHES = 10;
const MAX_PRICE = 500000000;
const LIMIT_ERROR = `You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Remove one to add another.`;
// A person's own searches (with any move-in window they added), so no browser or shared cache keeps them.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const rows = await context.env.DB.prepare(
    `SELECT id, locations, property_type, price_min, price_max, move_from, move_to, stay_offer_days, created_at
     FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC, id DESC`
  ).bind(user.id).all();
  return json({ searches: rows.results, max: MAX_SAVED_SEARCHES }, NO_STORE);
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const locations = clampString(body.locations, 200);
  if (!locations) return badRequest('Enter at least one location to watch.');
  const propertyType = body.propertyType === 'Any' || PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : 'Any';
  // num() clamps negatives and huge values and gives null for anything that isn't a number; blank means "no limit".
  const priceMin = Math.round(num(body.priceMin, { min: 0, max: MAX_PRICE }) || 0);
  const priceMax = Math.round(num(body.priceMax, { min: 0, max: MAX_PRICE }) || 0);
  if (priceMin && priceMax && priceMax < priceMin) return badRequest('Max price must be at or above the min price.');
  // Timing Match (optional): the move-in window this buyer needs and the stay-after days they could offer a seller.
  const timing = validateSearchTiming(body);
  if (timing.error) return badRequest(timing.error);
  const { moveFrom, moveTo, stayOfferDays } = timing.data;

  const db = context.env.DB;
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?').bind(user.id).first();
  if (n >= MAX_SAVED_SEARCHES) return json({ error: LIMIT_ERROR, code: 'saved_search_limit' }, { status: 400 });
  const dupSql = `SELECT 1 FROM saved_searches WHERE user_id = ?1 AND lower(locations) = lower(?2)
    AND property_type = ?3 AND price_min = ?4 AND price_max = ?5`;
  const dup = await db.prepare(dupSql).bind(user.id, locations, propertyType, priceMin, priceMax).first();
  if (dup) return json({ error: 'You already have this saved search.', code: 'saved_search_duplicate' }, { status: 400 });

  if (!(await claimUserAction(db, 'saved_search', user.id))) return rateLimited();

  // The cap and the duplicate check are repeated inside the insert, so two saves at the same moment can't get past them.
  // The duplicate check looks at the criteria only: timing is edited on a search (PUT), never a different search.
  const result = await db.prepare(
    `INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max, move_from, move_to, stay_offer_days)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
     WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) < ${MAX_SAVED_SEARCHES} AND NOT EXISTS (${dupSql})`
  ).bind(user.id, locations, propertyType, priceMin, priceMax, moveFrom, moveTo, stayOfferDays).run();
  if (!result.meta.changes) return json({ error: LIMIT_ERROR, code: 'saved_search_limit' }, { status: 400 });

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
