// The Monday agent scorecard: an approved agent's last 7 days on Amico Haus, how their proposal speed compares with
// agents who serve the same area (only when at least 3 of those agents have enough proposals to measure), and one
// next step. The same numbers show on the agent dashboard any time; the email goes out once a week from the lazy job
// runner (runDueScorecards, called from functions/api/_middleware.js), Monday morning Pacific, and only to agents
// who haven't turned it off. Every email has a one-click unsubscribe (CAN-SPAM).
import { DEMO_EMAIL_PATTERN } from './util.js';
import { fetchAgentStats } from './marketplace.js';
import { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } from './geo.js';

// ZIPs within the service radius of any of the agent's service ZIPs, with coordinates (a lat/lng box first, then the
// real distance). Bounded and parameter-light, unlike looking up every new pre-listing's ZIP.
async function zipsNearService(db, serviceZips) {
  const own = await lookupZipCoords(db, serviceZips);
  const near = new Map();
  const dLat = SERVICE_RADIUS_MILES / 69;
  for (const c of own.values()) {
    const dLng = SERVICE_RADIUS_MILES / (69 * Math.max(Math.cos((c.lat * Math.PI) / 180), 0.2));
    const rows = await db.prepare('SELECT zip, lat, lng FROM zip_codes WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?')
      .bind(c.lat - dLat, c.lat + dLat, c.lng - dLng, c.lng + dLng).all();
    for (const r of rows.results) near.set(String(r.zip), { lat: r.lat, lng: r.lng });
  }
  const coords = new Map([...own, ...near]);
  return [...near.keys()].filter(z => { const d = nearestServiceDistance(coords.get(z), serviceZips, coords); return d !== null && d <= SERVICE_RADIUS_MILES; });
}
import { pacificParts, pacificToUtcMs, dutyFromRow, sendOrHoldEmail } from './agentDuty.js';
import { confirmationCodeHash } from './emailConfirmation.js';

const MIN_PEERS = 3;
const MIN_PROPOSALS = 3;
const MAX_PEERS_CHECKED = 15;

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function speedText(hours) {
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `about ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `about ${days} day${days === 1 ? '' : 's'}`;
}

function median(values) {
  const v = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

async function agentRow(db, agentUserId) {
  return db.prepare(
    `SELECT agent_profiles.*, users.display_name, users.email
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.user_id = ? AND agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ?`
  ).bind(agentUserId, DEMO_EMAIL_PATTERN).first();
}

// null when the agent isn't an approved, active, real agent.
export async function buildScorecard(db, agentUserId, nowMs = Date.now()) {
  const row = await agentRow(db, agentUserId);
  if (!row) return null;
  const since = sqlTime(nowMs - 7 * 86400000);
  const one = async (sql, ...args) => ((await db.prepare(sql).bind(...args).first()) || {}).n || 0;

  const proposals = await one('SELECT COUNT(*) AS n FROM service_bids WHERE agent_user_id = ? AND created_at >= ?', agentUserId, since);
  const opinions = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT pre_listing_id FROM pre_listing_price_votes WHERE agent_user_id = ?1 AND created_at >= ?2
       UNION SELECT pre_listing_id FROM pre_listing_price_opinions WHERE agent_user_id = ?1 AND updated_at >= ?2)`, agentUserId, since);
  const interviews = await one('SELECT COUNT(*) AS n FROM pre_listing_interviews WHERE agent_user_id = ? AND created_at >= ?', agentUserId, since);
  const hires = await one("SELECT COUNT(*) AS n FROM service_bids WHERE agent_user_id = ? AND status = 'accepted' AND updated_at >= ?", agentUserId, since);
  const feedback = await one('SELECT COUNT(*) AS n FROM finalist_debriefs WHERE agent_user_id = ? AND created_at >= ?', agentUserId, since);

  // New pre-listings within the agent's service area this week, and how many they weighed in on.
  let serviceZips = [];
  try { serviceZips = JSON.parse(row.service_zips_json || '[]').map(String); } catch { serviceZips = []; }
  // Lists go in as one JSON parameter (D1 allows at most 100 bound values per query).
  const nearZips = serviceZips.length ? await zipsNearService(db, serviceZips) : [];
  const fresh = nearZips.length ? await db.prepare(
    `SELECT pre_listings.id, pre_listings.status FROM pre_listings JOIN users ON users.id = pre_listings.user_id
     WHERE pre_listings.created_at >= ? AND pre_listings.user_id != ? AND users.status = 'active' AND users.email NOT LIKE ?
       AND CAST(pre_listings.zip AS TEXT) IN (SELECT value FROM json_each(?))`
  ).bind(since, agentUserId, DEMO_EMAIL_PATTERN, JSON.stringify(nearZips)).all() : { results: [] };
  const nearIds = fresh.results.map(p => p.id);
  const answeredIds = new Set();
  if (nearIds.length) {
    const rows = await db.prepare(
      `SELECT request_id AS id FROM service_bids WHERE agent_user_id = ?1 AND request_type = 'pre_listing' AND request_id IN (SELECT value FROM json_each(?2))
       UNION SELECT pre_listing_id FROM pre_listing_price_votes WHERE agent_user_id = ?1 AND pre_listing_id IN (SELECT value FROM json_each(?2))`
    ).bind(agentUserId, JSON.stringify(nearIds)).all();
    for (const r of rows.results) answeredIds.add(r.id);
  }
  const answered = answeredIds.size;
  // Still waiting = open and not yet answered (a closed one can't take a proposal any more).
  const waiting = fresh.results.filter(p => p.status === 'open' && !answeredIds.has(p.id)).length;

  // Proposal speed: theirs (all-time median) against agents who serve any of the same ZIPs.
  const stats = await fetchAgentStats(db, agentUserId, { approvedAt: row.reviewed_at || null });
  let speed = null;
  if (stats.totalBids >= MIN_PROPOSALS && stats.avgResponseHours !== null && serviceZips.length) {
    const peers = await db.prepare(
      `SELECT DISTINCT agent_profiles.user_id, agent_profiles.reviewed_at
       FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id, json_each(agent_profiles.service_zips_json) z
       WHERE agent_profiles.status = 'approved' AND users.status = 'active' AND users.email NOT LIKE ? AND agent_profiles.user_id != ?
         AND CAST(z.value AS TEXT) IN (${serviceZips.map(() => '?').join(',')}) LIMIT ${MAX_PEERS_CHECKED}`
    ).bind(DEMO_EMAIL_PATTERN, agentUserId, ...serviceZips).all();
    const peerHours = [];
    for (const p of peers.results) {
      const s = await fetchAgentStats(db, p.user_id, { approvedAt: p.reviewed_at || null });
      if (s.totalBids >= MIN_PROPOSALS && s.avgResponseHours !== null) peerHours.push(s.avgResponseHours);
    }
    speed = { mine: speedText(stats.avgResponseHours), area: peerHours.length >= MIN_PEERS ? speedText(median(peerHours)) : null };
  }

  // One next step, the first that applies.
  const pendingNoReel = await one(
    `SELECT COUNT(*) AS n FROM service_bids JOIN pre_listings ON pre_listings.id = service_bids.request_id
     WHERE service_bids.agent_user_id = ? AND service_bids.request_type = 'pre_listing' AND service_bids.status = 'pending'
       AND service_bids.pitch_video_r2_key IS NULL AND pre_listings.status = 'open'`, agentUserId);
  const pastReviews = await one("SELECT COUNT(*) AS n FROM past_client_reviews WHERE agent_user_id = ? AND status = 'published'", agentUserId);
  let nextStep;
  if (waiting > 0) nextStep = `${waiting} new home${waiting === 1 ? '' : 's'} near you ${waiting === 1 ? 'is' : 'are'} waiting for your price opinion or proposal.`;
  else if (!dutyFromRow(row)) nextStep = 'Set your on-duty hours, so new-request emails reach you when you are working.';
  else if (!row.review_invite_token && pastReviews === 0) nextStep = "Turn on your past-client review link, so your profile doesn't start at zero.";
  else if (pendingNoReel > 0) nextStep = `Add a pitch reel to ${pendingNoReel === 1 ? 'your open proposal' : `your ${pendingNoReel} open proposals`}: homeowners can watch it on Decision Night.`;
  else nextStep = 'Share your Brag Card or add your live badge to your website.';

  return {
    name: row.display_name, email: row.email, duty: dutyFromRow(row), optOut: !!row.scorecard_opt_out,
    counts: { proposals, opinions, interviews, hires, feedback, newNearby: nearIds.length, answered },
    speed, nextStep,
  };
}

function weekLabel(nowMs) {
  const end = new Date(nowMs);
  const start = new Date(nowMs - 7 * 86400000);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
  return `${fmt(start)} to ${fmt(end)}`;
}

export async function unsubscribeToken(env, userId) {
  return (await confirmationCodeHash(env, userId, 'scorecard-unsubscribe')).slice(0, 32);
}

export async function scorecardEmail(context, userId, card, nowMs = Date.now()) {
  const origin = new URL(context.request.url).origin;
  const c = card.counts;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const lines = [
    `Hi ${card.name},`, '',
    `Your week on Amico Haus (${weekLabel(nowMs)}):`,
    `- ${plural(c.proposals, 'proposal', 'proposals')} sent`,
    `- ${plural(c.opinions, 'price opinion', 'price opinions')}`,
    `- ${plural(c.interviews, 'interview request', 'interview requests')}`,
    `- ${plural(c.hires, 'hire', 'hires')}`,
    ...(c.feedback ? [`- ${plural(c.feedback, 'finalist note', 'finalist notes')} from homeowners`] : []),
    `- ${plural(c.newNearby, 'new pre-listing', 'new pre-listings')} near you; you weighed in on ${c.answered}`,
    '',
    ...(card.speed ? [`Your typical proposal: ${card.speed.mine}${card.speed.area ? ` (agents who serve your area: ${card.speed.area})` : ''}.`, ''] : []),
    `One next step: ${card.nextStep}`, '',
    `Open your dashboard: ${origin}/app#become-agent`, '',
    `You get this every Monday as an approved agent on Amico Haus. Stop these emails: ${origin}/api/agents/scorecard-unsubscribe?u=${userId}&t=${await unsubscribeToken(context.env, userId)}`,
    'Presented by Rudy Flores, Realtor® · DRE #02257808 · Coldwell Banker West',
  ];
  const subject = `Your Amico Haus week: ${plural(c.proposals, 'proposal', 'proposals')}, ${plural(c.newNearby, 'new home', 'new homes')} near you`;
  return { subject, text: lines.join('\n') };
}

// Monday (from 7am Pacific) through Wednesday: the Pacific date of this week's Monday, or null outside that window.
export function scorecardWeek(nowMs = Date.now()) {
  const p = pacificParts(nowMs);
  if (!(p.weekday === 1 && p.hour >= 7) && p.weekday !== 2 && p.weekday !== 3) return null;
  const monday = pacificParts(pacificToUtcMs(p.year, p.month, p.day, 12, 0) - (p.weekday - 1) * 86400000);
  return `${monday.year}-${String(monday.month).padStart(2, '0')}-${String(monday.day).padStart(2, '0')}`;
}

// Sends this week's scorecards a few at a time. Each agent is claimed for the week with a conditional UPDATE, so two
// runs at once can't both send. An agent with nothing at all to report this week is skipped (claimed, not emailed).
export async function runDueScorecards(context, { limit = 5, nowMs = Date.now() } = {}) {
  const week = scorecardWeek(nowMs);
  if (!week) return 0;
  const db = context.env.DB;
  const agents = await db.prepare(
    `SELECT agent_profiles.user_id, agent_profiles.scorecard_sent_week, agent_profiles.scorecard_failures FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = 'approved' AND agent_profiles.scorecard_opt_out = 0 AND users.status = 'active' AND users.email NOT LIKE ?
       AND (agent_profiles.scorecard_sent_week IS NULL OR agent_profiles.scorecard_sent_week != ?)
     LIMIT ?`
  ).bind(DEMO_EMAIL_PATTERN, week, limit).all();
  let sent = 0;
  for (const a of agents.results) {
    const claim = await db.prepare(
      'UPDATE agent_profiles SET scorecard_sent_week = ? WHERE user_id = ? AND (scorecard_sent_week IS NULL OR scorecard_sent_week != ?)'
    ).bind(week, a.user_id, week).run();
    if (!claim.meta || !claim.meta.changes) continue;
    let ok = false;
    try {
      const card = await buildScorecard(db, a.user_id, nowMs);
      if (!card || !card.email) continue;
      const c = card.counts;
      if (!c.proposals && !c.opinions && !c.interviews && !c.hires && !c.feedback && !c.newNearby) continue;
      const { subject, text } = await scorecardEmail(context, a.user_id, card, nowMs);
      ok = await sendOrHoldEmail(context, { userId: a.user_id, to: card.email, subject, text, duty: card.duty, kind: 'scorecard' }).catch(() => false);
    } catch (err) {
      console.log(`[scorecard failed for ${a.user_id}] ${err && err.message}`);
    }
    if (!ok) {
      // Didn't go out: release the week so a later run (still Monday-Wednesday) tries again, up to 3 tries.
      if ((a.scorecard_failures || 0) < 2) {
        await db.prepare('UPDATE agent_profiles SET scorecard_sent_week = ?, scorecard_failures = scorecard_failures + 1 WHERE user_id = ? AND scorecard_sent_week = ?').bind(a.scorecard_sent_week, a.user_id, week).run();
      } else {
        await db.prepare('UPDATE agent_profiles SET scorecard_failures = 0 WHERE user_id = ?').bind(a.user_id).run();
      }
      continue;
    }
    await db.prepare('UPDATE agent_profiles SET scorecard_failures = 0 WHERE user_id = ?').bind(a.user_id).run();
    sent++;
    await new Promise(res => setTimeout(res, 600)); // the email provider allows about 2 a second
  }
  return sent;
}
