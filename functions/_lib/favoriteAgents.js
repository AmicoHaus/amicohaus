export async function toggleFavoriteAgent(db, userId, agentUserId) {
  // Un-favoriting always works, even if the agent has since been removed.
  const existing = await db.prepare('SELECT 1 FROM favorite_agents WHERE user_id = ? AND agent_user_id = ?').bind(userId, agentUserId).first();
  if (existing) {
    await db.prepare('DELETE FROM favorite_agents WHERE user_id = ? AND agent_user_id = ?').bind(userId, agentUserId).run();
    return { favorited: false };
  }

  // Adding needs a real, approved agent — inserting a nonexistent id violates
  // the foreign key and used to surface as a server error.
  if (agentUserId === userId) return { error: "You can't favorite yourself." };
  const agent = await db.prepare("SELECT 1 FROM agent_profiles WHERE user_id = ? AND status = 'approved'").bind(agentUserId).first();
  if (!agent) return { error: 'That agent was not found.', notFound: true };

  await db.prepare('INSERT INTO favorite_agents (user_id, agent_user_id) VALUES (?, ?)').bind(userId, agentUserId).run();
  return { favorited: true };
}

export async function fetchFavoriteAgentIds(db, userId) {
  const rows = await db.prepare('SELECT agent_user_id FROM favorite_agents WHERE user_id = ?').bind(userId).all();
  return rows.results.map(r => r.agent_user_id);
}

export async function fetchFavoriteAgents(db, userId) {
  const rows = await db.prepare(
    `SELECT favorite_agents.agent_user_id, favorite_agents.created_at, users.display_name,
            agent_profiles.brokerage_name, agent_profiles.years_experience, agent_profiles.video_r2_key,
            (SELECT ROUND(AVG(rating), 1) FROM agent_reviews WHERE agent_reviews.agent_user_id = favorite_agents.agent_user_id) AS agent_rating,
            (SELECT COUNT(*) FROM agent_reviews WHERE agent_reviews.agent_user_id = favorite_agents.agent_user_id) AS agent_review_count
     FROM favorite_agents
     JOIN users ON users.id = favorite_agents.agent_user_id
     LEFT JOIN agent_profiles ON agent_profiles.user_id = favorite_agents.agent_user_id
     WHERE favorite_agents.user_id = ? ORDER BY favorite_agents.created_at DESC`
  ).bind(userId).all();
  return rows.results.map(r => ({
    agentUserId: r.agent_user_id, displayName: r.display_name, brokerageName: r.brokerage_name,
    yearsExperience: r.years_experience, hasVideo: !!r.video_r2_key,
    rating: r.agent_rating, reviewCount: r.agent_review_count, createdAt: r.created_at,
  }));
}
