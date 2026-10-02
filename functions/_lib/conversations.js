// Conversations are stored with the smaller user id always as user_a_id, so
// the UNIQUE(user_a_id, user_b_id) constraint prevents duplicate threads
// regardless of who starts the conversation.
export async function getOrCreateConversation(db, userId1, userId2) {
  const [a, b] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
  await db.prepare('INSERT OR IGNORE INTO conversations (user_a_id, user_b_id) VALUES (?, ?)').bind(a, b).run();
  return db.prepare('SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ?').bind(a, b).first();
}
