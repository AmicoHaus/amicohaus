-- Batch L1: launch kit + safety fixes.

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

-- Saved searches are read per person (the Matches tab, the delete check, the per-person cap).
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id, created_at);

-- The "Reveal exact address once matched" box is gone: it never revealed anything, and a trade listing's street
-- address is only ever shown to its owner. The column stays (D1 has no cheap column drop).
UPDATE listings SET show_exact_address = 0;

-- Grey-area fixes (Rudy 11.04).
-- Signups record which Terms/Privacy version they agreed to and when.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
-- Agent applications record agreement to the agent rules in the Terms.
ALTER TABLE agent_profiles ADD COLUMN rules_version TEXT;
ALTER TABLE agent_profiles ADD COLUMN rules_accepted_at TEXT;
-- Home trades: the other partner confirms before agents see the request or anyone is hired (one agent for both homes
-- is dual agency and needs both owners). Requests opened before this rule count as confirmed.
ALTER TABLE transaction_requests ADD COLUMN partner_confirmed_at TEXT;
UPDATE transaction_requests SET partner_confirmed_at = created_at WHERE partner_confirmed_at IS NULL;
-- Moderation hides instead of deleting (an admin with a reason, or a home's owner on their own home's thread).
ALTER TABLE posts ADD COLUMN hidden_at TEXT;
ALTER TABLE posts ADD COLUMN hidden_reason TEXT;
ALTER TABLE comments ADD COLUMN hidden_at TEXT;
ALTER TABLE comments ADD COLUMN hidden_reason TEXT;
-- A listing an admin takes down is paused with a reason, and only an admin can make it active again.
ALTER TABLE listings ADD COLUMN hidden_at TEXT;
ALTER TABLE listings ADD COLUMN hidden_reason TEXT;
-- The hire checklist never talks about paying an agent directly (a salesperson is paid through their broker,
-- normally at closing).
UPDATE bid_milestones SET label = 'Listing agreement signed with the agent''s brokerage' WHERE label = 'Deposit sent (off-platform)';
UPDATE bid_milestones SET label = 'Home prepped and photographed' WHERE label = 'Work in progress';
UPDATE bid_milestones SET label = 'Listed' WHERE label = 'Work completed';
UPDATE bid_milestones SET label = 'Closed' WHERE label = 'Final payment sent (off-platform)';

-- A past-client review can be reported on its own (e.g. as fake). Only such a report, from someone who isn't an
-- admin, shows the reviewer's email and street address on the admin list. SQLite can't widen a CHECK in place, so
-- the reports table is rebuilt (nothing references it), the same way migration_v29 rebuilt listing_offers.
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('post','comment','listing','user','past_client_review')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
INSERT INTO reports_new (id, reporter_id, target_type, target_id, reason, status, created_at, resolved_at)
  SELECT id, reporter_id, target_type, target_id, reason, status, created_at, resolved_at FROM reports;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- Demo feed (seeded by functions/api/admin/seed.js, shown word for word on the public /demo page): sample posts no
-- longer describe family status or give money math. Only demo accounts' rows are touched.
UPDATE posts SET body = 'This house has more room than we need now. Ready to trade for something smaller if the right match shows up.'
  WHERE body LIKE 'Kids are grown%' AND user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.amicohaus.local');
UPDATE posts SET body = 'Happy to trade down for something smaller and easier to maintain.'
  WHERE body LIKE 'Empty-nesters here%' AND user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.amicohaus.local');
UPDATE posts SET body = replace(body, 'Growing family, need more space', 'Need more space')
  WHERE body LIKE 'Growing family, need more space%' AND user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.amicohaus.local');
UPDATE posts SET body = substr(body, 1, instr(body, '. I ran the numbers') - 1) || ' (my own guess). I''m weighing selling and renting by the beach for a while instead of trading. Anyone else weighing that option?'
  WHERE body LIKE '%after typical selling costs%' AND instr(body, '. I ran the numbers') > 0 AND user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.amicohaus.local');
UPDATE comments SET body = 'Interesting idea. Following to see how it goes.'
  WHERE body LIKE 'That math actually checks out%' AND user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.amicohaus.local');
