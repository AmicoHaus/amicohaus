import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { validateOpenFor } from '../../_lib/openFor.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };
const NOT_FOUND = 'Open For flags not found.';

// Gate (openFor) and sign-in for both methods; the row id as a whole number, or 0.
async function open(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'openFor', user)) return { response: notFound('Not found.') };
  if (!user) return { response: unauthorized() };
  const id = /^\d{1,15}$/.test(String(context.params.id || '')) ? Number(context.params.id) : 0;
  return { user, id };
}

// The owner edits a flag set (or pauses it: { status: 'paused' } alone keeps everything else). The ZIP is looked up
// only when it changed; every save counts toward idea_post. 3-4 statements.
export async function onRequestPut(context) {
  const { user, id, response } = await open(context);
  if (response) return response;
  const db = context.env.DB;
  const existing = id ? await db.prepare('SELECT * FROM open_for WHERE id = ? AND user_id = ?').bind(id, user.id).first() : null;
  if (!existing) return notFound(NOT_FOUND);
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOpenFor(body, { existing });
  if (validated.error) return badRequest(validated.error);
  const d = validated.data;
  if (d.zip !== existing.zip && !(await db.prepare('SELECT 1 AS ok FROM zip_codes WHERE zip = ?').bind(d.zip).first())) return badRequest("We don't know that ZIP code.");
  if (!(await claimUserAction(db, 'idea_post', user.id))) return rateLimited();
  await db.prepare(
    `UPDATE open_for SET property_kind = ?3, zip = ?4, city = ?5, state = ?6, uses_json = ?7, facts_json = ?8, status = ?9, updated_at = datetime('now')
     WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.id, d.propertyKind, d.zip, d.city, d.state, JSON.stringify(d.uses), JSON.stringify(d.facts), d.status).run();
  return json({ ok: true }, NO_STORE);
}

// The owner deletes a flag set. One statement.
export async function onRequestDelete(context) {
  const { user, id, response } = await open(context);
  if (response) return response;
  const result = id ? await context.env.DB.prepare('DELETE FROM open_for WHERE id = ? AND user_id = ?').bind(id, user.id).run() : null;
  if (!result || !result.meta || !result.meta.changes) return notFound(NOT_FOUND);
  return json({ ok: true }, NO_STORE);
}
