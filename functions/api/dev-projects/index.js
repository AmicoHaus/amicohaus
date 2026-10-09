import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { validateDevProjectInput, insertDevProject, fetchDevProjectPhotos, fetchInterestCount } from '../../_lib/devProjects.js';
import { fetchMyFavoriteProjectIds } from '../../_lib/devProjectFavorites.js';
import { checkAlertsForNewProject } from '../../_lib/devProjectNeedsAlerts.js';

const LIST_FIELDS = `dev_projects.id, dev_projects.user_id, dev_projects.title, dev_projects.city, dev_projects.state,
  dev_projects.project_type, dev_projects.stage, dev_projects.funding_goal, dev_projects.min_investment,
  dev_projects.target_return, dev_projects.timeline_months, dev_projects.status, dev_projects.created_at,
  dev_projects.adaptations_json, dev_projects.green_features_json, users.display_name AS owner_name`;

// ?mine=1 for a poster's own projects (any status); otherwise every open
// one, filterable by ?type=, ?stage=, ?city=, ?state= — open to anyone
// signed in to browse, same openness model as pre-listings.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);

  let rows;
  if (url.searchParams.get('mine') === '1') {
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM dev_projects JOIN users ON users.id = dev_projects.user_id
       WHERE dev_projects.user_id = ? ORDER BY dev_projects.created_at DESC`
    ).bind(user.id).all();
  } else if (url.searchParams.get('favorites') === '1') {
    const favoriteIds = await fetchMyFavoriteProjectIds(db, user.id);
    if (!favoriteIds.length) return json({ projects: [] });
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM dev_projects JOIN users ON users.id = dev_projects.user_id
       WHERE dev_projects.id IN (${favoriteIds.map(() => '?').join(',')}) ORDER BY dev_projects.created_at DESC`
    ).bind(...favoriteIds).all();
  } else {
    const city = (url.searchParams.get('city') || '').trim();
    const state = (url.searchParams.get('state') || '').trim();
    const type = (url.searchParams.get('type') || '').trim();
    const stage = (url.searchParams.get('stage') || '').trim();
    const conditions = [`dev_projects.status = 'open'`];
    const params = [];
    if (city) { conditions.push('dev_projects.city LIKE ?'); params.push(`%${city}%`); }
    if (state) { conditions.push('dev_projects.state LIKE ?'); params.push(`%${state}%`); }
    if (type) { conditions.push('dev_projects.project_type = ?'); params.push(type); }
    if (stage) { conditions.push('dev_projects.stage = ?'); params.push(stage); }
    params.push(60);
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM dev_projects JOIN users ON users.id = dev_projects.user_id
       WHERE ${conditions.join(' AND ')} ORDER BY dev_projects.created_at DESC LIMIT ?`
    ).bind(...params).all();
  }

  const wantedAdaptations = url.searchParams.getAll('adaptation');
  const wantedGreenFeatures = url.searchParams.getAll('greenFeature');
  const favoritesMode = url.searchParams.get('favorites') === '1';
  const skipFilter = url.searchParams.get('mine') === '1' || favoritesMode;
  const myFavoriteIds = favoritesMode ? null : new Set(await fetchMyFavoriteProjectIds(db, user.id));
  const projects = [];
  for (const r of rows.results) {
    const adaptations = JSON.parse(r.adaptations_json || '[]');
    const greenFeatures = JSON.parse(r.green_features_json || '[]');
    if (!skipFilter && wantedAdaptations.length && !wantedAdaptations.some(k => adaptations.includes(k))) continue;
    if (!skipFilter && wantedGreenFeatures.length && !wantedGreenFeatures.some(k => greenFeatures.includes(k))) continue;
    const photos = await fetchDevProjectPhotos(db, r.id);
    const interestCount = await fetchInterestCount(db, r.id);
    projects.push({
      id: r.id, userId: r.user_id, owner: r.owner_name, title: r.title, city: r.city, state: r.state,
      projectType: r.project_type, stage: r.stage, fundingGoal: r.funding_goal, minInvestment: r.min_investment,
      targetReturn: r.target_return, timelineMonths: r.timeline_months, status: r.status, createdAt: r.created_at,
      photoIds: photos.map(p => p.id), interestCount, adaptations, greenFeatures,
      isFavorited: favoritesMode ? true : myFavoriteIds.has(r.id),
    });
  }
  return json({ projects });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const validated = validateDevProjectInput(body);
  if (validated.error) return badRequest(validated.error);

  const id = await insertDevProject(context.env.DB, user.id, validated.data);
  context.waitUntil(checkAlertsForNewProject(context.env.DB, id));
  return json({ id }, { status: 201 });
}
