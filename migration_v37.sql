-- Phase 2: seller prep tools on pre-listings.

-- "Before listing, I'd…": the prep an agent recommends (paint, landscaping, staging, repairs…), kept with their
-- sealed price opinion so only the homeowner sees it. The owner gets a combined list ranked by how many agents
-- recommend each item.
ALTER TABLE pre_listing_price_opinions ADD COLUMN prep_json TEXT NOT NULL DEFAULT '[]';

-- A short phone video walkthrough of the home, so agents can weigh in without a visit. Streamed to R2 like an
-- agent's intro video; only the owner and approved agents can watch it.
ALTER TABLE pre_listings ADD COLUMN video_r2_key TEXT;
ALTER TABLE pre_listings ADD COLUMN video_content_type TEXT;

-- The "get listing-ready" checklist (separate from the disclosure checklist, which saves its own list) and the
-- date the owner hopes to list by, which drives its countdown.
ALTER TABLE pre_listings ADD COLUMN listing_ready_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pre_listings ADD COLUMN target_list_date TEXT;

-- Broker preview windows: the owner opens a time when agents can walk through, and agents RSVP. (One-off showings
-- an agent asks for stay in pre_listing_showings.)
CREATE TABLE IF NOT EXISTS pre_listing_previews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_previews_listing ON pre_listing_previews(pre_listing_id, starts_at);

CREATE TABLE IF NOT EXISTS pre_listing_preview_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preview_id INTEGER NOT NULL REFERENCES pre_listing_previews(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(preview_id, agent_user_id)
);

-- "Interview your top 3": the owner asks up to 3 agents for a short interview, offering up to 3 time slots; the
-- agent picks one. The owner's scorecard (1-5 on standard questions, plus notes) is private to the owner.
CREATE TABLE IF NOT EXISTS pre_listing_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'video' CHECK(format IN ('phone','video','in_person')),
  slots_json TEXT NOT NULL DEFAULT '[]',
  chosen_slot TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','scheduled','done','canceled')),
  scores_json TEXT NOT NULL DEFAULT '{}',
  owner_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pre_listing_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_interviews_agent ON pre_listing_interviews(agent_user_id, status);
