-- Seller-side stipulations on a pre-listing — informational preferences an
-- agent sees before bidding, same footing as occupancy/showing-notice
-- (nothing here is enforced or a binding contract term).
ALTER TABLE pre_listings ADD COLUMN min_years_experience INTEGER;
ALTER TABLE pre_listings ADD COLUMN preferred_language TEXT NOT NULL DEFAULT '';
ALTER TABLE pre_listings ADD COLUMN require_dedicated_contact INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_listings ADD COLUMN prefers_exclusive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_listings ADD COLUMN preferred_agreement_months INTEGER;

-- Agent-side specialty tags, certifications, languages, an additional
-- self-reported track-record figure, and whether they're a solo point of
-- contact — same self-reported/not-independently-verified footing as
-- license_number and the other track-record fields.
ALTER TABLE agent_profiles ADD COLUMN specialty_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN certifications TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_profiles ADD COLUMN languages_json TEXT NOT NULL DEFAULT '["English"]';
ALTER TABLE agent_profiles ADD COLUMN sale_to_list_ratio REAL;
ALTER TABLE agent_profiles ADD COLUMN solo_agent INTEGER NOT NULL DEFAULT 1;

-- A homeowner's saved agent-directory search — the reverse of the existing
-- new-request alert (functions/_lib/marketplaceNotify.js): instead of
-- agents being notified about a new request, a homeowner is notified when
-- an agent newly matches criteria they've saved. notified_agent_ids_json
-- tracks who's already been notified so a later profile edit doesn't
-- re-notify for the same agent.
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
-- alongside (not replacing) the existing loose agent_portfolio_photos
-- gallery — a more persuasive, comparable case study than a photo dump.
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
