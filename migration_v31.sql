-- Offers on AugmentedHomes and GreenHomes, mirroring listing_offers exactly (including multi-round counters).
CREATE TABLE IF NOT EXISTS augmented_home_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price INTEGER NOT NULL,
  financing_type TEXT NOT NULL DEFAULT 'financed' CHECK(financing_type IN ('cash','financed')),
  closing_timeline TEXT NOT NULL DEFAULT '',
  contingencies TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','countered','accepted','declined','withdrawn')),
  counter_price INTEGER,
  counter_message TEXT NOT NULL DEFAULT '',
  countered_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_offers_home ON augmented_home_offers(augmented_home_id);
CREATE INDEX IF NOT EXISTS idx_augmented_home_offers_buyer ON augmented_home_offers(buyer_user_id);

CREATE TABLE IF NOT EXISTS green_home_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price INTEGER NOT NULL,
  financing_type TEXT NOT NULL DEFAULT 'financed' CHECK(financing_type IN ('cash','financed')),
  closing_timeline TEXT NOT NULL DEFAULT '',
  contingencies TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','countered','accepted','declined','withdrawn')),
  counter_price INTEGER,
  counter_message TEXT NOT NULL DEFAULT '',
  countered_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_home_offers_home ON green_home_offers(green_home_id);
CREATE INDEX IF NOT EXISTS idx_green_home_offers_buyer ON green_home_offers(buyer_user_id);

-- Open houses on AugmentedHomes and GreenHomes, mirroring open_houses/open_house_rsvps exactly.
CREATE TABLE IF NOT EXISTS augmented_home_open_houses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_houses_home ON augmented_home_open_houses(augmented_home_id);
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_houses_starts ON augmented_home_open_houses(starts_at);

CREATE TABLE IF NOT EXISTS augmented_home_open_house_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_house_id INTEGER NOT NULL REFERENCES augmented_home_open_houses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(open_house_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_house_rsvps_oh ON augmented_home_open_house_rsvps(open_house_id);

CREATE TABLE IF NOT EXISTS green_home_open_houses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_home_open_houses_home ON green_home_open_houses(green_home_id);
CREATE INDEX IF NOT EXISTS idx_green_home_open_houses_starts ON green_home_open_houses(starts_at);

CREATE TABLE IF NOT EXISTS green_home_open_house_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_house_id INTEGER NOT NULL REFERENCES green_home_open_houses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(open_house_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_green_home_open_house_rsvps_oh ON green_home_open_house_rsvps(open_house_id);

-- Favorites (bookmark a specific listing for later, distinct from a saved-search alert) for AugmentedHomes,
-- GreenHomes, and FinderMine -- regular listings already have this via listing_feedback 'up'. Also the
-- subscriber list for price-drop notifications on AugmentedHomes/GreenHomes.
CREATE TABLE IF NOT EXISTS augmented_home_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, augmented_home_id)
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_favorites_user ON augmented_home_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_augmented_home_favorites_home ON augmented_home_favorites(augmented_home_id);

CREATE TABLE IF NOT EXISTS green_home_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, green_home_id)
);
CREATE INDEX IF NOT EXISTS idx_green_home_favorites_user ON green_home_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_green_home_favorites_home ON green_home_favorites(green_home_id);

CREATE TABLE IF NOT EXISTS dev_project_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dev_project_id INTEGER NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, dev_project_id)
);
CREATE INDEX IF NOT EXISTS idx_dev_project_favorites_user ON dev_project_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_project_favorites_project ON dev_project_favorites(dev_project_id);

-- FinderMine needs-alert: notify on a new matching project by type/city/state -- a project match is about
-- type and location, not a taxonomy of checkboxes like the accessibility/green-feature alerts.
CREATE TABLE IF NOT EXISTS dev_project_needs_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  project_type TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  notified_project_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_project_needs_alerts_user ON dev_project_needs_alerts(user_id);
