import { json } from '../_lib/util.js';
import { fetchMarketTrends, fetchMarketLeaderboard } from '../_lib/marketEvents.js';

// Public, aggregate-only -- counts, a headline, a city/state, same shape the public listing directory
// already shows (no address, no owner info). Same spirit as public-stats.js: a trust-building teaser,
// unlike the full event ticker at /api/market-events which stays signed-in-only.
// Optional query params scope it to one vertical and/or one city/state: a "momentum" banner on a single
// browse grid, or the Market Pulse tab's own location filter.
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const filters = {
    entityKind: url.searchParams.get('entityKind') || undefined,
    city: url.searchParams.get('city') || undefined,
    state: url.searchParams.get('state') || undefined,
  };
  const [trends, leaderboard] = await Promise.all([
    fetchMarketTrends(db, filters),
    fetchMarketLeaderboard(db, filters),
  ]);
  return json({ trends, leaderboard }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
