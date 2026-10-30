import { getSessionUser } from '../../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../../_lib/util.js';
import { isApprovedAgent } from '../../../../_lib/agents.js';
import { notifyPreviewCanceled, notifyPreviewRsvp } from '../../../../_lib/marketplaceNotify.js';

async function loadPreview(db, preListingId, previewId) {
  return db.prepare(
    `SELECT pre_listing_previews.id, pre_listing_previews.starts_at, pre_listing_previews.ends_at,
            pre_listings.user_id AS owner_id, pre_listings.status
     FROM pre_listing_previews JOIN pre_listings ON pre_listings.id = pre_listing_previews.pre_listing_id
     WHERE pre_listing_previews.id = ? AND pre_listing_previews.pre_listing_id = ?`
  ).bind(previewId, preListingId).first();
}

// An approved agent RSVPs ({ going: true }) or takes it back ({ going: false }).
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preview = await loadPreview(db, context.params.id, context.params.previewId);
  if (!preview) return notFound('Preview not found.');
  if (preview.owner_id === user.id) return forbidden("You can't RSVP to your own preview.");
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Only approved agents can RSVP.');
  if (preview.status !== 'open') return badRequest('This pre-listing is closed.');
  if (new Date(preview.ends_at).getTime() <= Date.now()) return badRequest('This preview has already ended.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (body.going) {
    const added = await db.prepare('INSERT OR IGNORE INTO pre_listing_preview_rsvps (preview_id, agent_user_id) VALUES (?, ?)').bind(preview.id, user.id).run();
    if (added.meta && added.meta.changes) {
      context.waitUntil(notifyPreviewRsvp(context, context.params.id, preview.owner_id, user.id, preview.starts_at).catch(err => console.log(`[rsvp notify failed] ${err.message}`)));
    }
  } else {
    await db.prepare('DELETE FROM pre_listing_preview_rsvps WHERE preview_id = ? AND agent_user_id = ?').bind(preview.id, user.id).run();
  }
  return json({ ok: true, going: !!body.going });
}

// The owner cancels a window; agents who RSVP'd are told.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const preview = await loadPreview(db, context.params.id, context.params.previewId);
  if (!preview) return notFound('Preview not found.');
  if (preview.owner_id !== user.id) return forbidden();
  const rsvps = await db.prepare('SELECT agent_user_id FROM pre_listing_preview_rsvps WHERE preview_id = ?').bind(preview.id).all();
  await db.prepare('DELETE FROM pre_listing_previews WHERE id = ?').bind(preview.id).run();
  if (new Date(preview.ends_at).getTime() > Date.now() && rsvps.results.length) {
    context.waitUntil(notifyPreviewCanceled(context, context.params.id, rsvps.results.map(r => r.agent_user_id), preview.starts_at)
      .catch(err => console.log(`[preview cancel notify failed] ${err.message}`)));
  }
  return json({ ok: true });
}
