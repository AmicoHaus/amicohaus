import { sendEmail } from './email.js';

// In-app (and, for new-request pings only, email) notifications for the
// Pre-Listings Marketplace. Kept separate from matchNotify.js since this has
// nothing to do with the trade-matching graph — these are just "someone
// acted on your proposal / your request" pings.
async function notify(db, userId, body, link) {
  await db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)").bind(userId, body, link).run();
}

// Events time-sensitive or encouraging enough to be worth an email, not just the in-app bell: a new request an
// agent could lose to someone faster, and a new vote/proposal on a homeowner's own pre-listing (the thing most
// likely to pull someone back into the app who posted once and never came back to check). A homeowner reacting
// to something already has the app open when it happens, so acceptances/declines/invites stay in-app only.
// Capped at a generous number per day — these are real activity, not a nurture digest — but this project has no
// cron-triggered worker for a real batched digest, so "stop after N" is the spam guard, the same workaround
// matchNotify.js uses for match emails.
const CAPPED_MARKETPLACE_EMAILS_PER_DAY = 8;

// recipient: { userId, email, emailFrequency }. cta is the call-to-action clause, e.g. "see the details and
// send a proposal" vs. "see what they said" — kept as a parameter since the right next action differs by event.
async function notifyAndMaybeEmail(context, recipient, body, link, subject, cta) {
  const db = context.env.DB;
  // Checked before inserting this event's own row, not after — counting it against its own cap would make the
  // Nth email of the day look like the (N+1)th and get skipped one send too early.
  let underCap = true;
  if (recipient.emailFrequency === 'capped') {
    const sent = await db.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'marketplace' AND body = ? AND created_at >= datetime('now', '-1 day')`
    ).bind(recipient.userId, body).first();
    underCap = sent.n < CAPPED_MARKETPLACE_EMAILS_PER_DAY;
  }
  await notify(db, recipient.userId, body, link);
  if (!recipient.email || !underCap) return; // demo accounts and any row missing an email never get one
  return sendEmail(context, {
    to: recipient.email,
    subject,
    text: `${body} Log in to ${cta}: ${new URL(context.request.url).origin}${link}`,
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
  const body = `${agent ? agent.display_name : 'An agent'} submitted a proposal.`;
  const ownerRows = await db.batch(owners.map(id => db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(id)));
  await Promise.allSettled(ownerRows.map(r => {
    const owner = r.results[0];
    if (!owner) return Promise.resolve();
    return notifyAndMaybeEmail(context, { userId: owner.id, email: owner.email, emailFrequency: owner.email_frequency }, body, link,
      'New proposal on Amico Haus', 'see the details and compare it with any others');
  }));
}

const VOTE_LABELS = { too_high: 'too high', too_low: 'too low', just_right: 'about right' };

// The one marketplace event that previously notified nobody at all: a homeowner posts a pre-listing hoping to
// hear from "local agent experts" and, until now, had no way to know a vote came in short of re-checking the
// app. Every vote re-notifies (an agent can change their vote, and each new opinion is itself news), same
// capped-per-day email guard as everything else here.
export async function notifyNewVote(context, preListingId, ownerUserId, agentUserId, vote) {
  const db = context.env.DB;
  const agent = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(agentUserId).first();
  const owner = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(ownerUserId).first();
  if (!owner) return;
  const body = `${agent ? agent.display_name : 'An agent'} says your asking price looks ${VOTE_LABELS[vote] || vote}.`;
  await notifyAndMaybeEmail(context, { userId: owner.id, email: owner.email, emailFrequency: owner.email_frequency }, body,
    `/app#pre-listing-${preListingId}`, 'New price feedback on Amico Haus', 'see what they said');
}

// A new showing request is the same kind of "homeowner should come back and look" event a vote or proposal is,
// so it gets the same email treatment. The decision on it (accept/decline) stays in-app only, matching
// notifyBidDecision below — the agent who asked is already watching for an answer, same reasoning as there.
export async function notifyNewShowingRequest(context, preListingId, ownerUserId, agentUserId, proposedAt) {
  const db = context.env.DB;
  const agent = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(agentUserId).first();
  const owner = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(ownerUserId).first();
  if (!owner) return;
  const when = new Date(proposedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const body = `${agent ? agent.display_name : 'An agent'} requested a showing for ${when}.`;
  await notifyAndMaybeEmail(context, { userId: owner.id, email: owner.email, emailFrequency: owner.email_frequency }, body,
    `/app#pre-listing-${preListingId}`, 'Showing request on Amico Haus', 'accept or decline the request');
}

export async function notifyShowingDecision(context, preListingId, agentUserId, accepted, proposedAt) {
  const db = context.env.DB;
  const when = new Date(proposedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  await notify(db, agentUserId, accepted ? `Your showing request for ${when} was accepted!` : `Your showing request for ${when} wasn't accepted.`, `/app#pre-listing-${preListingId}`);
}

// A message is the clearest "someone is waiting on you" event on the whole site, so it gets the same email
// treatment as a new vote/proposal/showing — same capped-per-day guard, keyed off this exact body text, so a
// burst of messages from the same person in one conversation doesn't turn into a burst of emails either.
export async function notifyNewMessage(context, recipientId, senderName, conversationId) {
  const db = context.env.DB;
  const recipient = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(recipientId).first();
  if (!recipient) return;
  await notifyAndMaybeEmail(context, { userId: recipient.id, email: recipient.email, emailFrequency: recipient.email_frequency },
    `New message from ${senderName}`, `/app#messages-${conversationId}`, 'New message on Amico Haus', 'read and reply');
}

export async function notifyTeamInvite(context, targetUserId) {
  await notify(context.env.DB, targetUserId, "You've been invited to join a team.", '/app#become-agent');
}

// FinderMine: a poster finds out the moment someone expresses interest in
// their project, same treatment as a new proposal on a pre-listing.
export async function notifyNewProjectInterest(context, projectId, ownerUserId, investorUserId) {
  const db = context.env.DB;
  const investor = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(investorUserId).first();
  const owner = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(ownerUserId).first();
  if (!owner) return;
  const body = `${investor ? investor.display_name : 'An investor'} is interested in your FinderMine project.`;
  await notifyAndMaybeEmail(context, { userId: owner.id, email: owner.email, emailFrequency: owner.email_frequency }, body,
    `/app#dev-project-${projectId}`, 'New interest on your FinderMine project', 'see who it is and follow up');
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

  const asRecipient = a => ({ userId: a.user_id, email: a.email, emailFrequency: a.email_frequency });
  const cta = 'see the details and send a proposal';
  const sends = [];
  if (requestType !== 'pre_listing' || !zip) {
    for (const a of agentsRow.results) sends.push(notifyAndMaybeEmail(context, asRecipient(a), bodyText, link, subject, cta));
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
      if (d !== null && d <= SERVICE_RADIUS_MILES) sends.push(notifyAndMaybeEmail(context, asRecipient(a), bodyText, link, subject, cta));
    }
  }
  // allSettled, not all — one agent's slow/failing email provider shouldn't stop another's in-app notification
  // or email from going through; this already runs via context.waitUntil() in the caller, so nothing upstream
  // is waiting on it either.
  await Promise.allSettled(sends);
}
