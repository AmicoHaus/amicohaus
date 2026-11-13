import { getSessionUser } from '../_lib/auth.js';
import { json } from '../_lib/util.js';
import { liveTools } from '../_lib/nuancedGate.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Which nuanced-ideas tools this viewer can use (nuancedGate.js): the live ones for everyone, all of them for an
// admin. The app reads it once at boot. One statement (the session); nothing here is read from the database.
export async function onRequestGet(context) {
  return json({ tools: liveTools(context.env, await getSessionUser(context)) }, NO_STORE);
}
