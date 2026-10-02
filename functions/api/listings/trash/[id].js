import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, badRequest } from '../../../_lib/util.js';
import { restoreFromTrash, purgeOneFromTrash } from '../../../_lib/trash.js';
import { notifyNewMatches } from '../../../_lib/matchNotify.js';

// POST restores (the trash item id isn't a listing id, so this doesn't fit
// the /api/listings/[id] PUT's edit action — a fresh route is clearer than
// overloading that one further).
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const result = await restoreFromTrash(context.env.DB, user.id, context.params.id);
  if (result.error) return badRequest(result.error);

  context.waitUntil(notifyNewMatches(context, result.id));
  return json({ id: result.id });
}

// Permanently removes one trash entry early, without restoring it.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  await purgeOneFromTrash(context.env.DB, user.id, context.params.id);
  return json({ ok: true });
}
