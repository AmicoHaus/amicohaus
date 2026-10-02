-- Soft-delete / undo: deleting a listing snapshots it here first (full row +
-- desired_criteria + photo metadata as one JSON blob) instead of only being
-- reachable through a real DELETE. Kept as a completely separate table
-- rather than a deleted_at column on `listings` itself, so every existing
-- query that reads from `listings` needs zero changes to stay correct — a
-- "deleted" listing is genuinely gone from that table, exactly as every
-- other query already assumes.
CREATE TABLE IF NOT EXISTS deleted_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deleted_listings_user ON deleted_listings(user_id, deleted_at);
