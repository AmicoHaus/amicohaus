-- Batch R3-1a: "Post without worry" -- You're in Control (contact dial, quiet hours, pause proposals, share-with-
-- this-agent, who saw my address) plus privacy fixes (phone private by default, one email cap per person).

-- How agents can reach this person by message: 'open' (as before), 'weekly' (one message per agent, delivered
-- together on Sunday morning) or 'quiet' (no agent messages; price opinions and proposals still arrive). Agents the
-- person already works with (they messaged first, shared their contact, hired, invited or booked an interview) are
-- never held back.
ALTER TABLE users ADD COLUMN contact_mode TEXT NOT NULL DEFAULT 'open' CHECK(contact_mode IN ('open','weekly','quiet'));
-- Quiet hours for email and push, Pacific time "HH:MM" (may cross midnight, e.g. 21:00-08:00). In-app alerts still
-- land right away. NULL = no quiet hours.
ALTER TABLE users ADD COLUMN quiet_start TEXT;
ALTER TABLE users ADD COLUMN quiet_end TEXT;
-- The phone number is private unless the person turns this on (it used to show on public profiles and listings).
ALTER TABLE users ADD COLUMN phone_public INTEGER NOT NULL DEFAULT 0;

-- "Pause new proposals": agents who already sent one can still update it; nobody new can start one.
ALTER TABLE pre_listings ADD COLUMN proposals_paused INTEGER NOT NULL DEFAULT 0;

-- Weekly contact mode: a held agent message has deliver_after set (UTC, "YYYY-MM-DD HH:MM:SS", the same format as
-- datetime('now')); the recipient doesn't see it until then. released_at = when the weekly delivery told them.
ALTER TABLE messages ADD COLUMN deliver_after TEXT;
ALTER TABLE messages ADD COLUMN released_at TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_held ON messages(deliver_after) WHERE deliver_after IS NOT NULL AND released_at IS NULL;

-- One email cap per person: the notification rows that produced (or queued) an email.
ALTER TABLE notifications ADD COLUMN emailed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_emailed ON notifications(user_id, emailed_at) WHERE emailed_at IS NOT NULL;

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
