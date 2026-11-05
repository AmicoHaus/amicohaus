// Blocks work both ways for contact: once either person blocks the other, neither can reach the other through
// messages, proposals, price opinions, showings, previews, interviews, invites or shared contact info. An agent
// refused because of a block gets the same answer as if the home didn't exist (never "you're blocked"), and the
// owner's lists simply leave a blocked agent out. Bids, votes and opinions stay stored, so unblocking brings them back.

// True if either user has blocked the other — checked before allowing a new
// conversation or message, so a block is effective regardless of who blocked whom.
export async function isEitherBlocked(db, userId1, userId2) {
  const row = await db.prepare(
    `SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`
  ).bind(userId1, userId2, userId2, userId1).first();
  return !!row;
}

// True only if blockerId blocked blockedId (the viewer's own block: "Unblock {name} to send a message").
export async function hasBlocked(db, blockerId, blockedId) {
  const row = await db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1').bind(blockerId, blockedId).first();
  return !!row;
}

// Everyone userId blocked or was blocked by.
export async function blockedIdsFor(db, userId) {
  const rows = await db.prepare(
    'SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ?1 UNION SELECT blocker_id FROM user_blocks WHERE blocked_id = ?1'
  ).bind(userId).all();
  return new Set(rows.results.map(r => r.id));
}

// SQL fragment: true when there's no block either way between the user in userCol and the viewer. viewerParam is a
// bound parameter (e.g. '?1') or any SQL expression for a user id, e.g. notBlockedSql('service_bids.agent_user_id', '?1').
export function notBlockedSql(userCol, viewerParam) {
  return `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ${viewerParam} AND ub.blocked_id = ${userCol}) OR (ub.blocker_id = ${userCol} AND ub.blocked_id = ${viewerParam}))`;
}

// The same, against the homeowner(s) behind a request: the pre-listing's owner, or both partners of a trade.
// requestType is 'pre_listing' or 'transaction' (from code, never from a request); requestIdCol is the SQL column
// or parameter holding the request id. Owner-facing lists use this, so it works without knowing who is looking.
export function notBlockedByOwnersSql(requestType, requestIdCol, userCol) {
  if (requestType === 'pre_listing') return notBlockedSql(userCol, `(SELECT user_id FROM pre_listings WHERE id = ${requestIdCol})`);
  return `${notBlockedSql(userCol, `(SELECT user_a_id FROM transaction_requests WHERE id = ${requestIdCol})`)}
    AND ${notBlockedSql(userCol, `(SELECT user_b_id FROM transaction_requests WHERE id = ${requestIdCol})`)}`;
}

// Same answer for code: true if any homeowner behind the request blocked, or was blocked by, userId.
export async function isBlockedWithOwners(db, requestType, requestId, userId) {
  const row = await db.prepare(`SELECT 1 AS ok WHERE NOT (${notBlockedByOwnersSql(requestType, '?1', '?2')})`).bind(requestId, userId).first();
  return !!row;
}
