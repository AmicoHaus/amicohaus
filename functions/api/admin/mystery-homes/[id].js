import { getSessionUser } from '../../../_lib/auth.js';
import { logAdminAction } from '../../../_lib/audit.js';
import { deleteR2Keys } from '../../../_lib/r2Cleanup.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { validateMysteryHome, mysteryState, scheduleProblems, RETIRE_AFTER_DAYS } from '../../../_lib/mysteryHomes.js';

// Edit, schedule, unschedule, retire or delete one Mystery Home (admin only, every write on the activity log).
// A home that is live or revealed can only be retired (or deleted): its public page must keep matching what people
// already saw. Scheduling needs every gate in scheduleProblems (both written-OK dates, 3+ photos all checked in
// Privacy Sweep, photo rights, publish and reveal times, a sale closed 30+ days ago) and sets the retire time to
// 8 weeks after the reveal.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const DAY_MS = 86400000;
const retireAtFor = (revealAt) => new Date(Date.parse(revealAt) + RETIRE_AFTER_DAYS * DAY_MS).toISOString();

async function adminAndHome(context) {
  const user = await getSessionUser(context);
  if (!user) return { res: unauthorized() };
  if (user.role !== 'admin') return { res: forbidden('Admin only.') };
  const id = Number(context.params.id);
  const home = Number.isInteger(id) && id > 0
    ? await context.env.DB.prepare('SELECT * FROM mystery_homes WHERE id = ?').bind(id).first()
    : null;
  if (!home) return { res: notFound('Mystery Home not found.') };
  return { user, home };
}

const notReady = (missing) => json({ error: 'Not ready to schedule yet.', code: 'not_ready', missing }, { status: 409, ...NO_STORE });

export async function onRequestPut(context) {
  const { res, user, home } = await adminAndHome(context);
  if (res) return res;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const db = context.env.DB;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const state = mysteryState(home, nowIso);
  const action = body && body.action;

  if (action === 'retire') {
    const retireAt = home.retire_at && home.retire_at < nowIso ? home.retire_at : nowIso;
    await db.prepare("UPDATE mystery_homes SET status = 'retired', retire_at = ?, updated_at = datetime('now') WHERE id = ?").bind(retireAt, home.id).run();
    await logAdminAction(db, user.id, 'retire_mystery_home', 'mystery_home', home.id, { from: state });
    return json({ ok: true, state: 'retired' }, NO_STORE);
  }
  if (state === 'live' || state === 'revealed') {
    return json({ error: 'This Mystery Home is public now. You can only retire it.', code: 'live' }, { status: 409, ...NO_STORE });
  }
  if (state === 'retired') {
    return json({ error: 'This Mystery Home is retired. Delete it, or add it again as a new one.', code: 'retired' }, { status: 409, ...NO_STORE });
  }
  const photos = async () => (await db.prepare('SELECT swept_at FROM mystery_home_photos WHERE mystery_home_id = ?').bind(home.id).all()).results || [];

  if (action === 'schedule') {
    const missing = scheduleProblems(home, await photos(), nowMs);
    if (missing.length) return notReady(missing);
    await db.prepare("UPDATE mystery_homes SET status = 'scheduled', retire_at = ?, updated_at = datetime('now') WHERE id = ?").bind(retireAtFor(home.reveal_at), home.id).run();
    await logAdminAction(db, user.id, 'schedule_mystery_home', 'mystery_home', home.id, { publishAt: home.publish_at, revealAt: home.reveal_at });
    return json({ ok: true, state: mysteryState({ ...home, status: 'scheduled', retire_at: retireAtFor(home.reveal_at) }, nowIso) }, NO_STORE);
  }
  if (action === 'unschedule') {
    await db.prepare("UPDATE mystery_homes SET status = 'draft', retire_at = NULL, updated_at = datetime('now') WHERE id = ?").bind(home.id).run();
    await logAdminAction(db, user.id, 'unschedule_mystery_home', 'mystery_home', home.id, null);
    return json({ ok: true, state: 'draft' }, NO_STORE);
  }
  if (action !== undefined && action !== null) return badRequest('Pick schedule, unschedule or retire.');

  // A field edit (the whole form). A scheduled home stays scheduled only if it still passes every gate.
  const v = validateMysteryHome(body, { nowMs });
  if (v.error) return badRequest(v.error);
  const d = v.data;
  let retireAt = null;
  if (home.status === 'scheduled') {
    const missing = scheduleProblems({ ...home, ...d }, await photos(), nowMs);
    if (missing.length) return notReady(missing);
    retireAt = retireAtFor(d.reveal_at);
  }
  await db.prepare(
    `UPDATE mystery_homes SET source = ?, city = ?, state = ?, property_type = ?, beds = ?, baths = ?, sqft = ?, lot_sqft = ?,
       year_built = ?, highlights = ?, sold_price = ?, sold_month = ?, publish_at = ?, reveal_at = ?, seller_ok_on = ?,
       broker_ok_on = ?, photo_rights = ?, retire_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(d.source, d.city, d.state, d.property_type, d.beds, d.baths, d.sqft, d.lot_sqft, d.year_built, d.highlights,
    d.sold_price, d.sold_month, d.publish_at, d.reveal_at, d.seller_ok_on, d.broker_ok_on, d.photo_rights, retireAt, home.id).run();
  await logAdminAction(db, user.id, 'edit_mystery_home', 'mystery_home', home.id, { city: d.city, state: d.state });
  return json({ ok: true, state: mysteryState({ ...home, ...d, retire_at: retireAt }, nowIso) }, NO_STORE);
}

// Deleting works in any state (a live home can be pulled at once). Keys are read before the row goes (the photo
// rows cascade), then the files are removed from storage.
export async function onRequestDelete(context) {
  const { res, user, home } = await adminAndHome(context);
  if (res) return res;
  const db = context.env.DB;
  const keys = ((await db.prepare('SELECT r2_key FROM mystery_home_photos WHERE mystery_home_id = ?').bind(home.id).all()).results || []).map(r => r.r2_key);
  await db.prepare('DELETE FROM mystery_homes WHERE id = ?').bind(home.id).run();
  await deleteR2Keys(context.env.PHOTOS, keys);
  await logAdminAction(db, user.id, 'delete_mystery_home', 'mystery_home', home.id, { slug: home.slug, photos: keys.length });
  return json({ ok: true }, NO_STORE);
}
