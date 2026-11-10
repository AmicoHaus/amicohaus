-- Batch "owner tools/content" (migration_v45): Share Your Moment, Mystery Home Monday, Privacy Sweep, Then & Now,
-- visit feedback, the Monday seller report and the handoff binder. Video twin pages need no table (static module).
-- Applies on v44 (R3-1b). Only ADD COLUMN, CREATE TABLE and CREATE INDEX.

-- Share Your Moment. awarded_at: when the owner hired (datetime('now') text, set by acceptBid for pre-listings only;
-- NULL on homes awarded before v45, so the "picked 1 in N days" slide is simply left out for them).
ALTER TABLE pre_listings ADD COLUMN awarded_at TEXT;
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

-- Privacy Sweep. When the OWNER ticked "I checked this photo" on their device before it uploaded (datetime('now')
-- text). Shown to the owner only; never to agents as a badge or a promise. No regions or originals are stored.
ALTER TABLE pre_listing_photos ADD COLUMN swept_at TEXT;

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
-- The in-app "how did the visit go?" prompt goes once per visit (lazy job claim, datetime('now') text).
ALTER TABLE pre_listing_showings ADD COLUMN feedback_asked_at TEXT;
ALTER TABLE pre_listing_preview_rsvps ADD COLUMN feedback_asked_at TEXT;

-- Monday seller report (the owner's weekly email): opted out (one click from the email, or account settings), the
-- Monday (Pacific 'YYYY-MM-DD') it was last claimed for, and failed tries this week (up to 3, like the scorecard).
ALTER TABLE users ADD COLUMN seller_report_opt_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN seller_report_week TEXT;
ALTER TABLE users ADD COLUMN seller_report_failures INTEGER NOT NULL DEFAULT 0;

-- Handoff binder: the owner's own house manual (owner notes, not a disclosure) that they print or save as a PDF. The
-- site never sends it to anyone and never shows it to agents or in the admin UI. Checked in code
-- (functions/_lib/handoffBinder.js). No storage keys: photos are picked from the home's existing photos by id.
ALTER TABLE pre_listings ADD COLUMN binder_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pre_listings ADD COLUMN binder_updated_at TEXT;
