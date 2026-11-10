import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden, DEMO_EMAIL_PATTERN } from '../../_lib/util.js';

// Share Your Moment: homeowners' repost OKs from the last 180 days (given or taken back), newest first, so Rudy knows
// which recordings he may repost and which reposts to take down. Admin only. Never proposals, agents, fees or the address.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');
  const rows = await context.env.DB.prepare(
    `SELECT c.pre_listing_id, c.moment, c.user_id, u.display_name, p.city, p.state, c.consent_version, c.consented_at, c.withdrawn_at
     FROM moment_repost_consents c
     JOIN users u ON u.id = c.user_id
     JOIN pre_listings p ON p.id = c.pre_listing_id
     WHERE (c.consented_at >= datetime('now', '-180 days') OR c.withdrawn_at >= datetime('now', '-180 days'))
       AND u.email NOT LIKE ?
     ORDER BY COALESCE(c.withdrawn_at, c.consented_at) DESC, c.id DESC
     LIMIT 200`
  ).bind(DEMO_EMAIL_PATTERN).all();
  const consents = rows.results.map(r => ({
    preListingId: r.pre_listing_id, moment: r.moment, ownerUserId: r.user_id, ownerName: r.display_name,
    city: r.city, state: r.state, consentVersion: r.consent_version, consentedAt: r.consented_at, withdrawnAt: r.withdrawn_at,
  }));
  return json({ consents }, { headers: { 'Cache-Control': 'private, no-store' } });
}
