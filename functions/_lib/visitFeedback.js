// 3-tap visit feedback (owner tools batch). After an accepted showing or a broker preview the agent RSVP'd to, that
// approved agent can leave three preset answers about the home for the homeowner: how the asking price feels now
// that they've seen it, the condition, and the one prep item that would help most. No free text (nothing about
// people is possible, nothing to moderate), never a count or an average across agents, never public, never on a
// profile, scorecard or report. Only the homeowner sees the answers, each with the agent's name and DRE number.
// Feedback stops when the home is awarded or closed, and an agent can change their answers for 48 hours.
// The prompt to agents is in-app only (runDueVisitFeedbackPrompts, from the lazy job runner in _middleware.js).
import { DEMO_EMAIL_PATTERN } from './util.js';
import { notBlockedSql, notBlockedByOwnersSql } from './blocks.js';
import { PREP_ITEMS } from './sellerPrep.js';
import { sqlTime } from './decisionNight.js';

export const VISIT_PRICE = { high: 'Feels high', about_right: 'About right', low: 'Feels low' };
export const VISIT_CONDITION = { ready: 'Ready to list', touch_ups: 'A few touch-ups', needs_work: 'Needs work first' };
export const VISIT_WINDOW_DAYS = 14, VISIT_EDIT_HOURS = 48;
export const VISIT_KINDS = ['showing', 'preview'];
export const VISIT_PROMPT_BODY = 'How did your visit go? Three quick taps for the homeowner, about the home.';

const iso = (ms) => new Date(ms).toISOString();

// Preset answers only. Any other key (a comment, a note, a number) is ignored and never stored. skipped ("I didn't
// make it") stores no answers. The price tap is left out (NULL) when the home was posted without a price.
export function validateVisitFeedback(body, { priceOpen = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.skipped === true) return { data: { skipped: 1, price: null, condition: null, topPrep: null } };
  let price = null;
  if (!priceOpen) {
    if (!Object.hasOwn(VISIT_PRICE, String(b.price ?? ''))) return { error: 'Pick how the asking price feels.' };
    price = String(b.price);
  }
  if (!Object.hasOwn(VISIT_CONDITION, String(b.condition ?? ''))) return { error: 'Pick the condition.' };
  const topPrep = String(b.topPrep ?? '');
  if (topPrep !== 'none' && !Object.hasOwn(PREP_ITEMS, topPrep)) return { error: 'Pick the one thing that would help most.' };
  return { data: { skipped: 0, price, condition: String(b.condition), topPrep } };
}

// The shared "who and what" rules for a visit that can take feedback: the home is open, its owner is active, the
// agent is approved and active, and there's no block either way. agentCol: the agent's id (a parameter or a column).
function eligibleSql(agentCol) {
  return `p.status = 'open' AND owner.status = 'active' AND agent.status = 'active' AND ap.status = 'approved'
    AND ${notBlockedSql(agentCol, 'p.user_id')}`;
}

// The visits this agent can leave feedback for on this home: accepted showings whose time has passed (in the last
// 14 days), and broker previews they RSVP'd to that have ended (in the last 14 days). visitAt is the showing time
// or the preview's start (ISO). visitId is the showing id or the preview id.
export async function eligibleVisitsFor(db, preListingId, agentUserId, nowMs = Date.now()) {
  const rows = await db.prepare(
    `SELECT 'showing' AS visit_kind, s.id AS visit_id, s.proposed_at AS visit_at
     FROM pre_listing_showings s JOIN pre_listings p ON p.id = s.pre_listing_id JOIN users owner ON owner.id = p.user_id
       JOIN users agent ON agent.id = s.agent_user_id JOIN agent_profiles ap ON ap.user_id = s.agent_user_id
     WHERE s.pre_listing_id = ?1 AND s.agent_user_id = ?2 AND s.status = 'accepted' AND s.proposed_at <= ?3 AND s.proposed_at >= ?4
       AND ${eligibleSql('?2')}
     UNION ALL
     SELECT 'preview', pv.id, pv.starts_at
     FROM pre_listing_preview_rsvps r JOIN pre_listing_previews pv ON pv.id = r.preview_id JOIN pre_listings p ON p.id = pv.pre_listing_id
       JOIN users owner ON owner.id = p.user_id JOIN users agent ON agent.id = r.agent_user_id JOIN agent_profiles ap ON ap.user_id = r.agent_user_id
     WHERE pv.pre_listing_id = ?1 AND r.agent_user_id = ?2 AND pv.ends_at <= ?3 AND pv.ends_at >= ?4
       AND ${eligibleSql('?2')}
     ORDER BY visit_at DESC`
  ).bind(Number(preListingId), Number(agentUserId), iso(nowMs), iso(nowMs - VISIT_WINDOW_DAYS * 86400000)).all();
  return rows.results.map(r => ({ visitKind: r.visit_kind, visitId: r.visit_id, visitAt: r.visit_at }));
}

// Until when an answer can still be changed (ISO), from the row's created_at (SQL text).
export function editableUntil(createdAt) {
  const t = sqlTime(createdAt);
  return Number.isFinite(t) ? iso(t + VISIT_EDIT_HOURS * 3600000) : null;
}

// The homeowner's cards, newest first: answered visits only (not "I didn't make it"), from active agents with no
// block either way. Each carries the agent's DRE identity, like a showing request. Never a count or a total.
export async function fetchVisitFeedbackForOwner(db, preListingId) {
  const rows = await db.prepare(
    `SELECT f.id, f.visit_kind, f.visit_at, f.price, f.asking_price_at, f.condition, f.top_prep, f.created_at,
            users.display_name AS agent_name, users.role AS agent_role, ap.status AS agent_status,
            ap.license_number, ap.brokerage_name
     FROM pre_listing_visit_feedback f JOIN users ON users.id = f.agent_user_id
       LEFT JOIN agent_profiles ap ON ap.user_id = f.agent_user_id
     WHERE f.pre_listing_id = ?1 AND f.skipped = 0 AND users.status = 'active'
       AND ${notBlockedByOwnersSql('pre_listing', '?1', 'f.agent_user_id')}
     ORDER BY f.created_at DESC, f.id DESC`
  ).bind(Number(preListingId)).all();
  return rows.results;
}

// One agent's own answers on one home (never anyone else's).
export async function fetchMyVisitFeedback(db, preListingId, agentUserId) {
  const rows = await db.prepare(
    `SELECT visit_kind, visit_id, skipped, price, condition, top_prep, created_at FROM pre_listing_visit_feedback
     WHERE pre_listing_id = ? AND agent_user_id = ? ORDER BY created_at DESC`
  ).bind(Number(preListingId), Number(agentUserId)).all();
  return rows.results.map(r => ({
    visitKind: r.visit_kind, visitId: r.visit_id, skipped: !!r.skipped, price: r.price, condition: r.condition,
    topPrep: r.top_prep, editableUntil: editableUntil(r.created_at),
  }));
}

// The in-app "how did your visit go?" prompt, once per visit (claimed with feedback_asked_at), to agents whose
// accepted showing time has passed or whose RSVP'd broker preview has ended, in the last 14 days, while the home is
// still open. No email, no push, no waiting: at most 3 statements a run (claim showings, claim RSVPs, one insert).
// Demo agents and agents who already answered are skipped. Returns the number of prompts sent.
export async function runDueVisitFeedbackPrompts(context, { nowMs = Date.now(), limit = 50 } = {}) {
  const db = context.env.DB;
  const nowIso = iso(nowMs);
  const sinceIso = iso(nowMs - VISIT_WINDOW_DAYS * 86400000);
  const showings = await db.prepare(
    `UPDATE pre_listing_showings SET feedback_asked_at = datetime('now')
     WHERE id IN (
       SELECT s.id FROM pre_listing_showings s JOIN pre_listings p ON p.id = s.pre_listing_id JOIN users owner ON owner.id = p.user_id
         JOIN users agent ON agent.id = s.agent_user_id JOIN agent_profiles ap ON ap.user_id = s.agent_user_id
       WHERE s.status = 'accepted' AND s.feedback_asked_at IS NULL AND s.proposed_at <= ?1 AND s.proposed_at >= ?2
         AND agent.email NOT LIKE ?3 AND ${eligibleSql('s.agent_user_id')}
         AND NOT EXISTS (SELECT 1 FROM pre_listing_visit_feedback f WHERE f.visit_kind = 'showing' AND f.visit_id = s.id AND f.agent_user_id = s.agent_user_id)
       LIMIT ?4)
     RETURNING id, pre_listing_id, agent_user_id`
  ).bind(nowIso, sinceIso, DEMO_EMAIL_PATTERN, limit).all();
  const rsvps = await db.prepare(
    `UPDATE pre_listing_preview_rsvps SET feedback_asked_at = datetime('now')
     WHERE id IN (
       SELECT r.id FROM pre_listing_preview_rsvps r JOIN pre_listing_previews pv ON pv.id = r.preview_id JOIN pre_listings p ON p.id = pv.pre_listing_id
         JOIN users owner ON owner.id = p.user_id JOIN users agent ON agent.id = r.agent_user_id JOIN agent_profiles ap ON ap.user_id = r.agent_user_id
       WHERE r.feedback_asked_at IS NULL AND pv.ends_at <= ?1 AND pv.ends_at >= ?2
         AND agent.email NOT LIKE ?3 AND ${eligibleSql('r.agent_user_id')}
         AND NOT EXISTS (SELECT 1 FROM pre_listing_visit_feedback f WHERE f.visit_kind = 'preview' AND f.visit_id = pv.id AND f.agent_user_id = r.agent_user_id)
       LIMIT ?4)
     RETURNING id, preview_id, agent_user_id`
  ).bind(nowIso, sinceIso, DEMO_EMAIL_PATTERN, limit).all();
  // One prompt per agent per home, even with two visits waiting. A preview's home is looked up inside the insert.
  const seen = new Set();
  const items = [];
  for (const r of showings.results || []) {
    const key = `${r.agent_user_id}:p${r.pre_listing_id}`;
    if (!seen.has(key)) { seen.add(key); items.push({ u: r.agent_user_id, p: r.pre_listing_id }); }
  }
  for (const r of rsvps.results || []) items.push({ u: r.agent_user_id, v: r.preview_id });
  if (!items.length) return 0;
  const res = await db.prepare(
    `INSERT INTO notifications (user_id, type, body, link)
     SELECT DISTINCT u, 'marketplace', ?1, '/app#pre-listing-' || p FROM (
       SELECT json_extract(value, '$.u') AS u,
              COALESCE(json_extract(value, '$.p'), (SELECT pre_listing_id FROM pre_listing_previews WHERE id = json_extract(value, '$.v'))) AS p
       FROM json_each(?2)) WHERE p IS NOT NULL`
  ).bind(VISIT_PROMPT_BODY, JSON.stringify(items)).run();
  return (res.meta && res.meta.changes) || 0;
}
