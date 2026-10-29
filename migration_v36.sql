-- Sealed price opinions on pre-listings: the list price an agent would suggest, up to 3 sold comps that back it
-- up, and one presentation file (PDF, PowerPoint or Word, stored in R2). Only the homeowner and that agent ever
-- see these; other agents never do. Kept apart from pre_listing_price_votes because a vote is about the asking
-- price (and is cleared when the owner changes it), while an opinion is about what the home is worth.
CREATE TABLE IF NOT EXISTS pre_listing_price_opinions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_opinion INTEGER,
  comps_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  deck_r2_key TEXT,
  deck_name TEXT,
  deck_type TEXT,
  deck_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pre_listing_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_opinions_listing ON pre_listing_price_opinions(pre_listing_id);

-- Mello-Roos and HOA snapshot on every kind of home (functions/_lib/homeCosts.js). NULL means the owner didn't
-- say; 0 means none. hoa_details_json holds what the dues include, rental and pet rules, and any special
-- assessment.
ALTER TABLE listings ADD COLUMN mello_roos_annual INTEGER;
ALTER TABLE listings ADD COLUMN hoa_monthly INTEGER;
ALTER TABLE listings ADD COLUMN hoa_details_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pre_listings ADD COLUMN mello_roos_annual INTEGER;
ALTER TABLE pre_listings ADD COLUMN hoa_monthly INTEGER;
ALTER TABLE pre_listings ADD COLUMN hoa_details_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE augmented_homes ADD COLUMN mello_roos_annual INTEGER;
ALTER TABLE augmented_homes ADD COLUMN hoa_monthly INTEGER;
ALTER TABLE augmented_homes ADD COLUMN hoa_details_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE green_homes ADD COLUMN mello_roos_annual INTEGER;
ALTER TABLE green_homes ADD COLUMN hoa_monthly INTEGER;
ALTER TABLE green_homes ADD COLUMN hoa_details_json TEXT NOT NULL DEFAULT '{}';
