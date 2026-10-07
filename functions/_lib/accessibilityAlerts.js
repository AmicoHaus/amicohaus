// A buyer's saved "what I need" profile for AugmentedHomes — the reverse of
// a new-listing notification: instead of a buyer re-checking the browse list
// every day, this pings them the moment a newly-posted home matches at least
// one adaptation they need in their area. Mirrors agentSearchAlerts.js.
import { clampString } from './util.js';
import { validAdaptationKeys } from './adaptations.js';

const MAX_ALERTS_PER_USER = 10;

export async function saveAccessibilityAlert(db, userId, body) {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM accessibility_needs_alerts WHERE user_id = ?').bind(userId).first();
  if (count.n >= MAX_ALERTS_PER_USER) return { error: `You can have at most ${MAX_ALERTS_PER_USER} saved alerts.` };

  const label = clampString(body.label, 80) || 'Accessibility alert';
  const adaptations = validAdaptationKeys(body.adaptations);
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  if (adaptations.length === 0) return { error: 'Pick at least one adaptation you need.' };

  const result = await db.prepare(
    'INSERT INTO accessibility_needs_alerts (user_id, label, adaptations_json, city, state) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, label, JSON.stringify(adaptations), city, state).run();
  return { id: result.meta.last_row_id };
}

export async function fetchMyAccessibilityAlerts(db, userId) {
  const rows = await db.prepare(
    'SELECT id, label, adaptations_json, city, state, created_at FROM accessibility_needs_alerts WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return rows.results.map(r => ({ id: r.id, label: r.label, adaptations: JSON.parse(r.adaptations_json || '[]'), city: r.city, state: r.state, createdAt: r.created_at }));
}

export async function deleteAccessibilityAlert(db, userId, alertId) {
  await db.prepare('DELETE FROM accessibility_needs_alerts WHERE id = ? AND user_id = ?').bind(alertId, userId).run();
}

// Called after a new augmented_homes row is posted. Only ever notifies once
// per (alert, home) pair, same guard as checkAlertsForAgent.
export async function checkAlertsForNewHome(db, homeId) {
  const home = await db.prepare('SELECT city, state, adaptations_json FROM augmented_homes WHERE id = ?').bind(homeId).first();
  if (!home) return;
  const homeAdaptations = new Set(JSON.parse(home.adaptations_json || '[]'));

  const alerts = await db.prepare('SELECT * FROM accessibility_needs_alerts').all();
  for (const alert of alerts.results) {
    const notified = new Set(JSON.parse(alert.notified_home_ids_json || '[]'));
    if (notified.has(homeId)) continue;

    if (alert.city && alert.city.toLowerCase() !== home.city.toLowerCase()) continue;
    if (alert.state && alert.state.toLowerCase() !== home.state.toLowerCase()) continue;
    const wanted = JSON.parse(alert.adaptations_json || '[]');
    if (!wanted.some(key => homeAdaptations.has(key))) continue;

    notified.add(homeId);
    await db.prepare('UPDATE accessibility_needs_alerts SET notified_home_ids_json = ? WHERE id = ?')
      .bind(JSON.stringify([...notified]), alert.id).run();
    await db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)"
    ).bind(alert.user_id, `A new AugmentedHomes listing in ${home.city} matches your saved alert "${alert.label}".`, `/app#augmented-home-${homeId}`).run();
  }
}
