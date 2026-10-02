-- Amico Haus — migration v3 (listing photos via R2)
-- Run this ONCE in the D1 console, after migration_v2.sql is already applied.
-- Also requires an R2 bucket bound to the Pages project as "PHOTOS" — see the
-- setup notes that came with this file.

CREATE TABLE IF NOT EXISTS listing_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listing_photos_listing ON listing_photos(listing_id, position);
