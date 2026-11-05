// "Unlock your ZIP": for each ZIP Amico Haus is launching in, how many homeowners are waiting on an open pre-listing,
// how many buyers are watching the area, and how many approved agents serve it, plus the founding-agent spots. All
// counts are live and real (demo accounts never count). Homeowner and buyer counts under DEMAND_MIN_SHOWN are shown
// as "a few" so no one can be picked out. Agent counts are exact (agents are public).
//
// Fair housing: ZIP and city name only, never a description of a neighborhood or who lives there.
import { DEMO_EMAIL_PATTERN } from './util.js';
import { DEMAND_MIN_SHOWN, namesCity } from './buyerDemand.js';
import { countAgentsOnDuty } from './agentDuty.js';

export const LAUNCH_ZIPS = {
  91910: 'Chula Vista', 91911: 'Chula Vista', 91913: 'Chula Vista', 91914: 'Chula Vista', 91915: 'Chula Vista', 91902: 'Bonita',
};
export const FOUNDING_SPOTS = 3;

// The founding agents who currently hold a spot: an approved, active, real (non-demo) agent who still lists that ZIP
// in their service area, the first FOUNDING_SPOTS of them per ZIP in the order they were granted. A spot lasts while
// all of that stays true. The account that runs Amico Haus (an admin) never takes a founding spot (Rudy 11.05).
// Used as a subquery (zip, agent_user_id), so every count and chip agrees.
export const LIVE_FOUNDERS_SQL = `SELECT zip, agent_user_id FROM (
  SELECT fa.zip, fa.agent_user_id, ROW_NUMBER() OVER (PARTITION BY fa.zip ORDER BY fa.id) AS rn
  FROM founding_agents fa JOIN agent_profiles ap ON ap.user_id = fa.agent_user_id JOIN users u ON u.id = fa.agent_user_id
  WHERE ap.status = 'approved' AND u.status = 'active' AND u.email NOT LIKE '${DEMO_EMAIL_PATTERN}' AND u.role <> 'admin'
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
  const buyersByCity = await countBuyersNamingCities(db, [...new Set(Object.values(LAUNCH_ZIPS))]);

  const onDuty = new Map();
  for (const zip of zips) onDuty.set(zip, await countAgentsOnDuty(db, zip));

  return zips.map(zip => ({
    zip, city: LAUNCH_ZIPS[zip],
    homeownersWaiting: shownCount(waiting.get(zip) || 0),
    buyersWatching: shownCount(buyersByCity.get(LAUNCH_ZIPS[zip]) || 0),
    agents: agents.get(zip) || 0,
    foundingTaken: Math.min(founding.get(zip) || 0, FOUNDING_SPOTS),
    foundingOpen: Math.max(FOUNDING_SPOTS - (founding.get(zip) || 0), 0),
    onDutyNow: onDuty.get(zip) || 0,
  }));
}

// city -> how many real people name it. The rows are read once and counted for every city (not re-read per city).
async function countBuyersNamingCities(db, cities) {
  const buyers = new Map(cities.map(c => [c, new Set()]));
  const searches = await db.prepare(
    `SELECT s.user_id, s.locations FROM saved_searches s JOIN users ON users.id = s.user_id
     WHERE users.status = 'active' AND users.email NOT LIKE ? LIMIT 5000`
  ).bind(DEMO_EMAIL_PATTERN).all();
  const wishes = await db.prepare(
    `SELECT l.user_id, d.locations FROM desired_criteria d JOIN listings l ON l.id = d.listing_id JOIN users ON users.id = l.user_id
     WHERE l.status = 'active' AND users.status = 'active' AND users.email NOT LIKE ? LIMIT 5000`
  ).bind(DEMO_EMAIL_PATTERN).all();
  for (const row of [...searches.results, ...wishes.results]) {
    for (const city of cities) if (namesCity(row.locations, city)) buyers.get(city).add(row.user_id);
  }
  return new Map(cities.map(c => [c, buyers.get(c).size]));
}

// What a founding spot means, for chips, tooltips and messages: "Among the first 3 approved agents in 91913;
// recognition only."
export function foundingCaption(zips) {
  return `Among the first ${FOUNDING_SPOTS} approved agents in ${[].concat(zips).join(', ')}; recognition only.`;
}

// The line added to an agent's approval (or founding) message when they take spots. Founding is recognition only:
// same-moment alerts, no head start, no leads or business promised.
export function foundingGrantedLine(zips) {
  return zips.length
    ? ` You're also a founding agent in ${zips.join(', ')}, one of the first ${FOUNDING_SPOTS} approved agents there. It's recognition only: you get alerts at the same moment as everyone else, and no leads, clients or business are promised. When a homeowner there posts a pre-listing, aim to send your price opinion within 48 hours.`
    : '';
}

// When an admin approves an agent (or an approved agent adds a launch ZIP, or is reinstated), the agent takes any open
// founding spot in their launch service ZIPs. First come, first served. Each insert counts the live holders inside the
// same statement, so two approvals at once can't both take the last spot. Returns the ZIPs newly granted, for the
// message. The account that runs Amico Haus (an admin) never takes a founding spot.
export async function grantFoundingSpots(db, agentUserId) {
  const profile = await db.prepare(
    "SELECT ap.service_zips_json FROM agent_profiles ap JOIN users u ON u.id = ap.user_id WHERE ap.user_id = ? AND ap.status = 'approved' AND u.status = 'active' AND u.email NOT LIKE ? AND u.role <> 'admin'"
  ).bind(agentUserId, DEMO_EMAIL_PATTERN).first();
  if (!profile) return [];
  let zips = [];
  try { zips = JSON.parse(profile.service_zips_json || '[]'); } catch { zips = []; }
  const granted = [];
  for (const zip of [...new Set(zips.map(String))].filter(z => Object.hasOwn(LAUNCH_ZIPS, z))) {
    // A spot held by someone who no longer qualifies (suspended outside the app, no longer approved, no longer serving
    // the ZIP) is let go before anyone takes the open spot. Otherwise, if they came back, their old row would sort
    // first again and silently push out the agent who took the spot: a returning agent goes to the back of the line.
    await db.prepare(
      `DELETE FROM founding_agents WHERE zip = ?1 AND agent_user_id NOT IN (
         SELECT ap.user_id FROM agent_profiles ap JOIN users u ON u.id = ap.user_id
         WHERE ap.status = 'approved' AND u.status = 'active' AND u.email NOT LIKE '${DEMO_EMAIL_PATTERN}' AND u.role <> 'admin'
           AND EXISTS (SELECT 1 FROM json_each(ap.service_zips_json) sz WHERE CAST(sz.value AS TEXT) = ?1))`
    ).bind(zip).run();
    const r = await db.prepare(
      `INSERT OR IGNORE INTO founding_agents (zip, agent_user_id)
       SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM (${LIVE_FOUNDERS_SQL}) WHERE zip = ?1) < ${FOUNDING_SPOTS}`
    ).bind(zip, agentUserId).run();
    if (r.meta && r.meta.changes) granted.push(zip);
  }
  return granted;
}

// A founding spot ends when the agent stops serving that ZIP (or is no longer approved, or is suspended), so the next
// approved agent there can take it. Called after a profile edit ({all: false}), and with {all: true} when an approval
// is withdrawn or the account is suspended (a reinstated agent then goes to the back of the line). The account that
// runs Amico Haus (an admin) never keeps a founding spot: any row it holds goes on its next profile save.
export async function releaseFoundingSpots(db, agentUserId, { all = false } = {}) {
  if (all) {
    await db.prepare('DELETE FROM founding_agents WHERE agent_user_id = ?').bind(agentUserId).run();
    return;
  }
  await db.prepare(
    `DELETE FROM founding_agents WHERE agent_user_id = ?1 AND (zip NOT IN (
       SELECT CAST(sz.value AS TEXT) FROM agent_profiles ap, json_each(ap.service_zips_json) sz WHERE ap.user_id = ?1)
       OR EXISTS (SELECT 1 FROM users WHERE id = ?1 AND role = 'admin'))`
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
