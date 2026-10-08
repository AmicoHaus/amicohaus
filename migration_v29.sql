-- Counter-offers: SQLite can't ALTER a CHECK constraint in place, so the table is rebuilt with the wider
-- status set plus the two new columns a counter needs.
CREATE TABLE listing_offers_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price INTEGER NOT NULL,
  financing_type TEXT NOT NULL DEFAULT 'financed' CHECK(financing_type IN ('cash','financed')),
  closing_timeline TEXT NOT NULL DEFAULT '',
  contingencies TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','countered','accepted','declined','withdrawn')),
  counter_price INTEGER,
  counter_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO listing_offers_new (id, listing_id, buyer_user_id, offer_price, financing_type, closing_timeline, contingencies, message, status, created_at, updated_at)
  SELECT id, listing_id, buyer_user_id, offer_price, financing_type, closing_timeline, contingencies, message, status, created_at, updated_at FROM listing_offers;
DROP TABLE listing_offers;
ALTER TABLE listing_offers_new RENAME TO listing_offers;
CREATE INDEX IF NOT EXISTS idx_listing_offers_listing ON listing_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_offers_buyer ON listing_offers(buyer_user_id);

-- FinderMine x AugmentedHomes crossover: a project can tag which accessibility adaptations it's being built
-- for, reusing the exact same taxonomy (functions/_lib/adaptations.js) -- purely informational/filterable.
ALTER TABLE dev_projects ADD COLUMN adaptations_json TEXT NOT NULL DEFAULT '[]';

-- GreenHomes: a third marketplace, identical shape to AugmentedHomes, for homes with energy/sustainability
-- features -- solar, EV charging, efficient HVAC, etc.
CREATE TABLE IF NOT EXISTS green_homes (
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
  green_features_json TEXT NOT NULL DEFAULT '[]',
  feature_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','under_contract','sold','withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_homes_user ON green_homes(user_id);
CREATE INDEX IF NOT EXISTS idx_green_homes_status ON green_homes(status);

CREATE TABLE IF NOT EXISTS green_home_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_home_photos_home ON green_home_photos(green_home_id);
