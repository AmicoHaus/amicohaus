-- Batch B2: Bring Your Reviews and Brag Cards.

-- Bring Your Reviews: an approved agent turns on a link for past clients from a period they choose (and attests they
-- send it to every client from that period, not only happy ones). The token is what makes the link work; turning
-- the link off clears it, and making a new link replaces it.
ALTER TABLE agent_profiles ADD COLUMN review_invite_token TEXT;
ALTER TABLE agent_profiles ADD COLUMN review_invite_from_year INTEGER;
ALTER TABLE agent_profiles ADD COLUMN review_invite_to_year INTEGER;
-- When the agent last agreed to send the link to every client from that period (shown on their profile).
ALTER TABLE agent_profiles ADD COLUMN review_invite_attested_at TEXT;
-- When Rudy was last sent a "new past-client review" heads-up for this agent (at most one a day per agent).
ALTER TABLE agent_profiles ADD COLUMN review_alert_sent_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_review_invite ON agent_profiles(review_invite_token) WHERE review_invite_token IS NOT NULL;

-- A review from someone the agent helped outside Amico Haus, kept apart from reviews of agents hired on Amico Haus.
-- The street address is private (only for checking against public sale records later); the profile shows the year,
-- city and which side they were on. The agent can't hide or delete these; only an admin can remove one (logged).
CREATE TABLE IF NOT EXISTS past_client_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  client_side TEXT NOT NULL CHECK(client_side IN ('sold','bought','both')),
  sale_year INTEGER NOT NULL,
  sale_city TEXT NOT NULL,
  sale_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed')),
  removed_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_user_id, reviewer_user_id)
);
CREATE INDEX IF NOT EXISTS idx_past_client_reviews_agent ON past_client_reviews(agent_user_id, status);
