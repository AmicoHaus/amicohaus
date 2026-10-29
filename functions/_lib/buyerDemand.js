// "How many buyers are looking for a home like this?" for a pre-listing: the number of different people whose
// saved search, or whose trade listing's wish list, names this home's area and fits its type, price and size.
// Real accounts only (demo accounts never count), never the owner, and only a count: who they are is never
// shown, and fewer than DEMAND_MIN_SHOWN isn't shown at all, so nobody can be picked out.
import { DEMO_EMAIL_PATTERN } from './util.js';
import { STATE_NAMES } from './matching.js';

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

function fitsPrice(price, min, max) {
  return (!min || price >= min) && (!max || price <= max);
}

export async function countBuyerDemand(db, home) {
  const buyers = new Set();
  const searches = await db.prepare(
    `SELECT s.user_id, s.locations, s.property_type, s.price_min, s.price_max
     FROM saved_searches s JOIN users ON users.id = s.user_id
     WHERE users.status = 'active' AND users.email NOT LIKE ? AND s.user_id != ?
     LIMIT 5000`
  ).bind(DEMO_EMAIL_PATTERN, home.userId).all();
  for (const s of searches.results) {
    if (!namesThisArea(s.locations, home)) continue;
    if (s.property_type !== 'Any' && s.property_type !== home.propertyType) continue;
    if (!fitsPrice(home.price, s.price_min, s.price_max)) continue;
    buyers.add(s.user_id);
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
    if (!fitsPrice(home.price, w.price_min, w.price_max)) continue;
    if ((Number(home.beds) || 0) < (Number(w.min_beds) || 0) || (Number(home.baths) || 0) < (Number(w.min_baths) || 0)) continue;
    buyers.add(w.user_id);
  }
  return buyers.size;
}

// What a page may show: the count when there are enough buyers, otherwise null.
export async function buyerDemandForDisplay(db, home) {
  const n = await countBuyerDemand(db, home);
  return n >= DEMAND_MIN_SHOWN ? n : null;
}
