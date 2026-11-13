import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { validZip } from '../../_lib/ideaText.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import {
  validateOutline, outlineFromRow, outlineConfig, outlineColumnValues, OUTLINE_COLUMNS, OUTLINE_KINDS, LISTED_OUTLINE_SQL, viewerIsDemo,
  MAX_OUTLINES, MAX_LISTED_OUTLINES, OUTLINE_LIMIT_ERROR, LISTED_LIMIT_ERROR,
} from '../../_lib/dealOutlines.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const KNOWN_USES = new Set(Object.values(OUTLINE_KINDS).flatMap(k => Object.keys(k.uses)));

// Easement Ideas (gate easementIdeas; signed-in members only). ?mine=1 -> the person's own idea outlines plus the
// builder's wording. Otherwise the listed outlines of other people, newest first, filtered by ZIP and use: owner
// active, not a demo account, no block either way. One statement either way. Never an address (none is stored).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'easementIdeas', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);
  if (url.searchParams.get('mine') === '1') {
    const rows = await db.prepare('SELECT * FROM deal_outlines WHERE user_id = ? ORDER BY created_at DESC, id DESC').bind(user.id).all();
    return json({ outlines: rows.results.map(r => outlineFromRow(r, { mine: true })), config: outlineConfig() }, NO_STORE);
  }
  const zip = (url.searchParams.get('zip') || '').trim();
  const use = (url.searchParams.get('use') || '').trim();
  if (zip && !validZip(zip)) return badRequest('ZIP code should be 5 digits.');
  if (use && !KNOWN_USES.has(use)) return badRequest('Pick a use from the list.');
  const rows = await db.prepare(
    `SELECT o.*, u.display_name AS owner_name FROM deal_outlines o JOIN users u ON u.id = o.user_id
     WHERE o.user_id != ?1 AND ${LISTED_OUTLINE_SQL}
       AND (?4 = '' OR o.zip = ?4) AND (?5 = '' OR o.use_key = ?5)
     ORDER BY o.created_at DESC, o.id DESC LIMIT 40`
  ).bind(user.id, DEMO_EMAIL_PATTERN, viewerIsDemo(user), zip, use).all();
  return json({ outlines: rows.results.map(r => outlineFromRow(r)) }, NO_STORE);
}

// Saves a new idea outline (the owner's own words; text runs the checks in ideaText.js). At most 5 per person and 3
// listed: both counts sit in the INSERT itself, so two saves at once can't slip past. A listed save counts toward
// the idea_post limit. 2-4 statements.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'easementIdeas', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOutline(body);
  if (validated.error) return badRequest(validated.error);
  const d = validated.data;
  const db = context.env.DB;
  if (d.zip && !(await db.prepare('SELECT 1 AS ok FROM zip_codes WHERE zip = ?').bind(d.zip).first())) return badRequest("We don't know that ZIP code.");
  if (d.listed && !(await claimUserAction(db, 'idea_post', user.id))) return rateLimited();

  const values = outlineColumnValues(d);
  const result = await db.prepare(
    `INSERT INTO deal_outlines (user_id, ${OUTLINE_COLUMNS.join(', ')})
     SELECT ?1, ${values.map((_, i) => `?${i + 2}`).join(', ')}
     WHERE (SELECT COUNT(*) FROM deal_outlines WHERE user_id = ?1) < ${MAX_OUTLINES}
       AND (?14 = 0 OR (SELECT COUNT(*) FROM deal_outlines WHERE user_id = ?1 AND listed = 1) < ${MAX_LISTED_OUTLINES})`
  ).bind(user.id, ...values).run();
  if (!result.meta || !result.meta.changes) {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM deal_outlines WHERE user_id = ?').bind(user.id).first();
    return badRequest(count && count.n >= MAX_OUTLINES ? OUTLINE_LIMIT_ERROR : LISTED_LIMIT_ERROR);
  }
  return json({ ok: true, id: result.meta.last_row_id }, { status: 201, ...NO_STORE });
}
