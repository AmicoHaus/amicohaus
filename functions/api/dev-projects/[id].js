import { getSessionUser } from '../../_lib/auth.js';
import { logAdminAction } from '../../_lib/audit.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../_lib/util.js';
import { validateDevProjectInput, updateDevProject, fetchDevProjectPhotos, setDevProjectStatus } from '../../_lib/devProjects.js';
import { isFavorited } from '../../_lib/devProjectFavorites.js';
import { deleteR2Keys } from '../../_lib/r2Cleanup.js';

// FinderMine (Rudy 11.04): projects looking for a builder, partner or co-buyer, no investment terms. See
// dev-projects/index.js: no funding amount, minimum investment, target return, investor count or "interested
// investors" list (devProjects.js never accepts them), and no "Fully Funded" stage or status.

export async function onRequestGet(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;

  const row = await db.prepare(
    `SELECT dev_projects.*, users.display_name AS owner_name
     FROM dev_projects JOIN users ON users.id = dev_projects.user_id WHERE dev_projects.id = ?`
  ).bind(id).first();
  if (!row) return notFound('Project not found.');

  const isOwner = user.id === row.user_id;
  const photos = await fetchDevProjectPhotos(db, id);

  const project = {
    id: row.id, userId: row.user_id, owner: row.owner_name, title: row.title, description: row.description,
    address: isOwner ? row.address : undefined, neighborhood: row.neighborhood, city: row.city, state: row.state, zip: row.zip,
    projectType: row.project_type, stage: row.stage === 'funded' ? null : row.stage,
    timelineMonths: row.timeline_months, status: row.status === 'funded' ? 'closed' : row.status, createdAt: row.created_at,
    photoIds: photos.map(p => p.id), adaptations: JSON.parse(row.adaptations_json || '[]'),
    greenFeatures: JSON.parse(row.green_features_json || '[]'),
    isFavorited: isOwner ? false : await isFavorited(db, user.id, id),
  };

  return json({ project, isOwner: !!isOwner }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function onRequestPut(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id, status FROM dev_projects WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Project not found.');
  if (existing.user_id !== user.id) return forbidden();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  if (body.action === 'set-status') {
    // Open or closed only ("Fully Funded" is gone).
    if (!['open', 'closed'].includes(body.status)) return badRequest('Invalid status.');
    const result = await setDevProjectStatus(db, id, body.status);
    if (result.error) return badRequest(result.error);
    return json(result);
  }

  if (existing.status !== 'open') return badRequest('Only an open project can be edited.');
  if (body.stage === 'funded') return badRequest('Pick a project stage.');
  const validated = validateDevProjectInput(body);
  if (validated.error) return badRequest(validated.error);
  // Saving also clears any funding amount, minimum investment or target return stored before the rule.
  await updateDevProject(db, id, validated.data);
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const id = context.params.id;
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const existing = await db.prepare('SELECT user_id FROM dev_projects WHERE id = ?').bind(id).first();
  if (!existing) return notFound('Project not found.');
  if (existing.user_id !== user.id && user.role !== 'admin') return forbidden();
  // An admin acting on someone else's content is on the admin activity log.
  if (existing.user_id !== user.id) await logAdminAction(db, user.id, 'delete_dev_project', 'dev_project', id);

  // Photo keys are read before the delete (the cascade takes the rows), then the files go from R2.
  const photos = await db.prepare('SELECT r2_key FROM dev_project_photos WHERE dev_project_id = ?').bind(id).all();
  await db.prepare('DELETE FROM dev_projects WHERE id = ?').bind(id).run();
  await deleteR2Keys(context.env.PHOTOS, photos.results.map(p => p.r2_key));
  return json({ ok: true });
}
