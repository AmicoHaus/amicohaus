// Ready Meter (R3-1b): the owner's private two-tap weekly check-in (how ready they feel, 1-5, and what's on their mind),
// which only reorders the owner's own tools; "What agents see", the facts agents see on an open pre-listing; and an
// in-app nudge on Thursday to Saturday. Agents see the listing-ready count, the target list MONTH and a band
// (Exploring / Getting close / Ready) only when the owner turns on "Share my progress with agents" (off by default,
// Rudy 11.04). The number picked and the topic never leave the owner. Admins see only totals across 20+ homeowners.
// Jury test: the band is the owner's own words, never "verified", never a score, and homes are never sorted by it.
import { pacificParts, pacificToUtcMs } from './agentDuty.js';
import { sqlUtc } from './contactPolicy.js';
import { LISTING_READY_ITEMS, validListingReadyKeys } from './sellerPrep.js';
import { DEMO_EMAIL_PATTERN, unlistedOwnerSql } from './util.js';

// About the home and the process only: never health, divorce, death, family, jobs, age, language or life events
// (fair housing; tools/ready-meter-test.mjs checks this). Kept in sync by hand with ready-meter.js.
export const READY_TOPICS = { timing: 'Timing', money: 'Money', where_next: "Where we'd go next", house_ready: 'Getting the house ready', picking_agent: 'Picking an agent' };
export const READY_BANDS = { exploring: 'Exploring', getting_close: 'Getting close', ready: 'Ready' };
export const BAND_FRESH_DAYS = 30;
export const NUDGE_STOP_AFTER = 3;
export const TOTALS_MIN_OWNERS = 20;
export const TOTALS_WINDOW_DAYS = 90;
const DAY_MS = 86400000;
const NUDGE_BODY = "Weekly check-in: how ready do you feel this week? It's two taps, and your answers stay private.";

export function bandFor(readiness) {
  const r = Number(readiness);
  if (r >= 5) return 'ready';
  if (r >= 3) return 'getting_close';
  return 'exploring';
}

const pad = (n) => String(n).padStart(2, '0');

// The Monday ('YYYY-MM-DD') of the Pacific week holding nowMs. Measured from Pacific noon, so stepping back whole days
// never crosses a date line at a daylight-saving change (scorecardWeek is not used: it gives the wrong Monday on Sundays).
export function pacificWeekKey(nowMs = Date.now()) {
  const p = pacificParts(nowMs);
  const noon = pacificToUtcMs(p.year, p.month, p.day, 12, 0);
  const m = pacificParts(noon - ((p.weekday + 6) % 7) * DAY_MS);
  return `${m.year}-${pad(m.month)}-${pad(m.day)}`;
}

// The week to nudge for: Thursday from 10:00 Pacific through Saturday; otherwise null (no nudges).
export function readyNudgeWeek(nowMs = Date.now()) {
  const p = pacificParts(nowMs);
  if ((p.weekday === 4 && p.hour >= 10) || p.weekday === 5 || p.weekday === 6) return pacificWeekKey(nowMs);
  return null;
}

export function validCheckIn(body) {
  const readiness = body ? body.readiness : undefined;
  if (typeof readiness !== 'number' || !Number.isInteger(readiness) || readiness < 1 || readiness > 5) return { error: 'Pick how ready you feel, from 1 to 5.' };
  const topic = body.topic;
  if (typeof topic !== 'string' || !Object.hasOwn(READY_TOPICS, topic)) return { error: "Pick what's on your mind." };
  return { data: { readiness, topic } };
}

async function latestCheckIn(db, preListingId) {
  return db.prepare('SELECT week_key, readiness, topic, updated_at FROM pre_listing_checkins WHERE pre_listing_id = ? ORDER BY week_key DESC LIMIT 1')
    .bind(preListingId).first();
}
const isFresh = (c, nowMs) => !!c && c.updated_at >= sqlUtc(nowMs - BAND_FRESH_DAYS * DAY_MS);

// The owner's own view, in any status: this week's key, whether a check-in is due (open homes only), the latest answer
// and their two settings. Owner only: never sent to an agent or an admin.
export async function readyMeterForOwner(db, row, nowMs = Date.now()) {
  const weekKey = pacificWeekKey(nowMs);
  const c = await latestCheckIn(db, row.id);
  const latest = c ? { readiness: c.readiness, topic: c.topic, weekKey: c.week_key, updatedAt: c.updated_at, fresh: isFresh(c, nowMs) } : null;
  return {
    weekKey,
    due: row.status === 'open' && (!latest || latest.weekKey !== weekKey),
    latest,
    shareReadiness: !!row.share_readiness,
    remindersOff: !!row.ready_reminders_off,
  };
}

// "What agents see" on an open pre-listing. The owner gets the very same object, so their preview is exact. Facts
// agents can already see elsewhere always show; the listing-ready count, the target MONTH (never the day) and the
// band (only from a check-in in the last 30 days) show only when the owner shares their progress. Never the number
// picked, the topic or the disclosure checklist. Null for anyone else (a plain admin) and for homes that aren't open.
export async function agentViewFor(db, row, { isOwner = false, isAgent = false, photoCount = 0 } = {}, nowMs = Date.now()) {
  if (!(isOwner || isAgent) || row.status !== 'open') return null;
  // One statement (the owner detail GET is already heavy): an upcoming preview (ends_at is an ISO time) and the latest
  // check-in, read only to make the band and used only when the owner shares.
  const facts = await db.prepare(
    `SELECT EXISTS(SELECT 1 FROM pre_listing_previews WHERE pre_listing_id = ?1 AND ends_at > ?2) AS has_preview,
            c.week_key, c.readiness, c.updated_at
     FROM (SELECT 1) LEFT JOIN (SELECT week_key, readiness, updated_at FROM pre_listing_checkins WHERE pre_listing_id = ?1 ORDER BY week_key DESC LIMIT 1) c`
  ).bind(row.id, new Date(nowMs).toISOString()).first();
  const view = {
    photoCount: Number(photoCount) || 0,
    hasVideo: !!row.video_r2_key,
    hasUpcomingPreview: !!(facts && facts.has_preview),
    proposalsDueAt: row.proposals_due_at || null,
    shared: !!row.share_readiness,
  };
  if (!view.shared) return view;
  let checked = [];
  try { checked = JSON.parse(row.listing_ready_json || '[]'); } catch { checked = []; }
  view.checklistDone = validListingReadyKeys(checked).length;
  view.checklistTotal = Object.keys(LISTING_READY_ITEMS).length;
  view.targetListMonth = row.target_list_date ? String(row.target_list_date).slice(0, 7) : null;
  const c = facts && facts.week_key !== null && facts.week_key !== undefined ? facts : null;
  const fresh = isFresh(c, nowMs);
  view.band = fresh ? bandFor(c.readiness) : null;
  view.bandAsOf = fresh ? c.week_key : null;
  return view;
}

// The owner's writes (PUT /api/pre-listings/:id/ready). Returns the statements for one db.batch.
export function readyWriteStatements(db, preListingId, { checkIn = null, shareReadiness, remindersOff } = {}, nowMs = Date.now()) {
  const stmts = [];
  if (checkIn) {
    stmts.push(db.prepare(
      `INSERT INTO pre_listing_checkins (pre_listing_id, week_key, readiness, topic) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(pre_listing_id, week_key) DO UPDATE SET readiness = excluded.readiness, topic = excluded.topic, updated_at = datetime('now')`
    ).bind(preListingId, pacificWeekKey(nowMs), checkIn.readiness, checkIn.topic));
    stmts.push(db.prepare('UPDATE pre_listings SET ready_nudges_unanswered = 0 WHERE id = ?').bind(preListingId));
  }
  if (typeof shareReadiness === 'boolean') {
    stmts.push(db.prepare('UPDATE pre_listings SET share_readiness = ? WHERE id = ?').bind(shareReadiness ? 1 : 0, preListingId));
  }
  if (typeof remindersOff === 'boolean') {
    // Turning reminders back on starts the 3-in-a-row count again.
    stmts.push(remindersOff
      ? db.prepare('UPDATE pre_listings SET ready_reminders_off = 1 WHERE id = ?').bind(preListingId)
      : db.prepare('UPDATE pre_listings SET ready_reminders_off = 0, ready_nudges_unanswered = 0 WHERE id = ?').bind(preListingId));
  }
  return stmts;
}

// The weekly nudge (functions/api/_middleware.js): an in-app reminder to the owner about their own home, Thursday 10am
// to Saturday Pacific. One conditional UPDATE claims each home for the week (so instances running at once can't
// double-send), then one batch inserts the notifications. Skips: reminders off, not open, 3 unanswered in a row,
// demo or suspended owners, homes posted under 7 days ago, and homes already checked in this week. No email, no push.
export async function runDueReadyNudges(context, { nowMs = Date.now(), limit = 50 } = {}) {
  const week = readyNudgeWeek(nowMs);
  if (!week) return 0;
  const db = context.env.DB;
  const claimed = await db.prepare(
    `UPDATE pre_listings SET ready_nudge_week = ?1, ready_nudges_unanswered = ready_nudges_unanswered + 1
     WHERE id IN (
       SELECT p.id FROM pre_listings p JOIN users u ON u.id = p.user_id
       WHERE p.status = 'open' AND p.ready_reminders_off = 0 AND p.ready_nudges_unanswered < ${NUDGE_STOP_AFTER}
         AND (p.ready_nudge_week IS NULL OR p.ready_nudge_week != ?1)
         AND u.status = 'active' AND u.email NOT LIKE ?2
         AND p.created_at <= ?3
         AND NOT EXISTS (SELECT 1 FROM pre_listing_checkins c WHERE c.pre_listing_id = p.id AND c.week_key = ?1)
       ORDER BY p.id LIMIT ?4)
     RETURNING id, user_id`
  ).bind(week, DEMO_EMAIL_PATTERN, sqlUtc(nowMs - 7 * DAY_MS), limit).all();
  const rows = (claimed && claimed.results) || [];
  if (!rows.length) return 0;
  // One statement however many homes were claimed (D1 caps queries per request). If it fails, the claim is given
  // back so those homes aren't counted as nudged for a reminder they never got.
  const ids = JSON.stringify(rows.map(r => r.id));
  try {
    await db.prepare(
      `INSERT INTO notifications (user_id, type, body, link)
       SELECT user_id, 'marketplace', ?1, '/app#pre-listing-' || id FROM pre_listings WHERE id IN (SELECT value FROM json_each(?2))`
    ).bind(NUDGE_BODY, ids).run();
  } catch (err) {
    await db.prepare(
      `UPDATE pre_listings SET ready_nudge_week = NULL, ready_nudges_unanswered = MAX(0, ready_nudges_unanswered - 1)
       WHERE id IN (SELECT value FROM json_each(?1)) AND ready_nudge_week = ?2`
    ).bind(ids, week).run().catch(() => {});
    throw err;
  }
  return rows.length;
}

// Admin totals (GET /api/admin/ready-meter): each real homeowner's latest check-in from the last 90 days, counted only
// once 20 or more homeowners have checked in. Never per home, person, week, ZIP or city.
export async function readyTotals(db, nowMs = Date.now()) {
  const rows = (await db.prepare(
    `SELECT c.readiness, c.topic FROM pre_listing_checkins c
     JOIN pre_listings p ON p.id = c.pre_listing_id JOIN users u ON u.id = p.user_id
     WHERE c.updated_at >= ?1 AND u.status = 'active' AND u.role != 'admin' AND u.email NOT LIKE ?2
       AND NOT ${unlistedOwnerSql('u.email')} AND u.email_confirmation_pending = 0
       AND c.id = (SELECT c2.id FROM pre_listing_checkins c2 JOIN pre_listings p2 ON p2.id = c2.pre_listing_id
                   WHERE p2.user_id = p.user_id AND c2.updated_at >= ?1 ORDER BY c2.updated_at DESC, c2.id DESC LIMIT 1)`
  ).bind(sqlUtc(nowMs - TOTALS_WINDOW_DAYS * DAY_MS), DEMO_EMAIL_PATTERN).all()).results;
  const owners = rows.length;
  if (owners < TOTALS_MIN_OWNERS) return { windowDays: TOTALS_WINDOW_DAYS, owners, minShown: TOTALS_MIN_OWNERS, totals: null };
  const readiness = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const band = Object.fromEntries(Object.keys(READY_BANDS).map(k => [k, 0]));
  const topic = Object.fromEntries(Object.keys(READY_TOPICS).map(k => [k, 0]));
  for (const r of rows) {
    if (Object.hasOwn(readiness, r.readiness)) readiness[r.readiness]++;
    band[bandFor(r.readiness)]++;
    if (Object.hasOwn(topic, r.topic)) topic[r.topic]++;
  }
  return { windowDays: TOTALS_WINDOW_DAYS, owners, minShown: TOTALS_MIN_OWNERS, totals: { readiness, band, topic } };
}
