// True if either user has blocked the other — checked before allowing a new
// conversation or message, so a block is effective regardless of who blocked whom.
export async function isEitherBlocked(db, userId1, userId2) {
  const row = await db.prepare(
    `SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`
  ).bind(userId1, userId2, userId2, userId1).first();
  return !!row;
}
