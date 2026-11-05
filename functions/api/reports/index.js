import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, clampString } from '../../_lib/util.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';

// past_client_review: a review from an agent's past client (pastClientReviews.js), e.g. one that looks fake.
const TARGET_TYPES = ['post', 'comment', 'listing', 'user', 'past_client_review'];
const TARGET_TABLES = { post: 'posts', comment: 'comments', listing: 'listings', user: 'users', past_client_review: 'past_client_reviews' };

// Preset reasons the report menus offer, e.g. "Report a rules problem" on an agent (targetType 'user', a Terms
// violation) or "Fair housing concern" on anything. Free text can go with a preset, or stand alone as before.
const REPORT_PRESETS = ['Rules problem', 'Fair housing concern'];

// { targetType, targetId, preset?, reason? }. A report on something that doesn't exist is a 404; a second open report
// from the same person on the same thing is quietly treated as the first one (nothing new is stored).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const targetType = TARGET_TYPES.includes(body.targetType) ? body.targetType : null;
  const targetId = Number(body.targetId);
  const rawPreset = body.preset ?? body.reasonPreset;
  const preset = REPORT_PRESETS.includes(rawPreset) ? rawPreset : null;
  if (rawPreset !== undefined && rawPreset !== null && rawPreset !== '' && !preset) return badRequest('Pick one of the report reasons.');
  const details = clampString(body.reason, 500);
  const reason = preset ? (details && details !== preset ? clampString(`${preset}: ${details}`, 500) : preset) : details;
  if (!targetType || !Number.isInteger(targetId) || targetId <= 0 || !reason) {
    return badRequest('Missing target type, target id, or reason.');
  }
  if (targetType === 'user' && targetId === user.id) return badRequest("You can't report yourself.");

  const db = context.env.DB;
  const target = await db.prepare(`SELECT id FROM ${TARGET_TABLES[targetType]} WHERE id = ?`).bind(targetId).first();
  if (!target) return notFound("That item wasn't found. It may have been removed.");

  const dupSql = "SELECT 1 FROM reports WHERE reporter_id = ?1 AND target_type = ?2 AND target_id = ?3 AND status = 'open'";
  if (await db.prepare(dupSql).bind(user.id, targetType, targetId).first()) return json({ ok: true, alreadyReported: true });

  if (!(await claimUserAction(db, 'report', user.id, `${targetType}:${targetId}`))) return rateLimited();
  // The duplicate check rides along with the insert too, so two taps at once store one report.
  await db.prepare(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason) SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (${dupSql})`
  ).bind(user.id, targetType, targetId, reason).run();

  return json({ ok: true }, { status: 201 });
}
