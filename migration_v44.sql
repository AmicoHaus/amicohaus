-- Batch R3-1b: Timing Match, Ready Meter, Opinion Refresh (price opinion history).

-- Timing Match. The owner's ideal closing window (Pacific calendar dates 'YYYY-MM-DD', both set or both NULL) and how
-- many days they'd like to stay after closing (the app offers 0, 7, 14 or 29). Capped at 29 here too: a stay of 30
-- days or more can create a tenancy, and the agents write any rent-back terms. No money is ever stored for it.
ALTER TABLE pre_listings ADD COLUMN close_from TEXT;
ALTER TABLE pre_listings ADD COLUMN close_to TEXT;
ALTER TABLE pre_listings ADD COLUMN stay_after_days INTEGER NOT NULL DEFAULT 0 CHECK(stay_after_days BETWEEN 0 AND 29);
-- The buyer's side, on a saved search: the move-in window they need and how many stay-after days they could offer.
ALTER TABLE saved_searches ADD COLUMN move_from TEXT;
ALTER TABLE saved_searches ADD COLUMN move_to TEXT;
ALTER TABLE saved_searches ADD COLUMN stay_offer_days INTEGER NOT NULL DEFAULT 0 CHECK(stay_offer_days BETWEEN 0 AND 29);

-- Ready Meter. share_readiness: the owner chose to show approved agents their progress (listing-ready count, target
-- list month) and their check-in band; off unless they turn it on. ready_reminders_off: no weekly check-in nudge.
-- ready_nudge_week: the Pacific week (its Monday, 'YYYY-MM-DD') the nudge job last claimed this home;
-- ready_nudges_unanswered: nudges in a row with no check-in (the job stops at 3; a check-in resets it to 0).
ALTER TABLE pre_listings ADD COLUMN share_readiness INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_listings ADD COLUMN ready_reminders_off INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_listings ADD COLUMN ready_nudge_week TEXT;
ALTER TABLE pre_listings ADD COLUMN ready_nudges_unanswered INTEGER NOT NULL DEFAULT 0;
-- The owner's weekly two-tap check-in. Private to the owner (admins see only totals across 20+ homeowners). One per
-- home per Pacific week (week_key = that week's Monday); a changed answer the same week replaces it. readiness (1-5)
-- and topic are checked in code (functions/_lib/readyMeter.js), so a reworded topic never needs a table rebuild.
CREATE TABLE IF NOT EXISTS pre_listing_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  readiness INTEGER NOT NULL,
  topic TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pre_listing_id, week_key)
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_checkins_updated ON pre_listing_checkins(updated_at);

-- Opinion Refresh. When the owner last asked their agents for a fresh look (datetime('now') text); one round per 90
-- days is claimed with a conditional UPDATE on this column.
ALTER TABLE pre_listings ADD COLUMN opinions_refreshed_at TEXT;
-- Each agent asked in a round (asked_at = that round's opinions_refreshed_at) and their answer. Seen only by the
-- owner and that agent.
CREATE TABLE IF NOT EXISTS pre_listing_opinion_asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asked_at TEXT NOT NULL,
  answer TEXT CHECK(answer IN ('same','update')),
  answered_at TEXT,
  UNIQUE(pre_listing_id, agent_user_id, asked_at)
);
CREATE INDEX IF NOT EXISTS idx_opinion_asks_agent ON pre_listing_opinion_asks(agent_user_id, asked_at);
-- Every version of an agent's price opinion on a home: the owner's private per-agent history. Never averaged across
-- agents and never published. source: 'first' (their first number, or the number on file when history began),
-- 'edit' (changed on the opinion form), 'same' / 'update' (answers to a refresh). comp_json: an optional new
-- comparable sale given with an update. ask_id: the refresh ask it answered (informational, no foreign key).
-- No storage (R2) keys here.
CREATE TABLE IF NOT EXISTS pre_listing_opinion_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_opinion INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('first','edit','same','update')),
  reason TEXT NOT NULL DEFAULT '',
  comp_json TEXT,
  ask_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_opinion_versions_home ON pre_listing_opinion_versions(pre_listing_id, agent_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_opinion_versions_agent ON pre_listing_opinion_versions(agent_user_id);
