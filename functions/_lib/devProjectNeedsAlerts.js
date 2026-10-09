// An investor's saved "what I'm looking for" profile for FinderMine -- pings them the moment a newly-posted
// project matches their type/city/state, instead of them re-checking the browse list every day. Mirrors
// accessibilityAlerts.js / greenNeedsAlerts.js, but matches on project type and location, not taxonomy keys.
import { clampString } from './util.js';
import { PROJECT_TYPES } from './devProjects.js';

const MAX_ALERTS_PER_USER = 10;

export async function saveDevProjectAlert(db, userId, body) {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM dev_project_needs_alerts WHERE user_id = ?').bind(userId).first();
  if (count.n >= MAX_ALERTS_PER_USER) return { error: `You can have at most ${MAX_ALERTS_PER_USER} saved alerts.` };

  const label = clampString(body.label, 80) || 'FinderMine alert';
  const projectType = PROJECT_TYPES.includes(body.projectType) ? body.projectType : '';
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  if (!projectType && !city && !state) return { error: 'Pick a project type, city, or state to match on.' };

  const result = await db.prepare(
    'INSERT INTO dev_project_needs_alerts (user_id, label, project_type, city, state) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, label, projectType, city, state).run();
  return { id: result.meta.last_row_id };
}

export async function fetchMyDevProjectAlerts(db, userId) {
  const rows = await db.prepare(
    'SELECT id, label, project_type, city, state, created_at FROM dev_project_needs_alerts WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return rows.results.map(r => ({ id: r.id, label: r.label, projectType: r.project_type, city: r.city, state: r.state, createdAt: r.created_at }));
}

export async function deleteDevProjectAlert(db, userId, alertId) {
  await db.prepare('DELETE FROM dev_project_needs_alerts WHERE id = ? AND user_id = ?').bind(alertId, userId).run();
}

// Called after a new dev_projects row is posted. Only ever notifies once per (alert, project) pair.
export async function checkAlertsForNewProject(db, projectId) {
  const project = await db.prepare('SELECT city, state, project_type FROM dev_projects WHERE id = ?').bind(projectId).first();
  if (!project) return;

  const alerts = await db.prepare('SELECT * FROM dev_project_needs_alerts').all();
  for (const alert of alerts.results) {
    const notified = new Set(JSON.parse(alert.notified_project_ids_json || '[]'));
    if (notified.has(projectId)) continue;

    if (alert.project_type && alert.project_type !== project.project_type) continue;
    if (alert.city && alert.city.toLowerCase() !== project.city.toLowerCase()) continue;
    if (alert.state && alert.state.toLowerCase() !== project.state.toLowerCase()) continue;

    notified.add(projectId);
    await db.prepare('UPDATE dev_project_needs_alerts SET notified_project_ids_json = ? WHERE id = ?')
      .bind(JSON.stringify([...notified]), alert.id).run();
    await db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)"
    ).bind(alert.user_id, `A new FinderMine project in ${project.city} matches your saved alert "${alert.label}".`, `/app#dev-project-${projectId}`).run();
  }
}
