import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized } from '../../../_lib/util.js';
import { listTrash } from '../../../_lib/trash.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  // Opening the trash also purges entries past their 7 days, photos included.
  const trash = await listTrash(context.env.DB, user.id, context.env.PHOTOS);
  return json({ trash });
}
