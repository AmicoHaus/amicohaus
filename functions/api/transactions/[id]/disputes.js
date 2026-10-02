import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../../_lib/util.js';
import { raiseDispute } from '../../../_lib/disputes.js';

export async function onRequestPost(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const result = await raiseDispute(context.env.DB, 'transaction', id, user.id, body);
  if (result.error) return badRequest(result.error);
  return json(result, { status: 201 });
}
