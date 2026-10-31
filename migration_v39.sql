-- Batch B1: Decision Night, Pitch Reels and finalist feedback.

-- Decision Night: the homeowner picks a time and every proposal opens to them at once, so early proposals don't set
-- the bar. Until then they see only how many came in. Stored as an ISO time (UTC). proposals_open_notified_at is
-- when the homeowner was told their proposals are open (set once, so they're told once).
ALTER TABLE pre_listings ADD COLUMN proposals_due_at TEXT;
ALTER TABLE pre_listings ADD COLUMN proposals_open_notified_at TEXT;

-- Pitch Reels: each proposal can carry a 15-60 second video pitch for that home, which only the homeowner (and the
-- agent who made it) can watch. owner_pick is the homeowner's private shortlist / pass from swiping through them.
ALTER TABLE service_bids ADD COLUMN pitch_video_r2_key TEXT;
ALTER TABLE service_bids ADD COLUMN pitch_video_content_type TEXT;
ALTER TABLE service_bids ADD COLUMN owner_pick TEXT CHECK(owner_pick IN ('shortlist','pass'));
-- When the proposal was last sent (first send, edit or re-send). created_at stays the first send, which proposal
-- speed is measured from; this one decides "sent after your Decision Night".
ALTER TABLE service_bids ADD COLUMN submitted_at TEXT;

-- Finalist feedback: after hiring, the homeowner can send the finalists they didn't pick (interviewed or
-- shortlisted) up to 3 reasons from a preset list of what tipped the decision. Never a fee or a number.
CREATE TABLE IF NOT EXISTS finalist_debriefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pre_listing_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_finalist_debriefs_agent ON finalist_debriefs(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_pre_listings_proposals_due ON pre_listings(proposals_due_at) WHERE proposals_open_notified_at IS NULL;
