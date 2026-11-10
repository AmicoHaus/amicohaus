// Per-person limits on actions that notify someone else (batch L1): new conversations, messages, proposals, price
// opinions, showing requests, broker-preview RSVPs, agent invites, saved searches and reports, owner timing edits
// (they change what buyers' timing counts show; R3-1b), and swept photo replacements and Then & Now pairs (owner
// tools). Each action is one row in user_action_log (migration_v43.sql), checked and recorded in ONE statement, so two requests at the same moment can't both slip
// under the limit (D1 runs one statement at a time). Rows are pruned by the lazy jobs in functions/api/_middleware.js.
import { json } from './util.js';

const DAY = 24 * 60;

// kind -> windows. perRef: the window counts only this action's target (the ref passed to claimUserAction), e.g.
// one conversation or one pre-listing; without it the window counts every target.
export const USER_LIMITS = {
  conversation_new: [{ max: 5, minutes: 10 }, { max: 20, minutes: DAY }],
  message: [{ max: 20, minutes: 10 }, { max: 200, minutes: DAY }, { max: 30, minutes: 60, perRef: true }], // ref conversation:<id>
  proposal: [{ max: 10, minutes: 60 }, { max: 30, minutes: DAY }, { max: 5, minutes: DAY, perRef: true }], // ref pre_listing:<id> | transaction:<id>
  price_vote: [{ max: 15, minutes: 60 }, { max: 60, minutes: DAY }, { max: 6, minutes: DAY, perRef: true }], // ref pre_listing:<id>
  showing_request: [{ max: 10, minutes: DAY }, { max: 3, minutes: 7 * DAY, perRef: true }], // ref pre_listing:<id>
  preview_rsvp: [{ max: 20, minutes: DAY }],
  agent_invite: [{ max: 20, minutes: DAY }],
  saved_search: [{ max: 20, minutes: DAY }],
  timing_edit: [{ max: 10, minutes: DAY }],
  photo_sweep: [{ max: 40, minutes: 60 }, { max: 120, minutes: DAY }], // ref pre_listing:<id>; swept replacements and Then & Now pairs
  report: [{ max: 10, minutes: DAY }],
};

export const RATE_LIMITED_ERROR = "You're doing that a lot right now. Please take a short break and try again later.";

// true = allowed (and recorded); false = over a limit (nothing recorded). The count for each window runs before
// this action's own row exists, so the Nth allowed action isn't counted against itself.
export async function claimUserAction(db, kind, userId, ref = null) {
  const windows = USER_LIMITS[kind];
  if (!windows) throw new Error(`Unknown rate-limit kind: ${kind}`);
  const refText = ref === null || ref === undefined ? null : String(ref);
  // The numbers come from USER_LIMITS above (never from a request), so they're written into the SQL as plain integers.
  const conditions = windows
    .filter(w => !w.perRef || refText !== null)
    .map(w => `(SELECT COUNT(*) FROM user_action_log WHERE user_id = ?1 AND kind = ?2${w.perRef ? ' AND ref = ?3' : ''}
                 AND created_at > datetime('now', '-${Math.floor(Number(w.minutes))} minutes')) < ${Math.floor(Number(w.max))}`);
  const result = await db.prepare(
    `INSERT INTO user_action_log (user_id, kind, ref) SELECT ?1, ?2, ?3 WHERE ${conditions.join(' AND ')}`
  ).bind(userId, kind, refText).run();
  return !!(result.meta && result.meta.changes);
}

export function rateLimited() {
  return json({ error: RATE_LIMITED_ERROR, code: 'rate_limited' }, { status: 429 });
}

// Rows older than 2 days go (login_attempts too: its longest window is a day). A kind with a longer window (a
// showing request's 7 days per home) keeps its rows for that long, or its limit would stop working.
const PRUNE_AFTER_MINUTES = 2 * DAY;
export async function pruneActionLogs(db) {
  const byKeep = new Map();
  for (const [kind, windows] of Object.entries(USER_LIMITS)) {
    const keep = Math.max(PRUNE_AFTER_MINUTES, ...windows.map(w => w.minutes));
    byKeep.set(keep, [...(byKeep.get(keep) || []), kind]);
  }
  const statements = [...byKeep.entries()].map(([keep, kinds]) => db.prepare(
    `DELETE FROM user_action_log WHERE kind IN (SELECT value FROM json_each(?1)) AND created_at < datetime('now', ?2)`
  ).bind(JSON.stringify(kinds), `-${keep} minutes`));
  // Kinds no longer in USER_LIMITS (renamed or retired) go after the usual 2 days.
  statements.push(db.prepare(
    `DELETE FROM user_action_log WHERE kind NOT IN (SELECT value FROM json_each(?1)) AND created_at < datetime('now', ?2)`
  ).bind(JSON.stringify(Object.keys(USER_LIMITS)), `-${PRUNE_AFTER_MINUTES} minutes`));
  statements.push(db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', ?)").bind(`-${PRUNE_AFTER_MINUTES} minutes`));
  await db.batch(statements);
}

// The lazy-jobs runner passes the request context.
export async function runPruneActionLogs(context) {
  await pruneActionLogs(context.env.DB);
}
