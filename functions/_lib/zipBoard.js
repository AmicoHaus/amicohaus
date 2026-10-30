// "Unlock your ZIP": for each ZIP Amico Haus is launching in, how many homeowners are waiting on an open pre-listing,
// how many buyers are watching the area, and how many approved agents serve it, plus the founding-agent spots. All
// counts are live and real (demo accounts never count). Homeowner and buyer counts under DEMAND_MIN_SHOWN are shown
// as "a few" so no one can be picked out. Agent counts are exact (agents are public).
//
// Fair housing: ZIP and city name only, never a description of a neighborhood or who lives there.
import { DEMO_EMAIL_PATTERN } from './util.js';
import { DEMAND_MIN_SHOWN, namesCity } from './buyerDemand.js';

export const LAUNCH_ZIPS = {
  91910: 'Chula Vista', 91911: 'Chula Vista', 91913: 'Chula Vista', 91914: 'Chula Vista', 91915: 'Chula Vista', 91902: 'Bonita',
};
export const FOUNDING_SPOTS = 3;

// The founding agents who currently hold a spot: an approved, active, real (non-demo) agent who still lists that ZIP
// in their service area, the first FOUNDING_SPOTS of them per ZIP in the order they were granted. A spot lasts while
// all of that stays true. Used as a subquery (zip, agent_user_id), so every count and chip agrees.
export const LIVE_FOUNDERS_SQL = `SELECT zip, agent_user_id FROM (
  SELECT fa.zip, fa.agent_user_id, ROW_NUMBER() OVER (PARTITION BY fa.zip ORDER BY fa.id) AS rn
  FROM founding_agents fa JOIN agent_profiles ap ON ap.user_id = fa.agent_user_id JOIN users u ON u.id = fa.agent_user_id
  WHERE ap.status = 'approved' AND u.status = 'active' AND u.email NOT LIKE '${DEMO_EMAIL_PATTERN}'
    AND EXISTS (SELECT 1 FROM json_each(ap.service_zips_json) sz WHERE CAST(sz.value AS TEXT) = fa.zip)
) WHERE rn <= ${FOUNDING_SPOTS}`;

function shownCount(n) {
  return n >= DEMAND_MIN_SHOWN ? n : n > 0 ? 'a few' : 0;
}

export async function fetchZipBoard(db) {
  const zips = Object.keys(LAUNCH_ZIPS);
  // Homeowners, not pre-listings: one person with two open pre-listings in a ZIP counts once.
  const waitingRows = await db.prepare(
    `SELECT pre_listings.zip, COUNT(DISTINCT pre_listings.user_id) AS n FROM pre_listings JOIN users ON users.id = pre_listings.user_id
     WHERE pre_listings.status = 'open' AND users.status = 'active' AND users.email NOT LIKE ?
       AND pre_listings.zip IN (${zips.map(() => '?').join(',')})
     GROUP BY pre_listings.zip`
  ).bind(DEMO_EMAIL_PATTERN, ...zips).all();
  const agentRows = await db.prepare(
    `SELECT z.value AS zip, COUNT(DISTINCT agent_profiles.user_id) AS n
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id, json_each(agent_profiles.service_zips_json) z
     WHERE agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ?
       AND z.value IN (${zips.map(() => '?').join(',')})
     GROUP BY z.value`
  ).bind(DEMO_EMAIL_PATTERN, ...zips).all();
  const foundingRows = await db.prepare(`SELECT zip, COUNT(*) AS n FROM (${LIVE_FOUNDERS_SQL}) GROUP BY zip`).all();
  const byZip = (rows) => new Map(rows.results.map(r => [String(r.zip), r.n]));
  const waiting = byZip(waitingRows), agents = byZip(agentRows), founding = byZip(foundingRows);

  // Buyers watching each city: real people whose saved search or trade wish list names it exactly.
  const buyersByCity = new Map();
  for (const city of new Set(Object.values(LAUNCH_ZIPS))) buyersByCity.set(city, await countBuyersNamingCity(db, city));

  return zips.map(zip => ({
    zip, city: LAUNCH_ZIPS[zip],
    homeownersWaiting: shownCount(waiting.get(zip) || 0),
    buyersWatching: shownCount(buyersByCity.get(LAUNCH_ZIPS[zip]) || 0),
    agents: agents.get(zip) || 0,
    foundingTaken: Math.min(founding.get(zip) || 0, FOUNDING_SPOTS),
    foundingOpen: Math.max(FOUNDING_SPOTS - (founding.get(zip) || 0), 0),
  }));
}

async function countBuyersNamingCity(db, city) {
  const buyers = new Set();
  const searches = await db.prepare(
    `SELECT s.user_id, s.locations FROM saved_searches s JOIN users ON users.id = s.user_id
     WHERE users.status = 'active' AND users.email NOT LIKE ? LIMIT 5000`
  ).bind(DEMO_EMAIL_PATTERN).all();
  for (const s of searches.results) if (namesCity(s.locations, city)) buyers.add(s.user_id);
  const wishes = await db.prepare(
    `SELECT l.user_id, d.locations FROM desired_criteria d JOIN listings l ON l.id = d.listing_id JOIN users ON users.id = l.user_id
     WHERE l.status = 'active' AND users.status = 'active' AND users.email NOT LIKE ? LIMIT 5000`
  ).bind(DEMO_EMAIL_PATTERN).all();
  for (const w of wishes.results) if (namesCity(w.locations, city)) buyers.add(w.user_id);
  return buyers.size;
}

// When an admin approves an agent, the agent takes any open founding spot in their launch service ZIPs. First come,
// first served. Each insert counts the live holders inside the same statement, so two approvals at once can't both
// take the last spot. Returns the ZIPs newly granted, for the approval message.
export async function grantFoundingSpots(db, agentUserId) {
  const profile = await db.prepare(
    "SELECT ap.service_zips_json FROM agent_profiles ap JOIN users u ON u.id = ap.user_id WHERE ap.user_id = ? AND ap.status = 'approved' AND u.status = 'active' AND u.email NOT LIKE ?"
  ).bind(agentUserId, DEMO_EMAIL_PATTERN).first();
  if (!profile) return [];
  let zips = [];
  try { zips = JSON.parse(profile.service_zips_json || '[]'); } catch { zips = []; }
  const granted = [];
  for (const zip of [...new Set(zips.map(String))].filter(z => Object.hasOwn(LAUNCH_ZIPS, z))) {
    const r = await db.prepare(
      `INSERT OR IGNORE INTO founding_agents (zip, agent_user_id)
       SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM (${LIVE_FOUNDERS_SQL}) WHERE zip = ?1) < ${FOUNDING_SPOTS}`
    ).bind(zip, agentUserId).run();
    if (r.meta && r.meta.changes) granted.push(zip);
  }
  return granted;
}

// A founding spot ends when the agent stops serving that ZIP (or is no longer approved), so the next approved agent
// there can take it. Called after a profile edit and when an approval is withdrawn.
export async function releaseFoundingSpots(db, agentUserId, { all = false } = {}) {
  if (all) {
    await db.prepare('DELETE FROM founding_agents WHERE agent_user_id = ?').bind(agentUserId).run();
    return;
  }
  await db.prepare(
    `DELETE FROM founding_agents WHERE agent_user_id = ?1 AND zip NOT IN (
       SELECT CAST(sz.value AS TEXT) FROM agent_profiles ap, json_each(ap.service_zips_json) sz WHERE ap.user_id = ?1)`
  ).bind(agentUserId).run();
}

export async function fetchFoundingZips(db, agentUserIds) {
  const ids = [...new Set(agentUserIds.filter(Boolean))].slice(0, 90);
  if (!ids.length) return new Map();
  const rows = await db.prepare(`SELECT agent_user_id, zip FROM (${LIVE_FOUNDERS_SQL}) WHERE agent_user_id IN (${ids.map(() => '?').join(',')}) ORDER BY zip`).bind(...ids).all();
  const map = new Map();
  for (const r of rows.results) map.set(r.agent_user_id, [...(map.get(r.agent_user_id) || []), r.zip]);
  return map;
}
