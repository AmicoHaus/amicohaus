import { getSessionUser } from '../_lib/auth.js';
import { json, badRequest, unauthorized } from '../_lib/util.js';
import { CONTACT_MODES, validQuietTime, quietHoursWindow, releaseHeldMessages, retimeHeldMessages, nextWeeklyDeliveryUtc, HELD_WHILE_QUIET } from '../_lib/contactPolicy.js';
import { nextDutyStartMs, dutyFromRow, PERSON_HOLD_KINDS } from '../_lib/agentDuty.js';

// You're in Control: the signed-in person's own contact choices.
// GET -> { contactMode, quietStart, quietEnd, phonePublic, hasPhone }
// PUT any of { contactMode: 'open'|'weekly'|'quiet', quietStart, quietEnd ("HH:MM" Pacific, sent together; both ''
// or null clears them), phonePublic: true|false } -> the same shape as GET.
function settingsOf(row) {
  return {
    contactMode: CONTACT_MODES.includes(row.contact_mode) ? row.contact_mode : 'open',
    quietStart: row.quiet_start || null,
    quietEnd: row.quiet_end || null,
    phonePublic: !!row.phone_public,
    hasPhone: !!String(row.phone || '').trim(),
  };
}

async function load(db, userId) {
  return db.prepare('SELECT contact_mode, quiet_start, quiet_end, phone_public, phone FROM users WHERE id = ?').bind(userId).first();
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const row = await load(context.env.DB, user.id);
  if (!row) return unauthorized();
  return json(settingsOf(row));
}

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const current = await load(db, user.id);
  if (!current) return unauthorized();

  const next = { contact_mode: current.contact_mode, quiet_start: current.quiet_start, quiet_end: current.quiet_end, phone_public: current.phone_public };
  let changed = false;

  if (body.contactMode !== undefined) {
    if (!CONTACT_MODES.includes(body.contactMode)) return badRequest('Pick how agents can reach you: Open, Weekly or Quiet.');
    next.contact_mode = body.contactMode;
    changed = true;
  }

  let quietChanged = false;
  if (body.quietStart !== undefined || body.quietEnd !== undefined) {
    if (blank(body.quietStart) && blank(body.quietEnd)) {
      next.quiet_start = null;
      next.quiet_end = null;
    } else {
      if (blank(body.quietStart) || blank(body.quietEnd)) return badRequest('Pick both a start and an end time for your quiet hours.');
      const start = String(body.quietStart).trim();
      const end = String(body.quietEnd).trim();
      if (!validQuietTime(start) || !validQuietTime(end)) return badRequest('Enter quiet hours as times between 00:00 and 23:59.');
      if (start === end) return badRequest('Your quiet hours need different start and end times.');
      next.quiet_start = start;
      next.quiet_end = end;
    }
    quietChanged = next.quiet_start !== current.quiet_start || next.quiet_end !== current.quiet_end;
    changed = true;
  }

  if (body.phonePublic !== undefined) {
    if (typeof body.phonePublic !== 'boolean' && body.phonePublic !== 0 && body.phonePublic !== 1) return badRequest('phonePublic must be true or false.');
    const on = body.phonePublic === true || body.phonePublic === 1;
    if (on && !String(current.phone || '').trim()) return badRequest('Add a phone number on your profile first.');
    next.phone_public = on ? 1 : 0;
    changed = true;
  }

  if (!changed) return badRequest('Nothing to change.');

  await db.prepare('UPDATE users SET contact_mode = ?, quiet_start = ?, quiet_end = ?, phone_public = ? WHERE id = ?')
    .bind(next.contact_mode, next.quiet_start, next.quiet_end, next.phone_public, user.id).run();

  // Agent messages still waiting for the weekly delivery follow the new choice: Open -> they arrive now (marked
  // released, so no weekly alert counts them later); Quiet -> they keep waiting instead of arriving on Sunday;
  // Weekly -> they arrive on the next Sunday.
  if (next.contact_mode !== current.contact_mode) {
    if (next.contact_mode === 'open') await releaseHeldMessages(db, user.id);
    else if (next.contact_mode === 'quiet') await retimeHeldMessages(db, user.id, HELD_WHILE_QUIET);
    else await retimeHeldMessages(db, user.id, nextWeeklyDeliveryUtc(Date.now()));
  }

  // Emails still waiting for the old quiet hours go out on the new ones: right away when they're cleared (or it
  // isn't quiet now), otherwise when the new quiet hours end. An agent's alerts follow quiet hours only when they
  // have no on-duty hours set (duty hours win; those are re-timed by /api/agents/duty).
  if (quietChanged) {
    const window = quietHoursWindow(next);
    const at = window ? nextDutyStartMs(window) : Date.now();
    const duty = await db.prepare('SELECT duty_days_json, duty_start, duty_end FROM agent_profiles WHERE user_id = ?').bind(user.id).first();
    if (dutyFromRow(duty)) {
      await db.prepare('UPDATE held_emails SET deliver_after = ? WHERE user_id = ? AND sent_at IS NULL AND kind IN (SELECT value FROM json_each(?))')
        .bind(new Date(at).toISOString(), user.id, JSON.stringify(PERSON_HOLD_KINDS)).run();
    } else {
      await db.prepare('UPDATE held_emails SET deliver_after = ? WHERE user_id = ? AND sent_at IS NULL').bind(new Date(at).toISOString(), user.id).run();
    }
  }

  return json(settingsOf({ ...current, ...next }));
}
