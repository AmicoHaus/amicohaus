-- AugmentedHomes: a marketplace for homes modified for a disability (mobility,
-- vision, hearing, height, etc.) so the adaptation finds the next person who
-- actually needs it instead of being stripped out at resale.
CREATE TABLE IF NOT EXISTS augmented_homes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL DEFAULT '',
  property_type TEXT NOT NULL,
  beds REAL NOT NULL DEFAULT 0,
  baths REAL NOT NULL DEFAULT 0,
  sqft INTEGER,
  asking_price INTEGER NOT NULL,
  adaptations_json TEXT NOT NULL DEFAULT '[]',
  adaptation_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','under_contract','sold','withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_homes_user ON augmented_homes(user_id);
CREATE INDEX IF NOT EXISTS idx_augmented_homes_status ON augmented_homes(status);

CREATE TABLE IF NOT EXISTS augmented_home_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_photos_home ON augmented_home_photos(augmented_home_id);

-- A buyer's saved "what I need" profile — mirrors agent_search_alerts: a flat
-- notified-ids list so the same home never re-notifies the same alert twice.
CREATE TABLE IF NOT EXISTS accessibility_needs_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  adaptations_json TEXT NOT NULL DEFAULT '[]',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  notified_home_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accessibility_needs_alerts_user ON accessibility_needs_alerts(user_id);

-- FinderMine: a deal-discovery and discussion board for developers/investors.
-- Discovery and messaging only — no funds, equity, or escrow are tracked or
-- moved here, same as the rest of Amico Haus.
CREATE TABLE IF NOT EXISTS dev_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL DEFAULT '',
  project_type TEXT NOT NULL CHECK(project_type IN ('flip','new_construction','multifamily','commercial','land','other')),
  stage TEXT NOT NULL DEFAULT 'concept' CHECK(stage IN ('concept','permitting','under_construction','funded','completed')),
  funding_goal INTEGER NOT NULL DEFAULT 0,
  min_investment INTEGER NOT NULL DEFAULT 0,
  target_return TEXT NOT NULL DEFAULT '',
  timeline_months INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','funded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_projects_user ON dev_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_projects_status ON dev_projects(status);

CREATE TABLE IF NOT EXISTS dev_project_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dev_project_id INTEGER NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_project_photos_project ON dev_project_photos(dev_project_id);

-- A lightweight "I'm interested" signal distinct from full messaging: lets a
-- poster see how many investors are circling without everyone having to
-- write a message first, and an investor track what they've already flagged.
CREATE TABLE IF NOT EXISTS dev_project_interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dev_project_id INTEGER NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  investor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dev_project_id, investor_user_id)
);
CREATE INDEX IF NOT EXISTS idx_dev_project_interests_project ON dev_project_interests(dev_project_id);
CREATE INDEX IF NOT EXISTS idx_dev_project_interests_investor ON dev_project_interests(investor_user_id);
