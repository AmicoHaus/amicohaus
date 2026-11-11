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

// Toy-box: { rv, sideAccess, workshop, ev240 } ticks -> toy_flags (1 RV/boat, 2 side access, 4 workshop, 8 240V/EV),
// plus minGateIn (24-480 inches) and minGarage (1-10 spaces); blank = no minimum (NULL).
const TOY_FLAG_BITS = { rv: 1, sideAccess: 2, workshop: 4, ev240: 8 };
const ticked = v => v === true || v === 1 || v === '1' || v === 'yes' || v === 'on';
function toyMin(v, min, max) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { value: null };
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN);
  return Number.isInteger(n) && n >= min && n <= max ? { value: n } : { error: true };
}
function toySearch(input) {
  const t = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  let toyFlags = 0;
  for (const [k, bit] of Object.entries(TOY_FLAG_BITS)) if (ticked(t[k])) toyFlags |= bit;
  const gate = toyMin(t.minGateIn, 24, 480);
  if (gate.error) return { error: 'Min gate opening should be whole inches from 24 to 480.' };
  const garage = toyMin(t.minGarage, 1, 10);
  if (garage.error) return { error: 'Min garage spaces should be a whole number from 1 to 10.' };
  return { data: { toyFlags, minGateIn: gate.value, minGarage: garage.value } };
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const rows = await context.env.DB.prepare(
    `SELECT id, locations, property_type, price_min, price_max, move_from, move_to, stay_offer_days,
            toy_flags, min_gate_in, min_garage, created_at
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
  // Toy-box (optional): parking and garage must-haves, matched only against what an owner said (toySearch above).
  const toy = toySearch(body.toy);
  if (toy.error) return badRequest(toy.error);
  const { toyFlags, minGateIn, minGarage } = toy.data;

  const db = context.env.DB;
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?').bind(user.id).first();
  if (n >= MAX_SAVED_SEARCHES) return json({ error: LIMIT_ERROR, code: 'saved_search_limit' }, { status: 400 });
  const dupSql = `SELECT 1 FROM saved_searches WHERE user_id = ?1 AND lower(locations) = lower(?2)
    AND property_type = ?3 AND price_min = ?4 AND price_max = ?5
    AND toy_flags = ?6 AND min_gate_in IS ?7 AND min_garage IS ?8`;
  const dup = await db.prepare(dupSql).bind(user.id, locations, propertyType, priceMin, priceMax, toyFlags, minGateIn, minGarage).first();
  if (dup) return json({ error: 'You already have this saved search.', code: 'saved_search_duplicate' }, { status: 400 });

  if (!(await claimUserAction(db, 'saved_search', user.id))) return rateLimited();

  // The cap and the duplicate check are repeated inside the insert, so two saves at the same moment can't get past them.
  // The duplicate check looks at the criteria only: timing is edited on a search (PUT), never a different search.
  const result = await db.prepare(
    `INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max, toy_flags, min_gate_in, min_garage,
       move_from, move_to, stay_offer_days)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
     WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) < ${MAX_SAVED_SEARCHES} AND NOT EXISTS (${dupSql})`
  ).bind(user.id, locations, propertyType, priceMin, priceMax, toyFlags, minGateIn, minGarage, moveFrom, moveTo, stayOfferDays).run();
  if (!result.meta.changes) return json({ error: LIMIT_ERROR, code: 'saved_search_limit' }, { status: 400 });

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
