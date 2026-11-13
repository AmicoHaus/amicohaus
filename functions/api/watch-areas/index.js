import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, clampString } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { validZip, ideaTextProblem } from '../../_lib/ideaText.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { MAX_WATCH_AREAS, fetchWatchAreas, addWatchArea } from '../../_lib/watchAreas.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// A member's watch areas: whole ZIP codes, up to 3 (watchAreas.js). Any member can watch any known ZIP; nothing
// about where they live is asked, stored or implied. 1 statement + the session.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'watchAreas', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  return json({ areas: await fetchWatchAreas(context.env.DB, user.id), max: MAX_WATCH_AREAS }, NO_STORE);
}

// { zip, label }: nothing else is read from the body. 2 statements + the session (a 3rd only to explain a refusal).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'watchAreas', user)) return notFound('Not found.');
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!validZip(body.zip)) return badRequest('ZIP code should be 5 digits.');
  const label = clampString(body.label, 40);
  // A name for the member's own list ("Near work"). living: false, so "Where we live" isn't answered with the
  // idea tools' "not a place to live" line; every other check applies.
  const problem = ideaTextProblem(label, { living: false });
  if (problem) return badRequest(problem);

  const db = context.env.DB;
  if (!(await claimUserAction(db, 'watch_area_edit', user.id))) return rateLimited();
  const added = await addWatchArea(db, user.id, String(body.zip), label);
  if (added.error) return badRequest(added.error);
  return json({ id: added.id, zip: String(body.zip), label }, { status: 201, ...NO_STORE });
}
