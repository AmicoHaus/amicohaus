import { getSessionUser } from '../../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden, notFound } from '../../../_lib/util.js';
import { toolLive } from '../../../_lib/nuancedGate.js';
import { validateStepDown, stepNextAt } from '../../../_lib/stepDown.js';
import { claimUserAction, rateLimited } from '../../../_lib/rateLimits.js';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

// Step-Down Price (stepDown.js): the owner of a trade listing publishes a price schedule, or stops it. Every step and
// date is public; there is no private floor. Not for a rental, a buyer profile, a portfolio (or a home bundled into
// one), a paused listing, or a home posted for a client or by an approved agent. Until the tool is live for this person the route
// answers "Not found." (nuancedGate.js).
async function ownedListing(context, user) {
  const listing = await context.env.DB.prepare(
    `SELECT id, user_id, is_rental, is_buyer_only, is_portfolio, status, client_name, estimated_value,
            (SELECT 1 FROM portfolio_members WHERE member_listing_id = listings.id) AS bundled,
            (SELECT 1 FROM agent_profiles WHERE user_id = listings.user_id AND status = 'approved') AS agent_owner
     FROM listings WHERE id = ?`
  ).bind(context.params.id).first();
  if (!listing) return { response: notFound('Listing not found.') };
  // Only the owner: an admin never changes what an owner published.
  if (listing.user_id !== user.id) return { response: forbidden() };
  return { listing };
}

// Body { stepAmount, stepDays, steps, confirm }. Publishes (or replaces) the schedule, starting from the listing's
// price today. 3 statements + the session.
export async function onRequestPut(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'stepDown', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const { listing, response } = await ownedListing(context, user);
  if (response) return response;

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const now = Date.now();
  const validated = validateStepDown(body, listing, now);
  if (validated.error) return validated.code ? json({ error: validated.error, code: validated.code }, { status: 400 }) : badRequest(validated.error);

  const db = context.env.DB;
  if (!(await claimUserAction(db, 'step_down_edit', user.id))) return rateLimited();
  await db.prepare("UPDATE listings SET step_down_json = ?, step_next_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(JSON.stringify(validated.data), stepNextAt(validated.data, now), listing.id, user.id).run();
  return json({ ok: true, stepDown: validated.data }, NO_STORE);
}

// Stops the schedule. The price stays where it is. 2 statements + the session.
export async function onRequestDelete(context) {
  const user = await getSessionUser(context);
  if (!toolLive(context.env, 'stepDown', user)) return notFound('Not found.');
  if (!user) return unauthorized();
  const { listing, response } = await ownedListing(context, user);
  if (response) return response;
  await context.env.DB.prepare("UPDATE listings SET step_down_json = '{}', step_next_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(listing.id, user.id).run();
  return json({ ok: true }, NO_STORE);
}
