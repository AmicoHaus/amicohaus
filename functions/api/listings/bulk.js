import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, forbidden } from '../../_lib/util.js';
import { validateListingInput, insertListing } from '../../_lib/listings.js';
import { notifySavedSearches, savedSearchHome } from '../../_lib/savedSearches.js';
import { isApprovedAgent } from '../../_lib/agents.js';

// Agent mass-upload, for approved agents only (Rudy 11.05) — the client parses a CSV into an array of the
// same field shape the single-listing form uses, and this validates + inserts
// each row independently (one bad row shouldn't block the other 49).
const MAX_ROWS = 100;

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  const db = context.env.DB;
  if (!(await isApprovedAgent(db, user.id))) return forbidden('Bulk upload is for approved agents.');

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const rows = Array.isArray(body.listings) ? body.listings.slice(0, MAX_ROWS) : [];
  if (rows.length === 0) return badRequest('No listings to upload.');

  const results = [];
  const newHomes = [];
  for (let i = 0; i < rows.length; i++) {
    const validated = validateListingInput(rows[i]);
    if (validated.error) {
      results.push({ row: i + 1, ok: false, error: validated.error });
      continue;
    }
    try {
      const id = await insertListing(db, user.id, validated.data);
      results.push({ row: i + 1, ok: true, id });
      const home = savedSearchHome(id, user.id, validated.data);
      if (home) newHomes.push(home);
    } catch {
      results.push({ row: i + 1, ok: false, error: 'Could not save this row.' });
    }
  }
  // One background pass for the whole upload: each person with a matching saved search gets one alert, not one per row.
  if (newHomes.length) {
    context.waitUntil(notifySavedSearches(db, newHomes).catch(err => console.log(`[saved search notify failed] ${err.message}`)));
  }

  return json({ created: results.filter(r => r.ok).length, total: rows.length, results });
}
