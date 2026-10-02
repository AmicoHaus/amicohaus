import { getSessionUser } from '../_lib/auth.js';
import { json, parseJsonSafe, DEMO_EMAIL_PATTERN } from '../_lib/util.js';
import { fetchPortfolioMembers } from '../_lib/portfolios.js';

const PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];
const SORTS = {
  newest: 'listings.created_at DESC',
  price_asc: 'listings.estimated_value ASC',
  price_desc: 'listings.estimated_value DESC',
};

// Public, no-login-required browse of active listings. Only ever exposes the
// city/neighborhood-level fields — never the street address — regardless of
// each listing's own show_exact_address preference (that only applies once a
// match is confirmed and the two agents/users are actually introduced).
export async function onRequestGet(context) {
  const db = context.env.DB;
  const viewer = await getSessionUser(context);
  const url = new URL(context.request.url);
  const groupId = url.searchParams.get('groupId');
  const city = (url.searchParams.get('city') || '').trim();
  const state = (url.searchParams.get('state') || '').trim();
  const propertyType = url.searchParams.get('propertyType');
  const priceMin = Number(url.searchParams.get('priceMin'));
  const priceMax = Number(url.searchParams.get('priceMax'));
  const sort = SORTS[url.searchParams.get('sort')] || SORTS.newest;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 100);
  const kind = url.searchParams.get('kind'); // 'trade' | 'rental' | 'portfolio' | null (all)

  // First-time/primary-buyer profiles have no home to show off — they only
  // ever surface as a one-directional match on a seller's own Matches tab.
  // Seeded demo accounts (no password, can never reply) are excluded so real
  // users never browse into — or try to message — one. Rentals ARE shown
  // here (unlike buyer-only) — an ultra-luxury rental is a real property
  // someone can browse and reach out about. A bundled member listing is only
  // tradeable through its portfolio now, so it's hidden here too — only the
  // portfolio itself (which lists its members) is browsable.
  const conditions = [
    `listings.status = 'active'`, `listings.is_buyer_only = 0`, `users.email NOT LIKE ?`,
    `listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)`,
  ];
  const params = [DEMO_EMAIL_PATTERN];
  if (kind === 'rental') conditions.push('listings.is_rental = 1');
  else if (kind === 'trade') conditions.push('listings.is_rental = 0 AND listings.is_portfolio = 0');
  else if (kind === 'portfolio') conditions.push('listings.is_portfolio = 1');

  if (groupId) {
    conditions.push('group_memberships.group_id = ?');
    params.push(groupId);
  }
  if (city) { conditions.push('listings.city LIKE ?'); params.push(`%${city}%`); }
  if (state) { conditions.push('listings.state LIKE ?'); params.push(`%${state}%`); }
  if (PROPERTY_TYPES.includes(propertyType)) { conditions.push('listings.property_type = ?'); params.push(propertyType); }
  if (Number.isFinite(priceMin) && priceMin > 0) { conditions.push('listings.estimated_value >= ?'); params.push(priceMin); }
  if (Number.isFinite(priceMax) && priceMax > 0) { conditions.push('listings.estimated_value <= ?'); params.push(priceMax); }
  if (viewer) {
    conditions.push(`listings.id NOT IN (SELECT listing_id FROM listing_feedback WHERE user_id = ? AND feedback = 'down')`);
    params.push(viewer.id);
  }

  const joinGroups = groupId ? 'JOIN group_memberships ON group_memberships.user_id = listings.user_id' : '';
  // This subquery's "?" is textually the first placeholder in the compiled
  // SQL (SELECT clause precedes WHERE), so its param goes at the front —
  // everything else keeps appending in the order its condition was added.
  const myFeedbackSelect = viewer
    ? '(SELECT feedback FROM listing_feedback WHERE listing_feedback.listing_id = listings.id AND listing_feedback.user_id = ?) AS my_feedback'
    : 'NULL AS my_feedback';
  if (viewer) params.unshift(viewer.id);
  params.push(limit);

  const rows = await db.prepare(
    `SELECT listings.id, listings.title, listings.neighborhood, listings.city, listings.state,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value, listings.price_tier,
            listings.external_links, listings.is_rental, listings.rent_amount, listings.min_lease_months, listings.is_portfolio,
            users.display_name AS owner_name,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.price_min, desired_criteria.price_max,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id,
            ${myFeedbackSelect}
     FROM listings
     JOIN users ON users.id = listings.user_id
     ${joinGroups}
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${sort} LIMIT ?`
  ).bind(...params).all();

  const portfolioIds = rows.results.filter(r => r.is_portfolio).map(r => r.id);
  const membersByPortfolio = await fetchPortfolioMembers(db, portfolioIds);

  const listings = rows.results.map(r => ({
    ...r, external_links: parseJsonSafe(r.external_links, []),
    portfolio_members: r.is_portfolio ? (membersByPortfolio.get(r.id) || []) : undefined,
  }));
  return json({ listings });
}
