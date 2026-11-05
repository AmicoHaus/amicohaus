import { json, DEMO_EMAIL_PATTERN, unlistedOwnerSql } from '../_lib/util.js';

// The real numbers behind the home page. Counts only — nothing about who or
// what — and seeded demo accounts are excluded from every one, so the demo's
// sample data and the live site never mix. "listings" uses exactly the same
// conditions as the public listing directory (api/directory.js), so the number
// on the home page always matches the list under it, plus the unlisted rule
// (unlistedOwnerSql: the @resend.dev authz test accounts and the Google Play
// reviewer's sample listing are never counted). The directory itself keeps the
// test accounts because the authz suite checks its test agent is listed.
export async function onRequestGet(context) {
  const db = context.env.DB;

  const count = async (sql) => (await db.prepare(sql).bind(DEMO_EMAIL_PATTERN).first()).n;

  const agents = await count(
    `SELECT COUNT(*) AS n FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = 'approved' AND users.email NOT LIKE ?
       AND NOT ${unlistedOwnerSql('users.email')}`
  );
  const openPreListings = await count(
    `SELECT COUNT(*) AS n FROM pre_listings JOIN users ON users.id = pre_listings.user_id
     WHERE pre_listings.status = 'open' AND users.email NOT LIKE ?
       AND NOT ${unlistedOwnerSql('users.email')}`
  );
  const openTradeRequests = await count(
    `SELECT COUNT(*) AS n FROM transaction_requests JOIN users ON users.id = transaction_requests.user_a_id
     WHERE transaction_requests.status = 'open' AND users.email NOT LIKE ?
       AND NOT ${unlistedOwnerSql('users.email')}`
  );
  const listings = await count(
    `SELECT COUNT(*) AS n FROM listings JOIN users ON users.id = listings.user_id
     WHERE listings.status = 'active' AND listings.is_buyer_only = 0 AND users.email NOT LIKE ?
       AND listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)
       AND NOT ${unlistedOwnerSql('users.email')}`
  );

  return json(
    { agents, openRequests: openPreListings + openTradeRequests, listings },
    { headers: { 'Cache-Control': 'public, max-age=60' } }
  );
}
