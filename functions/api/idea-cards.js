import { getSessionUser } from '../_lib/auth.js';
import { json, unauthorized } from '../_lib/util.js';
import { ideaCardsFor } from '../_lib/ideaCards.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// The idea cards for the Ideas tab: only the cards whose tool is live for this viewer (nuancedGate.js), each ending
// with "General information. Not legal advice." and the HOA-and-city line. Signed-in members only. One statement
// (the session); the cards themselves are in ideaCards.js, never in the database.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  return json({ cards: ideaCardsFor(context.env, user) }, NO_STORE);
}
