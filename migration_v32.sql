-- Deal threads: a discussion attaches to a listing/home/project via a lazily-created anchor post, reusing the
-- existing posts/comments/likes system as-is (no changes needed there). Mirrors the existing listing_id column.
ALTER TABLE posts ADD COLUMN augmented_home_id INTEGER REFERENCES augmented_homes(id) ON DELETE CASCADE;
ALTER TABLE posts ADD COLUMN green_home_id INTEGER REFERENCES green_homes(id) ON DELETE CASCADE;
ALTER TABLE posts ADD COLUMN dev_project_id INTEGER REFERENCES dev_projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_posts_listing ON posts(listing_id);
CREATE INDEX IF NOT EXISTS idx_posts_augmented_home ON posts(augmented_home_id);
CREATE INDEX IF NOT EXISTS idx_posts_green_home ON posts(green_home_id);
CREATE INDEX IF NOT EXISTS idx_posts_dev_project ON posts(dev_project_id);

-- Market Pulse: a real, append-only log of actual platform activity (new listings, price drops, accepted
-- offers, open houses) across all four marketplaces, for a trading-terminal-style ticker. Never simulated --
-- real estate has no continuous market, so this only ever logs events that actually happened.
CREATE TABLE IF NOT EXISTS market_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK(event_type IN ('new_listing','price_drop','offer_accepted','open_house_scheduled')),
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('listing','augmented_home','green_home','dev_project')),
  entity_id INTEGER NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL,
  amount INTEGER,
  delta INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_events_created ON market_events(created_at DESC);
