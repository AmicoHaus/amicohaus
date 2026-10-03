import { sendEmail } from './email.js';

// In-app (and, for new-request pings only, email) notifications for the
// Pre-Listings Marketplace. Kept separate from matchNotify.js since this has
// nothing to do with the trade-matching graph — these are just "someone
// acted on your proposal / your request" pings.
async function notify(db, userId, body, link) {
  await db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)").bind(userId, body, link).run();
}

// New requests are the one marketplace ping worth emailing: an agent who
// only sees the in-app bell could lose a lead to someone faster. A homeowner
// reacting to a proposal, an award, or an invite is already in the app when
// it happens, so those stay in-app only. Capped at a generous number per
// day (not the 3/day matches use) since these are time-sensitive leads an
// agent plausibly wants more of, not a nurture digest — this project has no
// cron-triggered worker for a real batched digest, so "stop after N" is the
// spam guard, the same workaround matchNotify.js uses.
const CAPPED_NEW_REQUEST_EMAILS_PER_DAY = 8;

async function notifyAndMaybeEmail(context, agent, body, link, subject) {
  const db = context.env.DB;
  // Checked before inserting this event's own row, not after — counting it against its own cap would make the
  // Nth email of the day look like the (N+1)th and get skipped one send too early.
  let underCap = true;
  if (agent.email_frequency === 'capped') {
    const sent = await db.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'marketplace' AND body = ? AND created_at >= datetime('now', '-1 day')`
    ).bind(agent.user_id, body).first();
    underCap = sent.n < CAPPED_NEW_REQUEST_EMAILS_PER_DAY;
  }
  await notify(db, agent.user_id, body, link);
  if (!agent.email || !underCap) return; // demo accounts and any row missing an email never get one
  return sendEmail(context, {
    to: agent.email,
    subject,
    text: `${body} Log in to see the details and send a proposal: ${new URL(context.request.url).origin}${link}`,
  });
}

function requestLink(requestType, requestId) {
  return requestType === 'pre_listing' ? `/app#pre-listing-${requestId}` : `/app#transaction-${requestId}`;
}

export async function notifyNewBid(context, requestType, requestId, ownerUserIds, agentUserId) {
  const db = context.env.DB;
  const agent = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(agentUserId).first();
  const owners = Array.isArray(ownerUserIds) ? ownerUserIds : [ownerUserIds];
  const link = requestLink(requestType, requestId);
  for (const ownerId of owners) {
    await notify(db, ownerId, `${agent ? agent.display_name : 'An agent'} submitted a proposal.`, link);
  }
}

export async function notifyAgentInvited(context, requestType, requestId, agentUserId, invitedByUserId) {
  const db = context.env.DB;
  const inviter = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(invitedByUserId).first();
  await notify(db, agentUserId, `${inviter ? inviter.display_name : 'A homeowner'} invited you to bid directly.`, requestLink(requestType, requestId));
}

export async function notifyBidDecision(context, agentUserId, requestType, requestId, accepted) {
  const db = context.env.DB;
  const link = requestLink(requestType, requestId);
  await notify(db, agentUserId, accepted ? 'Your proposal was accepted!' : 'Your proposal was not selected this time.', link);
}

export async function notifyTransactionOpened(context, requestId, notifyUserId, openedByUserId) {
  const db = context.env.DB;
  const opener = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(openedByUserId).first();
  await notify(db, notifyUserId, `${opener ? opener.display_name : 'Your trade partner'} opened your trade to agent bids.`, requestLink('transaction', requestId));
}

// A homeowner's "saved search" equivalent — pings approved agents the
// moment a new request opens, rather than making them keep re-checking the
// browse list. A pre-listing has a zip, so this only pings agents whose
// service area covers it; a transaction request is tied to two trade
// listings with no zip on file, so it pings every opted-in approved agent
// instead of trying to guess a location match.
export async function notifyAgentsNewRequest(context, requestType, requestId, zip) {
  const db = context.env.DB;
  const link = requestLink(requestType, requestId);
  const bodyText = requestType === 'pre_listing' ? 'A new pre-listing opened for proposals near you.' : 'A new trade transaction request opened for proposals.';
  const subject = requestType === 'pre_listing' ? 'New pre-listing near you on Amico Haus' : 'New trade request open for proposals on Amico Haus';

  const agentsRow = await db.prepare(
    `SELECT agent_profiles.user_id, agent_profiles.service_zips_json, users.email, users.email_frequency
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = 'approved' AND agent_profiles.notify_new_requests = 1`
  ).all();
  if (agentsRow.results.length === 0) return;

  const sends = [];
  if (requestType !== 'pre_listing' || !zip) {
    for (const a of agentsRow.results) sends.push(notifyAndMaybeEmail(context, a, bodyText, link, subject));
  } else {
    const { lookupZipCoords, nearestServiceDistance, SERVICE_RADIUS_MILES } = await import('./geo.js');
    const allZips = new Set([zip]);
    for (const a of agentsRow.results) {
      for (const z of JSON.parse(a.service_zips_json || '[]')) allZips.add(z);
    }
    const coords = await lookupZipCoords(db, [...allZips]);

    for (const a of agentsRow.results) {
      const serviceZips = JSON.parse(a.service_zips_json || '[]');
      if (serviceZips.length === 0) continue;
      const d = nearestServiceDistance(coords.get(zip), serviceZips, coords);
      if (d !== null && d <= SERVICE_RADIUS_MILES) sends.push(notifyAndMaybeEmail(context, a, bodyText, link, subject));
    }
  }
  // allSettled, not all — one agent's slow/failing email provider shouldn't stop another's in-app notification
  // or email from going through; this already runs via context.waitUntil() in the caller, so nothing upstream
  // is waiting on it either.
  await Promise.allSettled(sends);
}
