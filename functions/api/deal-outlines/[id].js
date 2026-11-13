import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import {
  validateOutline, outlineFromRow, outlineColumnValues, OUTLINE_COLUMNS, LISTED_OUTLINE_SQL, viewerIsDemo, MAX_LISTED_OUTLINES, LISTED_LIMIT_ERROR,
} from '../../_lib/dealOutlines.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const NOT_FOUND = 'Idea outline not found.';

// Gate (easementIdeas) and sign-in for every method here; the outline id as a whole number, or 0.
async function open(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'easementIdeas', user)) return { response: notFound('Not found.') };
  if (!user) return { response: unauthorized() };
  const id = /^\d{1,15}$/.test(String(context.params.id || '')) ? Number(context.params.id) : 0;
  return { user, id };
}

// One outline: its owner, or any signed-in member when it is listed and passes the browse rules (owner active, not a
// demo account, no block either way). Anything else is the same 404. One statement.
export async function onRequestGet(context) {
  const { user, id, response } = await open(context);
  if (response) return response;
  const row = id ? await context.env.DB.prepare(
    `SELECT o.*, u.display_name AS owner_name FROM deal_outlines o JOIN users u ON u.id = o.user_id
     WHERE o.id = ?4 AND (o.user_id = ?1 OR (${LISTED_OUTLINE_SQL}))`
  ).bind(user.id, DEMO_EMAIL_PATTERN, viewerIsDemo(user), id).first() : null;
  if (!row) return notFound(NOT_FOUND);
  return json({ outline: outlineFromRow(row, { mine: row.user_id === user.id }) }, NO_STORE);
}

// The owner edits an outline. Fields the body leaves out keep their stored value, so "Stop listing" sends
// { listed: false } alone. The ZIP is looked up only when it changed; a listed save counts toward idea_post; the
// 3-listed limit sits in the UPDATE. 2-4 statements.
export async function onRequestPut(context) {
  const { user, id, response } = await open(context);
  if (response) return response;
  const db = context.env.DB;
  const existing = id ? await db.prepare('SELECT * FROM deal_outlines WHERE id = ? AND user_id = ?').bind(id, user.id).first() : null;
  if (!existing) return notFound(NOT_FOUND);
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOutline(body, { existing });
  if (validated.error) return badRequest(validated.error);
  const d = validated.data;
  if (d.zip && d.zip !== existing.zip && !(await db.prepare('SELECT 1 AS ok FROM zip_codes WHERE zip = ?').bind(d.zip).first())) return badRequest("We don't know that ZIP code.");
  if (d.listed && !(await claimUserAction(db, 'idea_post', user.id))) return rateLimited();

  const values = outlineColumnValues(d);
  const result = await db.prepare(
    `UPDATE deal_outlines SET ${OUTLINE_COLUMNS.map((c, i) => `${c} = ?${i + 3}`).join(', ')}, updated_at = datetime('now')
     WHERE id = ?1 AND user_id = ?2
       AND (?15 = 0 OR listed = 1 OR (SELECT COUNT(*) FROM deal_outlines WHERE user_id = ?2 AND listed = 1) < ${MAX_LISTED_OUTLINES})`
  ).bind(id, user.id, ...values).run();
  if (!result.meta || !result.meta.changes) return badRequest(LISTED_LIMIT_ERROR);
  return json({ ok: true }, NO_STORE);
}

// The owner deletes an outline (it is gone for good; nothing else hangs off it). One statement.
export async function onRequestDelete(context) {
  const { user, id, response } = await open(context);
  if (response) return response;
  const result = id ? await context.env.DB.prepare('DELETE FROM deal_outlines WHERE id = ? AND user_id = ?').bind(id, user.id).run() : null;
  if (!result || !result.meta || !result.meta.changes) return notFound(NOT_FOUND);
  return json({ ok: true }, NO_STORE);
}
