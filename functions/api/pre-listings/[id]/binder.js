import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { fetchPreListingPhotos } from '../../../_lib/preListings.js';
import { validateBinder, binderForOwner } from '../../../_lib/handoffBinder.js';

// The handoff binder (handoffBinder.js): the homeowner's private house manual. Owner only, for every status: the
// hired agent, other agents and admins get 403. GET -> { binder, updatedAt, photoIds } (this home's photos, for the
// picker). PUT the whole binder -> { ok, updatedAt }. It notifies nobody, so there's no rate limit. private, no-store.
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const ONLY_OWNER = 'Only the homeowner can open the binder.';

async function ownerHome(context) {
  const user = await getSessionUser(context);
  if (!user) return { res: unauthorized() };
  const db = context.env.DB;
  const row = await db.prepare('SELECT id, user_id, binder_json, binder_updated_at FROM pre_listings WHERE id = ?').bind(Number(context.params.id)).first();
  if (!row) return { res: notFound('Pre-listing not found.') };
  if (row.user_id !== user.id) return { res: forbidden(ONLY_OWNER) };
  const photoIds = (await fetchPreListingPhotos(db, row.id)).map(p => p.id);
  return { user, row, photoIds, db };
}

export async function onRequestGet(context) {
  const h = await ownerHome(context);
  if (h.res) return h.res;
  return json({ binder: binderForOwner(h.row, h.photoIds), updatedAt: h.row.binder_updated_at || null, photoIds: h.photoIds }, NO_STORE);
}

export async function onRequestPut(context) {
  const h = await ownerHome(context);
  if (h.res) return h.res;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const v = validateBinder(body, h.photoIds);
  if (v.error) return json({ error: v.error }, { status: 400, ...NO_STORE });
  const saved = await h.db.prepare(
    "UPDATE pre_listings SET binder_json = ?, binder_updated_at = datetime('now') WHERE id = ? AND user_id = ? RETURNING binder_updated_at"
  ).bind(JSON.stringify(v.data), h.row.id, h.user.id).first();
  if (!saved) return notFound('Pre-listing not found.');
  return json({ ok: true, updatedAt: saved.binder_updated_at }, NO_STORE);
}
