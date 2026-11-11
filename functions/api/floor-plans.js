import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized, clampString, DEMO_EMAIL_PATTERN } from '../_lib/util.js';

// GET /api/floor-plans?city=: the builder / plan / community spellings other owners already entered on live listings
// in that city that are listed with same-plan homes, so the listing form can suggest them (fewer misspelled twins).
// Signed-in only. No counts, ids or owners; not cached anywhere, so an owner who unticks the box drops out at once.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const city = clampString(new URL(context.request.url).searchParams.get('city'), 80);
  if (!city) return json({ plans: [] }, NO_STORE);
  const rows = await context.env.DB.prepare(
    `SELECT DISTINCT plan_builder, plan_name, plan_community FROM listings JOIN users ON users.id = listings.user_id
     WHERE listings.plan_twins = 1 AND listings.status = 'active' AND listings.city = ?1 COLLATE NOCASE
       AND users.status = 'active' AND users.email NOT LIKE ?2
     ORDER BY plan_builder, plan_name LIMIT 50`
  ).bind(city, DEMO_EMAIL_PATTERN).all();
  const plans = rows.results.map(r => ({ builder: r.plan_builder || '', name: r.plan_name || '', community: r.plan_community || '' }));
  return json({ plans }, NO_STORE);
}
