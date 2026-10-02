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
