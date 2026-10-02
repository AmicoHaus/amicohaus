-- Marketplace Phase 2: milestone checklists, admin-reviewed license photos,
-- reciprocal (agent-reviews-homeowner) reviews, dispute resolution, direct
-- agent invites, new-request alerts, and favorited agents.

-- Shared checklist for an awarded engagement (either request type) — no real
-- money changes hands here, just a status tracker both the homeowner and the
-- awarded agent can update, seeded with a default set when a bid is accepted.
CREATE TABLE IF NOT EXISTS bid_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL CHECK(request_type IN ('pre_listing','transaction')),
  request_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0,
  done_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bid_milestones_request ON bid_milestones(request_type, request_id);

-- Admin-reviewed license photo — Amico Haus still doesn't call any state
-- licensing board, but an admin can eyeball the uploaded photo against the
-- state's public lookup site and flip this flag. Self-reported text fields
-- (license_number etc.) are unaffected and keep their own disclaimers.
ALTER TABLE agent_profiles ADD COLUMN license_photo_r2_key TEXT;
ALTER TABLE agent_profiles ADD COLUMN license_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_profiles ADD COLUMN license_verified_at TEXT;
ALTER TABLE agent_profiles ADD COLUMN license_verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Opt out of "a new request opened near you" notifications — defaults on.
ALTER TABLE agent_profiles ADD COLUMN notify_new_requests INTEGER NOT NULL DEFAULT 1;

-- Reciprocal side of agent_reviews — lets the awarded agent rate the
-- homeowner(s) they worked with. For a transaction (two homeowners), the
-- agent leaves one row per homeowner since they're rated independently.
CREATE TABLE IF NOT EXISTS homeowner_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homeowner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK(request_type IN ('pre_listing','transaction')),
  request_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_type, request_id, reviewer_user_id, homeowner_user_id)
);
CREATE INDEX IF NOT EXISTS idx_homeowner_reviews_user ON homeowner_reviews(homeowner_user_id);

-- Admin-mediated disputes over an awarded engagement — either the homeowner
-- or the agent can raise one; an admin resolves it out-of-band (this just
-- tracks status, it isn't a payments/refund mechanism).
CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL CHECK(request_type IN ('pre_listing','transaction')),
  request_id INTEGER NOT NULL,
  raised_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  against_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  admin_notes TEXT NOT NULL DEFAULT '',
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_disputes_request ON disputes(request_type, request_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

-- A homeowner privately inviting one specific approved agent to bid, instead
-- of (or alongside) the open marketplace — the agent still submits a normal
-- service_bids proposal, this just puts the request on their radar even if
-- it's outside their usual browse filters.
CREATE TABLE IF NOT EXISTS agent_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL CHECK(request_type IN ('pre_listing','transaction')),
  request_id INTEGER NOT NULL,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','responded','declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_type, request_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_invites_agent ON agent_invites(agent_user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_invites_request ON agent_invites(request_type, request_id);

-- A homeowner bookmarking an agent from a past engagement to fast-invite
-- them next time, instead of re-running the open marketplace.
CREATE TABLE IF NOT EXISTS favorite_agents (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_favorite_agents_agent ON favorite_agents(agent_user_id);
