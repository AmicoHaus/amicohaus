-- Amico Haus D1 schema
-- Apply with: wrangler d1 execute amicohaus --file=./schema.sql (or via the Cloudflare dashboard D1 console)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  verify_token_expires TEXT,
  email_confirmation_pending INTEGER NOT NULL DEFAULT 0,
  reset_token TEXT,
  reset_token_expires TEXT,
  totp_secret TEXT,
  totp_pending_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  referral_code TEXT,
  referred_by INTEGER,
  notify_matches INTEGER NOT NULL DEFAULT 1,
  email_frequency TEXT NOT NULL DEFAULT 'capped' CHECK(email_frequency IN ('every','capped')),
  phone TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  address TEXT,
  neighborhood TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  property_type TEXT NOT NULL,
  beds REAL NOT NULL DEFAULT 0,
  baths REAL NOT NULL DEFAULT 0,
  sqft INTEGER,
  estimated_value INTEGER NOT NULL,
  price_tier TEXT NOT NULL,
  show_exact_address INTEGER NOT NULL DEFAULT 0,
  external_links TEXT NOT NULL DEFAULT '[]',
  client_name TEXT,
  is_buyer_only INTEGER NOT NULL DEFAULT 0,
  is_rental INTEGER NOT NULL DEFAULT 0,
  rent_amount INTEGER NOT NULL DEFAULT 0,
  min_lease_months INTEGER NOT NULL DEFAULT 12,
  is_portfolio INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  life_event_tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);

CREATE TABLE IF NOT EXISTS desired_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
  locations TEXT NOT NULL,
  property_type TEXT NOT NULL,
  min_beds REAL NOT NULL DEFAULT 0,
  min_baths REAL NOT NULL DEFAULT 0,
  price_min INTEGER NOT NULL DEFAULT 0,
  price_max INTEGER NOT NULL DEFAULT 0,
  must_haves TEXT NOT NULL DEFAULT '',
  cash_mode TEXT NOT NULL DEFAULT 'none' CHECK(cash_mode IN ('none','pay','receive')),
  cash_amount INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deleted_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deleted_listings_user ON deleted_listings(user_id, deleted_at);

CREATE TABLE IF NOT EXISTS portfolio_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  member_listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_portfolio_members_portfolio ON portfolio_members(portfolio_listing_id);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('price_tier','location')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(type, key)
);

CREATE TABLE IF NOT EXISTS group_memberships (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('login','signup','forgot_password')),
  ip TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(kind, ip, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('post','comment','listing','user')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS listing_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listing_photos_listing ON listing_photos(listing_id, position);

CREATE TABLE IF NOT EXISTS pending_2fa (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locations TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT 'Any',
  price_min INTEGER NOT NULL DEFAULT 0,
  price_max INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 'up' = saved/favorited (shown in the app's Saved tab), 'down' = hidden from
-- the viewer's own directory browsing. One row per (user, listing): a later
-- vote just flips the existing row rather than accumulating history.
CREATE TABLE IF NOT EXISTS listing_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  feedback TEXT NOT NULL CHECK(feedback IN ('up','down')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_listing_feedback_user ON listing_feedback(user_id, feedback);

-- Thumbs up/down on a match, keyed by the pair of listing ids (always stored
-- with the smaller id first so a lookup doesn't need to check both orders).
-- Either direction archives the match out of the user's active Matches feed.
CREATE TABLE IF NOT EXISTS match_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_a_id INTEGER NOT NULL,
  listing_b_id INTEGER NOT NULL,
  feedback TEXT NOT NULL CHECK(feedback IN ('up','down')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, listing_a_id, listing_b_id)
);
CREATE INDEX IF NOT EXISTS idx_match_feedback_user ON match_feedback(user_id);

-- Web Push (VAPID) subscriptions. p256dh/auth are unused today since push
-- messages are sent with an empty payload (see functions/_lib/webpush.js) —
-- kept anyway since PushSubscription always includes them, in case payload
-- encryption (RFC 8291) is added later.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
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
  service_zips_json TEXT NOT NULL DEFAULT '[]',
  open_house_days_json TEXT NOT NULL DEFAULT '[]',
  avg_days_on_market INTEGER,
  homes_sold_last_year INTEGER,
  license_photo_r2_key TEXT,
  license_verified INTEGER NOT NULL DEFAULT 0,
  license_verified_at TEXT,
  license_verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notify_new_requests INTEGER NOT NULL DEFAULT 1,
  specialty_tags_json TEXT NOT NULL DEFAULT '[]',
  certifications TEXT NOT NULL DEFAULT '',
  languages_json TEXT NOT NULL DEFAULT '["English"]',
  sale_to_list_ratio REAL,
  solo_agent INTEGER NOT NULL DEFAULT 1,
  accepting_clients INTEGER NOT NULL DEFAULT 1,
  carries_eo_insurance INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT
);

-- Static reference data (US ZCTA centroids) for the haversine service-area
-- check in functions/_lib/geo.js — populated separately via
-- zip_codes_data.sql (~33.8k rows), not part of this schema file itself.
CREATE TABLE IF NOT EXISTS zip_codes (
  zip TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL
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
  zip TEXT NOT NULL DEFAULT '',
  occupancy_status TEXT NOT NULL DEFAULT 'occupied' CHECK(occupancy_status IN ('occupied','vacant')),
  showing_notice_hours INTEGER NOT NULL DEFAULT 0,
  special_instructions TEXT NOT NULL DEFAULT '',
  min_years_experience INTEGER,
  preferred_language TEXT NOT NULL DEFAULT '',
  require_dedicated_contact INTEGER NOT NULL DEFAULT 0,
  prefers_exclusive INTEGER NOT NULL DEFAULT 0,
  preferred_agreement_months INTEGER,
  prefers_local_specialist INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','awarded','closed')),
  awarded_bid_id INTEGER,
  disclosure_checklist_json TEXT NOT NULL DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS pre_listing_showings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','canceled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_showings_listing ON pre_listing_showings(pre_listing_id);
CREATE INDEX IF NOT EXISTS idx_pre_listing_showings_agent ON pre_listing_showings(agent_user_id);

-- Agent teams/brokerages — an agent belongs to at most one team at a time.
CREATE TABLE IF NOT EXISTS agent_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active')),
  invited_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_team_members_team ON agent_team_members(team_id);

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

-- Basic/Standard/Premium service packages an agent defines once on their own
-- profile (a preset, Fiverr-gig style), rather than re-describing "what's
-- included" on every custom proposal. Purely informational/comparison
-- pricing, same as every other fee figure in this marketplace — no payment
-- moves through Amico Haus because of this table.
CREATE TABLE IF NOT EXISTS agent_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK(tier IN ('basic','standard','premium')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  commission_pct REAL,
  flat_fee INTEGER,
  services_json TEXT NOT NULL DEFAULT '[]',
  turnaround_days INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_user_id, tier)
);
CREATE INDEX IF NOT EXISTS idx_agent_packages_agent ON agent_packages(agent_user_id);

-- A homeowner's saved agent-directory search — the reverse of the new-request
-- alert: instead of agents being notified about a new request, a homeowner
-- is notified when an agent newly matches criteria they've saved.
CREATE TABLE IF NOT EXISTS agent_search_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  filters_json TEXT NOT NULL DEFAULT '{}',
  notified_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_search_alerts_user ON agent_search_alerts(user_id);

-- Structured before/after portfolio pairs tied to a specific past sale,
-- alongside (not replacing) the looser agent_portfolio_photos gallery.
CREATE TABLE IF NOT EXISTS agent_case_studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  result_note TEXT NOT NULL DEFAULT '',
  before_r2_key TEXT NOT NULL,
  before_content_type TEXT NOT NULL,
  after_r2_key TEXT NOT NULL,
  after_content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_case_studies_agent ON agent_case_studies(agent_user_id, position);

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
