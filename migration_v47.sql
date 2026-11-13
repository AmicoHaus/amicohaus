-- migration_v47.sql: "Nuanced ideas v1" (12 tools). Applies on v46.
-- Only ALTER TABLE ... ADD COLUMN, CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS. No backfill; every
-- ADD COLUMN default is a constant (D1-safe). All times are datetime('now') text (UTC 'YYYY-MM-DD HH:MM:SS') unless a
-- column says "Pacific date" ('YYYY-MM-DD'); never compare either with an ISO 'T...Z' string.

-- ---------------------------------------------------------------------------------------------------------------
-- Shared: a trade listing's ZIP code, typed by the owner ('' on listings posted before v47). Watch areas, the
-- member digest, area context and carrier-reported coverage all work at ZIP level (the site holds no coordinates).
ALTER TABLE listings ADD COLUMN zip TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_listings_zip ON listings(zip);
CREATE INDEX IF NOT EXISTS idx_pre_listings_zip ON pre_listings(zip);

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Neighbors First (watchAreas.js). head_start_until: while set and in the future, a trade listing is stored
-- status = 'paused' (hidden everywhere, as any paused listing) and shown only to members watching its ZIP; a
-- pre-listing's teaser is shown only to members watching its ZIP (approved agents see it as always). NULL = none.
ALTER TABLE listings ADD COLUMN head_start_until TEXT;
ALTER TABLE pre_listings ADD COLUMN head_start_until TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_head_start ON listings(head_start_until) WHERE head_start_until IS NOT NULL;

-- A member's watch areas: whole ZIP codes in v1 (max 3 per person, checked in code). Open to any member, never tied
-- to where they live (fair housing).
CREATE TABLE IF NOT EXISTS watch_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zip TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, zip)
);
CREATE INDEX IF NOT EXISTS idx_watch_areas_zip ON watch_areas(zip);

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Standing Offer (standingInterest.js). A homeowner's own note of where their home is (ZIP + street name, never
-- a house number), so standing interest for that street or ZIP reaches them. Not checked by the site.
CREATE TABLE IF NOT EXISTS home_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zip TEXT NOT NULL,
  street_key TEXT NOT NULL DEFAULT '',
  street_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, zip, street_key)
);
CREATE INDEX IF NOT EXISTS idx_home_claims_area ON home_claims(zip, street_key);

-- A member's NON-BINDING standing interest ("Not an offer to purchase"): terms only, no free text, nothing about
-- the person. target_kind 'area' = a ZIP (+ optional street name); 'pre_listing' = one pre-listing on the site.
-- Never public: only matching owners see it. expires_at: 90 days after it was posted or renewed.
CREATE TABLE IF NOT EXISTS standing_interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('area','pre_listing')),
  zip TEXT NOT NULL DEFAULT '',
  street_key TEXT NOT NULL DEFAULT '',
  street_label TEXT NOT NULL DEFAULT '',
  pre_listing_id INTEGER REFERENCES pre_listings(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK(amount > 0),
  property_type TEXT NOT NULL DEFAULT 'Any',
  min_beds INTEGER NOT NULL DEFAULT 0,
  financing TEXT NOT NULL DEFAULT 'either' CHECK(financing IN ('cash','financed','either')),
  timing TEXT NOT NULL DEFAULT 'flexible' CHECK(timing IN ('3_months','6_months','12_months','flexible')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_standing_interests_user ON standing_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_standing_interests_area ON standing_interests(zip, status);
CREATE INDEX IF NOT EXISTS idx_standing_interests_pre_listing ON standing_interests(pre_listing_id) WHERE pre_listing_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 12. Test-Drive Trade (tradeTrials.js). Two owners of a mutual trade match record that both said yes to a short
-- trial stay, the dates (Pacific dates) and the checklist each confirmed. Not a contract; no money fields.
-- listing_a_id < listing_b_id (the transaction_requests rule). canceled_by_user_id has no REFERENCES on purpose (a
-- foreign key with no ON DELETE rule would block that person's account deletion).
CREATE TABLE IF NOT EXISTS trade_trials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_a_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_b_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK(nights BETWEEN 1 AND 90),
  long_stay INTEGER NOT NULL DEFAULT 0,
  checklist_a_json TEXT NOT NULL DEFAULT '[]',
  checklist_b_json TEXT NOT NULL DEFAULT '[]',
  a_agreed_at TEXT,
  b_agreed_at TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','agreed','canceled')),
  canceled_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listing_a_id, listing_b_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_trials_user_a ON trade_trials(user_a_id);
CREATE INDEX IF NOT EXISTS idx_trade_trials_user_b ON trade_trials(user_b_id);

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Easement Ideas (dealOutlines.js). A NON-BINDING idea outline in the owner's own words: "Not an easement. A real
-- one is written by an attorney and recorded." kind 'co_ownership' outlines are never listed (listed stays 0).
-- term_option: the ladder the owner picked from (month_to_month is where the form starts). No address, no APN.
CREATE TABLE IF NOT EXISTS deal_outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('space','access','view_sun','co_ownership')),
  use_key TEXT NOT NULL DEFAULT '',
  use_note TEXT NOT NULL DEFAULT '',
  area_note TEXT NOT NULL DEFAULT '',
  sketch_json TEXT NOT NULL DEFAULT '{}',
  term_option TEXT NOT NULL DEFAULT 'month_to_month' CHECK(term_option IN ('month_to_month','lease_3yr','recorded_easement','long_lease','co_2_4','co_5_plus','co_time_based')),
  ask_amount INTEGER,
  ask_per TEXT NOT NULL DEFAULT '' CHECK(ask_per IN ('','day','month','year','once')),
  questions_json TEXT NOT NULL DEFAULT '[]',
  zip TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'CA',
  listed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deal_outlines_user ON deal_outlines(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_outlines_area ON deal_outlines(zip, listed);

-- 2. Open For (openFor.js). Uses an owner would consider hearing about on a property ("Not an offer to lease"):
-- no price, no term, no promise. uses_json: array of use keys; facts_json: a few fixed-choice facts + the
-- long-lease acknowledgment. No address.
CREATE TABLE IF NOT EXISTS open_for (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_kind TEXT NOT NULL DEFAULT 'home' CHECK(property_kind IN ('home','vacant_lot','rural_land','commercial')),
  zip TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'CA',
  uses_json TEXT NOT NULL DEFAULT '[]',
  facts_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_open_for_user ON open_for(user_id);
CREATE INDEX IF NOT EXISTS idx_open_for_area ON open_for(zip, status);

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Step-Down Price (stepDown.js), trade listings only. step_down_json: the owner's published schedule
-- ({ startPrice, stepAmount, stepDays, steps, startDate }); '{}' = none. step_next_at: when the next step is due
-- (NULL = no schedule, or the last step has passed); the lazy job reads it through the partial index.
ALTER TABLE listings ADD COLUMN step_down_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE listings ADD COLUMN step_next_at TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_step_next ON listings(step_next_at) WHERE step_next_at IS NOT NULL;

-- 6. Terms Wishlist (listingTerms.js): the seller's ranked non-price terms, fixed keys only (never free text).
ALTER TABLE listings ADD COLUMN terms_wishlist_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pre_listings ADD COLUMN terms_wishlist_json TEXT NOT NULL DEFAULT '[]';

-- 10. Owner Will Carry (listingTerms.js): two yes/no flags as the owner states them. No rate, amount, term or
-- payment is stored anywhere.
ALTER TABLE listings ADD COLUMN owner_carry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN assumable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_listings ADD COLUMN owner_carry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_listings ADD COLUMN assumable INTEGER NOT NULL DEFAULT 0;
-- Saved searches: 1 = owner open to seller financing, 2 = loan may be assumable.
ALTER TABLE saved_searches ADD COLUMN deal_flags INTEGER NOT NULL DEFAULT 0;

-- 11. Sell and Stay: no schema change (it reads pre_listings.stay_after_days from migration_v44).

-- ---------------------------------------------------------------------------------------------------------------
-- 7. True Cost to Run, 8. Will It Fit?, 9. Signal Map (homeData.js): owner-entered, '{}' = nothing entered.
ALTER TABLE listings ADD COLUMN run_costs_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE listings ADD COLUMN fit_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE listings ADD COLUMN signal_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pre_listings ADD COLUMN run_costs_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pre_listings ADD COLUMN fit_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pre_listings ADD COLUMN signal_json TEXT NOT NULL DEFAULT '{}';
