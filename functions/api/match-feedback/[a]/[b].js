import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../../_lib/util.js';

// Matches aren't rows in a table (they're computed on the fly by the
// matching engine — see functions/api/matches.js), so there's no natural
// primary key to hang feedback off of. The pair of listing ids stands in for
// one instead, always normalized smaller-first so either side of the match
// can address the same feedback row.
function normalizePair(context) {
  const a = Number(context.params.a);
  const b = Number(context.params.b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return null;
  return a < b ? [a, b] : [b, a];
}

export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const pair = normalizePair(context);
  if (!pair) return badRequest('Two distinct listing ids are required.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (!['up', 'down'].includes(body.feedback)) return badRequest('feedback must be "up" or "down".');

  await context.env.DB.prepare(
    `INSERT INTO match_feedback (user_id, listing_a_id, listing_b_id, feedback) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, listing_a_id, listing_b_id) DO UPDATE SET feedback = excluded.feedback, created_at = datetime('now')`
  ).bind(user.id, pair[0], pair[1], body.feedback).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const pair = normalizePair(context);
  if (!pair) return badRequest('Two distinct listing ids are required.');

  await context.env.DB.prepare(
    'DELETE FROM match_feedback WHERE user_id = ? AND listing_a_id = ? AND listing_b_id = ?'
  ).bind(user.id, pair[0], pair[1]).run();

  return json({ ok: true });
}
