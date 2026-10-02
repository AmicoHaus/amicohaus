// A homeowner privately inviting one specific approved agent to bid — the
// "already have an existing relationship" path the open marketplace doesn't
// cover on its own. The agent still submits a normal service_bids proposal;
// this just surfaces the request on their radar (and re-adds it to their
// browse list) even if it's outside their usual filters, and lets the
// homeowner skip advertising the request to every agent on the platform.
import { clampString } from './util.js';

export async function isPartyToRequest(db, requestType, requestId, userId) {
  const row = requestType === 'pre_listing'
    ? await db.prepare('SELECT user_id AS a, NULL AS b FROM pre_listings WHERE id = ?').bind(requestId).first()
    : await db.prepare('SELECT user_a_id AS a, user_b_id AS b FROM transaction_requests WHERE id = ?').bind(requestId).first();
  if (!row) return false;
  return row.a === userId || row.b === userId;
}

export async function inviteAgent(db, requestType, requestId, invitedByUserId, agentUserId, message) {
  const isParty = await isPartyToRequest(db, requestType, requestId, invitedByUserId);
  if (!isParty) return { error: 'You are not a party to this request.' };

  const agent = await db.prepare("SELECT 1 FROM agent_profiles WHERE user_id = ? AND status = 'approved'").bind(agentUserId).first();
  if (!agent) return { error: 'That agent is not an approved agent.' };

  await db.prepare(
    `INSERT INTO agent_invites (request_type, request_id, agent_user_id, invited_by_user_id, message)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(request_type, request_id, agent_user_id) DO UPDATE SET message = excluded.message, status = 'pending'`
  ).bind(requestType, requestId, agentUserId, invitedByUserId, clampString(message, 500)).run();
  return { ok: true };
}

export async function fetchInvitesForRequest(db, requestType, requestId) {
  const rows = await db.prepare(
    `SELECT agent_invites.*, users.display_name AS agent_name
     FROM agent_invites JOIN users ON users.id = agent_invites.agent_user_id
     WHERE request_type = ? AND request_id = ? ORDER BY created_at DESC`
  ).bind(requestType, requestId).all();
  return rows.results.map(r => ({
    id: r.id, agentUserId: r.agent_user_id, agentName: r.agent_name,
    message: r.message, status: r.status, createdAt: r.created_at,
  }));
}

// Every open request an agent has been personally invited to — shown
// alongside their normal browse list regardless of service-area/city
// filters, since a direct invite is an explicit ask. Mirrors
// fetchAgentOwnBids's two-lookups-and-merge pattern since invites are
// polymorphic across the same two request tables.
export async function fetchMyInvites(db, agentUserId) {
  const rows = await db.prepare(
    `SELECT id, request_type, request_id, message, status, created_at FROM agent_invites
     WHERE agent_user_id = ? AND status = 'pending' ORDER BY created_at DESC`
  ).bind(agentUserId).all();

  const preListingIds = rows.results.filter(r => r.request_type === 'pre_listing').map(r => r.request_id);
  const transactionIds = rows.results.filter(r => r.request_type === 'transaction').map(r => r.request_id);

  const preListingsById = new Map();
  if (preListingIds.length > 0) {
    const placeholders = preListingIds.map(() => '?').join(',');
    const pl = await db.prepare(`SELECT id, title, city, state, asking_price FROM pre_listings WHERE id IN (${placeholders})`).bind(...preListingIds).all();
    for (const r of pl.results) preListingsById.set(r.id, r);
  }
  const transactionsById = new Map();
  if (transactionIds.length > 0) {
    const placeholders = transactionIds.map(() => '?').join(',');
    const tx = await db.prepare(`SELECT id FROM transaction_requests WHERE id IN (${placeholders})`).bind(...transactionIds).all();
    for (const r of tx.results) transactionsById.set(r.id, r);
  }

  return rows.results.map(r => ({
    id: r.id, requestType: r.request_type, requestId: r.request_id, message: r.message, status: r.status, createdAt: r.created_at,
    preListing: r.request_type === 'pre_listing' ? preListingsById.get(r.request_id) : undefined,
    transaction: r.request_type === 'transaction' ? transactionsById.get(r.request_id) : undefined,
  }));
}

export async function markInviteResponded(db, requestType, requestId, agentUserId) {
  await db.prepare(
    "UPDATE agent_invites SET status = 'responded' WHERE request_type = ? AND request_id = ? AND agent_user_id = ? AND status = 'pending'"
  ).bind(requestType, requestId, agentUserId).run();
}

export async function declineInvite(db, inviteId, agentUserId) {
  await db.prepare("UPDATE agent_invites SET status = 'declined' WHERE id = ? AND agent_user_id = ? AND status = 'pending'").bind(inviteId, agentUserId).run();
}
