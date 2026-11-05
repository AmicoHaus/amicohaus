// You're in Control: how agents can reach a person (the contact dial, users.contact_mode) and their quiet hours
// (users.quiet_start / quiet_end, Pacific "HH:MM").
//
// The dial only covers messages and showing requests from someone with an agent profile (any status, admins
// included: Fair Play). Price opinions and proposals always arrive. Agents the person already works with are exempt
// (isExemptPair), so a conversation they started or agreed to never dead-ends.
// - open: as before.
// - weekly: the message is stored with deliver_after = next Sunday 09:00 Pacific and stays out of sight until then;
//   one waiting message per agent per person. runDueWeeklyMessages announces them when they arrive.
// - quiet: agent messages, new conversations and showing requests are refused.
import { pacificParts, pacificToUtcMs, isOnDuty } from './agentDuty.js';
import { sendPushToUser } from './webpush.js';

export const CONTACT_MODES = ['open', 'weekly', 'quiet'];
export const CONTACT_QUIET_ERROR = "This homeowner has chosen Quiet mode, so they hear from agents through price opinions and proposals. Send one of those and they'll see it right away.";
export const SHOWING_QUIET_ERROR = 'This homeowner has chosen Quiet mode, so showing requests are off for now. A price opinion or a proposal reaches them right away.';
export const WEEKLY_LIMIT_ERROR = "Your message for this week is already on its way. It will be delivered Sunday morning, together with other agents' messages.";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PREVIEW_GRACE_MS = 2 * 86400000; // an RSVP keeps the pair exempt until 2 days after the preview ends

// A time as SQLite's datetime('now') text: UTC "YYYY-MM-DD HH:MM:SS" (what messages.deliver_after holds). Never
// compare an ISO "T...Z" string with these: 'T' sorts after ' '.
export function sqlUtc(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// The next Sunday 09:00 Pacific strictly after nowMs, as a sqlUtc string (daylight saving handled by
// pacificToUtcMs; 9am is never inside a clock change).
export function nextWeeklyDeliveryUtc(nowMs = Date.now()) {
  const today = pacificParts(nowMs);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    if (d.getUTCDay() !== 0) continue;
    const at = pacificToUtcMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 9, 0);
    if (at > nowMs) return sqlUtc(at);
  }
  return sqlUtc(nowMs + 7 * 86400000); // can't happen: one of the next 8 days is a Sunday after now
}

export function validQuietTime(value) {
  return TIME_RE.test(String(value || ''));
}

// Quiet hours as a duty-shaped "OK to email" window for sendOrHoldEmail (agentDuty.js): every day, from the end of
// the quiet hours to their start. Quiet 21:00-08:00 -> send 08:00-21:00; quiet 01:00-06:00 -> send 06:00-01:00
// (crosses midnight). null when no (valid) quiet hours are set.
export function quietHoursWindow(row) {
  if (!row || !validQuietTime(row.quiet_start) || !validQuietTime(row.quiet_end) || row.quiet_start === row.quiet_end) return null;
  return { days: [0, 1, 2, 3, 4, 5, 6], start: row.quiet_end, end: row.quiet_start };
}

export function isQuietNow(row, nowMs = Date.now()) {
  const window = quietHoursWindow(row);
  return !!window && !isOnDuty(window, nowMs);
}

// Web push is skipped during the person's quiet hours (the in-app alert is already there when they look).
export async function sendPushUnlessQuiet(context, userId, nowMs = Date.now()) {
  const row = await context.env.DB.prepare('SELECT quiet_start, quiet_end FROM users WHERE id = ?').bind(userId).first();
  if (!row || isQuietNow(row, nowMs)) return { skipped: true };
  return sendPushToUser(context, userId);
}

// The DRE identity of a person for a point of contact: name, and (for an approved agent) license number and
// brokerage. licenseNumber/brokerageName are '' for anyone else.
export async function fetchAgentIdentity(db, userId) {
  const row = await db.prepare(
    `SELECT users.display_name, agent_profiles.status AS agent_status, agent_profiles.license_number, agent_profiles.brokerage_name
     FROM users LEFT JOIN agent_profiles ON agent_profiles.user_id = users.id WHERE users.id = ?`
  ).bind(userId).first();
  if (!row) return null;
  const approved = row.agent_status === 'approved';
  return {
    name: row.display_name || '',
    isAgent: approved,
    licenseNumber: approved ? String(row.license_number || '').trim() : '',
    brokerageName: approved ? String(row.brokerage_name || '').trim() : '',
  };
}

// "Name · DRE #01234567 · Brokerage", leaving out a missing part and its dot. onFile (pages, cards and flyers):
// "DRE #01234567 on file", never "verified": the site doesn't vouch for anyone's license status today.
export function identityLine({ name, licenseNumber, brokerageName }, { onFile = false } = {}) {
  return [name, licenseNumber ? `DRE #${licenseNumber}${onFile ? ' on file' : ''}` : '', brokerageName].filter(Boolean).join(' · ');
}

// "Name (DRE #01234567, Brokerage)" for message alerts; just the name when neither is on file.
export function identityParens({ name, licenseNumber, brokerageName }) {
  const extra = [licenseNumber ? `DRE #${licenseNumber}` : '', brokerageName].filter(Boolean).join(', ');
  return extra ? `${name} (${extra})` : name;
}

// Agents this person already works with, across all of their pre-listings: they messaged the agent first, shared
// their contact info, hired them, invited them, have an interview requested or scheduled with them, or the agent
// RSVP'd to one of their broker previews (one still to come, or that ended in the last 2 days).
export async function isExemptPair(db, agentId, ownerId, { nowMs = Date.now() } = {}) {
  const a = Number(agentId);
  const o = Number(ownerId);
  if (!a || !o || a === o) return false;
  const row = await db.prepare(
    `SELECT (
       EXISTS (SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
               WHERE c.user_a_id = ?3 AND c.user_b_id = ?4 AND m.sender_id = ?2)
       OR EXISTS (SELECT 1 FROM contact_shares WHERE owner_id = ?2 AND agent_id = ?1)
       OR EXISTS (SELECT 1 FROM service_bids b JOIN pre_listings p ON p.id = b.request_id
                  WHERE b.request_type = 'pre_listing' AND b.status = 'accepted' AND b.agent_user_id = ?1 AND p.user_id = ?2)
       OR EXISTS (SELECT 1 FROM agent_invites WHERE invited_by_user_id = ?2 AND agent_user_id = ?1)
       OR EXISTS (SELECT 1 FROM pre_listing_interviews i JOIN pre_listings p ON p.id = i.pre_listing_id
                  WHERE i.agent_user_id = ?1 AND p.user_id = ?2 AND i.status IN ('requested','scheduled'))
       OR EXISTS (SELECT 1 FROM pre_listing_preview_rsvps r JOIN pre_listing_previews v ON v.id = r.preview_id
                  JOIN pre_listings p ON p.id = v.pre_listing_id
                  WHERE r.agent_user_id = ?1 AND p.user_id = ?2 AND v.ends_at > ?5)
     ) AS exempt`
  ).bind(a, o, Math.min(a, o), Math.max(a, o), new Date(nowMs - PREVIEW_GRACE_MS).toISOString()).first();
  return !!(row && row.exempt);
}

// Can senderId message recipientId right now, and how?
// mode: the recipient's dial. appliesToSender: the sender has an agent profile (any status). exempt: they already
// work together (only worked out when it matters, i.e. the dial applies and isn't open). allow: send it. holdUntil:
// the sqlUtc time the message must wait until (weekly), else null. code/error: why it was refused.
// Showing requests use only { mode, exempt, appliesToSender } (quiet refuses them, with SHOWING_QUIET_ERROR).
export async function contactDecision(db, senderId, recipientId, { nowMs = Date.now() } = {}) {
  const row = await db.prepare(
    'SELECT users.contact_mode, EXISTS (SELECT 1 FROM agent_profiles WHERE user_id = ?1) AS sender_is_agent FROM users WHERE users.id = ?2'
  ).bind(Number(senderId), Number(recipientId)).first();
  const mode = row && CONTACT_MODES.includes(row.contact_mode) ? row.contact_mode : 'open';
  const appliesToSender = !!(row && row.sender_is_agent) && Number(senderId) !== Number(recipientId);
  const decision = { mode, exempt: false, appliesToSender, allow: true, holdUntil: null, code: null, error: null };
  if (!appliesToSender || mode === 'open') return decision;
  if (await isExemptPair(db, senderId, recipientId, { nowMs })) return { ...decision, exempt: true };
  if (mode === 'quiet') return { ...decision, allow: false, code: 'contact_quiet', error: CONTACT_QUIET_ERROR };
  // weekly: one waiting message per agent per person at a time.
  const a = Number(senderId);
  const b = Number(recipientId);
  const waiting = await db.prepare(
    `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_a_id = ? AND c.user_b_id = ? AND m.sender_id = ? AND m.deliver_after IS NOT NULL AND m.deliver_after > ? LIMIT 1`
  ).bind(Math.min(a, b), Math.max(a, b), a, sqlUtc(nowMs)).first();
  if (waiting) return { ...decision, allow: false, code: 'weekly_limit', error: WEEKLY_LIMIT_ERROR };
  return { ...decision, holdUntil: nextWeeklyDeliveryUtc(nowMs) };
}

// Messages still waiting for this person's weekly delivery arrive now: all of them (they switched to Open), or just
// one agent's (they shared their contact info with that agent, so the pair is exempt from now on). Marked released,
// so the weekly alert doesn't count them again. Returns how many arrived.
export async function releaseHeldMessages(db, recipientId, { senderId = null } = {}) {
  const now = sqlUtc();
  const result = await db.prepare(
    `UPDATE messages SET deliver_after = ?2, released_at = ?2
     WHERE deliver_after IS NOT NULL AND released_at IS NULL AND deliver_after > ?2 AND sender_id != ?1
       AND (?3 IS NULL OR sender_id = ?3)
       AND conversation_id IN (SELECT id FROM conversations WHERE user_a_id = ?1 OR user_b_id = ?1)`
  ).bind(Number(recipientId), now, senderId === null || senderId === undefined ? null : Number(senderId)).run();
  return (result.meta && result.meta.changes) || 0;
}

// Switching to Quiet: agent messages still waiting for the weekly delivery keep waiting (they don't arrive on
// Sunday); switching back to Weekly puts them on the next Sunday, and Open releases them (releaseHeldMessages).
export const HELD_WHILE_QUIET = '9999-12-31 00:00:00';
export async function retimeHeldMessages(db, recipientId, deliverAfter) {
  await db.prepare(
    `UPDATE messages SET deliver_after = ?2
     WHERE deliver_after IS NOT NULL AND released_at IS NULL AND deliver_after > ?3 AND sender_id != ?1
       AND conversation_id IN (SELECT id FROM conversations WHERE user_a_id = ?1 OR user_b_id = ?1)`
  ).bind(Number(recipientId), deliverAfter, sqlUtc()).run();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function weeklyMessagesBody(messageCount, agentCount) {
  return `Your weekly agent messages are here: ${plural(messageCount, 'new message')} from ${plural(agentCount, 'agent')}.`;
}

const RELEASE_GAP_MS = 600; // the email provider allows about 2 a second

// The weekly delivery: held messages whose time has come are already visible (reads compare deliver_after with
// now); this tells each person once, with one in-app alert and one email ("3 new messages from 2 agents"). Each
// message is claimed with a conditional UPDATE (released_at), so two runs at once can't announce it twice.
// Returns how many messages were released.
export async function runDueWeeklyMessages(context, { limit = 200, budgetMs = 8000 } = {}) {
  const startedAt = Date.now();
  const db = context.env.DB;
  const now = sqlUtc();
  const due = await db.prepare(
    `SELECT m.id, m.sender_id, CASE WHEN c.user_a_id = m.sender_id THEN c.user_b_id ELSE c.user_a_id END AS recipient_id,
            sender.status AS sender_status
     FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users sender ON sender.id = m.sender_id
     WHERE m.deliver_after IS NOT NULL AND m.released_at IS NULL AND m.deliver_after <= ?
     ORDER BY recipient_id, m.id LIMIT ?`
  ).bind(now, limit).all();
  const groups = new Map();
  for (const row of due.results) {
    if (!groups.has(row.recipient_id)) groups.set(row.recipient_id, []);
    groups.get(row.recipient_id).push(row);
  }
  // A full page may have cut the last person's messages in two; they go together on the next run.
  if (due.results.length >= limit && groups.size > 1) groups.delete(due.results[due.results.length - 1].recipient_id);
  if (!groups.size) return 0;
  const { notifyWeeklyMessages } = await import('./marketplaceNotify.js');
  let released = 0;
  let emailedLast = false;
  for (const [recipientId, rows] of groups) {
    if (Date.now() - startedAt > budgetMs) break;
    if (emailedLast) await new Promise(res => setTimeout(res, RELEASE_GAP_MS));
    const claims = await db.batch(rows.map(r => db.prepare("UPDATE messages SET released_at = datetime('now') WHERE id = ? AND released_at IS NULL").bind(r.id)));
    const claimed = rows.filter((r, i) => claims[i] && claims[i].meta && claims[i].meta.changes);
    released += claimed.length;
    // Only messages from active senders with no block between them are announced (they're released either way).
    const blocked = await db.prepare('SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = ?1 OR blocked_id = ?1').bind(recipientId).all();
    const blockedIds = new Set(blocked.results.map(b => (b.blocker_id === recipientId ? b.blocked_id : b.blocker_id)));
    const announce = claimed.filter(r => r.sender_status === 'active' && !blockedIds.has(r.sender_id));
    emailedLast = false;
    if (!announce.length) continue;
    const outcome = await notifyWeeklyMessages(context, recipientId, announce.length, new Set(announce.map(r => r.sender_id)).size).catch(() => null);
    emailedLast = outcome === 'sent';
  }
  return released;
}
