// When a pre-listing closes, an agent is hired, or it's deleted: upcoming broker previews come down (agents who
// RSVP'd are told, and with the window gone they no longer get the street address) and open interview requests
// are canceled (each agent is told). Only the hired agent's already-scheduled interview is kept; one still waiting
// for a time is canceled too, since a pre-listing that's no longer open can't take a pick.
//
// The status change that triggered this has already been saved, so nothing here may turn it into an error: the
// notifications go out in the background and every failure is only logged.
import { notifyPreviewCanceled, notifyInterviewCanceled } from './marketplaceNotify.js';

export async function wrapUpSellerPrep(context, preListingId, { keepAgentId = null } = {}) {
  const db = context.env.DB;
  const notices = [];
  try {
    const previews = await db.prepare('SELECT id, starts_at FROM pre_listing_previews WHERE pre_listing_id = ? AND ends_at > ?')
      .bind(preListingId, new Date().toISOString()).all();
    for (const pv of previews.results) {
      const rsvps = await db.prepare('SELECT agent_user_id FROM pre_listing_preview_rsvps WHERE preview_id = ?').bind(pv.id).all();
      await db.prepare('DELETE FROM pre_listing_previews WHERE id = ?').bind(pv.id).run();
      if (rsvps.results.length) notices.push(notifyPreviewCanceled(context, preListingId, rsvps.results.map(r => r.agent_user_id), pv.starts_at));
    }
    const open = await db.prepare("SELECT agent_user_id, status FROM pre_listing_interviews WHERE pre_listing_id = ? AND status IN ('requested','scheduled')")
      .bind(preListingId).all();
    for (const i of open.results) {
      if (i.agent_user_id === keepAgentId && i.status === 'scheduled') continue;
      await db.prepare("UPDATE pre_listing_interviews SET status = 'canceled', updated_at = datetime('now') WHERE pre_listing_id = ? AND agent_user_id = ?")
        .bind(preListingId, i.agent_user_id).run();
      notices.push(notifyInterviewCanceled(context, preListingId, i.agent_user_id));
    }
  } catch (err) {
    console.log(`[seller prep wrap-up failed] ${err.message}`);
  }
  const sending = Promise.allSettled(notices).then(results => results.forEach(r => {
    if (r.status === 'rejected') console.log(`[wrap-up notice failed] ${r.reason && r.reason.message}`);
  }));
  if (context.waitUntil) context.waitUntil(sending);
}
