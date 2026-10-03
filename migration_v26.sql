-- Agent teams/brokerages: a lightweight grouping of approved agents under one shared name (e.g. "McKelvey Team"),
-- shown on their directory cards and public profiles. An agent belongs to at most one team at a time (keeps v1
-- simple — no sub-teams, no multi-team membership). The owner invites; an invited agent accepts or declines.
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
