import { getSessionUser } from '../../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../../_lib/util.js';
import { fetchCaseStudyForDelete, deleteCaseStudy } from '../../../_lib/caseStudies.js';

export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const row = await fetchCaseStudyForDelete(db, context.params.id, user.id);
  if (!row) return notFound('Case study not found.');

  const bucket = context.env.PHOTOS;
  if (bucket) {
    await bucket.delete(row.before_r2_key);
    await bucket.delete(row.after_r2_key);
  }
  await deleteCaseStudy(db, context.params.id, user.id);
  return json({ ok: true });
}
