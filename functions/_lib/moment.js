// Share Your Moment (owner tools batch): the homeowner's own facts for Reveal Mode and the Hired! story, and their
// per-moment OK for Rudy to repost what they recorded. Only counts the owner can see for themselves: never proposal
// text, fees, price opinions, agent names, the address, the ZIP or the price.
import { sqlTime } from './decisionNight.js';

// Bump when the wording of the repost OK changes (share-moment.js), so each stored OK says which words were agreed to.
export const MOMENT_CONSENT_VERSION = 'moment-2026-11';
export const MOMENTS = ['reveal', 'hired'];

// Whole days from one datetime('now') text to another, at least 1 (a same-day hire is "1 day"); null if either is missing.
export function daysBetweenSql(fromSql, toSql) {
  const from = sqlTime(fromSql);
  const to = sqlTime(toSql);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(1, Math.ceil((to - from) / 86400000));
}

function repostFlags(json) {
  let list = [];
  try { list = JSON.parse(json || '[]'); } catch { list = []; }
  return { reveal: list.includes('reveal'), hired: list.includes('hired') };
}

// Owner only (called from the owner branch of the detail GET). Nothing unless the home has a Decision Night or is
// awarded. One statement. bids is [] while proposals are sealed, else the owner's fetchBids result.
export async function momentForOwner(db, row, bids) {
  if (!row || !(row.proposals_due_at || row.status === 'awarded')) return undefined;
  const r = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM pre_listing_interviews WHERE pre_listing_id = ?1 AND status = 'done') AS interviews_done,
            (SELECT json_group_array(moment) FROM moment_repost_consents WHERE pre_listing_id = ?1 AND withdrawn_at IS NULL) AS repost_json`
  ).bind(row.id).first();
  return {
    interviewsDone: Number(r && r.interviews_done) || 0,
    daysToHire: row.status === 'awarded' ? daysBetweenSql(row.created_at, row.awarded_at) : null,
    hiredIsOperator: !!(bids || []).find(b => b.id === row.awarded_bid_id && b.isPlatformOperator),
    repost: repostFlags(r && r.repost_json),
  };
}

// Give (ok = true) or take back (ok = false) the OK for one moment. A renewed OK stores the current wording version
// and a fresh date. Returns the home's OKs as they stand now.
export async function setRepostOk(db, preListingId, userId, moment, ok) {
  if (ok) {
    await db.prepare(
      `INSERT INTO moment_repost_consents (pre_listing_id, user_id, moment, consent_version) VALUES (?, ?, ?, ?)
       ON CONFLICT(pre_listing_id, moment) DO UPDATE SET user_id = excluded.user_id, consent_version = excluded.consent_version,
         consented_at = datetime('now'), withdrawn_at = NULL`
    ).bind(preListingId, userId, moment, MOMENT_CONSENT_VERSION).run();
  } else {
    await db.prepare(
      "UPDATE moment_repost_consents SET withdrawn_at = datetime('now') WHERE pre_listing_id = ? AND moment = ? AND withdrawn_at IS NULL"
    ).bind(preListingId, moment).run();
  }
  const r = await db.prepare(
    'SELECT json_group_array(moment) AS repost_json FROM moment_repost_consents WHERE pre_listing_id = ? AND withdrawn_at IS NULL'
  ).bind(preListingId).first();
  return repostFlags(r && r.repost_json);
}
