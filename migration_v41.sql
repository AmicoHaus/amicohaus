-- Batch B3: Farm Radar (on-duty hours) and the Monday agent scorecard.

-- On-duty hours, in Pacific time: which days (JSON array, 0 = Sunday) and from/until ("08:00" / "18:00"). In-app
-- alerts still reach every agent at the same moment; emails that arrive while an agent is off duty wait in
-- held_emails until their next on-duty time. NULL days = no duty hours set (emails go out right away, as before).
ALTER TABLE agent_profiles ADD COLUMN duty_days_json TEXT;
ALTER TABLE agent_profiles ADD COLUMN duty_start TEXT;
ALTER TABLE agent_profiles ADD COLUMN duty_end TEXT;

-- The Monday scorecard email: opted out (one click from the email, or from the dashboard), and the Monday (Pacific
-- date) it was last sent for, so each agent gets one per week.
ALTER TABLE agent_profiles ADD COLUMN scorecard_opt_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_profiles ADD COLUMN scorecard_sent_week TEXT;

CREATE TABLE IF NOT EXISTS held_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What it's about, so it's re-checked when it goes out: 'new_request' | 'interview' | 'scorecard', and ref like
  -- 'pre_listing:10' or 'transaction:4'.
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

-- The scorecard finds ZIPs near an agent with a latitude/longitude box; without this it reads all 33k ZIP rows.
CREATE INDEX IF NOT EXISTS idx_zip_codes_lat ON zip_codes(lat);

-- Scorecard sends that failed this week (up to 3 tries, then it waits for next week).
ALTER TABLE agent_profiles ADD COLUMN scorecard_failures INTEGER NOT NULL DEFAULT 0;
