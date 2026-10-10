import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchRecentMarketEvents, fetchMarketTrends, fetchMarketLeaderboard } from '../../_lib/marketEvents.js';

// Signed-in only, same as everything else the app shows -- the ticker is an in-app feature, not a public
// marketing page, at least for now. Optional city/state scope the whole tab (ticker, trends, leaderboard
// together) to one neighborhood, same filters the momentum banners use on the browse grids.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const url = new URL(context.request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const filters = { city: url.searchParams.get('city') || undefined, state: url.searchParams.get('state') || undefined };
  const db = context.env.DB;
  const [events, trends, leaderboard] = await Promise.all([
    fetchRecentMarketEvents(db, limit, filters),
    fetchMarketTrends(db, filters),
    fetchMarketLeaderboard(db, filters),
  ]);
  return json({ events, trends, leaderboard });
}
