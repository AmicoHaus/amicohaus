// Farm Radar: an agent's on-duty hours (Pacific time). In-app alerts always reach every agent at the same moment
// (Fair Play rule 1); only EMAILS that arrive while an agent is off duty wait until their next on-duty time, then
// go out from the lazy job runner (functions/api/_middleware.js). Homeowners can see how many agents who serve
// their ZIP are on duty right now (only when that's at least one).
import { sendEmail } from './email.js';
import { DEMO_EMAIL_PATTERN } from './util.js';

const TZ = 'America/Los_Angeles';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// The Pacific wall-clock parts of an instant.
export function pacificParts(ms = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: DAY_NAMES.indexOf(parts.weekday) };
}

// The instant of a Pacific wall-clock time (handles daylight saving by measuring the offset at that moment).
export function pacificToUtcMs(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = pacificParts(guess);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offset = asIfUtc - guess; // negative: Pacific is behind UTC
  const ms = guess - offset;
  // Across a daylight-saving change the first guess can be an hour off; one more pass settles it.
  const p2 = pacificParts(ms);
  const offset2 = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute) - ms;
  return guess - offset2;
}

export function validateDutyHours(body) {
  if (body.clear === true) return { days: null, start: null, end: null };
  const days = [...new Set((Array.isArray(body.days) ? body.days : []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length) return { error: 'Pick at least one day you are on duty.' };
  if (!TIME_RE.test(String(body.start || '')) || !TIME_RE.test(String(body.end || ''))) return { error: 'Pick a start and end time.' };
  if (body.start >= body.end) return { error: 'The end time has to be after the start time (same day).' };
  return { days, start: body.start, end: body.end };
}

export function dutyFromRow(row) {
  if (!row || !row.duty_days_json || !row.duty_start || !row.duty_end) return null;
  let days = [];
  try { days = JSON.parse(row.duty_days_json); } catch { return null; }
  return Array.isArray(days) && days.length ? { days, start: row.duty_start, end: row.duty_end } : null;
}

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// No duty hours set counts as always on duty (emails go out right away, as before Farm Radar).
export function isOnDuty(duty, ms = Date.now()) {
  if (!duty) return true;
  const p = pacificParts(ms);
  const now = p.hour * 60 + p.minute;
  return duty.days.includes(p.weekday) && now >= minutesOf(duty.start) && now < minutesOf(duty.end);
}

// The next moment the agent comes on duty (now, if they already are).
// Walks calendar dates (not 24-hour steps, which skip the short spring-forward Sunday). A start time that doesn't
// exist that day (inside the 2-3am spring-forward gap) moves to the first on-duty minute after it.
export function nextDutyStartMs(duty, ms = Date.now()) {
  if (!duty || isOnDuty(duty, ms)) return ms;
  const [sh, sm] = [Number(duty.start.slice(0, 2)), Number(duty.start.slice(3, 5))];
  const today = pacificParts(ms);
  for (let i = 0; i <= 14; i++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    if (!duty.days.includes(d.getUTCDay())) continue;
    const [y, mo, da] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    let start = pacificToUtcMs(y, mo, da, sh, sm);
    // A start inside the missing spring-forward hour: the first real minute that day is 3:00am.
    if (!isOnDuty(duty, start)) start = pacificToUtcMs(y, mo, da, 3, 0);
    if (start > ms && isOnDuty(duty, start)) return start;
  }
  return ms; // can't happen with at least one day set; send now rather than never
}

// Sends now, or holds the email until the agent's next on-duty time. kind/ref say what it's about, so it can be
// re-checked when it goes out (see runDueHeldEmails).
export async function sendOrHoldEmail(context, { userId, to, subject, text, duty, kind = 'other', ref = null }) {
  const at = nextDutyStartMs(duty);
  if (at <= Date.now()) return sendEmail(context, { to, subject, text });
  await context.env.DB.prepare('INSERT INTO held_emails (user_id, kind, ref, subject, text_body, deliver_after) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(userId, kind, ref, subject, text, new Date(at).toISOString()).run();
  return true;
}

// Is a held email still worth sending? The agent must still be an active real account (approved, for agent emails,
// and still wanting new-request alerts or the scorecard), and what it's about must still be open.
async function stillWanted(db, row) {
  if (row.status !== 'active' || !row.email || String(row.email).toLowerCase().endsWith('@demo.amicohaus.local')) return false;
  if (['new_request', 'interview', 'scorecard'].includes(row.kind) && row.agent_status !== 'approved') return false;
  if (row.kind === 'new_request' && !row.notify_new_requests) return false;
  if (row.kind === 'scorecard' && row.scorecard_opt_out) return false;
  const m = /^(pre_listing|transaction):(\d+)$/.exec(row.ref || '');
  if (m) {
    const table = m[1] === 'pre_listing' ? 'pre_listings' : 'transaction_requests';
    const req = await db.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(Number(m[2])).first();
    if (!req || req.status !== 'open') return false;
    // An interview request the homeowner has since canceled (or the agent already answered) needs no email.
    if (row.kind === 'interview') {
      const iv = await db.prepare('SELECT status FROM pre_listing_interviews WHERE pre_listing_id = ? AND agent_user_id = ?').bind(Number(m[2]), row.user_id).first();
      if (!iv || iv.status !== 'requested') return false;
    }
  }
  return true;
}

const MAX_SEND_ATTEMPTS = 3;
const SEND_GAP_MS = 600; // the email provider allows about 2 a second

// Delivers held emails whose time has come, re-checking each one first (and to the agent's current address). Each
// row is claimed with a conditional UPDATE, so two runs at once can't both send it. Several waiting for the same
// agent go out as ONE email ("while you were off duty"), not a burst. A failed send is retried on a later run, up
// to 3 tries.
// budgetMs: stop starting new sends after this long (the background work has about 30 seconds); anything not
// reached stays unclaimed for the next run.
export async function runDueHeldEmails(context, { limit = 40, budgetMs = 15000 } = {}) {
  const startedAt = Date.now();
  const db = context.env.DB;
  const due = await db.prepare(
    `SELECT h.id, h.user_id, h.kind, h.ref, h.subject, h.text_body, users.email, users.status, users.display_name,
            agent_profiles.status AS agent_status, agent_profiles.notify_new_requests, agent_profiles.scorecard_opt_out
     FROM held_emails h JOIN users ON users.id = h.user_id LEFT JOIN agent_profiles ON agent_profiles.user_id = h.user_id
     WHERE h.sent_at IS NULL AND h.deliver_after <= ? ORDER BY h.user_id, h.deliver_after LIMIT ?`
  ).bind(new Date().toISOString(), limit).all();
  // Alerts for the same agent are combined; a scorecard is its own email. Nothing is claimed yet.
  const groups = new Map();
  for (const row of due.results) {
    const key = row.kind === 'scorecard' ? `scorecard:${row.id}` : `alerts:${row.user_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let sent = 0;
  let first = true;
  for (const candidates of groups.values()) {
    if (Date.now() - startedAt > budgetMs) break;
    // Claim this group's rows right before sending them (so nothing is left claimed-but-unsent if time runs out).
    const rows = [];
    const seen = new Set();
    for (const row of candidates) {
      const claim = await db.prepare("UPDATE held_emails SET sent_at = datetime('now'), attempts = attempts + 1 WHERE id = ? AND sent_at IS NULL").bind(row.id).run();
      if (!claim.meta || !claim.meta.changes) continue;
      let wanted = false;
      try { wanted = await stillWanted(db, row); } catch {
        await db.prepare('UPDATE held_emails SET sent_at = NULL WHERE id = ?').bind(row.id).run(); // try again next run
        continue;
      }
      if (!wanted) continue; // claimed and dropped: no longer relevant
      if (seen.has(row.text_body)) continue; // the same message twice (e.g. asked again) goes once
      seen.add(row.text_body);
      rows.push(row);
    }
    if (!rows.length) continue;
    if (!first) await new Promise(res => setTimeout(res, SEND_GAP_MS));
    first = false;
    const lead = rows[0];
    const subject = rows.length === 1 ? lead.subject : `${rows.length} updates from Amico Haus while you were off duty`;
    const text = rows.length === 1 ? lead.text_body
      : [`Hi ${lead.display_name || 'there'}, here's what came in while you were off duty:`, '', ...rows.slice(0, 10).map(r => `- ${r.text_body.split('\n').filter(Boolean)[0]}`)].join('\n');
    const ok = await sendEmail(context, { to: lead.email, subject, text }).catch(() => false);
    if (!ok) {
      // Put them back for another try (until they've had 3).
      for (const r of rows) await db.prepare('UPDATE held_emails SET sent_at = NULL WHERE id = ? AND attempts < ?').bind(r.id, MAX_SEND_ATTEMPTS).run();
    } else sent++;
  }
  // Old sent rows don't need keeping.
  await db.prepare("DELETE FROM held_emails WHERE sent_at IS NOT NULL AND sent_at < datetime('now', '-14 days')").run();
  return sent;
}

// How many approved, active, real agents who list this ZIP are on duty right now.
export async function countAgentsOnDuty(db, zip, ms = Date.now()) {
  const rows = await db.prepare(
    `SELECT agent_profiles.duty_days_json, agent_profiles.duty_start, agent_profiles.duty_end
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id, json_each(agent_profiles.service_zips_json) z
     WHERE agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ?
       AND agent_profiles.duty_days_json IS NOT NULL AND CAST(z.value AS TEXT) = ?`
  ).bind(DEMO_EMAIL_PATTERN, String(zip)).all();
  return rows.results.filter(r => { const d = dutyFromRow(r); return d && isOnDuty(d, ms); }).length;
}

export function describeDuty(duty) {
  if (!duty) return '';
  const fmt = (hhmm) => {
    const h = Number(hhmm.slice(0, 2));
    return `${h % 12 || 12}${hhmm.slice(2) === ':00' ? '' : hhmm.slice(2)} ${h < 12 ? 'am' : 'pm'}`;
  };
  return `${duty.days.map(d => DAY_NAMES[d]).join(', ')}, ${fmt(duty.start)} to ${fmt(duty.end)} (Pacific)`;
}
