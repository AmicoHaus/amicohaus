-- Closes the loop a pre-listing's existing "showing notice" field never actually enforced: an approved agent
-- can propose a specific time to view the home, the homeowner accepts/declines it, and the proposed time is
-- validated server-side against the pre-listing's own showing_notice_hours.
CREATE TABLE IF NOT EXISTS pre_listing_showings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','canceled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_showings_listing ON pre_listing_showings(pre_listing_id);
CREATE INDEX IF NOT EXISTS idx_pre_listing_showings_agent ON pre_listing_showings(agent_user_id);
