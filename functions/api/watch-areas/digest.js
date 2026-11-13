import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { fetchWatchDigest, MAX_WATCH_AREAS } from '../../_lib/watchAreas.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// "What's new in your watch areas": the member's ZIP codes and the newest items in them, from the registry in
// watchAreas.js (only the terms whose tool is live for this viewer). Pull only. 2 statements + the session.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'watchAreas', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const { areas, items } = await fetchWatchDigest(context.env.DB, context.env, user);
  return json({ areas, items, max: MAX_WATCH_AREAS }, NO_STORE);
}
