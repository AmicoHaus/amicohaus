// A buyer's saved "what I need" profile for GreenHomes -- the reverse of a new-listing notification: instead
// of re-checking the browse list every day, this pings them the moment a newly-posted home matches at least
// one green feature they want in their area. Mirrors accessibilityAlerts.js (AugmentedHomes' equivalent).
import { clampString } from './util.js';
import { validGreenFeatureKeys } from './greenFeatures.js';

const MAX_ALERTS_PER_USER = 10;

export async function saveGreenAlert(db, userId, body) {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM green_needs_alerts WHERE user_id = ?').bind(userId).first();
  if (count.n >= MAX_ALERTS_PER_USER) return { error: `You can have at most ${MAX_ALERTS_PER_USER} saved alerts.` };

  const label = clampString(body.label, 80) || 'Green home alert';
  const greenFeatures = validGreenFeatureKeys(body.greenFeatures);
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  if (greenFeatures.length === 0) return { error: 'Pick at least one green feature you need.' };

  const result = await db.prepare(
    'INSERT INTO green_needs_alerts (user_id, label, green_features_json, city, state) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, label, JSON.stringify(greenFeatures), city, state).run();
  return { id: result.meta.last_row_id };
}

export async function fetchMyGreenAlerts(db, userId) {
  const rows = await db.prepare(
    'SELECT id, label, green_features_json, city, state, created_at FROM green_needs_alerts WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return rows.results.map(r => ({ id: r.id, label: r.label, greenFeatures: JSON.parse(r.green_features_json || '[]'), city: r.city, state: r.state, createdAt: r.created_at }));
}

export async function deleteGreenAlert(db, userId, alertId) {
  await db.prepare('DELETE FROM green_needs_alerts WHERE id = ? AND user_id = ?').bind(alertId, userId).run();
}

// Called after a new green_homes row is posted. Only ever notifies once per
// (alert, home) pair, same guard as checkAlertsForNewHome (AugmentedHomes).
export async function checkGreenAlertsForNewHome(db, homeId) {
  const home = await db.prepare('SELECT city, state, green_features_json FROM green_homes WHERE id = ?').bind(homeId).first();
  if (!home) return;
  const homeFeatures = new Set(JSON.parse(home.green_features_json || '[]'));

  const alerts = await db.prepare('SELECT * FROM green_needs_alerts').all();
  for (const alert of alerts.results) {
    const notified = new Set(JSON.parse(alert.notified_home_ids_json || '[]'));
    if (notified.has(homeId)) continue;

    if (alert.city && alert.city.toLowerCase() !== home.city.toLowerCase()) continue;
    if (alert.state && alert.state.toLowerCase() !== home.state.toLowerCase()) continue;
    const wanted = JSON.parse(alert.green_features_json || '[]');
    if (!wanted.some(key => homeFeatures.has(key))) continue;

    notified.add(homeId);
    await db.prepare('UPDATE green_needs_alerts SET notified_home_ids_json = ? WHERE id = ?')
      .bind(JSON.stringify([...notified]), alert.id).run();
    await db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)"
    ).bind(alert.user_id, `A new GreenHomes listing in ${home.city} matches your saved alert "${alert.label}".`, `/app#green-home-${homeId}`).run();
  }
}
