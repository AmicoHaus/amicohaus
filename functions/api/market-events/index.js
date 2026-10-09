import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized } from '../../_lib/util.js';
import { fetchRecentMarketEvents } from '../../_lib/marketEvents.js';

// Signed-in only, same as everything else the app shows -- the ticker is an in-app feature, not a public
// marketing page, at least for now.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const url = new URL(context.request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const events = await fetchRecentMarketEvents(context.env.DB, limit);
  return json({ events });
}
