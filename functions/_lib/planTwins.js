// Floor-plan twins (home facts batch): other listings whose owners typed the same builder, community and plan name,
// and who both ticked "List my home with other homes on Amico Haus that share my floor plan" (off by default).
// Matched only on what owners typed: the site never says two homes are twins, never uses county data, and the strip
// shows no price of any kind (same plan isn't same value; Rudy's jury test, 11.04). Listings only; pre-listings keep
// their plan text in home_facts_json for agents to read and are never in a twin list.
import { DEMO_EMAIL_PATTERN, escapeHtml, clampString, unlistedOwnerSql } from './util.js';
import { notBlockedSql } from './blocks.js';
import { steeringProblem, STEERING_ERROR, addressProblem, ADDRESS_ERROR, codeProblem, CODE_ERROR, foldAccents } from './homeText.js';
import { propertyArtUrl } from './propertyArt.js';

export const TWINS_HEADING = 'Other homes on Amico Haus with this floor plan';
export const TWINS_NOT_COMPS_LINE = "Floor plans are as each owner entered them. Same plan doesn't mean same condition, upgrades or value: these aren't comparable sales or a price estimate.";
const PLAN_TEXT_MAX = { builder: 60, name: 40, community: 60 };
const MAX_TWINS = 6;

// One part of the key: accents folded, lowercased, apostrophes and periods dropped, other punctuation to spaces,
// spaces collapsed, a leading "the " (and for the plan name, "plan ") removed. "Plan 3." and "plan  3" -> "3".
function planPart(text, { isName = false } = {}) {
  let s = foldAccents(String(text ?? '')).toLowerCase().replace(/['’.]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  s = s.replace(/^the /, '');
  if (isName) s = s.replace(/^plan /, '');
  return s;
}

// builder|community|name, or null when the builder or the plan name is blank (no twins without both).
export function planKey(builder, community, name) {
  const b = planPart(builder), c = planPart(community), n = planPart(name, { isName: true });
  if (!b || !n) return null;
  return `${b}|${c}|${n}`.slice(0, 200);
}

// The listing form's "Floor plan (optional)" fields -> what gets stored. Each text gets the fair-housing, address and
// code checks (English and Spanish). The box only sticks when there's a key to match on.
export function validateFloorPlan(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const part of ['builder', 'name', 'community']) {
    const s = clampString(typeof src[part] === 'string' ? src[part] : '', PLAN_TEXT_MAX[part]);
    if (s) {
      if (steeringProblem(s)) return { error: STEERING_ERROR };
      if (addressProblem(s)) return { error: ADDRESS_ERROR };
      if (codeProblem(s)) return { error: CODE_ERROR };
    }
    out[part] = s || null;
  }
  const key = planKey(out.builder, out.community, out.name);
  return { data: { ...out, key, showTwins: key && src.showTwins ? 1 : 0 } };
}

// Up to 6 other opted-in, live, public listings with the same plan key in the same city, newest first (never
// "best match"). One indexed statement, and none at all unless this listing opted in too.
export async function fetchPlanTwins(db, listing, viewerId) {
  if (!listing || Number(listing.plan_twins) !== 1 || !listing.plan_key) return [];
  const params = [listing.plan_key, listing.city || '', listing.id, DEMO_EMAIL_PATTERN];
  if (viewerId) params.push(viewerId);
  const rows = await db.prepare(
    `SELECT listings.id, listings.title, listings.property_type, listings.beds, listings.baths, listings.sqft,
            listings.neighborhood, listings.city, listings.state, listings.is_rental,
            (SELECT id FROM listing_photos WHERE listing_photos.listing_id = listings.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM listings JOIN users ON users.id = listings.user_id
     WHERE listings.plan_key = ?1 AND listings.city = ?2 COLLATE NOCASE AND listings.plan_twins = 1 AND listings.id != ?3
       AND listings.status = 'active' AND listings.is_buyer_only = 0 AND listings.is_portfolio = 0
       AND listings.id NOT IN (SELECT member_listing_id FROM portfolio_members)
       AND users.status = 'active' AND users.email NOT LIKE ?4 AND NOT ${unlistedOwnerSql('users.email')}
       ${viewerId ? `AND ${notBlockedSql('listings.user_id', '?5')}` : ''}
     ORDER BY listings.created_at DESC LIMIT ${MAX_TWINS}`
  ).bind(...params).all();
  return rows.results;
}

function areaLabel(r) {
  const n = String(r.neighborhood || '').trim(), c = String(r.city || '').trim();
  return n && n.toLowerCase() !== c.toLowerCase() ? `${n}, ${c}` : c;
}

// The strip for the listing page. No price, rent, value, $/sqft, sold data or count anywhere in it, and the
// "aren't comparable sales" line always shows.
export function planTwinsHtml(twins, listing) {
  if (!Array.isArray(twins) || !twins.length || !listing) return '';
  const cards = twins.slice(0, MAX_TWINS).map(t => {
    const name = t.title || t.property_type || 'Home';
    const img = t.photo_id
      ? `<img src="/api/photos/${Number(t.photo_id)}" alt="${escapeHtml(`Photo of ${name}`)}" loading="lazy">`
      : `<img src="${escapeHtml(propertyArtUrl(t.property_type, t.id))}" alt="Illustrative photo, not this home" loading="lazy">`;
    const size = `${Number(t.beds) || 0}bd/${Number(t.baths) || 0}ba${Number(t.sqft) > 0 ? ` · ${Number(t.sqft).toLocaleString('en-US')} sqft` : ''}`;
    return `
          <a class="similar-card plan-twin-card" href="/listing/${Number(t.id)}">
            ${img}
            <strong>${escapeHtml(name)}</strong>
            <span class="tiny">${escapeHtml(size)}</span>
            <span class="tiny">${escapeHtml(areaLabel(t))}</span>
            <span class="badge">${t.is_rental ? 'For rent' : 'For trade'}</span>
          </a>`;
  }).join('');
  return `
    <div class="card about-card plan-twins">
      <h2>${escapeHtml(TWINS_HEADING)}</h2>
      <div class="similar-grid">${cards}
      </div>
      <p class="tiny"><a href="/?plan=${encodeURIComponent(listing.plan_key || '')}#directory">See them all</a></p>
      <p class="tiny">${escapeHtml(TWINS_NOT_COMPS_LINE)}</p>
    </div>`;
}

// "Floor plan (from the owner)": shown to everyone once the owner ticks the box; before that, only the owner sees
// what they typed, with a note saying so.
export function floorPlanLineHtml(listing, { isOwner = false } = {}) {
  if (!listing) return '';
  const name = String(listing.plan_name || '').trim(), builder = String(listing.plan_builder || '').trim();
  const community = String(listing.plan_community || '').trim();
  if (!name && !builder && !community) return '';
  const opted = Number(listing.plan_twins) === 1;
  if (!opted && !isOwner) return '';
  const what = [name && builder ? `${name} by ${builder}` : (name || builder), community].filter(Boolean).join(', ');
  const ownerNote = opted ? '' : ' <span class="tiny">(only you see this until you tick "List my home with other homes on Amico Haus that share my floor plan")</span>';
  return `<p class="tiny"><span class="label">Floor plan (from the owner)</span> ${escapeHtml(what)}${ownerNote}</p>`;
}
