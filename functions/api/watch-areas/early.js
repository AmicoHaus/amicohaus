import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, notFound } from '../../_lib/util.js';
import { toolLive } from '../../_lib/nuancedGate.js';
import { fetchEarlyLooks } from '../../_lib/watchAreas.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Neighbors First: trade listings in their head start, for members who watch the listing's ZIP (watchAreas.js).
// The only place a head-start listing shows to anyone but its owner and admins. Never the address. 1 statement +
// the session.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'watchAreas', user) || !toolLive(context.env, 'headStart', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  return json({ homes: await fetchEarlyLooks(context.env.DB, user) }, NO_STORE);
}
