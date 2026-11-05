import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { validateDevProjectInput, insertDevProject } from '../../_lib/devProjects.js';
import { fetchPhotoIdsBatch } from '../../_lib/photoBatch.js';
import { fetchMyFavoriteProjectIds, fetchFavoriteCountBatch } from '../../_lib/devProjectFavorites.js';
import { checkAlertsForNewProject } from '../../_lib/devProjectNeedsAlerts.js';
import { logMarketEventUnlessDemo, fetchRecentActivityBatch } from '../../_lib/marketEvents.js';
import { PROJECT_TYPE_LABELS } from '../../_lib/devProjects.js';
import { fetchCommentCountBatch } from '../../_lib/dealThreads.js';

// FinderMine is for projects looking for a builder, partner or co-buyer; people reach the poster through Amico Haus
// messages (Rudy 11.04). No investment terms: a funding amount, a minimum investment and a target return are never
// accepted, stored or shown (devProjects.js ignores them; the columns stay and are cleared on save), there's no
// investor count or "I'm interested" list, and "Fully Funded" is gone as a stage and a status. Older rows read as no
// stage / closed. A suspended owner's projects drop out of the browse, the same as their project pages.
const LIST_FIELDS = `dev_projects.id, dev_projects.user_id, dev_projects.title, dev_projects.city, dev_projects.state,
  dev_projects.project_type, dev_projects.stage,
  dev_projects.timeline_months, dev_projects.status, dev_projects.created_at,
  dev_projects.adaptations_json, dev_projects.green_features_json, users.display_name AS owner_name`;

// ?mine=1 for a poster's own projects (any status); otherwise every open
// one, filterable by ?type=, ?stage=, ?city=, ?state= — open to anyone
// signed in to browse.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  const url = new URL(context.request.url);

  let rows;
  let hasMore = false;
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
    // Capped at 60 so the batch lookups below stay well under D1's per-query bound-parameter limit.
    const limit = Math.min(Number(url.searchParams.get('limit')) || 60, 60);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
    const wantedAdaptations = url.searchParams.getAll('adaptation').filter(Boolean).slice(0, 30);
    const wantedGreenFeatures = url.searchParams.getAll('greenFeature').filter(Boolean).slice(0, 30);
    const conditions = [`dev_projects.status = 'open'`, `users.status = 'active'`];
    const params = [];
    if (city) { conditions.push('dev_projects.city LIKE ?'); params.push(`%${city}%`); }
    if (state) { conditions.push('dev_projects.state LIKE ?'); params.push(`%${state}%`); }
    if (type) { conditions.push('dev_projects.project_type = ?'); params.push(type); }
    if (stage && stage !== 'funded') { conditions.push('dev_projects.stage = ?'); params.push(stage); }
    // Each checked group is "has any of these"; both groups together must both match -- same rules as before,
    // just applied in SQL so every page is a full page of real matches.
    if (wantedAdaptations.length) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(dev_projects.adaptations_json) WHERE json_each.value IN (${wantedAdaptations.map(() => '?').join(',')}))`);
      params.push(...wantedAdaptations);
    }
    if (wantedGreenFeatures.length) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(dev_projects.green_features_json) WHERE json_each.value IN (${wantedGreenFeatures.map(() => '?').join(',')}))`);
      params.push(...wantedGreenFeatures);
    }
    params.push(limit + 1, offset);
    rows = await db.prepare(
      `SELECT ${LIST_FIELDS} FROM dev_projects JOIN users ON users.id = dev_projects.user_id
       WHERE ${conditions.join(' AND ')} ORDER BY dev_projects.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params).all();
    hasMore = rows.results.length > limit;
    if (hasMore) rows.results.length = limit;
  }

  const favoritesMode = url.searchParams.get('favorites') === '1';
  const myFavoriteIds = favoritesMode ? null : new Set(await fetchMyFavoriteProjectIds(db, user.id));
  const ids = rows.results.map(r => r.id);
  const [recentActivityByProject, favoriteCountByProject, commentCountByProject, photoIdsByProject] = await Promise.all([
    fetchRecentActivityBatch(db, 'dev_project', ids),
    fetchFavoriteCountBatch(db, ids),
    fetchCommentCountBatch(db, 'dev_project', ids),
    fetchPhotoIdsBatch(db, 'dev_project', ids),
  ]);
  const projects = [];
  for (const r of rows.results) {
    const adaptations = JSON.parse(r.adaptations_json || '[]');
    const greenFeatures = JSON.parse(r.green_features_json || '[]');
    projects.push({
      id: r.id, userId: r.user_id, owner: r.owner_name, title: r.title, city: r.city, state: r.state,
      projectType: r.project_type, stage: r.stage === 'funded' ? null : r.stage,
      timelineMonths: r.timeline_months, status: r.status === 'funded' ? 'closed' : r.status, createdAt: r.created_at,
      photoIds: photoIdsByProject.get(r.id) || [], adaptations, greenFeatures,
      recentActivity: recentActivityByProject.get(r.id) || null,
      favoriteCount: favoriteCountByProject.get(r.id) || 0,
      commentCount: commentCountByProject.get(r.id) || 0,
      isFavorited: favoritesMode ? true : myFavoriteIds.has(r.id),
    });
  }
  return json({ projects, hasMore }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  if (body.stage === 'funded') return badRequest('Pick a project stage.');

  const validated = validateDevProjectInput(body);
  if (validated.error) return badRequest(validated.error);

  const id = await insertDevProject(context.env.DB, user.id, validated.data);
  context.waitUntil(checkAlertsForNewProject(context.env.DB, id));
  const typeLabel = PROJECT_TYPE_LABELS[validated.data.projectType] || validated.data.projectType;
  // No dollar amount in the activity feed: a project post isn't a request for money.
  context.waitUntil(logMarketEventUnlessDemo(context.env.DB, user.id, {
    eventType: 'new_listing', entityKind: 'dev_project', entityId: id,
    city: validated.data.city, state: validated.data.state,
    headline: `New FinderMine project in ${validated.data.city}, ${validated.data.state}: ${typeLabel}`,
    amount: null,
  }));
  return json({ id }, { status: 201 });
}
