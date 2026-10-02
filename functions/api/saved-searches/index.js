import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, clampString } from '../../_lib/util.js';

const PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const rows = await context.env.DB.prepare(
    'SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return json({ searches: rows.results });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const locations = clampString(body.locations, 200);
  if (!locations) return badRequest('Enter at least one location to watch.');
  const propertyType = body.propertyType === 'Any' || PROPERTY_TYPES.includes(body.propertyType) ? body.propertyType : 'Any';
  const priceMin = Number(body.priceMin) || 0;
  const priceMax = Number(body.priceMax) || 0;

  const result = await context.env.DB.prepare(
    'INSERT INTO saved_searches (user_id, locations, property_type, price_min, price_max) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, locations, propertyType, priceMin, priceMax).run();

  return json({ id: result.meta.last_row_id }, { status: 201 });
}
