// Decision Night, Pitch Reels and finalist feedback (batch B1).
//
// Decision Night: the homeowner picks a time and every proposal opens to them at once, so the first proposal in
// doesn't set the bar for the rest. Until then they see only how many came in; agents can keep sending and updating
// proposals. There's no scheduler, so "is it sealed?" is worked out on every read, and the "your proposals are open"
// message goes out lazily (runDueDecisionNights, kicked off from the API middleware at most every few minutes).
//
// Finalist feedback: after hiring, the homeowner can send the finalists they didn't pick (agents they interviewed or
// shortlisted) up to 3 reasons from a preset list. Never a fee, a rate or a number, and never who was hired.
import { DEMO_EMAIL_PATTERN } from './util.js';
import { notifyProposalsOpen, notifyFinalistDebrief } from './marketplaceNotify.js';

export const DECISION_MIN_HOURS = 12;
export const DECISION_MAX_DAYS = 21;

export const DEBRIEF_REASONS = {
  pricing: 'Their pricing plan',
  marketing: 'Their marketing plan',
  local: 'Knowledge of the neighborhood',
  communication: 'Communication and responsiveness',
  experience: 'Experience and track record',
  fees_terms: 'Fees or terms',
  timing: 'Timing and availability',
  fit: 'Personal fit',
};
export const DEBRIEF_MAX_REASONS = 3;

// SQLite's datetime('now') text ("YYYY-MM-DD HH:MM:SS", UTC) as a time value.
export function sqlTime(text) {
  return text ? Date.parse(String(text).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? '' : 'Z')) : NaN;
}

export function proposalsSealed(row, now = Date.now()) {
  return !!(row && row.status === 'open' && row.proposals_due_at && Date.parse(row.proposals_due_at) > now);
}

// A new Decision Night time: at least 12 hours out (so agents who were alerted have a fair chance) and no more than
// 3 weeks. Moving an existing one is only allowed later, never earlier: agents may be planning around it. Opening
// early is a separate action ("open them now"), which is always the homeowner's call.
export function validateDecisionTime(value, currentDueAt, now = Date.now()) {
  const t = Date.parse(String(value || ''));
  if (!Number.isFinite(t)) return { error: 'Pick a date and time for your Decision Night.' };
  const moving = !!currentDueAt && Date.parse(currentDueAt) > now;
  if (moving && t < Date.parse(currentDueAt)) {
    return { error: 'Agents may be planning around your current time, so it can only move later. To see them sooner, open them now.' };
  }
  if (!moving && t < now + DECISION_MIN_HOURS * 3600000) return { error: `Pick a time at least ${DECISION_MIN_HOURS} hours from now, so every agent has a fair chance to send a proposal.` };
  if (t > now + DECISION_MAX_DAYS * 86400000) return { error: `Pick a time within the next ${DECISION_MAX_DAYS} days.` };
  return { dueAt: new Date(t).toISOString() };
}

export function validateDebriefReasons(reasons) {
  const list = [...new Set((Array.isArray(reasons) ? reasons : []).map(String))].filter(r => Object.hasOwn(DEBRIEF_REASONS, r));
  if (!list.length) return { error: 'Pick at least one reason.' };
  if (list.length > DEBRIEF_MAX_REASONS) return { error: `Pick up to ${DEBRIEF_MAX_REASONS} reasons.` };
  return { reasons: list };
}

// How many live proposals a sealed Decision Night is holding (same rule as the owner's list: not withdrawn, and
// from an active agent unless already accepted).
export async function countSealedProposals(db, preListingId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM service_bids JOIN users ON users.id = service_bids.agent_user_id
     WHERE service_bids.request_type = 'pre_listing' AND service_bids.request_id = ? AND service_bids.status != 'withdrawn'
       AND (users.status = 'active' OR service_bids.status = 'accepted')`
  ).bind(preListingId).first();
  return row ? row.n : 0;
}

// Finalists on a pre-listing: agents the homeowner interviewed (scheduled or done) or shortlisted from the pitch
// reels, other than the agent they hired, whose proposal wasn't withdrawn.
export async function fetchFinalists(db, preListingId, hiredAgentId) {
  const rows = await db.prepare(
    `SELECT DISTINCT b.agent_user_id, users.display_name AS agent_name
     FROM service_bids b JOIN users ON users.id = b.agent_user_id
     WHERE b.request_type = 'pre_listing' AND b.request_id = ?1 AND b.status != 'withdrawn' AND b.agent_user_id != ?2 AND users.status = 'active'
       AND (b.owner_pick = 'shortlist' OR EXISTS (
         SELECT 1 FROM pre_listing_interviews i WHERE i.pre_listing_id = ?1 AND i.agent_user_id = b.agent_user_id AND i.status IN ('scheduled','done')))
     ORDER BY users.display_name`
  ).bind(preListingId, hiredAgentId || 0).all();
  return rows.results.map(r => ({ agentUserId: r.agent_user_id, agentName: r.agent_name }));
}

// Sends the same reasons to every finalist not yet told. Returns how many were sent.
export async function sendFinalistDebrief(context, preListingId, hiredAgentId, reasons) {
  const db = context.env.DB;
  const finalists = await fetchFinalists(db, preListingId, hiredAgentId);
  let sent = 0;
  for (const f of finalists) {
    const r = await db.prepare('INSERT OR IGNORE INTO finalist_debriefs (pre_listing_id, agent_user_id, reasons_json) VALUES (?, ?, ?)')
      .bind(preListingId, f.agentUserId, JSON.stringify(reasons)).run();
    if (r.meta && r.meta.changes) {
      sent++;
      await notifyFinalistDebrief(context, f.agentUserId, reasons.map(k => DEBRIEF_REASONS[k]));
    }
  }
  return sent;
}

// How many homes an agent was a finalist on (interviewed, or shortlisted on a home that has since been decided, so a
// homeowner's picks stay private while they're deciding), real homeowners only. Shown as a measured stat once >= 1.
export async function countFinalistHomes(db, agentUserId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT i.pre_listing_id AS pl FROM pre_listing_interviews i JOIN pre_listings p ON p.id = i.pre_listing_id JOIN users o ON o.id = p.user_id
       WHERE i.agent_user_id = ?1 AND i.status IN ('scheduled','done') AND o.email NOT LIKE ?2
       UNION
       SELECT b.request_id AS pl FROM service_bids b JOIN pre_listings p ON p.id = b.request_id JOIN users o ON o.id = p.user_id
       WHERE b.agent_user_id = ?1 AND b.request_type = 'pre_listing' AND b.owner_pick = 'shortlist' AND b.status != 'withdrawn' AND o.email NOT LIKE ?2
         AND p.status IN ('awarded','closed')
     )`
  ).bind(agentUserId, DEMO_EMAIL_PATTERN).first();
  return row ? row.n : 0;
}

// Tells homeowners whose Decision Night has arrived that their proposals are open. Each pre-listing is claimed with
// one conditional UPDATE, so two runs at once can't both send. Called from the API middleware (throttled) and safe to
// call anywhere.
export async function runDueDecisionNights(context, { limit = 20 } = {}) {
  const db = context.env.DB;
  const due = await db.prepare(
    `SELECT pre_listings.id, pre_listings.user_id, users.email, users.email_frequency
     FROM pre_listings JOIN users ON users.id = pre_listings.user_id
     WHERE pre_listings.proposals_open_notified_at IS NULL AND pre_listings.proposals_due_at IS NOT NULL
       AND pre_listings.proposals_due_at <= ? AND pre_listings.status = 'open'
     LIMIT ?`
  ).bind(new Date().toISOString(), limit).all();
  let told = 0;
  for (const p of due.results) {
    const claim = await db.prepare("UPDATE pre_listings SET proposals_open_notified_at = datetime('now') WHERE id = ? AND proposals_open_notified_at IS NULL AND proposals_due_at <= ? AND status = 'open'")
      .bind(p.id, new Date().toISOString()).run();
    if (!claim.meta || !claim.meta.changes) continue;
    const count = await countSealedProposals(db, p.id);
    await notifyProposalsOpen(context, { userId: p.user_id, email: p.email, emailFrequency: p.email_frequency }, p.id, count);
    told++;
  }
  return told;
}
