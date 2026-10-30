-- Batch A (agent supply + ad funnel).

-- A 6-digit code in the signup email, so someone who signed up inside TikTok's or Instagram's in-app browser can
-- finish in that same window (the emailed link would open a different browser). Stored hashed; 5 wrong tries
-- and the code stops working until a new email is sent.
ALTER TABLE users ADD COLUMN verify_code_hash TEXT;
ALTER TABLE users ADD COLUMN verify_code_attempts INTEGER NOT NULL DEFAULT 0;
-- When the last confirmation email was actually accepted for delivery. Re-signing up with a pending address waits 2
-- minutes after a delivered email, but never after one that failed.
ALTER TABLE users ADD COLUMN verify_sent_at TEXT;

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

-- DRE license IDs are 8 digits; older applications may have stored them without the leading zeros (the apply form
-- now pads them). Pad digits-only numbers of 5-7 digits so the DRE lookup link and the approval check line up.
UPDATE agent_profiles SET license_number = substr('00000000' || license_number, -8, 8)
WHERE license_number NOT GLOB '*[^0-9]*' AND length(license_number) BETWEEN 5 AND 7;
