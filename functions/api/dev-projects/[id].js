import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../_lib/util.js';
import { validateDevProjectInput, updateDevProject, fetchDevProjectPhotos, setDevProjectStatus, fetchInterestCount, fetchInterestedInvestors, hasExpressedInterest } from '../../_lib/devProjects.js';

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
  const interestCount = await fetchInterestCount(db, id);

  const project = {
    id: row.id, userId: row.user_id, owner: row.owner_name, title: row.title, description: row.description,
    address: isOwner ? row.address : undefined, neighborhood: row.neighborhood, city: row.city, state: row.state, zip: row.zip,
    projectType: row.project_type, stage: row.stage, fundingGoal: row.funding_goal, minInvestment: row.min_investment,
    targetReturn: row.target_return, timelineMonths: row.timeline_months, status: row.status, createdAt: row.created_at,
    photoIds: photos.map(p => p.id), interestCount,
  };

  const interestedInvestors = isOwner ? await fetchInterestedInvestors(db, id) : null;
  const amInterested = isOwner ? false : await hasExpressedInterest(db, id, user.id);

  return json({ project, isOwner: !!isOwner, interestedInvestors, amInterested });
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
    const result = await setDevProjectStatus(db, id, body.status);
    if (result.error) return badRequest(result.error);
    return json(result);
  }

  if (existing.status !== 'open') return badRequest('Only an open project can be edited.');
  const validated = validateDevProjectInput(body);
  if (validated.error) return badRequest(validated.error);
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

  await db.prepare('DELETE FROM dev_projects WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
