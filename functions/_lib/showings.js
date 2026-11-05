import { clampString } from './util.js';
import { notBlockedByOwnersSql } from './blocks.js';

// A proposed time to view the home in person, before the homeowner has committed to any one agent — gives the
// pre-listing's existing showing_notice_hours field (previously just displayed, never enforced) a real effect.
// beforeWrite: an optional async check run once the time is valid, before the request is saved (the route's
// per-person limit, rateLimits.js); when it returns false nothing is saved and the result is { rateLimited: true }.
export async function proposeShowing(db, preListingId, agentUserId, body, { beforeWrite = null } = {}) {
  const preListing = await db.prepare('SELECT status, showing_notice_hours FROM pre_listings WHERE id = ?').bind(preListingId).first();
  if (!preListing) return { error: 'Pre-listing not found.', status: 404 };
  if (preListing.status !== 'open') return { error: 'This pre-listing is closed, so it is no longer scheduling showings.' };

  const proposedAt = new Date(body.proposedAt);
  if (!body.proposedAt || Number.isNaN(proposedAt.getTime())) return { error: 'Pick a valid date and time.' };
  const hoursFromNow = (proposedAt - Date.now()) / 3600000;
  if (hoursFromNow < 0) return { error: 'Pick a time in the future.' };
  if (hoursFromNow < preListing.showing_notice_hours) {
    return { error: `This homeowner needs at least ${preListing.showing_notice_hours} hours' notice — pick a later time.` };
  }

  // One waiting request per agent per home, so the homeowner isn't asked again and again. Checked first so a refused
  // duplicate doesn't use up one of the agent's showing-request slots...
  const pending = await db.prepare("SELECT 1 FROM pre_listing_showings WHERE pre_listing_id = ? AND agent_user_id = ? AND status = 'pending'")
    .bind(preListingId, agentUserId).first();
  if (pending) return { error: SHOWING_PENDING_ERROR, code: 'showing_pending' };

  if (beforeWrite && !(await beforeWrite())) return { rateLimited: true };

  // ...and again in the same statement as the insert, so two requests sent at once can't both get in.
  const note = clampString(body.note, 300);
  const result = await db.prepare(
    `INSERT INTO pre_listing_showings (pre_listing_id, agent_user_id, proposed_at, note)
     SELECT ?1, ?2, ?3, ?4
     WHERE NOT EXISTS (SELECT 1 FROM pre_listing_showings WHERE pre_listing_id = ?1 AND agent_user_id = ?2 AND status = 'pending')`
  ).bind(preListingId, agentUserId, proposedAt.toISOString(), note).run();
  if (!(result.meta && result.meta.changes)) return { error: SHOWING_PENDING_ERROR, code: 'showing_pending' };
  return { id: result.meta.last_row_id };
}

export const SHOWING_PENDING_ERROR = 'You already have a showing request waiting for this home. You can change it or cancel it first.';

// The owner sees every request on their own pre-listing; an agent sees only their own — same privacy model as
// proposals (an agent isn't meant to see when a competitor wants to view the home). Each row carries the agent's
// DRE number and brokerage, since a showing request is a first point of contact. The owner's list leaves out
// suspended agents and agents blocked either way (the same rule as their proposals).
export async function fetchShowings(db, preListingId, { forAgentUserId } = {}) {
  const select = `SELECT pre_listing_showings.*, users.display_name AS agent_name,
                         agent_profiles.license_number AS agent_license_number, agent_profiles.brokerage_name AS agent_brokerage_name
                  FROM pre_listing_showings JOIN users ON users.id = pre_listing_showings.agent_user_id
                  LEFT JOIN agent_profiles ON agent_profiles.user_id = pre_listing_showings.agent_user_id`;
  const rows = forAgentUserId
    ? await db.prepare(`${select} WHERE pre_listing_id = ? AND agent_user_id = ? ORDER BY proposed_at ASC`).bind(preListingId, forAgentUserId).all()
    : await db.prepare(`${select} WHERE pre_listing_id = ?1 AND users.status = 'active'
                          AND ${notBlockedByOwnersSql('pre_listing', '?1', 'pre_listing_showings.agent_user_id')} ORDER BY proposed_at ASC`).bind(preListingId).all();
  return rows.results.map(r => ({
    id: r.id, agentUserId: r.agent_user_id, agentName: r.agent_name,
    agentLicenseNumber: r.agent_license_number || '', agentBrokerageName: r.agent_brokerage_name || '',
    proposedAt: r.proposed_at, note: r.note, status: r.status, createdAt: r.created_at,
  }));
}

export async function decideShowing(db, showingId, accepted) {
  await db.prepare("UPDATE pre_listing_showings SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(accepted ? 'accepted' : 'declined', showingId).run();
}

export async function cancelShowing(db, showingId) {
  await db.prepare("UPDATE pre_listing_showings SET status = 'canceled', updated_at = datetime('now') WHERE id = ?").bind(showingId).run();
}
