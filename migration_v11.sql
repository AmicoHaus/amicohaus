-- Amico Haus — migration v11 (broker dashboard, contact CTA, push notifications, verified badges)
-- Run this ONCE in the D1 console, after migration_v10.sql is already applied.

ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
