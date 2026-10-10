// A saved watch on Market Pulse: notify a user in-app the moment a real event matches their filters (each
// optional -- unset means "any"). Mirrors accessibilityAlerts.js / greenNeedsAlerts.js / devProjectNeedsAlerts.js.
import { clampString } from './util.js';

const MAX_ALERTS_PER_USER = 10;
const VALID_EVENT_TYPES = ['new_listing', 'price_drop', 'offer_accepted', 'open_house_scheduled'];
const VALID_ENTITY_KINDS = ['listing', 'augmented_home', 'green_home', 'dev_project'];

export async function saveMarketPulseAlert(db, userId, body) {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM market_pulse_alerts WHERE user_id = ?').bind(userId).first();
  if (count.n >= MAX_ALERTS_PER_USER) return { error: `You can have at most ${MAX_ALERTS_PER_USER} saved alerts.` };

  const eventType = VALID_EVENT_TYPES.includes(body.eventType) ? body.eventType : null;
  const entityKind = VALID_ENTITY_KINDS.includes(body.entityKind) ? body.entityKind : null;
  const city = clampString(body.city, 80) || null;
  const state = clampString(body.state, 20) || null;
  if (!eventType && !entityKind && !city && !state) return { error: 'Pick at least one filter for this alert.' };

  const label = clampString(body.label, 80) || 'Market Pulse alert';

  const result = await db.prepare(
    'INSERT INTO market_pulse_alerts (user_id, label, event_type, entity_kind, city, state) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, label, eventType, entityKind, city, state).run();
  return { id: result.meta.last_row_id, label };
}

export async function fetchMyMarketPulseAlerts(db, userId) {
  const rows = await db.prepare(
    'SELECT id, label, event_type, entity_kind, city, state, created_at FROM market_pulse_alerts WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return rows.results.map(r => ({
    id: r.id, label: r.label, eventType: r.event_type, entityKind: r.entity_kind, city: r.city, state: r.state, createdAt: r.created_at,
  }));
}

export async function deleteMarketPulseAlert(db, userId, alertId) {
  await db.prepare('DELETE FROM market_pulse_alerts WHERE id = ? AND user_id = ?').bind(alertId, userId).run();
}

// Called from logMarketEvent() right after a real event is inserted. No per-event dedup needed (unlike the
// home/project needs-alerts): each market event is already a one-time occurrence, not a listing that could
// re-match the same alert on a later check.
export async function checkMarketPulseAlerts(db, event) {
  const alerts = await db.prepare(
    `SELECT id, user_id, label FROM market_pulse_alerts
     WHERE (event_type IS NULL OR event_type = ?) AND (entity_kind IS NULL OR entity_kind = ?)
       AND (city IS NULL OR LOWER(city) = LOWER(?)) AND (state IS NULL OR LOWER(state) = LOWER(?))`
  ).bind(event.eventType, event.entityKind, event.city || '', event.state || '').all();
  for (const alert of alerts.results) {
    await db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'market_pulse', ?, '/app#marketpulse')"
    ).bind(alert.user_id, `Market Pulse: ${event.headline} — matches your "${alert.label}" alert`).run();
  }
}
