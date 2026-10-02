// Server-side port of the matching engine originally prototyped client-side in app.js.
// Operates on "profile" objects: { id, current: {city,state,neighborhood,type,beds,baths,price}, desired: {...} }

import { netSaleProceeds, lumpSumRentalYears } from './util.js';

export const MATCH_THRESHOLD = 60;

// A rental match isn't worth surfacing if the seller's equity would barely
// cover a year of it — that's noise, not a real alternative to trading.
const MIN_RENTAL_YEARS = 1;

// Real trades usually have room to negotiate on price from both sides — a
// seller can come down, a buyer can stretch up — so a home priced up to ~9%
// outside someone's stated range still gets full price credit instead of
// being penalized or gated out. Per explicit ask: "the match % should go
// down to 91% ... wiggle room on both ends for a negotiation."
const NEGOTIATION_FLEX = 0.09;

const STATE_NAMES = {
  CA: 'california', MT: 'montana', MA: 'massachusetts', FL: 'florida', CO: 'colorado',
  NY: 'new york', AR: 'arkansas', NC: 'north carolina', ID: 'idaho', AZ: 'arizona',
  TX: 'texas', WA: 'washington', OR: 'oregon', NV: 'nevada', UT: 'utah', HI: 'hawaii',
};

export function locationMatches(desiredLocations, home) {
  if (!desiredLocations || desiredLocations.length === 0) return true;
  const city = (home.city || '').toLowerCase();
  const state = (home.state || '').toLowerCase();
  const neighborhood = (home.neighborhood || '').toLowerCase();
  const stateFull = STATE_NAMES[(home.state || '').toUpperCase()] || '';

  return desiredLocations.some(loc => {
    const l = loc.trim().toLowerCase();
    if (!l) return true;
    if (l === 'anywhere' || l === 'any') return true;
    if (l.length <= 2) return l === state;
    if (city && (city.includes(l) || l.includes(city))) return true;
    if (neighborhood && (neighborhood.includes(l) || l.includes(neighborhood))) return true;
    if (stateFull && (stateFull.includes(l) || l.includes(stateFull))) return true;
    return false;
  });
}

// Same math as before, just restructured to also hand back which specific
// factors did/didn't fit — so a user can see WHY they got 73% (price short,
// say) instead of just the raw number, and decide whether that's worth
// negotiating on or a reason to move on.
export function matchScoreBreakdown(desired, home) {
  const typeOk = desired.type === 'Any' || desired.type === home.type;
  const typeScore = typeOk ? 25 : 8;

  const price = Number(home.price) || 0;
  const min = Number(desired.priceMin) || 0;
  const max = Number(desired.priceMax) || Infinity;
  const flexMin = min * (1 - NEGOTIATION_FLEX);
  const flexMax = max === Infinity ? Infinity : max * (1 + NEGOTIATION_FLEX);
  let priceScore;
  if (price >= flexMin && price <= flexMax) {
    priceScore = 25;
  } else {
    const span = Math.max(max - min, 1);
    const dist = price < flexMin ? (flexMin - price) : (price - flexMax);
    const penalty = Math.min(1, dist / span);
    priceScore = Math.max(0, 25 * (1 - penalty));
  }
  const priceOk = priceScore >= 20; // "comfortably" within range, not just clearing the gate below

  const bedsOk = (Number(home.beds) || 0) >= (Number(desired.minBeds) || 0);
  const bathsOk = (Number(home.baths) || 0) >= (Number(desired.minBaths) || 0);
  let bbScore = 0;
  if (bedsOk) bbScore += 7.5;
  if (bathsOk) bbScore += 7.5;

  const locOk = locationMatches(desired.locations, home);
  const clearsPriceGate = priceScore >= 10;
  const gated = !locOk || !clearsPriceGate;
  const score = gated
    ? Math.round(Math.min(30, (typeScore + priceScore + bbScore) * 0.4))
    : Math.round(35 + typeScore + priceScore + bbScore);

  return {
    score,
    location: { ok: locOk },
    type: { ok: typeOk },
    price: { ok: priceOk, overPriced: price > flexMax, underPriced: price < flexMin },
    beds: { ok: bedsOk },
    baths: { ok: bathsOk },
  };
}

export function matchScore(desired, home) {
  return matchScoreBreakdown(desired, home).score;
}

export function buildEdges(profiles) {
  const edges = [];
  for (const seeker of profiles) {
    for (const owner of profiles) {
      if (seeker.id === owner.id) continue;
      const b = matchScoreBreakdown(seeker.desired, owner.current);
      if (b.score >= MATCH_THRESHOLD) edges.push({ from: seeker.id, to: owner.id, score: b.score, breakdown: b });
    }
  }
  return edges;
}

// First-time/primary-buyer profiles have no home to offer, so they can never
// form a reciprocal edge (nobody "wants" a home that doesn't exist) and can
// never sit inside a chain cycle. Their only role is a one-directional
// interest check: does this seller's home fit what the buyer is looking for.
export function findBuyerMatches(buyerProfiles, sellerProfiles) {
  const matches = [];
  for (const buyer of buyerProfiles) {
    for (const seller of sellerProfiles) {
      if (buyer.userId === seller.userId) continue;
      const b = matchScoreBreakdown(buyer.desired, seller.current);
      if (b.score >= MATCH_THRESHOLD) matches.push({ buyerId: buyer.id, sellerId: seller.id, score: b.score, breakdown: b });
    }
  }
  return matches;
}

// A rental listing has no reciprocal side at all — it's not "seeking"
// anything back, so it can't be scored as a mutual trade. But the seller DID
// say what would make them move (locations, property type, price bracket,
// min beds/baths), and that's exactly as meaningful a yardstick against a
// rental's own attributes as it is against another trade listing — so this
// reuses the same matchScore/MATCH_THRESHOLD as every other match type,
// scored one-directionally (same shape as findBuyerMatches). On top of that
// score gate, a rental match also needs the seller's net sale proceeds to
// cover at least MIN_RENTAL_YEARS of it (see util.js's lumpSumRentalYears
// for why the years figure itself is a range, not a single number).
export function findRentalMatches(sellerProfiles, rentalProfiles) {
  const matches = [];
  for (const seller of sellerProfiles) {
    const proceeds = netSaleProceeds(seller.current.price);
    for (const rental of rentalProfiles) {
      if (seller.userId === rental.userId) continue;
      const b = matchScoreBreakdown(seller.desired, rental.current);
      if (b.score < MATCH_THRESHOLD) continue;
      const years = lumpSumRentalYears(proceeds, rental.rentAmount);
      if (!years || years.yearsLow < MIN_RENTAL_YEARS) continue;
      matches.push({ sellerId: seller.id, rentalId: rental.id, score: b.score, breakdown: b, yearsLow: years.yearsLow, yearsHigh: years.yearsHigh });
    }
  }
  return matches;
}

export function findMutualMatches(edges) {
  const map = new Map();
  edges.forEach(e => map.set(`${e.from}->${e.to}`, e));
  const seen = new Set();
  const matches = [];
  edges.forEach(e => {
    const revKey = `${e.to}->${e.from}`;
    const rev = map.get(revKey);
    if (rev) {
      const pairKey = [e.from, e.to].sort().join('|');
      if (!seen.has(pairKey)) {
        seen.add(pairKey);
        matches.push({
          a: e.from, b: e.to, scoreAWantsB: e.score, scoreBWantsA: rev.score,
          breakdownAWantsB: e.breakdown, breakdownBWantsA: rev.breakdown,
        });
      }
    }
  });
  return matches.sort((x, y) => (y.scoreAWantsB + y.scoreBWantsA) - (x.scoreAWantsB + x.scoreBWantsA));
}

function pathEdgeScores(path, adj) {
  const scores = [];
  for (let i = 0; i < path.length; i++) {
    const from = path[i];
    const to = path[(i + 1) % path.length];
    const e = (adj.get(from) || []).find(x => x.to === to);
    scores.push(e ? e.score : 0);
  }
  return scores;
}

// A dense graph (lots of "wants Anywhere"/whole-state seekers, or several
// designed demo chains that happen to overlap) can have an enormous number
// of technically-valid cycles — we measured 1,645 from just 32 listings
// during testing. That's a real combinatorial fact, not a bug. Per explicit
// request the platform should surface real volume rather than an
// artificially small sample, so this is set high (2,000) rather than
// display-sized — it exists purely as a CPU-time safety valve against
// pathological graphs, not to shape what gets shown. Verified locally at
// full demo scale (400 seeded users) before raising this.
const MAX_RAW_CYCLES = 2000;

export function findChains(edges, profileIds) {
  const adj = new Map();
  edges.forEach(e => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
  });

  const rawCycles = [];
  const MAX_LEN = 5;

  function dfs(start, current, path, visited) {
    if (rawCycles.length >= MAX_RAW_CYCLES) return;
    const outEdges = adj.get(current) || [];
    for (const e of outEdges) {
      if (rawCycles.length >= MAX_RAW_CYCLES) return;
      if (e.to === start && path.length >= 3) {
        rawCycles.push([...path]);
        continue;
      }
      if (visited.has(e.to) || path.length >= MAX_LEN) continue;
      visited.add(e.to);
      path.push(e.to);
      dfs(start, e.to, path, visited);
      path.pop();
      visited.delete(e.to);
    }
  }

  for (const start of profileIds) {
    if (rawCycles.length >= MAX_RAW_CYCLES) break;
    dfs(start, start, [start], new Set([start]));
  }

  const uniq = new Map();
  for (const ids of rawCycles) {
    let minIdx = 0;
    for (let i = 1; i < ids.length; i++) if (ids[i] < ids[minIdx]) minIdx = i;
    const rotated = [...ids.slice(minIdx), ...ids.slice(0, minIdx)];
    const key = rotated.join('>');
    if (!uniq.has(key)) uniq.set(key, rotated);
  }

  return [...uniq.values()].map(path => {
    const scores = pathEdgeScores(path, adj);
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return { path, avg };
  }).sort((a, b) => b.avg - a.avg);
}

// Converts D1 rows (listings joined with desired_criteria) into the profile
// shape the scoring functions above expect.
export function rowsToProfiles(rows) {
  return rows.map(r => ({
    id: r.listing_id,
    userId: r.user_id,
    isBuyerOnly: !!r.is_buyer_only,
    isRental: !!r.is_rental,
    rentAmount: r.rent_amount || 0,
    current: {
      city: r.city, state: r.state, neighborhood: r.neighborhood,
      type: r.property_type, beds: r.beds, baths: r.baths, price: r.estimated_value,
    },
    desired: {
      locations: (r.locations || '').split(',').map(s => s.trim()).filter(Boolean),
      type: r.desired_type, minBeds: r.min_beds, minBaths: r.min_baths,
      priceMin: r.price_min, priceMax: r.price_max,
    },
  }));
}
