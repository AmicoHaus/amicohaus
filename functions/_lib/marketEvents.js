// A real, append-only log of actual platform activity -- never simulated. Real estate has no continuous
// market the way stocks do, so this logs events as they really happen (a new listing, a real price drop, a
// real accepted offer, a real open house) rather than faking tick-by-tick price action. Demo accounts never
// appear here, same separation the rest of the site keeps between live and seeded/demo data.
import { DEMO_EMAIL_PATTERN } from './util.js';
import { checkMarketPulseAlerts } from './marketPulseAlerts.js';

export async function logMarketEvent(db, event) {
  const { eventType, entityKind, entityId, city, state, headline, amount, delta } = event;
  await db.prepare(
    'INSERT INTO market_events (event_type, entity_kind, entity_id, city, state, headline, amount, delta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(eventType, entityKind, entityId, city || '', state || '', headline, amount ?? null, delta ?? null).run();
  await checkMarketPulseAlerts(db, event);
}

// Looks up the given user's email once and skips logging if it's a demo account -- called from the same spot
// that already has ownerUserId on hand, so this is one query, not a second round trip for the caller.
export async function logMarketEventUnlessDemo(db, ownerUserId, event) {
  const owner = await db.prepare(`SELECT id FROM users WHERE id = ? AND email NOT LIKE ?`).bind(ownerUserId, DEMO_EMAIL_PATTERN).first();
  if (!owner) return;
  await logMarketEvent(db, event);
}

export async function fetchRecentMarketEvents(db, limit = 50) {
  // created_at has only 1-second resolution, so two events on the same entity in the same second are a real
  // possibility (e.g. a brand-new listing immediately edited) -- id DESC breaks the tie by actual insert order.
  const rows = await db.prepare('SELECT * FROM market_events ORDER BY created_at DESC, id DESC LIMIT ?').bind(limit).all();
  return rows.results.map(r => ({
    id: r.id, eventType: r.event_type, entityKind: r.entity_kind, entityId: r.entity_id,
    city: r.city, state: r.state, headline: r.headline, amount: r.amount, delta: r.delta, createdAt: r.created_at,
  }));
}

// A few aggregate numbers for a "trending" panel above the ticker -- the closer analog to the market-stats
// pages BiggerPockets/r/REBubble argue over, built from the same real event log, not a separate data source.
export async function fetchMarketTrends(db) {
  const [byType, topCities, drops] = await Promise.all([
    db.prepare(`SELECT event_type, COUNT(*) AS n FROM market_events WHERE created_at > datetime('now', '-7 days') GROUP BY event_type`).all(),
    db.prepare(`SELECT city, state, COUNT(*) AS n FROM market_events WHERE created_at > datetime('now', '-7 days') AND city != '' GROUP BY city, state ORDER BY n DESC LIMIT 3`).all(),
    db.prepare(`SELECT COALESCE(SUM(ABS(delta)), 0) AS total, COUNT(*) AS n FROM market_events WHERE event_type = 'price_drop' AND created_at > datetime('now', '-30 days')`).first(),
  ]);
  return {
    eventCounts7d: Object.fromEntries(byType.results.map(r => [r.event_type, r.n])),
    topCities7d: topCities.results.map(r => ({ city: r.city, state: r.state, count: r.n })),
    priceDropTotal30d: drops.total, priceDropCount30d: drops.n,
  };
}

// Batches each entity's most recent new_listing/price_drop within the window, for a list/browse card's
// "just listed" or "price cut" accent -- the two event types that make sense as an at-a-glance card cue
// (an accepted offer or open house don't call for the buyer's attention the same way).
export async function fetchRecentActivityBatch(db, entityKind, ids, hours = 48) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await db.prepare(
    `SELECT entity_id, event_type FROM market_events
     WHERE entity_kind = ? AND entity_id IN (${ids.map(() => '?').join(',')}) AND event_type IN ('new_listing', 'price_drop')
       AND created_at > datetime('now', ?)
     ORDER BY created_at DESC, id DESC`
  ).bind(entityKind, ...ids, `-${hours} hours`).all();
  for (const r of rows.results) {
    if (!map.has(r.entity_id)) map.set(r.entity_id, r.event_type); // first row per id, in DESC order = most recent
  }
  return map;
}
