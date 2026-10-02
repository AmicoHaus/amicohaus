import { getSessionUser } from '../../_lib/auth.js';
import { json, unauthorized, forbidden, priceTierFor, PRICE_TIERS } from '../../_lib/util.js';

// Demo-data generator for showing the platform with realistic volume, without
// waiting on real signups. Every seeded account gets a null password_hash
// (nobody needs to log in as them) and an @demo.amicohaus.local email, so
// they're trivially identifiable and can be wiped later with:
//   DELETE FROM users WHERE email LIKE '%@demo.amicohaus.local';
// (cascades to their listings/posts/etc via the schema's ON DELETE CASCADE).
//
// Called repeatedly (small batch per call) from admin-seed.html rather than
// generating everything in one request, since a few thousand rows of D1
// writes would otherwise risk the Worker's request time limit.

const FIRST_NAMES = ['James','Maria','Robert','Linda','John','Patricia','Michael','Jennifer','David','Elizabeth','William','Susan','Richard','Jessica','Joseph','Sarah','Thomas','Karen','Charles','Nancy','Daniel','Lisa','Matthew','Betty','Anthony','Margaret','Mark','Sandra','Paul','Ashley','Steven','Kimberly','Andrew','Emily','Kenneth','Donna','George','Michelle','Joshua','Carol','Kevin','Amanda','Brian','Melissa','Edward','Deborah','Ronald','Stephanie','Timothy','Rebecca','Jason','Laura','Jeff','Amy','Ryan','Angela','Jacob','Helen','Gary','Anna'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts'];

// Deliberately narrowed to 4 states so a smaller user count still produces
// dense overlap (more plausible matches per user) instead of spreading thin
// across the whole country — good for a quick, impressive demo run.
const CITIES = [
  { city: 'San Diego', state: 'CA', base: 950000 }, { city: 'Los Angeles', state: 'CA', base: 980000 },
  { city: 'San Francisco', state: 'CA', base: 1550000 }, { city: 'San Jose', state: 'CA', base: 1450000 },
  { city: 'Sacramento', state: 'CA', base: 520000 }, { city: 'Fresno', state: 'CA', base: 350000 },
  { city: 'Oakland', state: 'CA', base: 750000 }, { city: 'Long Beach', state: 'CA', base: 680000 },
  { city: 'Coronado', state: 'CA', base: 2400000 }, { city: 'Beverly Hills', state: 'CA', base: 4200000 },

  { city: 'Miami', state: 'FL', base: 620000 }, { city: 'Tampa', state: 'FL', base: 400000 },
  { city: 'Orlando', state: 'FL', base: 390000 }, { city: 'Jacksonville', state: 'FL', base: 320000 },
  { city: 'Fort Lauderdale', state: 'FL', base: 520000 }, { city: 'Tallahassee', state: 'FL', base: 280000 },
  { city: 'Sarasota', state: 'FL', base: 480000 }, { city: 'Naples', state: 'FL', base: 1800000 },

  { city: 'New York', state: 'NY', base: 1100000 }, { city: 'Brooklyn', state: 'NY', base: 900000 },
  { city: 'Buffalo', state: 'NY', base: 240000 }, { city: 'Albany', state: 'NY', base: 280000 },
  { city: 'Rochester', state: 'NY', base: 220000 }, { city: 'Syracuse', state: 'NY', base: 200000 },
  { city: 'Yonkers', state: 'NY', base: 450000 },

  { city: 'Seattle', state: 'WA', base: 780000 }, { city: 'Spokane', state: 'WA', base: 350000 },
  { city: 'Tacoma', state: 'WA', base: 420000 }, { city: 'Bellevue', state: 'WA', base: 1100000 },
  { city: 'Olympia', state: 'WA', base: 380000 }, { city: 'Vancouver', state: 'WA', base: 450000 },
];

const STATES = ['California', 'Florida', 'New York', 'Washington'];

const PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];
const NEIGHBORHOODS = ['Downtown', 'Uptown', 'Riverside', 'Lakeview', 'Hillcrest', 'Midtown', 'Old Town', 'Westside', 'Eastside', 'Northside', 'Southgate', 'Parkside'];
const MUST_HAVES = ['garage', 'pool', 'view', 'single-story', 'big yard', 'home office', 'walkable', 'quiet street', 'updated kitchen', 'near schools'];

const POST_TEMPLATES = [
  c => `Looking to trade my place for something in ${c}. Anyone interested?`,
  c => `Would love to swap for a home near ${c} — open to creative deals.`,
  () => `Not in a rush, but if the right trade comes along I'm ready to move.`,
  () => `Has anyone here actually closed a trade through Amico Haus yet? Curious how it went.`,
  c => `My place would be perfect for someone leaving ${c} — comment or reach out.`,
  c => `Job's relocating me to ${c} — hoping to line up a trade instead of doing this the traditional way.`,
  () => `Kids are grown and this house is way bigger than we need now. Ready to downsize if the right match shows up.`,
  c => `Outgrowing our current place fast — looking to upsize into something in ${c} with more room.`,
  () => `Empty-nesters here, happy to trade down for something smaller and easier to maintain.`,
  c => `Growing family, need more space — would trade straight across for the right home in ${c}.`,
];
const COMMENT_TEMPLATES = ["This could be exactly what I'm looking for!", 'Sent you a message.', 'How flexible are you on timing?', 'Would you consider a 3-way trade?', 'Following — I have a similar situation.'];

// A narrative scenario alongside the straight home-for-home trades: someone
// who'd rather sell and put the proceeds toward a long-term luxury rental
// than buy again. Same math as the public trade-for-lease calculator
// (calculator.html/page-calculator.js) — a ~$1M home nets ~7-8 years at a
// $10k/mo beachfront rental after typical selling costs — so the seeded
// posts and the calculator tell the same story.
const BEACH_CITIES = ['San Diego', 'Los Angeles', 'Coronado', 'Long Beach', 'Miami', 'Fort Lauderdale', 'Naples', 'Sarasota', 'Tampa'];
const LUXURY_RENT_MONTHLY = 10000;
const SELLING_COST_PCT = 0.07;
const LUXURY_COMMENT_TEMPLATES = ["That math actually checks out — beats signing up for another mortgage.", "How'd you land on that number?", 'I looked into this too, it stretches further than I expected right on the water.', 'Following — curious if you actually go through with it.', "We're weighing the exact same thing."];

function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

function luxuryRentalPostText(have) {
  const netProceeds = have.estimatedValue * (1 - SELLING_COST_PCT);
  const years = netProceeds / (LUXURY_RENT_MONTHLY * 12);
  const yearsLabel = years >= 1 ? `${years.toFixed(1)} years` : `${Math.max(1, Math.round(years * 12))} months`;
  return `My place in ${have.city} is worth around ${fmtMoney(have.estimatedValue)}. I ran the numbers on selling instead of trading — after typical selling costs, that's roughly ${yearsLabel} of a long-term luxury rental right on the beach instead of signing up for another mortgage. Anyone else weighing that option?`;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randPrice(base) { return Math.round((base * (0.6 + Math.random() * 0.9)) / 5000) * 5000; }
function fakeName() { return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; }
function fakeEmail() { return `demo.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}@demo.amicohaus.local`; }

function buildHave(cityObj) {
  return {
    city: cityObj.city, state: cityObj.state, neighborhood: pick(NEIGHBORHOODS),
    propertyType: pick(PROPERTY_TYPES), beds: randInt(2, 5), baths: randInt(2, 4),
    sqft: randInt(900, 4200), estimatedValue: randPrice(cityObj.base),
  };
}

export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden('Admin only.');

  const body = await context.request.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body.count) || 200, 1), 300);
  const db = context.env.DB;

  // Resolve every group we might need once, up front, so the row-generation
  // loop below can be pure batched inserts with known foreign keys.
  const groupIds = new Map();
  for (const tier of PRICE_TIERS) {
    await db.prepare('INSERT OR IGNORE INTO groups (type, key, label) VALUES (?, ?, ?)').bind('price_tier', tier.key, tier.label).run();
    const row = await db.prepare('SELECT id FROM groups WHERE type = ? AND key = ?').bind('price_tier', tier.key).first();
    groupIds.set(`price_tier:${tier.key}`, row.id);
  }
  for (const c of CITIES) {
    const key = `${c.city}, ${c.state}`.toLowerCase();
    await db.prepare('INSERT OR IGNORE INTO groups (type, key, label) VALUES (?, ?, ?)').bind('location', key, `${c.city}, ${c.state}`).run();
    const row = await db.prepare('SELECT id FROM groups WHERE type = ? AND key = ?').bind('location', key).first();
    groupIds.set(`location:${key}`, row.id);
  }

  const maxUser = await db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM users').first();
  const maxListing = await db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM listings').first();
  const maxDesired = await db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM desired_criteria').first();
  const maxPost = await db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM posts').first();
  let nextUserId = maxUser.m + 1;
  let nextListingId = maxListing.m + 1;
  let nextDesiredId = maxDesired.m + 1;
  let nextPostId = maxPost.m + 1;

  const statements = [];
  const newListingIds = [];

  function addUser({ have, wantCity, priceMin, priceMax, desiredType, minBeds, minBaths }) {
    const userId = nextUserId++;
    const listingId = nextListingId++;
    const desiredId = nextDesiredId++;
    const name = fakeName();

    statements.push(db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, NULL, ?, ?)').bind(userId, fakeEmail(), name, 'user'));

    const priceTier = priceTierFor(have.estimatedValue);
    statements.push(db.prepare(
      `INSERT INTO listings (id, user_id, title, description, address, neighborhood, city, state, property_type, beds, baths, sqft, estimated_value, price_tier, show_exact_address, external_links)
       VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]')`
    ).bind(listingId, userId, have.neighborhood, have.city, have.state, have.propertyType, have.beds, have.baths, have.sqft, have.estimatedValue, priceTier));

    statements.push(db.prepare(
      `INSERT INTO desired_criteria (id, listing_id, locations, property_type, min_beds, min_baths, price_min, price_max, must_haves, cash_mode, cash_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 0)`
    ).bind(desiredId, listingId, wantCity, desiredType, minBeds, minBaths, priceMin, priceMax, pick(MUST_HAVES)));

    const tierGroupId = groupIds.get(`price_tier:${priceTier}`);
    const locGroupId = groupIds.get(`location:${have.city}, ${have.state}`.toLowerCase());
    statements.push(db.prepare('INSERT OR IGNORE INTO group_memberships (group_id, user_id) VALUES (?, ?)').bind(tierGroupId, userId));
    statements.push(db.prepare('INSERT OR IGNORE INTO group_memberships (group_id, user_id) VALUES (?, ?)').bind(locGroupId, userId));

    newListingIds.push({ listingId, userId, city: have.city, name, tierGroupId, locGroupId, estimatedValue: have.estimatedValue });
    return { userId, listingId, name, have };
  }

  let remaining = count;

  // ~35% deliberate mutual pairs — guaranteed matches for the demo.
  let pairBudget = Math.floor(count * 0.35 / 2) * 2;
  while (pairBudget > 0 && remaining >= 2) {
    const cityA = pick(CITIES), cityB = pick(CITIES);
    const haveA = buildHave(cityA), haveB = buildHave(cityB);
    addUser({ have: haveA, wantCity: `${cityB.city}, ${cityB.state}`, priceMin: Math.round(haveB.estimatedValue * 0.7), priceMax: Math.round(haveB.estimatedValue * 1.3), desiredType: 'Any', minBeds: 2, minBaths: 2 });
    addUser({ have: haveB, wantCity: `${cityA.city}, ${cityA.state}`, priceMin: Math.round(haveA.estimatedValue * 0.7), priceMax: Math.round(haveA.estimatedValue * 1.3), desiredType: 'Any', minBeds: 2, minBaths: 2 });
    pairBudget -= 2; remaining -= 2;
  }

  // ~35% deliberate daisy chains (3-5 parties) — the headline feature.
  let chainBudget = Math.round(count * 0.35);
  while (chainBudget >= 3 && remaining >= 3) {
    const len = Math.min(randInt(3, 5), remaining, chainBudget);
    const cities = Array.from({ length: len }, () => pick(CITIES));
    const haves = cities.map(buildHave);
    for (let i = 0; i < len; i++) {
      const target = haves[(i + 1) % len];
      addUser({ have: haves[i], wantCity: `${cities[(i + 1) % len].city}, ${cities[(i + 1) % len].state}`, priceMin: Math.round(target.estimatedValue * 0.7), priceMax: Math.round(target.estimatedValue * 1.3), desiredType: 'Any', minBeds: 2, minBaths: 2 });
    }
    chainBudget -= len; remaining -= len;
  }

  // Remainder: independent, realistic "noise" listings — meant to mostly
  // NOT match anything (a realistic pool of mismatched criteria), so
  // whole-state wants stay rare here; too high and nearly everyone in the
  // same state accidentally satisfies everyone else, turning "noise" into
  // an accidental wall of matches (this produced 1,600+ phantom daisy
  // chains from just 32 listings during testing before this was tightened).
  while (remaining > 0) {
    const haveCity = pick(CITIES);
    const have = buildHave(haveCity);
    const wantsWholeState = Math.random() < 0.08;
    const wantCity = wantsWholeState ? null : pick(CITIES);
    const targetPrice = randPrice(wantsWholeState ? pick(CITIES).base : wantCity.base);
    addUser({
      have, wantCity: wantsWholeState ? pick(STATES) : `${wantCity.city}, ${wantCity.state}`,
      priceMin: Math.round(targetPrice * 0.85), priceMax: Math.round(targetPrice * 1.15),
      desiredType: Math.random() < 0.3 ? 'Any' : pick(PROPERTY_TYPES),
      minBeds: randInt(1, 4), minBaths: randInt(1, 3),
    });
    remaining--;
  }

  // Light social activity: a few posts from this batch, plus comments/likes
  // pulled from across the whole (growing) user base for cross-batch mixing.
  const existingUsers = await db.prepare('SELECT id, display_name FROM users ORDER BY RANDOM() LIMIT 60').all();
  const pool = existingUsers.results.length ? existingUsers.results : newListingIds.map(l => ({ id: l.userId, display_name: l.name }));

  // Roughly two-thirds of posts land in the author's own group (split between
  // their price-tier and area group) rather than the global feed, so the
  // Groups feature actually has visible activity to browse into.
  const postCount = Math.round(newListingIds.length * 0.15);
  const createdPostIds = [];
  for (let i = 0; i < postCount; i++) {
    const author = pick(newListingIds);
    const postId = nextPostId++;
    const targetCityObj = pick(CITIES);
    const text = pick(POST_TEMPLATES)(`${targetCityObj.city}, ${targetCityObj.state}`);
    const roll = Math.random();
    const groupId = roll < 0.35 ? author.tierGroupId : roll < 0.65 ? author.locGroupId : null;
    statements.push(db.prepare('INSERT INTO posts (id, user_id, listing_id, group_id, body) VALUES (?, ?, ?, ?, ?)').bind(postId, author.userId, author.listingId, groupId, text));
    createdPostIds.push(postId);
  }
  for (const postId of createdPostIds) {
    const likeCount = randInt(0, 8);
    for (let i = 0; i < likeCount; i++) {
      const liker = pick(pool);
      statements.push(db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)').bind(postId, liker.id));
    }
    if (Math.random() < 0.5) {
      const commenter = pick(pool);
      statements.push(db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)').bind(postId, commenter.id, pick(COMMENT_TEMPLATES)));
    }
  }

  // A handful of "sell for a luxury beachfront rental instead" posts from
  // this batch's beach-city homeowners — a distinct narrative from the
  // straight home-for-home trade posts above.
  const beachAuthors = newListingIds.filter(l => BEACH_CITIES.includes(l.city));
  const luxuryPostTarget = Math.min(beachAuthors.length, Math.max(1, Math.round(count * 0.03)));
  const usedBeachAuthors = new Set();
  for (let i = 0; i < luxuryPostTarget; i++) {
    const author = pick(beachAuthors);
    if (usedBeachAuthors.has(author.listingId)) continue;
    usedBeachAuthors.add(author.listingId);
    const postId = nextPostId++;
    const text = luxuryRentalPostText(author);
    const roll = Math.random();
    const groupId = roll < 0.35 ? author.tierGroupId : roll < 0.65 ? author.locGroupId : null;
    statements.push(db.prepare('INSERT INTO posts (id, user_id, listing_id, group_id, body) VALUES (?, ?, ?, ?, ?)').bind(postId, author.userId, author.listingId, groupId, text));

    const likeCount = randInt(1, 10);
    for (let j = 0; j < likeCount; j++) {
      const liker = pick(pool);
      statements.push(db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)').bind(postId, liker.id));
    }
    const commenter = pick(pool);
    statements.push(db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)').bind(postId, commenter.id, pick(LUXURY_COMMENT_TEMPLATES)));
  }

  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK));
  }

  return json({ created: newListingIds.length, posts: postCount, statementCount: statements.length });
}
