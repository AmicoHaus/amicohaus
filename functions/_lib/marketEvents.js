// A real, append-only log of actual platform activity -- never simulated. Real estate has no continuous
// market the way stocks do, so this logs events as they really happen (a new listing, a real price drop, a
// real accepted offer, a real open house) rather than faking tick-by-tick price action. Demo accounts never
// appear here, same separation the rest of the site keeps between live and seeded/demo data.
import { DEMO_EMAIL_PATTERN } from './util.js';
import { checkMarketPulseAlerts } from './marketPulseAlerts.js';

// An accepted offer on Amico Haus only means the owner wants to move forward; it isn't a sale and has no price
// anyone should rely on, so the event says so and never carries the amount.
export function offerAcceptedHeadline(city) {
  return `Offer accepted on Amico Haus in ${city || 'San Diego County'} (not a closed sale)`;
}

// Older rows were logged before that rule ("Deal closed in X: $Y", "... $Z sought" on FinderMine projects), so every
// read goes through this: offer events get the new wording, and offers and FinderMine projects lose their amounts.
export function cleanMarketEvent(r) {
  let headline = r.headline;
  let amount = r.amount ?? null;
  if (r.event_type === 'offer_accepted') { headline = offerAcceptedHeadline(r.city); amount = null; }
  if (r.entity_kind === 'dev_project') {
    // ...and an older FinderMine "Fix & Flip" reads as "Renovation" (the label since Rudy 11.04).
    headline = String(headline || '').replace(/\s+—\s+\$[\d,]+ sought$/, '').replace(/: Fix & Flip$/, ': Renovation');
    amount = null;
  }
  return { headline, amount };
}

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

export async function fetchRecentMarketEvents(db, limit = 50, filters = {}) {
  // created_at has only 1-second resolution, so two events on the same entity in the same second are a real
  // possibility (e.g. a brand-new listing immediately edited) -- id DESC breaks the tie by actual insert order.
  const scope = trendScope(filters, ['1=1']);
  const rows = await db.prepare(`SELECT * FROM market_events WHERE ${scope.where} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...scope.params, limit).all();
  return rows.results.map(r => ({
    id: r.id, eventType: r.event_type, entityKind: r.entity_kind, entityId: r.entity_id,
    city: r.city, state: r.state, ...cleanMarketEvent(r), delta: r.delta, createdAt: r.created_at,
  }));
}

// Builds the WHERE-clause fragments + bound params shared by fetchMarketTrends/fetchMarketLeaderboard --
// every caller optionally scopes by vertical (entityKind) and/or location (city/state), city/state compared
// case-insensitively like the rest of the app's location matching (needs-alerts, etc).
function trendScope(filters, baseConditions) {
  const { entityKind, city, state } = filters;
  const conditions = [...baseConditions];
  const params = [];
  if (entityKind) { conditions.push('entity_kind = ?'); params.push(entityKind); }
  if (city) { conditions.push('LOWER(city) = LOWER(?)'); params.push(city); }
  if (state) { conditions.push('LOWER(state) = LOWER(?)'); params.push(state); }
  return { where: conditions.join(' AND '), params };
}

// A few aggregate numbers for a "trending" panel above the ticker -- the closer analog to the market-stats
// pages BiggerPockets/r/REBubble argue over, built from the same real event log, not a separate data source.
// filters (all optional) scope this to one vertical and/or one city/state -- e.g. a "momentum" banner on the
// AugmentedHomes browse grid, or the Market Pulse tab's own city filter.
export async function fetchMarketTrends(db, filters = {}) {
  const scope7 = trendScope(filters, [`created_at > datetime('now', '-7 days')`]);
  const scope30 = trendScope(filters, [`created_at > datetime('now', '-30 days')`, `event_type = 'price_drop'`]);
  // Top cities only makes sense when the caller hasn't already pinned one.
  const [byType, topCities, drops] = await Promise.all([
    db.prepare(`SELECT event_type, COUNT(*) AS n FROM market_events WHERE ${scope7.where} GROUP BY event_type`).bind(...scope7.params).all(),
    filters.city
      ? Promise.resolve({ results: [] })
      : db.prepare(`SELECT city, state, COUNT(*) AS n FROM market_events WHERE ${scope7.where} AND city != '' GROUP BY city, state ORDER BY n DESC LIMIT 3`).bind(...scope7.params).all(),
    db.prepare(`SELECT COALESCE(SUM(ABS(delta)), 0) AS total, COUNT(*) AS n FROM market_events WHERE ${scope30.where}`).bind(...scope30.params).first(),
  ]);
  return {
    eventCounts7d: Object.fromEntries(byType.results.map(r => [r.event_type, r.n])),
    topCities7d: topCities.results.map(r => ({ city: r.city, state: r.state, count: r.n })),
    priceDropTotal30d: drops.total, priceDropCount30d: drops.n,
  };
}

// One spotlight: the home or project with the most activity in the last 7 days, counting only new listings and
// open houses (never price drops or accepted offers), within the same optional scope as fetchMarketTrends. There's
// no "hottest" and no "biggest price drop" card any more: the site doesn't rank homes or single one out for a cut.
// The app labels it "Most activity this week".
export async function fetchMarketLeaderboard(db, filters = {}) {
  const scope = trendScope(filters, [`created_at > datetime('now', '-7 days')`, `event_type IN ('new_listing', 'open_house_scheduled')`]);
  const row = await db.prepare(
    `SELECT entity_kind, entity_id, COUNT(*) AS event_count, MAX(headline) AS headline, MAX(city) AS city, MAX(state) AS state
     FROM market_events WHERE ${scope.where} GROUP BY entity_kind, entity_id ORDER BY event_count DESC, MAX(created_at) DESC LIMIT 1`
  ).bind(...scope.params).first();
  const mostActivity = row ? { ...row, headline: cleanMarketEvent({ ...row, event_type: 'new_listing' }).headline } : null;
  return { mostActivity };
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
