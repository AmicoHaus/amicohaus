-- Amico Haus — migration v10 (favorites/hidden listings, match feedback, notification prefs)
-- Run this ONCE in the D1 console, after migration_v9.sql is already applied.

ALTER TABLE users ADD COLUMN notify_matches INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS listing_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  feedback TEXT NOT NULL CHECK(feedback IN ('up','down')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_listing_feedback_user ON listing_feedback(user_id, feedback);

CREATE TABLE IF NOT EXISTS match_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_a_id INTEGER NOT NULL,
  listing_b_id INTEGER NOT NULL,
  feedback TEXT NOT NULL CHECK(feedback IN ('up','down')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, listing_a_id, listing_b_id)
);
CREATE INDEX IF NOT EXISTS idx_match_feedback_user ON match_feedback(user_id);
