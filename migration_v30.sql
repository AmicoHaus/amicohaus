-- GreenHomes needs-alerts: mirrors accessibility_needs_alerts (AugmentedHomes), but for green features.
CREATE TABLE IF NOT EXISTS green_needs_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  green_features_json TEXT NOT NULL DEFAULT '[]',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  notified_home_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_needs_alerts_user ON green_needs_alerts(user_id);

-- GreenHomes x FinderMine crossover, mirroring the adaptations_json crossover already on dev_projects.
ALTER TABLE dev_projects ADD COLUMN green_features_json TEXT NOT NULL DEFAULT '[]';

-- Life-event context (purely informational, same as listings.life_event_tags_json) on AugmentedHomes/GreenHomes.
ALTER TABLE augmented_homes ADD COLUMN life_event_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE green_homes ADD COLUMN life_event_tags_json TEXT NOT NULL DEFAULT '[]';

-- Price-change history for AugmentedHomes/GreenHomes, mirroring pre_listing_price_history.
CREATE TABLE IF NOT EXISTS augmented_home_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  old_price INTEGER NOT NULL,
  new_price INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_price_history_home ON augmented_home_price_history(augmented_home_id);

CREATE TABLE IF NOT EXISTS green_home_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  old_price INTEGER NOT NULL,
  new_price INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_home_price_history_home ON green_home_price_history(green_home_id);

-- Multi-round counter-offers: tracks which side proposed the CURRENT counter_price/counter_message, so the
-- other side's response (accept/decline/counter back) is gated correctly across any number of rounds, instead
-- of the single owner-counters-once round the feature originally shipped with.
ALTER TABLE listing_offers ADD COLUMN countered_by TEXT NOT NULL DEFAULT 'owner';
