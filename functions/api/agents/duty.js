import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../_lib/util.js';
import { isApprovedAgent } from '../../_lib/agents.js';
import { validateDutyHours, dutyFromRow, describeDuty, isOnDuty, nextDutyStartMs, PERSON_HOLD_KINDS } from '../../_lib/agentDuty.js';
import { quietHoursWindow } from '../../_lib/contactPolicy.js';

// The agent's own on-duty hours (Farm Radar). GET: current hours. PUT { days: [0-6], start: "HH:MM", end: "HH:MM" }
// or { clear: true }. Emails that arrive off duty wait until their next on-duty time; in-app alerts never wait.
async function current(db, userId) {
  const row = await db.prepare('SELECT duty_days_json, duty_start, duty_end FROM agent_profiles WHERE user_id = ?').bind(userId).first();
  const duty = dutyFromRow(row);
  return { duty, description: describeDuty(duty), onDutyNow: duty ? isOnDuty(duty) : null };
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (!(await isApprovedAgent(context.env.DB, user.id))) return forbidden('On-duty hours are for approved agents.');
  return json(await current(context.env.DB, user.id));
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('On-duty hours are for approved agents.');
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const checked = validateDutyHours(body);
  if (checked.error) return badRequest(checked.error);
  await db.prepare('UPDATE agent_profiles SET duty_days_json = ?, duty_start = ?, duty_end = ? WHERE user_id = ?')
    .bind(checked.days ? JSON.stringify(checked.days) : null, checked.start, checked.end, user.id).run();
  // Agent alerts still waiting go out on the new schedule: at the start of their next on-duty time under the new
  // hours; when the hours are cleared, right away (or when their quiet hours end, if they've set some). Their own
  // homeowner alerts and weekly messages follow quiet hours, not duty hours, so they're left alone.
  const quiet = quietHoursWindow(user);
  const at = checked.days ? nextDutyStartMs({ days: checked.days, start: checked.start, end: checked.end })
    : quiet ? nextDutyStartMs(quiet) : Date.now();
  // (Agent kinds: AGENT_HOLD_KINDS, plus any older row without one of the person kinds.)
  await db.prepare('UPDATE held_emails SET deliver_after = ? WHERE user_id = ? AND sent_at IS NULL AND kind NOT IN (SELECT value FROM json_each(?))')
    .bind(new Date(at).toISOString(), user.id, JSON.stringify(PERSON_HOLD_KINDS)).run();
  return json(await current(db, user.id));
}
