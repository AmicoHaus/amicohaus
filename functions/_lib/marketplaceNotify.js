// Lightweight in-app notifications for the Pre-Listings Marketplace. Kept
// separate from matchNotify.js since this has nothing to do with the
// trade-matching graph — these are just "someone acted on your proposal /
// your request" pings. No email here (unlike matchNotify.js) to keep this
// first cut simple; the in-app bell is enough to start.
async function notify(db, userId, body, link) {
  await db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)").bind(userId, body, link).run();
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

  const agentsRow = await db.prepare(
    "SELECT user_id, service_zips_json FROM agent_profiles WHERE status = 'approved' AND notify_new_requests = 1"
  ).all();
  if (agentsRow.results.length === 0) return;

  if (requestType !== 'pre_listing' || !zip) {
    for (const a of agentsRow.results) await notify(db, a.user_id, bodyText, link);
    return;
  }

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
    if (d !== null && d <= SERVICE_RADIUS_MILES) await notify(db, a.user_id, bodyText, link);
  }
}
