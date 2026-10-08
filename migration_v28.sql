-- Price-change transparency: a visible log instead of silently clearing
-- agent votes when a pre-listing's asking price changes.
CREATE TABLE IF NOT EXISTS pre_listing_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  old_price INTEGER NOT NULL,
  new_price INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_price_history_pl ON pre_listing_price_history(pre_listing_id);

-- Open houses: a scheduled event the public can RSVP to, distinct from a
-- showing request (which is a 1:1 agent-initiated ask on a pre-listing).
-- Tied to a regular listing since that's the one with a public page.
CREATE TABLE IF NOT EXISTS open_houses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_open_houses_listing ON open_houses(listing_id);
CREATE INDEX IF NOT EXISTS idx_open_houses_starts ON open_houses(starts_at);

CREATE TABLE IF NOT EXISTS open_house_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_house_id INTEGER NOT NULL REFERENCES open_houses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(open_house_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_open_house_rsvps_oh ON open_house_rsvps(open_house_id);

-- Structured offers on a regular (trade) listing -- a buyer's actual terms,
-- not just a DM. No money moves through Amico Haus; this is a comparison
-- and negotiation-starter layer, same footing as everything else here.
CREATE TABLE IF NOT EXISTS listing_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price INTEGER NOT NULL,
  financing_type TEXT NOT NULL DEFAULT 'financed' CHECK(financing_type IN ('cash','financed')),
  closing_timeline TEXT NOT NULL DEFAULT '',
  contingencies TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listing_offers_listing ON listing_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_offers_buyer ON listing_offers(buyer_user_id);

-- Life-event context on a trade listing -- purely informational/filterable
-- metadata (e.g. so a downsizing empty-nester and an upsizing growing family
-- can recognize each other), never fed into the matching engine itself.
ALTER TABLE listings ADD COLUMN life_event_tags_json TEXT NOT NULL DEFAULT '[]';
