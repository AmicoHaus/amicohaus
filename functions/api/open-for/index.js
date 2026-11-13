import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound, clampString, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { validZip } from '../../_lib/ideaText.js';
import { notBlockedSql } from '../../_lib/blocks.js';
import { claimUserAction, rateLimited } from '../../_lib/rateLimits.js';
import { viewerIsDemo } from '../../_lib/dealOutlines.js';
import { validateOpenFor, openForFromRow, openForConfig, OPEN_FOR_USES, MAX_OPEN_FOR, OPEN_FOR_LIMIT_ERROR } from '../../_lib/openFor.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Open For (gate openFor; signed-in members only). ?mine=1 -> the person's own flag sets plus the form's wording.
// Otherwise a search: `use` is required; `zip` is exact, `city` is equal ignoring case (never a LIKE on what someone
// typed); active sets of other people, owner active, not a demo account, no block either way; newest first. One
// statement either way. Never an address (none is stored), never a price or a term (none exists).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'openFor', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);
  if (url.searchParams.get('mine') === '1') {
    const rows = await db.prepare('SELECT * FROM open_for WHERE user_id = ? ORDER BY created_at DESC, id DESC').bind(user.id).all();
    return json({ flags: rows.results.map(r => openForFromRow(r, { mine: true })), config: openForConfig() }, NO_STORE);
  }
  const use = (url.searchParams.get('use') || '').trim();
  if (!Object.hasOwn(OPEN_FOR_USES, use)) return badRequest('Pick a use to search for.');
  const zip = (url.searchParams.get('zip') || '').trim();
  if (zip && !validZip(zip)) return badRequest('ZIP code should be 5 digits.');
  const city = clampString(url.searchParams.get('city'), 60);
  const rows = await db.prepare(
    `SELECT f.*, u.display_name AS owner_name FROM open_for f JOIN users u ON u.id = f.user_id
     WHERE f.status = 'active' AND f.user_id != ?1 AND u.status = 'active' AND (u.email NOT LIKE ?2 OR ?3 = 1)
       AND ${notBlockedSql('f.user_id', '?1')}
       AND EXISTS (SELECT 1 FROM json_each(f.uses_json) WHERE value = ?4)
       AND (?5 = '' OR f.zip = ?5) AND (?6 = '' OR f.city = ?6 COLLATE NOCASE)
     ORDER BY f.created_at DESC, f.id DESC LIMIT 40`
  ).bind(user.id, DEMO_EMAIL_PATTERN, viewerIsDemo(user), use, zip, city).all();
  return json({ flags: rows.results.map(r => openForFromRow(r)) }, NO_STORE);
}

// Saves a new flag set. At most 3 per person (the count sits in the INSERT); every save counts toward idea_post.
// 3 statements (ZIP lookup, the limit, the INSERT), 4 when the 3-set limit refuses it.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'openFor', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const validated = validateOpenFor(body);
  if (validated.error) return badRequest(validated.error);
  const d = validated.data;
  const db = context.env.DB;
  if (!(await db.prepare('SELECT 1 AS ok FROM zip_codes WHERE zip = ?').bind(d.zip).first())) return badRequest("We don't know that ZIP code.");
  if (!(await claimUserAction(db, 'idea_post', user.id))) return rateLimited();
  const result = await db.prepare(
    `INSERT INTO open_for (user_id, property_kind, zip, city, state, uses_json, facts_json, status)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE (SELECT COUNT(*) FROM open_for WHERE user_id = ?1) < ${MAX_OPEN_FOR}`
  ).bind(user.id, d.propertyKind, d.zip, d.city, d.state, JSON.stringify(d.uses), JSON.stringify(d.facts), d.status).run();
  if (!result.meta || !result.meta.changes) return badRequest(OPEN_FOR_LIMIT_ERROR);
  return json({ ok: true, id: result.meta.last_row_id }, { status: 201, ...NO_STORE });
}
