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

// sealed: the owner set a Decision Night, so the message says a proposal came in without saying whose.
// updated: an edit of a live proposal rather than a new one.
export async function notifyNewBid(context, requestType, requestId, ownerUserIds, agentUserId, { sealed = false, updated = false } = {}) {
  const db = context.env.DB;
  const agent = sealed ? null : await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(agentUserId).first();
  const owners = Array.isArray(ownerUserIds) ? ownerUserIds : [ownerUserIds];
  const link = requestLink(requestType, requestId);
  const body = sealed
    ? 'A new proposal came in. Every proposal opens to you together on your Decision Night.'
    : `${agent ? agent.display_name : 'An agent'} ${updated ? 'updated their proposal' : 'submitted a proposal'}.`;
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
  await notify(db, agentUserId, accepted ? 'Your proposal was accepted!' : 'The homeowner chose another agent this time. Thanks for sending a proposal.', link);
}

// Bring Your Reviews: a past client used the agent's review link.
export async function notifyPastClientReview(context, agentUserId) {
  await notify(context.env.DB, agentUserId, 'A past client left you a review. It shows on your profile under "Past clients, outside Amico Haus."', `/profile/${agentUserId}`);
}

// Decision Night arrived: the homeowner's proposals are all open now (see decisionNight.js runDueDecisionNights).
export async function notifyProposalsOpen(context, owner, preListingId, count) {
  const body = count > 0
    ? `It's Decision Night: your ${count} proposal${count === 1 ? ' is' : 's are'} open. Compare them side by side.`
    : "It's Decision Night, but no proposals came in yet. You can invite a local agent or keep the pre-listing open.";
  await notifyAndMaybeEmail(context, owner, body, requestLink('pre_listing', preListingId), 'Your proposals are open on Amico Haus', 'compare them');
}

// Finalist feedback: what tipped the homeowner's decision, from a preset list. It doesn't say which home (the agent
// may have been a finalist on several), who was hired, or anything about fees.
export async function notifyFinalistDebrief(context, agentUserId, reasonLabels) {
  await notify(context.env.DB, agentUserId,
    `A homeowner who had you as a finalist chose another agent. What tipped their decision: ${reasonLabels.join(', ')}. Finalist spots count on your profile.`,
    '/app#become-agent');
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
// excludeUserIds: the people who opened the request (a homeowner who is also an agent isn't pinged about their own).
export async function notifyAgentsNewRequest(context, requestType, requestId, zip, excludeUserIds = []) {
  const db = context.env.DB;
  const link = requestLink(requestType, requestId);
  const bodyText = requestType === 'pre_listing' ? 'A new pre-listing opened for proposals near you.' : 'A new trade transaction request opened for proposals.';
  const subject = requestType === 'pre_listing' ? 'New pre-listing near you on Amico Haus' : 'New trade request open for proposals on Amico Haus';

  const agentsRow = await db.prepare(
    `SELECT agent_profiles.user_id, agent_profiles.service_zips_json, users.email, users.email_frequency
     FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = 'approved' AND agent_profiles.notify_new_requests = 1
       AND users.status = 'active' AND users.email NOT LIKE '%@demo.amicohaus.local'`
  ).all();
  const excluded = new Set(excludeUserIds.map(Number));
  agentsRow.results = agentsRow.results.filter(a => !excluded.has(Number(a.user_id)));
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

// A structured offer on a regular trade listing — the clearest "someone wants to make a deal" event on that
// side of the site, so it gets the same email treatment as a new pre-listing proposal.
// `link` is wherever the owner reviews the offer -- /listing/{id} for a regular listing, /app#augmented-home-{id}
// or /app#green-home-{id} for those verticals (no public offer UI there, so it routes back into the app).
export async function notifyNewOffer(context, link, ownerUserId, buyerUserId) {
  const db = context.env.DB;
  const buyer = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(buyerUserId).first();
  const owner = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(ownerUserId).first();
  if (!owner) return;
  const body = `${buyer ? buyer.display_name : 'Someone'} made an offer on your listing.`;
  await notifyAndMaybeEmail(context, { userId: owner.id, email: owner.email, emailFrequency: owner.email_frequency }, body,
    link, 'New offer on Amico Haus', 'see the details');
}

export async function notifyOfferDecision(context, buyerUserId, link, accepted) {
  await notify(context.env.DB, buyerUserId, accepted ? 'Your offer was accepted!' : 'Your offer was not accepted this time.', link);
}

// proposedBy is who JUST made this counter ('owner' or 'buyer'), so the recipient (the other side) gets the
// right phrasing -- a buyer hearing from the seller reads differently than a seller hearing back from a buyer
// who countered their counter. Supports any number of back-and-forth rounds, not just the seller's first one.
export async function notifyOfferCounter(context, link, notifyUserId, counterPrice, proposedBy) {
  const price = '$' + Number(counterPrice).toLocaleString('en-US');
  const db = context.env.DB;
  const recipient = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(notifyUserId).first();
  if (!recipient) return;
  const body = proposedBy === 'owner' ? `The seller countered your offer at ${price}.` : `The buyer countered back at ${price}.`;
  await notifyAndMaybeEmail(context, { userId: recipient.id, email: recipient.email, emailFrequency: recipient.email_frequency },
    body, link, 'Counter-offer on Amico Haus', 'see the details and respond');
}

export async function notifyCounterDecision(context, link, notifyUserId, accepted) {
  await notify(context.env.DB, notifyUserId, accepted ? 'Your counter-offer was accepted!' : 'Your counter-offer was declined.', link);
}

// A listing someone favorited just got a new open house scheduled -- the one event worth proactively telling
// a prospective buyer about, since they have no other way to find out short of re-checking the page.
export async function notifyOpenHouseScheduled(context, link, favoriterUserIds, startsAt) {
  const db = context.env.DB;
  if (!favoriterUserIds.length) return;
  const when = new Date(startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const rows = await db.batch(favoriterUserIds.map(id => db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(id)));
  const sends = rows.map(r => {
    const u = r.results[0];
    if (!u) return Promise.resolve();
    return notifyAndMaybeEmail(context, { userId: u.id, email: u.email, emailFrequency: u.email_frequency },
      `A new open house was scheduled for ${when} on a listing you saved.`, link, 'New open house on a saved listing', 'see the details');
  });
  await Promise.allSettled(sends);
}

// A listing someone favorited just dropped in price -- the other event worth proactively surfacing to a
// saver, same reasoning as the open-house notify above. Used by AugmentedHomes/GreenHomes, the two verticals
// with both price history and a favorites list; a raise isn't notified, only a drop (the news a saver wants).
export async function notifyPriceDrop(context, link, favoriterUserIds, oldPrice, newPrice) {
  const db = context.env.DB;
  if (!favoriterUserIds.length || newPrice >= oldPrice) return;
  const price = '$' + Number(newPrice).toLocaleString('en-US');
  const rows = await db.batch(favoriterUserIds.map(id => db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(id)));
  const sends = rows.map(r => {
    const u = r.results[0];
    if (!u) return Promise.resolve();
    return notifyAndMaybeEmail(context, { userId: u.id, email: u.email, emailFrequency: u.email_frequency },
      `A listing you saved dropped in price to ${price}.`, link, 'Price drop on a saved listing', 'see the details');
  });
  await Promise.allSettled(sends);
}

// ---- Seller prep: broker previews and interviews ----
// Times are shown in Pacific time (the site serves San Diego County); the server itself runs on UTC.
function pacificTime(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Agents who already engaged with this pre-listing (voted, sent a proposal, or were invited) hear about a new
// preview window in-app; it's an invitation, not a request waiting on them, so no email.
export async function notifyPreviewScheduled(context, preListingId, startsAt) {
  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT engaged.id FROM (
       SELECT agent_user_id AS id FROM pre_listing_price_votes WHERE pre_listing_id = ?1
       UNION SELECT agent_user_id FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ?1 AND status IN ('pending','accepted')
       UNION SELECT agent_user_id FROM agent_invites WHERE request_type = 'pre_listing' AND request_id = ?1 AND status != 'declined'
     ) engaged
     JOIN users ON users.id = engaged.id AND users.status = 'active'
     JOIN agent_profiles ON agent_profiles.user_id = engaged.id AND agent_profiles.status = 'approved'`
  ).bind(preListingId).all();
  const body = `A homeowner opened a broker preview for ${pacificTime(startsAt)}. RSVP if you'd like to walk through.`;
  await Promise.allSettled(rows.results.map(r => notify(db, r.id, body, `/app#pre-listing-${preListingId}`)));
}

export async function notifyPreviewCanceled(context, preListingId, agentUserIds, startsAt) {
  const db = context.env.DB;
  const body = `The broker preview for ${pacificTime(startsAt)} was canceled.`;
  await Promise.allSettled(agentUserIds.map(id => notify(db, id, body, `/app#pre-listing-${preListingId}`)));
}

// Being asked to interview is the kind of thing an agent could lose by missing it, so it gets the email too.
export async function notifyInterviewRequested(context, preListingId, agentUserId) {
  const db = context.env.DB;
  const agent = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(agentUserId).first();
  if (!agent) return;
  await notifyAndMaybeEmail(context, { userId: agent.id, email: agent.email, emailFrequency: agent.email_frequency },
    'A homeowner would like to interview you about their pre-listing. Pick one of the times they offered.',
    `/app#pre-listing-${preListingId}`, 'Interview request on Amico Haus', 'pick a time');
}

export async function notifyInterviewScheduled(context, preListingId, ownerUserId, agentUserId, slot) {
  const db = context.env.DB;
  const agent = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(agentUserId).first();
  const owner = await db.prepare('SELECT id, email, email_frequency FROM users WHERE id = ?').bind(ownerUserId).first();
  if (!owner) return;
  await notifyAndMaybeEmail(context, { userId: owner.id, email: owner.email, emailFrequency: owner.email_frequency },
    `${agent ? agent.display_name : 'An agent'} picked ${pacificTime(slot)} for your interview.`,
    `/app#pre-listing-${preListingId}`, 'Interview scheduled on Amico Haus', 'see the details');
}

export async function notifyInterviewCanceled(context, preListingId, agentUserId) {
  await notify(context.env.DB, agentUserId, 'A homeowner canceled their interview request with you.', `/app#pre-listing-${preListingId}`);
}

// The owner hears about every RSVP (in-app), so they always know which agents received their street address.
export async function notifyPreviewRsvp(context, preListingId, ownerUserId, agentUserId, startsAt) {
  const db = context.env.DB;
  const agent = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(agentUserId).first();
  await notify(db, ownerUserId, `${agent ? agent.display_name : 'An agent'} RSVP'd to your broker preview on ${pacificTime(startsAt)} and can now see your address.`, `/app#pre-listing-${preListingId}`);
}
