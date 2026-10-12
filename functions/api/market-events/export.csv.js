import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized, toCsv, csvResponse } from '../../_lib/util.js';
import { fetchRecentMarketEvents } from '../../_lib/marketEvents.js';

// CSV download of the same real event log the Market Pulse ticker reads -- same signed-in gate, same
// optional entityKind/city/state scope, just a much higher row cap since this is meant as a take-it-with-you
// history dump rather than a live feed.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const url = new URL(context.request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 500, 2000);
  const filters = {
    entityKind: url.searchParams.get('entityKind') || undefined,
    city: url.searchParams.get('city') || undefined,
    state: url.searchParams.get('state') || undefined,
  };
  const events = await fetchRecentMarketEvents(context.env.DB, limit, filters);

  const header = ['date', 'eventType', 'entityKind', 'entityId', 'city', 'state', 'headline', 'amount', 'delta'];
  const rows = events.map(e => [e.createdAt, e.eventType, e.entityKind, e.entityId, e.city, e.state, e.headline, e.amount ?? '', e.delta ?? '']);
  return csvResponse(toCsv(header, rows), 'market-pulse-history.csv');
}
