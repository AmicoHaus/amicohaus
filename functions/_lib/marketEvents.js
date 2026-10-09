// A real, append-only log of actual platform activity -- never simulated. Real estate has no continuous
// market the way stocks do, so this logs events as they really happen (a new listing, a real price drop, a
// real accepted offer, a real open house) rather than faking tick-by-tick price action. Demo accounts never
// appear here, same separation the rest of the site keeps between live and seeded/demo data.
import { DEMO_EMAIL_PATTERN } from './util.js';

export async function logMarketEvent(db, { eventType, entityKind, entityId, city, state, headline, amount, delta }) {
  await db.prepare(
    'INSERT INTO market_events (event_type, entity_kind, entity_id, city, state, headline, amount, delta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(eventType, entityKind, entityId, city || '', state || '', headline, amount ?? null, delta ?? null).run();
}

// Looks up the given user's email once and skips logging if it's a demo account -- called from the same spot
// that already has ownerUserId on hand, so this is one query, not a second round trip for the caller.
export async function logMarketEventUnlessDemo(db, ownerUserId, event) {
  const owner = await db.prepare(`SELECT id FROM users WHERE id = ? AND email NOT LIKE ?`).bind(ownerUserId, DEMO_EMAIL_PATTERN).first();
  if (!owner) return;
  await logMarketEvent(db, event);
}

export async function fetchRecentMarketEvents(db, limit = 50) {
  const rows = await db.prepare('SELECT * FROM market_events ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return rows.results.map(r => ({
    id: r.id, eventType: r.event_type, entityKind: r.entity_kind, entityId: r.entity_id,
    city: r.city, state: r.state, headline: r.headline, amount: r.amount, delta: r.delta, createdAt: r.created_at,
  }));
}
