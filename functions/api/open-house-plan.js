import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized } from '../_lib/util.js';
import { fetchOpenHousePlan, planDays } from '../_lib/openHousePlan.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// GET /api/open-house-plan?days=7 (1-8): the signed-in person's open houses (RSVP'd or on saved homes) and, for an
// approved agent, the broker previews they RSVP'd to, in start-time order. A file, not me/, because api/me.js exists.
// Per viewer, never cached; 2 statements + the session. No drive times, distances or "best" order: the Saved tab lets
// the person order the stops themselves (kept only on their device).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const days = planDays(new URL(context.request.url).searchParams.get('days'));
  const stops = await fetchOpenHousePlan(context.env.DB, user, { days });
  return json({ stops, days }, NO_STORE);
}
