import { getSessionUser } from '../../../_lib/auth.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { json, badRequest, unauthorized, forbidden } from '../../../_lib/util.js';
import { validateMysteryHome, adminMysteryRow, slugify } from '../../../_lib/mysteryHomes.js';

// Mystery Home Monday, admin only (admin content, never user data: not in the account export or delete). Every write
// is on the admin activity log. No rate limit: admin only, and it notifies no one.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  const db = context.env.DB;
  const homes = (await db.prepare('SELECT * FROM mystery_homes ORDER BY created_at DESC, id DESC LIMIT 200').all()).results || [];
  const ids = homes.map(h => h.id);
  const photos = ids.length
    ? ((await db.prepare(
      `SELECT id, mystery_home_id, swept_at FROM mystery_home_photos
       WHERE mystery_home_id IN (SELECT value FROM json_each(?)) ORDER BY position, id`
    ).bind(JSON.stringify(ids)).all()).results || [])
    : [];
  const nowIso = new Date().toISOString();
  return json({
    homes: homes.map(h => ({
      ...adminMysteryRow(h, nowIso),
      photos: photos.filter(p => p.mystery_home_id === h.id).map(p => ({ id: p.id, swept: !!p.swept_at })),
    })),
  }, NO_STORE);
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const v = validateMysteryHome(body, { nowMs: Date.now() });
  if (v.error) return badRequest(v.error);
  const d = v.data;
  const slug = `${slugify(d.city)}-${crypto.randomUUID().slice(0, 6)}`;
  const db = context.env.DB;
  const result = await db.prepare(
    `INSERT INTO mystery_homes (slug, source, status, city, state, property_type, beds, baths, sqft, lot_sqft, year_built,
       highlights, sold_price, sold_month, publish_at, reveal_at, seller_ok_on, broker_ok_on, photo_rights, created_by)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(slug, d.source, d.city, d.state, d.property_type, d.beds, d.baths, d.sqft, d.lot_sqft, d.year_built,
    d.highlights, d.sold_price, d.sold_month, d.publish_at, d.reveal_at, d.seller_ok_on, d.broker_ok_on, d.photo_rights, user.id).run();
  const id = result.meta.last_row_id;
  await logAdminAction(db, user.id, 'create_mystery_home', 'mystery_home', id, { slug, city: d.city, state: d.state });
  return json({ id, slug }, { status: 201, ...NO_STORE });
}
