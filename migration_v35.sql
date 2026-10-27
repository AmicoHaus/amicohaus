-- Where signups and contact-form leads came from, for reading ad and video results back later:
-- signup_intent is the side they picked at signup (homeowner / agent), and signup_source / source hold a
-- small JSON object of the campaign tags, ad click ids, landing page and referring site from the link
-- they first arrived on (functions/_lib/attribution.js). All optional; older rows stay NULL.
ALTER TABLE users ADD COLUMN signup_intent TEXT;
ALTER TABLE users ADD COLUMN signup_source TEXT;
ALTER TABLE leads ADD COLUMN source TEXT;

-- One row per "new pre-listing" / "new agent application" email sent to Rudy (functions/_lib/adminAlerts.js),
-- so the daily caps can't be reset by deleting a pre-listing and posting it again.
CREATE TABLE IF NOT EXISTS admin_alerts_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_sent_user ON admin_alerts_sent(user_id, created_at);
