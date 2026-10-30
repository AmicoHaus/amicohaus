import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { validatePreviewInput, MAX_UPCOMING_PREVIEWS, fetchPreviews } from '../../../../_lib/sellerPrep.js';
import { notifyPreviewScheduled } from '../../../../_lib/marketplaceNotify.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preListing = await db.prepare('SELECT user_id, address, status FROM pre_listings WHERE id = ?').bind(context.params.id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  const isOwner = preListing.user_id === user.id;
  if (!isOwner && !(await isApprovedAgent(db, user.id))) return forbidden();
  if (!isOwner && preListing.status !== 'open') return json({ previews: [] });
  return json(await fetchPreviews(db, context.params.id, { isOwner, viewerId: user.id, address: preListing.address }));
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const id = context.params.id;
  const preListing = await db.prepare('SELECT user_id, status FROM pre_listings WHERE id = ?').bind(id).first();
  if (!preListing) return notFound('Pre-listing not found.');
  if (preListing.user_id !== user.id) return forbidden();
  if (preListing.status !== 'open') return badRequest('Only an open pre-listing can schedule a broker preview.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validatePreviewInput(body);
  if (validated.error) return badRequest(validated.error);
  const upcoming = await db.prepare('SELECT COUNT(*) AS n FROM pre_listing_previews WHERE pre_listing_id = ? AND ends_at > ?')
    .bind(id, new Date().toISOString()).first();
  if (upcoming.n >= MAX_UPCOMING_PREVIEWS) return badRequest(`You can have up to ${MAX_UPCOMING_PREVIEWS} upcoming preview windows.`);

  const d = validated.data;
  const result = await db.prepare('INSERT INTO pre_listing_previews (pre_listing_id, starts_at, ends_at, note) VALUES (?, ?, ?, ?)')
    .bind(id, d.startsAt, d.endsAt, d.note).run();
  context.waitUntil(notifyPreviewScheduled(context, id, d.startsAt).catch(err => console.log(`[preview notify failed] ${err.message}`)));
  return json({ id: result.meta.last_row_id }, { status: 201 });
}
