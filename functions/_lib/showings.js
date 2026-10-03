import { clampString } from './util.js';

// A proposed time to view the home in person, before the homeowner has committed to any one agent — gives the
// pre-listing's existing showing_notice_hours field (previously just displayed, never enforced) a real effect.
export async function proposeShowing(db, preListingId, agentUserId, body) {
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

  const note = clampString(body.note, 300);
  const result = await db.prepare(
    `INSERT INTO pre_listing_showings (pre_listing_id, agent_user_id, proposed_at, note) VALUES (?, ?, ?, ?)`
  ).bind(preListingId, agentUserId, proposedAt.toISOString(), note).run();
  return { id: result.meta.last_row_id };
}

// The owner sees every request on their own pre-listing; an agent sees only their own — same privacy model as
// proposals (an agent isn't meant to see when a competitor wants to view the home).
export async function fetchShowings(db, preListingId, { forAgentUserId } = {}) {
  const rows = forAgentUserId
    ? await db.prepare(
        `SELECT pre_listing_showings.*, users.display_name AS agent_name
         FROM pre_listing_showings JOIN users ON users.id = pre_listing_showings.agent_user_id
         WHERE pre_listing_id = ? AND agent_user_id = ? ORDER BY proposed_at ASC`
      ).bind(preListingId, forAgentUserId).all()
    : await db.prepare(
        `SELECT pre_listing_showings.*, users.display_name AS agent_name
         FROM pre_listing_showings JOIN users ON users.id = pre_listing_showings.agent_user_id
         WHERE pre_listing_id = ? ORDER BY proposed_at ASC`
      ).bind(preListingId).all();
  return rows.results.map(r => ({
    id: r.id, agentUserId: r.agent_user_id, agentName: r.agent_name, proposedAt: r.proposed_at,
    note: r.note, status: r.status, createdAt: r.created_at,
  }));
}

export async function decideShowing(db, showingId, accepted) {
  await db.prepare("UPDATE pre_listing_showings SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(accepted ? 'accepted' : 'declined', showingId).run();
}

export async function cancelShowing(db, showingId) {
  await db.prepare("UPDATE pre_listing_showings SET status = 'canceled', updated_at = datetime('now') WHERE id = ?").bind(showingId).run();
}
