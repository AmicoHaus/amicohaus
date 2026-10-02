import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { validateListingInput, insertListing } from '../../_lib/listings.js';

// Broker/agent mass-upload — the client parses a CSV into an array of the
// same field shape the single-listing form uses, and this validates + inserts
// each row independently (one bad row shouldn't block the other 49).
const MAX_ROWS = 100;

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const rows = Array.isArray(body.listings) ? body.listings.slice(0, MAX_ROWS) : [];
  if (rows.length === 0) return badRequest('No listings to upload.');

  const db = context.env.DB;
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const validated = validateListingInput(rows[i]);
    if (validated.error) {
      results.push({ row: i + 1, ok: false, error: validated.error });
      continue;
    }
    try {
      const id = await insertListing(db, user.id, validated.data);
      results.push({ row: i + 1, ok: true, id });
    } catch {
      results.push({ row: i + 1, ok: false, error: 'Could not save this row.' });
    }
  }

  return json({ created: results.filter(r => r.ok).length, total: rows.length, results });
}
