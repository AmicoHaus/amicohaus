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
  signup_intent TEXT,
  signup_source TEXT,
  verify_code_hash TEXT,
  verify_code_attempts INTEGER NOT NULL DEFAULT 0,
  verify_sent_at TEXT,
  -- You're in Control (migration_v42): how agents can message this person, email/push quiet hours (Pacific HH:MM),
  -- and whether the phone number is shown publicly (private by default).
  contact_mode TEXT NOT NULL DEFAULT 'open' CHECK(contact_mode IN ('open','weekly','quiet')),
  quiet_start TEXT,
  quiet_end TEXT,
  phone_public INTEGER NOT NULL DEFAULT 0,
  -- Which Terms/Privacy version they agreed to at signup, and when (migration_v43).
  terms_version TEXT,
  terms_accepted_at TEXT,
  -- Monday seller report (migration_v45): opted out, the Monday it was last claimed for, failed tries this week.
  seller_report_opt_out INTEGER NOT NULL DEFAULT 0,
  seller_report_week TEXT,
  seller_report_failures INTEGER NOT NULL DEFAULT 0,
  -- Spanish pages (migration_v46): the person's own display language. Private: never used for matching, alerts, filters, lists or counts.
  ui_lang TEXT NOT NULL DEFAULT 'en' CHECK(ui_lang IN ('en','es')),
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
  mello_roos_annual INTEGER,
  hoa_monthly INTEGER,
  hoa_details_json TEXT NOT NULL DEFAULT '{}',
  -- Home facts (migration_v46, homeFacts.js): owner-entered yard/sun, parking/garage, pets; '{}' = nothing entered.
  home_facts_json TEXT NOT NULL DEFAULT '{}',
  -- Floor-plan twins (migration_v46, planTwins.js): what the owner typed; listed with same-plan homes only when plan_twins = 1.
  plan_builder TEXT,
  plan_name TEXT,
  plan_community TEXT,
  plan_key TEXT,
  plan_twins INTEGER NOT NULL DEFAULT 0,
  -- Paused by an admin (moderation): only an admin can make it active again (migration_v43).
  hidden_at TEXT,
  hidden_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
-- migration_v46
CREATE INDEX IF NOT EXISTS idx_listings_plan_key ON listings(plan_key);

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
  -- Deal threads: a discussion attaches to a listing/home/project via a lazily-created anchor post,
  -- reusing this same posts/comments system -- mirrors listing_id above for the three newer verticals.
  augmented_home_id INTEGER REFERENCES augmented_homes(id) ON DELETE CASCADE,
  green_home_id INTEGER REFERENCES green_homes(id) ON DELETE CASCADE,
  dev_project_id INTEGER REFERENCES dev_projects(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  -- Moderation hides instead of deleting (migration_v43).
  hidden_at TEXT,
  hidden_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_listing ON posts(listing_id);
CREATE INDEX IF NOT EXISTS idx_posts_augmented_home ON posts(augmented_home_id);
CREATE INDEX IF NOT EXISTS idx_posts_green_home ON posts(green_home_id);
CREATE INDEX IF NOT EXISTS idx_posts_dev_project ON posts(dev_project_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  -- Moderation hides instead of deleting (migration_v43).
  hidden_at TEXT,
  hidden_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
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
  -- past_client_review: a review from an agent's past client (migration_v43).
  target_type TEXT NOT NULL CHECK(target_type IN ('post','comment','listing','user','past_client_review')),
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
  read_at TEXT,
  -- Weekly contact mode (migration_v42): held until deliver_after (UTC, datetime('now') format); released_at = when
  -- the weekly delivery announced it.
  deliver_after TEXT,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_held ON messages(deliver_after) WHERE deliver_after IS NOT NULL AND released_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  emailed_at TEXT, -- set when this notification produced (or queued) an email: the per-person email cap counts these
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_emailed ON notifications(user_id, emailed_at) WHERE emailed_at IS NOT NULL;

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
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per "new pre-listing" / "new agent application" email sent to Rudy (functions/_lib/adminAlerts.js),
-- so the daily caps can't be reset by deleting a pre-listing and posting it again.
CREATE TABLE IF NOT EXISTS admin_alerts_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_sent_user ON admin_alerts_sent(user_id, created_at);

CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locations TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT 'Any',
  price_min INTEGER NOT NULL DEFAULT 0,
  price_max INTEGER NOT NULL DEFAULT 0,
  -- Timing Match (migration_v44): the move-in window this buyer needs and the stay-after days they could offer.
  move_from TEXT,
  move_to TEXT,
  stay_offer_days INTEGER NOT NULL DEFAULT 0 CHECK(stay_offer_days BETWEEN 0 AND 29),
  -- Toy-box (migration_v46): flags 1 RV/boat, 2 side access, 4 workshop, 8 240V/EV; minimums.
  toy_flags INTEGER NOT NULL DEFAULT 0,
  min_gate_in INTEGER,
  min_garage INTEGER,
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
  -- Agreement to the agent rules in the Terms (migration_v43).
  rules_version TEXT,
  rules_accepted_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  -- Bring Your Reviews (migration_v40): the past-client review link and its period.
  review_invite_token TEXT,
  review_invite_from_year INTEGER,
  review_invite_to_year INTEGER,
  review_invite_attested_at TEXT,
  review_alert_sent_at TEXT,
  -- Farm Radar + Monday scorecard (migration_v41)
  duty_days_json TEXT,
  duty_start TEXT,
  duty_end TEXT,
  scorecard_opt_out INTEGER NOT NULL DEFAULT 0,
  scorecard_sent_week TEXT,
  scorecard_failures INTEGER NOT NULL DEFAULT 0
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
  mello_roos_annual INTEGER,
  hoa_monthly INTEGER,
  hoa_details_json TEXT NOT NULL DEFAULT '{}',
  -- Home facts (migration_v46, homeFacts.js): owner-entered yard/sun, parking/garage, pets; '{}' = nothing entered.
  home_facts_json TEXT NOT NULL DEFAULT '{}',
  video_r2_key TEXT,
  video_content_type TEXT,
  listing_ready_json TEXT NOT NULL DEFAULT '[]',
  target_list_date TEXT,
  -- Decision Night (migration_v39): proposals stay sealed from the owner until this ISO time.
  proposals_due_at TEXT,
  proposals_open_notified_at TEXT,
  -- Pause new proposals (migration_v42): agents with a proposal can still update it; no new ones start.
  proposals_paused INTEGER NOT NULL DEFAULT 0,
  -- Timing Match (migration_v44): ideal closing window (Pacific dates) and stay-after-closing days (capped at 29).
  close_from TEXT,
  close_to TEXT,
  stay_after_days INTEGER NOT NULL DEFAULT 0 CHECK(stay_after_days BETWEEN 0 AND 29),
  -- Ready Meter (migration_v44): progress sharing opt-in, weekly nudge settings and claim.
  share_readiness INTEGER NOT NULL DEFAULT 0,
  ready_reminders_off INTEGER NOT NULL DEFAULT 0,
  ready_nudge_week TEXT,
  ready_nudges_unanswered INTEGER NOT NULL DEFAULT 0,
  -- Opinion Refresh (migration_v44): when the owner last asked for fresh price opinions.
  opinions_refreshed_at TEXT,
  -- Share Your Moment (migration_v45): when the owner hired (datetime('now') text; NULL on older awards).
  awarded_at TEXT,
  -- Handoff binder (migration_v45): the owner's private house manual, checked in code (handoffBinder.js).
  binder_json TEXT NOT NULL DEFAULT '{}',
  binder_updated_at TEXT,
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
  -- Privacy Sweep (migration_v45): the owner ticked "I checked this photo" before it uploaded. Owner-only.
  swept_at TEXT,
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
  -- The other partner confirms before agents see the request or anyone is hired (migration_v43).
  partner_confirmed_at TEXT,
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
  -- Pitch Reels (migration_v39): a short owner-only video pitch, and the owner's private shortlist / pass.
  pitch_video_r2_key TEXT,
  pitch_video_content_type TEXT,
  owner_pick TEXT CHECK(owner_pick IN ('shortlist','pass')),
  submitted_at TEXT,
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
  prep_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pre_listing_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_opinions_listing ON pre_listing_price_opinions(pre_listing_id);

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
  -- Visit feedback (migration_v45): the in-app "how did the visit go?" prompt went out (lazy job claim).
  feedback_asked_at TEXT,
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

-- Founding agents: the first 3 approved agents who list a given service ZIP (in the ZIPs Amico Haus is launching
-- in) get a "Founding agent" ribbon for that ZIP while they stay approved and keep serving it (see LIVE_FOUNDERS_SQL
-- in functions/_lib/zipBoard.js). Recognition only: no ranking boost, no head start.
-- In return they aim to send a price opinion within 48 hours on new pre-listings in that ZIP.
CREATE TABLE IF NOT EXISTS founding_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zip TEXT NOT NULL,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(zip, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_founding_agents_agent ON founding_agents(agent_user_id);

CREATE TABLE IF NOT EXISTS pre_listing_showings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','canceled')),
  -- Visit feedback (migration_v45): the in-app "how did the visit go?" prompt went out (lazy job claim).
  feedback_asked_at TEXT,
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
  life_event_tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','under_contract','sold','withdrawn')),
  mello_roos_annual INTEGER,
  hoa_monthly INTEGER,
  hoa_details_json TEXT NOT NULL DEFAULT '{}',
  -- Home facts (migration_v46, homeFacts.js): owner-entered yard/sun, parking/garage, pets; '{}' = nothing entered.
  home_facts_json TEXT NOT NULL DEFAULT '{}',
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

-- Price-change transparency, mirroring pre_listing_price_history.
CREATE TABLE IF NOT EXISTS augmented_home_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  old_price INTEGER NOT NULL,
  new_price INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_price_history_home ON augmented_home_price_history(augmented_home_id);

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

-- Same pattern, for GreenHomes' green-feature taxonomy instead of AugmentedHomes' adaptations.
CREATE TABLE IF NOT EXISTS green_needs_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  green_features_json TEXT NOT NULL DEFAULT '[]',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  notified_home_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_needs_alerts_user ON green_needs_alerts(user_id);

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
  adaptations_json TEXT NOT NULL DEFAULT '[]',
  green_features_json TEXT NOT NULL DEFAULT '[]',
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
  -- Open-house route (migration_v46): owner shares the street address with RSVPs (24 h before start until end).
  share_address_with_rsvps INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_open_houses_listing ON open_houses(listing_id);
CREATE INDEX IF NOT EXISTS idx_open_houses_starts ON open_houses(starts_at);

-- Marks an open house as already having had its RSVP reminder email sent, so a scheduled job (content/
-- dispatcher built in functions/_lib/openHouseReminders.js, but NOT yet wired to a live Cron Trigger --
-- that's a separate decision, same reasoning as weeklyDigest.js) never double-sends to the same RSVPs.
-- One generic table across all 3 open-house kinds rather than a column on each of the 3 tables.
CREATE TABLE IF NOT EXISTS open_house_reminders_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('listing','augmented_home','green_home')),
  open_house_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_kind, open_house_id)
);

CREATE TABLE IF NOT EXISTS open_house_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_house_id INTEGER NOT NULL REFERENCES open_houses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Open-house route (migration_v46): 1 = RSVP'd after being told the owner sees their name; 0 = before (count only).
  rsvp_named INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(open_house_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_open_house_rsvps_oh ON open_house_rsvps(open_house_id);
-- migration_v46
CREATE INDEX IF NOT EXISTS idx_open_house_rsvps_user ON open_house_rsvps(user_id);

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
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','countered','accepted','declined','withdrawn')),
  counter_price INTEGER,
  counter_message TEXT NOT NULL DEFAULT '',
  -- Which side proposed the current counter_price/counter_message, so the other side's response options
  -- (accept/decline/counter back) are gated correctly across any number of negotiation rounds.
  countered_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listing_offers_listing ON listing_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_offers_buyer ON listing_offers(buyer_user_id);

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
  life_event_tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','under_contract','sold','withdrawn')),
  mello_roos_annual INTEGER,
  hoa_monthly INTEGER,
  hoa_details_json TEXT NOT NULL DEFAULT '{}',
  -- Home facts (migration_v46, homeFacts.js): owner-entered yard/sun, parking/garage, pets; '{}' = nothing entered.
  home_facts_json TEXT NOT NULL DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS green_home_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  old_price INTEGER NOT NULL,
  new_price INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_home_price_history_home ON green_home_price_history(green_home_id);

-- Offers on AugmentedHomes and GreenHomes, mirroring listing_offers exactly (including multi-round counters).
CREATE TABLE IF NOT EXISTS augmented_home_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price INTEGER NOT NULL,
  financing_type TEXT NOT NULL DEFAULT 'financed' CHECK(financing_type IN ('cash','financed')),
  closing_timeline TEXT NOT NULL DEFAULT '',
  contingencies TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','countered','accepted','declined','withdrawn')),
  counter_price INTEGER,
  counter_message TEXT NOT NULL DEFAULT '',
  countered_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_offers_home ON augmented_home_offers(augmented_home_id);
CREATE INDEX IF NOT EXISTS idx_augmented_home_offers_buyer ON augmented_home_offers(buyer_user_id);

CREATE TABLE IF NOT EXISTS green_home_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price INTEGER NOT NULL,
  financing_type TEXT NOT NULL DEFAULT 'financed' CHECK(financing_type IN ('cash','financed')),
  closing_timeline TEXT NOT NULL DEFAULT '',
  contingencies TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','countered','accepted','declined','withdrawn')),
  counter_price INTEGER,
  counter_message TEXT NOT NULL DEFAULT '',
  countered_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_home_offers_home ON green_home_offers(green_home_id);
CREATE INDEX IF NOT EXISTS idx_green_home_offers_buyer ON green_home_offers(buyer_user_id);

-- Open houses on AugmentedHomes and GreenHomes, mirroring open_houses/open_house_rsvps exactly.
CREATE TABLE IF NOT EXISTS augmented_home_open_houses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  -- Open-house route (migration_v46): owner shares the street address with RSVPs (24 h before start until end).
  share_address_with_rsvps INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_houses_home ON augmented_home_open_houses(augmented_home_id);
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_houses_starts ON augmented_home_open_houses(starts_at);

CREATE TABLE IF NOT EXISTS augmented_home_open_house_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_house_id INTEGER NOT NULL REFERENCES augmented_home_open_houses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Open-house route (migration_v46): 1 = RSVP'd after being told the owner sees their name; 0 = before (count only).
  rsvp_named INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(open_house_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_house_rsvps_oh ON augmented_home_open_house_rsvps(open_house_id);
-- migration_v46
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_house_rsvps_user ON augmented_home_open_house_rsvps(user_id);

CREATE TABLE IF NOT EXISTS green_home_open_houses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  -- Open-house route (migration_v46): owner shares the street address with RSVPs (24 h before start until end).
  share_address_with_rsvps INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_green_home_open_houses_home ON green_home_open_houses(green_home_id);
CREATE INDEX IF NOT EXISTS idx_green_home_open_houses_starts ON green_home_open_houses(starts_at);

CREATE TABLE IF NOT EXISTS green_home_open_house_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  open_house_id INTEGER NOT NULL REFERENCES green_home_open_houses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Open-house route (migration_v46): 1 = RSVP'd after being told the owner sees their name; 0 = before (count only).
  rsvp_named INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(open_house_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_green_home_open_house_rsvps_oh ON green_home_open_house_rsvps(open_house_id);
-- migration_v46
CREATE INDEX IF NOT EXISTS idx_green_home_open_house_rsvps_user ON green_home_open_house_rsvps(user_id);

-- Favorites (bookmark a specific listing for later, distinct from a saved-search alert) for AugmentedHomes,
-- GreenHomes, and FinderMine -- regular listings already have this via listing_feedback 'up'. Also the
-- subscriber list for price-drop notifications on AugmentedHomes/GreenHomes.
CREATE TABLE IF NOT EXISTS augmented_home_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  augmented_home_id INTEGER NOT NULL REFERENCES augmented_homes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, augmented_home_id)
);
CREATE INDEX IF NOT EXISTS idx_augmented_home_favorites_user ON augmented_home_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_augmented_home_favorites_home ON augmented_home_favorites(augmented_home_id);

CREATE TABLE IF NOT EXISTS green_home_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  green_home_id INTEGER NOT NULL REFERENCES green_homes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, green_home_id)
);
CREATE INDEX IF NOT EXISTS idx_green_home_favorites_user ON green_home_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_green_home_favorites_home ON green_home_favorites(green_home_id);

CREATE TABLE IF NOT EXISTS dev_project_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dev_project_id INTEGER NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, dev_project_id)
);
CREATE INDEX IF NOT EXISTS idx_dev_project_favorites_user ON dev_project_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_project_favorites_project ON dev_project_favorites(dev_project_id);

-- FinderMine needs-alert: notify on a new matching project by type/city/state -- a project match is about
-- type and location, not a taxonomy of checkboxes like the accessibility/green-feature alerts.
CREATE TABLE IF NOT EXISTS dev_project_needs_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  project_type TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  notified_project_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_project_needs_alerts_user ON dev_project_needs_alerts(user_id);

-- Market Pulse: a real, append-only log of actual platform activity (new listings, price drops, accepted
-- offers, open houses) across all four marketplaces, for a trading-terminal-style ticker. Never simulated --
-- real estate has no continuous market, so this only ever logs events that actually happened.
CREATE TABLE IF NOT EXISTS market_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK(event_type IN ('new_listing','price_drop','offer_accepted','open_house_scheduled')),
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('listing','augmented_home','green_home','dev_project')),
  entity_id INTEGER NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL,
  amount INTEGER,
  delta INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_events_created ON market_events(created_at DESC);

-- Save a watch (each filter optional -- unset means "any") and get notified in-app the moment a matching
-- market event fires. Mirrors the shape of the other needs-alert tables.
CREATE TABLE IF NOT EXISTS market_pulse_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  event_type TEXT,
  entity_kind TEXT,
  city TEXT,
  state TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_pulse_alerts_user ON market_pulse_alerts(user_id);

-- Finalist feedback (migration_v39): up to 3 preset reasons a homeowner sends the finalists they didn't hire.
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

-- Bring Your Reviews (migration_v40)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_review_invite ON agent_profiles(review_invite_token) WHERE review_invite_token IS NOT NULL;
-- A review from someone the agent helped outside Amico Haus, kept apart from reviews of agents hired on Amico Haus.
-- The street address is private (only for checking against public sale records later); the profile shows the year,
-- city and which side they were on. The agent can't hide or delete these; only an admin can remove one (logged).
CREATE TABLE IF NOT EXISTS past_client_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  client_side TEXT NOT NULL CHECK(client_side IN ('sold','bought','both')),
  sale_year INTEGER NOT NULL,
  sale_city TEXT NOT NULL,
  sale_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed')),
  removed_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_user_id, reviewer_user_id)
);
CREATE INDEX IF NOT EXISTS idx_past_client_reviews_agent ON past_client_reviews(agent_user_id, status);

-- Farm Radar: emails held until an agent's next on-duty time (migration_v41)
CREATE TABLE IF NOT EXISTS held_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What it's about, so it's re-checked when it goes out: 'new_request' | 'interview' | 'scorecard' |
  -- 'opinion_refresh' (R3-1b) | 'seller_report' (v45), and ref like 'pre_listing:10' or 'transaction:4'.
  kind TEXT NOT NULL DEFAULT 'other',
  ref TEXT,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  deliver_after TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_held_emails_due ON held_emails(deliver_after) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_zip_codes_lat ON zip_codes(lat);

-- You're in Control (migration_v42)
-- "Share my contact info with this agent": that agent then sees the exact address, phone and email for this home.
-- shared_at is the record of when the owner chose to share (phone/text consent rules).
CREATE TABLE IF NOT EXISTS contact_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pre_listing_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_shares_agent ON contact_shares(agent_id);
CREATE INDEX IF NOT EXISTS idx_contact_shares_owner ON contact_shares(owner_id);

-- "Who saw my address": each agent the exact address was shown to, how (a contact share or a broker preview RSVP),
-- and when. Kept while the pre-listing exists; deleted with it.
CREATE TABLE IF NOT EXISTS address_views (
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  via TEXT NOT NULL CHECK(via IN ('share','preview')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  view_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (pre_listing_id, agent_id, via)
);

-- Batch L1 (migration_v43)
-- Per-person limits on actions that notify someone else (new conversations, messages, proposals, price opinions,
-- showing requests, broker-preview RSVPs, agent invites, saved searches, reports). Checked and recorded in one
-- statement (functions/_lib/rateLimits.js claimUserAction); rows older than 2 days are pruned by the lazy jobs.
-- kind is checked in code (no CHECK here, so new kinds don't need a table rebuild).
CREATE TABLE IF NOT EXISTS user_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_action_log ON user_action_log(user_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id, created_at);

-- Batch R3-1b (migration_v44)
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

-- Batch owner tools/content (migration_v45)
-- The owner's written OK for Rudy to repost their own recording of one moment ('reveal' = Reveal Mode, 'hired' = the
-- Hired! story). Never a reward. consent_version names the exact wording they agreed to; withdrawing sets
-- withdrawn_at (consenting again clears it and moves consented_at). Seen by the owner and the admin list only.
CREATE TABLE IF NOT EXISTS moment_repost_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moment TEXT NOT NULL CHECK(moment IN ('reveal','hired')),
  consent_version TEXT NOT NULL,
  consented_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  UNIQUE(pre_listing_id, moment)
);
CREATE INDEX IF NOT EXISTS idx_moment_repost_consents_user ON moment_repost_consents(user_id);

-- Mystery Home Monday. A home that already sold, entered by an admin only: Rudy's own closed sale with the seller's
-- written OK, or a former owner's volunteered home (their written OK, their photos). City only, never a street.
-- publish_at / reveal_at / retire_at are ISO strings compared with new Date().toISOString(); live and revealed are
-- worked out from them on read. sold_price never leaves the server before reveal_at. seller_ok_on and broker_ok_on
-- are the Pacific dates ('YYYY-MM-DD') the written OKs were received (the documents stay offline with Rudy); a home
-- can't be scheduled without both. Public guesses are never stored anywhere on the server.
CREATE TABLE IF NOT EXISTS mystery_homes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK(source IN ('own_sale','former_owner')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','retired')),
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'CA',
  property_type TEXT NOT NULL,
  beds REAL,
  baths REAL,
  sqft INTEGER,
  lot_sqft INTEGER,
  year_built INTEGER,
  highlights TEXT NOT NULL DEFAULT '',
  sold_price INTEGER NOT NULL CHECK(sold_price > 0),
  sold_month TEXT NOT NULL,
  publish_at TEXT,
  reveal_at TEXT,
  retire_at TEXT,
  seller_ok_on TEXT,
  broker_ok_on TEXT,
  photo_rights TEXT NOT NULL DEFAULT 'own' CHECK(photo_rights IN ('own','licensed')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mystery_homes_status ON mystery_homes(status, publish_at);
-- Its photos (R2 keys 'mystery/<homeId>/<uuid>'). swept_at: the admin ticked "I checked this photo" in Privacy Sweep.
CREATE TABLE IF NOT EXISTS mystery_home_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mystery_home_id INTEGER NOT NULL REFERENCES mystery_homes(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  swept_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mystery_home_photos_home ON mystery_home_photos(mystery_home_id, position);

-- Then & Now. The owner's own list of work done on their home: owner-reported, not a disclosure. Categories are
-- checked in code (functions/_lib/thenNow.js). No cost and no value is stored. permit: NULL = not answered; shown only
-- to the owner, the hired agent and agents the owner shared contact info with.
CREATE TABLE IF NOT EXISTS pre_listing_upgrades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  done_year INTEGER NOT NULL,
  done_month INTEGER CHECK(done_month IS NULL OR done_month BETWEEN 1 AND 12),
  note TEXT NOT NULL DEFAULT '',
  permit TEXT CHECK(permit IS NULL OR permit IN ('yes','no','not_sure')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_upgrades_home ON pre_listing_upgrades(pre_listing_id, position);
-- An old photo next to today's (drag slider). R2 keys 'pre-listing-then-now/<preListingId>/<uuid>', never exported.
CREATE TABLE IF NOT EXISTS pre_listing_then_now (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  upgrade_id INTEGER REFERENCES pre_listing_upgrades(id) ON DELETE SET NULL,
  caption TEXT NOT NULL DEFAULT '',
  then_year INTEGER,
  then_r2_key TEXT NOT NULL,
  then_content_type TEXT NOT NULL,
  now_r2_key TEXT NOT NULL,
  now_content_type TEXT NOT NULL,
  swept_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pre_listing_then_now_home ON pre_listing_then_now(pre_listing_id, position);

-- Visit feedback: an approved agent's three preset taps about the home after an accepted showing or a broker preview
-- they RSVP'd to. Seen only by the homeowner and the agent who wrote it; never public, never counted across agents or
-- homes, never on a profile or scorecard. visit_id is pre_listing_showings.id or pre_listing_previews.id (two tables,
-- so no foreign key; checked at write time). Answers are checked in code (functions/_lib/visitFeedback.js).
CREATE TABLE IF NOT EXISTS pre_listing_visit_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pre_listing_id INTEGER NOT NULL REFERENCES pre_listings(id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visit_kind TEXT NOT NULL CHECK(visit_kind IN ('showing','preview')),
  visit_id INTEGER NOT NULL,
  visit_at TEXT,
  skipped INTEGER NOT NULL DEFAULT 0,
  price TEXT,
  asking_price_at INTEGER,
  condition TEXT,
  top_prep TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(visit_kind, visit_id, agent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_visit_feedback_home ON pre_listing_visit_feedback(pre_listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_visit_feedback_agent ON pre_listing_visit_feedback(agent_user_id);
