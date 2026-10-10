-- Market Pulse alerts: save a watch (event type / entity kind / city / state, each optional -- unset means
-- "any") and get notified in-app the moment a matching real event fires. Mirrors the shape of the other
-- needs-alert tables (accessibility_needs_alerts, green_needs_alerts, dev_project_needs_alerts).
CREATE TABLE IF NOT EXISTS market_pulse_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  event_type TEXT,
  entity_kind TEXT,
  city TEXT,
  state TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_pulse_alerts_user ON market_pulse_alerts(user_id);

-- Comment upvotes, mirrors post_likes exactly.
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);
