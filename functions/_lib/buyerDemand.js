// "How many buyers are looking for a home like this?" for a pre-listing: the number of different people whose
// saved search, or whose trade listing's wish list, names this home's area and fits its type, price and size.
// Real accounts only (demo accounts never count), never the owner, and only a count: who they are is never
// shown, and fewer than DEMAND_MIN_SHOWN isn't shown at all, so nobody can be picked out. And, for the owner only,
// how many of those buyers' move-in windows fit theirs (also 3 or more only; Timing Match, R3-1b).
import { DEMO_EMAIL_PATTERN } from './util.js';
import { STATE_NAMES } from './matching.js';
import { timingFits, pacificToday } from './timingMatch.js';
import { priceIsOpen } from './preListings.js';

export const DEMAND_MIN_SHOWN = 3;

const STATE_WORDS = Object.values(STATE_NAMES);
const BROAD_WORDS = /\b(any|anywhere|county|counties|region|area|southern|northern|central|socal|norcal|state)\b/;

// "Chula Vista", "chula vista" and "ChulaVista" all compare equal.
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Only a search that names this home's own city or neighborhood counts. A whole state, a region ("Southern
// California", "San Diego County"), "anywhere", or a word that merely appears inside the name ("Vista" for Chula
// Vista, "Lake" for EastLake) is too broad to say someone wants *this* area. Unlike the trade matcher's looser
// locationMatches, this is an exact (spacing- and case-insensitive) match.
function namesThisArea(locations, home) {
  const city = squash(home.city);
  const hood = squash(home.neighborhood);
  // "Chula Vista CA" or "Chula Vista California" for a California home; any other trailing state ("Chula Vista
  // TX") or a look-alike ("San Diego Co") is left on, so it doesn't match.
  const code = String(home.state || '').trim().toLowerCase();
  const ownState = new RegExp(`\\s+(${[code, STATE_NAMES[code.toUpperCase()]].filter(Boolean).join('|')})$`);
  return String(locations || '').split(',').some(raw => {
    const l = raw.trim().toLowerCase().replace(ownState, '');
    if (l.length <= 2 || BROAD_WORDS.test(l) || STATE_WORDS.some(st => l.includes(st))) return false;
    const key = squash(l);
    return key.length > 0 && (key === city || (hood && key === hood));
  });
}

// Whether a search names this city exactly (same rules as above, without a neighborhood). Used by the ZIP board.
export function namesCity(locations, city) {
  return namesThisArea(locations, { city, neighborhood: '', state: 'CA' });
}

function fitsPrice(price, min, max) {
  return (!min || price >= min) && (!max || price <= max);
}

// Whether one saved search names this home's area and fits its type and price. cityOnly: match the city alone, for
// places where the home's neighborhood is hidden (the browse teaser), so a match can't give it away.
// home.priceOpen: the owner left the price blank ("open to price opinions"), so a home like this in this area is
// enough: the price check is skipped rather than run against a $0 price.
export function searchFitsHome(s, home, { cityOnly = false } = {}) {
  if (!namesThisArea(s.locations, cityOnly ? { ...home, neighborhood: '' } : home)) return false;
  if (s.property_type !== 'Any' && s.property_type !== home.propertyType) return false;
  if (!home.priceOpen && !fitsPrice(home.price, s.price_min, s.price_max)) return false;
  return true;
}

// { total, timingFit }: the buyers looking for a home like this, and how many of them have a saved search whose
// move-in window and stay offer fit the owner's timing. Wish lists have no move-in window, so they count only toward
// the total (timingFit <= total).
export async function countBuyerDemandDetail(db, home) {
  const checkPrice = !home.priceOpen;
  const buyers = new Set();
  const fits = new Set();
  const today = pacificToday();
  const searches = await db.prepare(
    `SELECT s.user_id, s.locations, s.property_type, s.price_min, s.price_max, s.move_from, s.move_to, s.stay_offer_days
     FROM saved_searches s JOIN users ON users.id = s.user_id
     WHERE users.status = 'active' AND users.email NOT LIKE ? AND s.user_id != ?
     LIMIT 5000`
  ).bind(DEMO_EMAIL_PATTERN, home.userId).all();
  for (const s of searches.results) {
    if (!searchFitsHome(s, home)) continue;
    buyers.add(s.user_id);
    if (home.closeFrom && timingFits(s, home, today)) fits.add(s.user_id);
  }
  const wishes = await db.prepare(
    `SELECT l.user_id, d.locations, d.property_type, d.min_beds, d.min_baths, d.price_min, d.price_max
     FROM desired_criteria d JOIN listings l ON l.id = d.listing_id JOIN users ON users.id = l.user_id
     WHERE l.status = 'active' AND users.status = 'active' AND users.email NOT LIKE ? AND l.user_id != ?
     LIMIT 5000`
  ).bind(DEMO_EMAIL_PATTERN, home.userId).all();
  for (const w of wishes.results) {
    if (!namesThisArea(w.locations, home)) continue;
    if (w.property_type !== 'Any' && w.property_type !== home.propertyType) continue;
    if (checkPrice && !fitsPrice(home.price, w.price_min, w.price_max)) continue;
    if ((Number(home.beds) || 0) < (Number(w.min_beds) || 0) || (Number(home.baths) || 0) < (Number(w.min_baths) || 0)) continue;
    buyers.add(w.user_id);
  }
  return { total: buyers.size, timingFit: fits.size };
}

// Just the number (the ZIP board, the vote notices and opinions-test use this shape).
export async function countBuyerDemand(db, home) {
  return (await countBuyerDemandDetail(db, home)).total;
}

// What a page may show: the count when there are enough buyers, otherwise null.
export async function buyerDemandForDisplay(db, home) {
  const n = await countBuyerDemand(db, home);
  return n >= DEMAND_MIN_SHOWN ? n : null;
}

// The meter plus, for the owner, how many of those buyers' move-in windows fit theirs. Each is null under
// DEMAND_MIN_SHOWN; timingDemand is also null when the owner has no window or it has passed. Only the owner may be
// sent timingDemand (the callers check).
export async function buyerDemandDetailForDisplay(db, home) {
  const { total, timingFit } = await countBuyerDemandDetail(db, home);
  const windowOpen = !!home.closeFrom && !(home.closeTo < pacificToday());
  return {
    buyerDemand: total >= DEMAND_MIN_SHOWN ? total : null,
    timingDemand: windowOpen && timingFit >= DEMAND_MIN_SHOWN ? timingFit : null,
  };
}

// The browse: which of these open pre-listings' timing fits one of the viewer's own timed saved searches (for the
// "Timing fits" tag). ONE query, and none when the viewer has no live move-in window. City only on purpose: the
// teaser hides the neighborhood, so a neighborhood match would give it away. The viewer's own homes are skipped.
export async function timingFitIdsFor(db, viewerId, rows, today = pacificToday()) {
  const found = await db.prepare(
    `SELECT locations, property_type, price_min, price_max, move_from, move_to, stay_offer_days FROM saved_searches
     WHERE user_id = ?1 AND move_from IS NOT NULL AND move_to >= ?2`
  ).bind(viewerId, today).all();
  const searches = (found && found.results) || [];
  if (!searches.length) return [];
  const ids = [];
  for (const r of rows || []) {
    if (r.user_id === viewerId) continue;
    const home = {
      city: r.city, state: r.state, neighborhood: '', propertyType: r.property_type, price: r.asking_price,
      priceOpen: priceIsOpen(r.asking_price), closeFrom: r.close_from, closeTo: r.close_to, stayAfterDays: r.stay_after_days,
    };
    if (searches.some(s => searchFitsHome(s, home, { cityOnly: true }) && timingFits(s, home, today))) ids.push(r.id);
  }
  return ids;
}
