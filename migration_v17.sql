-- Pre-Listings Marketplace: brings a Fiverr/Upwork-style gig marketplace to
-- real estate. Vetted agents build a profile (portfolio photos, an a-la-
-- carte service menu with fees, reviews/ratings from past work) and submit
-- proposals ("bids") on two kinds of requests for help:
--   - a homeowner's solo "pre-listing" (before they've found a trade match,
--     seeking normal listing representation) — this also supports agents
--     casting a quick "is this priced right" vote, since that's specific to
--     an asking price and doesn't apply to a swap.
--   - a "transaction request" opened from an EXISTING mutual trade match
--     between two already-matched users, when either side wants to put
--     finalizing/closing the swap out to bid instead of (or in addition to)
--     using an agent they already know.
-- Entirely parallel to the existing listings/matching system — none of this
-- enters that graph, and turning an awarded proposal into an actual managed
-- trade listing (client_name set to the homeowner) is a manual follow-up
-- step through the existing tools, not an automatic conversion.

-- One row per user who has ever applied to become a vetted agent. Vetting is
-- admin-reviewed based on self-reported info (license number, brokerage) —
-- Amico Haus does not independently verify license numbers with any state
-- board, which the UI must disclose clearly.
CREATE TABLE IF NOT EXISTS agent_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  brokerage_name TEXT NOT NULL DEFAULT '',
  license_number TEXT NOT NULL DEFAULT '',
  years_experience INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  default_commission_pct REAL,
  default_flat_fee INTEGER,
  services_json TEXT NOT NULL DEFAULT '[]',
  video_r2_key TEXT,
  video_content_type TEXT,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT
);

-- Past-work portfolio photos an approved agent shows on their public profile.
CREATE TABLE IF NOT EXISTS agent_portfolio_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_portfolio_photos_agent ON agent_portfolio_photos(agent_user_id, position);

CREATE TABLE IF NOT EXISTS pre_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  property_type TEXT NOT NULL,
  beds REAL NOT NULL DEFAULT 0,
  baths REAL NOT NULL DEFAULT 0,
  sqft INTEGER,
  asking_price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','awarded','closed')),
  awarded_bid_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listings_user ON pre_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_pre_listings_status ON pre_listings(status);

CREATE TABLE IF NOT EXISTS pre_listing_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_photos_listing ON pre_listing_photos(pre_listing_id, position);

-- Opened from an existing mutual match between two listings (identified by
-- the pair, since matches themselves are computed on demand and never
-- persisted) when either trade partner wants to put finalizing/closing the
-- swap out to bid. Either side can open one; either side can accept a
-- proposal on it — this deliberately doesn't require both parties' sign-off
-- in v1, so the two of them should still coordinate via their existing
-- conversation before accepting.
CREATE TABLE IF NOT EXISTS transaction_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_a_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_b_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','awarded','closed')),
  awarded_bid_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listing_a_id, listing_b_id)
);
CREATE INDEX IF NOT EXISTS idx_transaction_requests_users ON transaction_requests(user_a_id, user_b_id);

-- Polymorphic across both request kinds (request_type + request_id) rather
-- than two near-identical tables, since the proposal shape (message, fee,
-- included services, status) is exactly the same either way — only what
-- it's attached to differs. One active proposal per agent per request;
-- re-submitting (including after withdrawing or being declined) just
-- overwrites it and puts it back to pending.
CREATE TABLE IF NOT EXISTS service_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL CHECK(request_type IN ('pre_listing','transaction')),
  request_id INTEGER NOT NULL,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  commission_pct REAL,
  flat_fee INTEGER,
  services_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_type, request_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_service_bids_request ON service_bids(request_type, request_id);
CREATE INDEX IF NOT EXISTS idx_service_bids_agent ON service_bids(agent_user_id, status);

-- Only for pre-listings — "is this priced right" doesn't map cleanly onto a
-- swap the way it does a for-sale asking price.
CREATE TABLE IF NOT EXISTS pre_listing_price_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK(vote IN ('too_high','too_low','just_right')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pre_listing_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_votes_listing ON pre_listing_price_votes(pre_listing_id);

-- Reviews/ratings — the third pillar of a real gig marketplace alongside
-- proposals and portfolios. Gated to only the user who was on the awarded
-- side of a completed request, one review per request.
CREATE TABLE IF NOT EXISTS agent_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK(request_type IN ('pre_listing','transaction')),
  request_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_type, request_id, reviewer_user_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_agent ON agent_reviews(agent_user_id);
