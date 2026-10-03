import { clampString } from './util.js';
import { fetchAgentStats } from './marketplace.js';

const MAX_TEAM_NAME = 80;

export async function fetchMyTeamRow(db, userId) {
  return db.prepare('SELECT * FROM agent_team_members WHERE agent_user_id = ?').bind(userId).first();
}

// Just the display name, for directory cards and public profiles — only ever shown for an active membership,
// never a still-pending invite (that's private to the invitee and the team owner).
export async function fetchActiveTeamName(db, userId) {
  const row = await db.prepare(
    `SELECT agent_teams.name FROM agent_team_members JOIN agent_teams ON agent_teams.id = agent_team_members.team_id
     WHERE agent_team_members.agent_user_id = ? AND agent_team_members.status = 'active'`
  ).bind(userId).first();
  return row ? row.name : null;
}

export async function createTeam(db, userId, name) {
  const existing = await fetchMyTeamRow(db, userId);
  if (existing) return { error: "You're already on a team — leave it first if you want to start a new one." };
  const clean = clampString(name, MAX_TEAM_NAME);
  if (!clean) return { error: 'Give your team a name.' };

  const team = await db.prepare('INSERT INTO agent_teams (name, created_by_user_id) VALUES (?, ?)').bind(clean, userId).run();
  const teamId = team.meta.last_row_id;
  await db.prepare("INSERT INTO agent_team_members (team_id, agent_user_id, role, status) VALUES (?, ?, 'owner', 'active')").bind(teamId, userId).run();
  return { teamId };
}

// Full team view for a member or invitee: the team's name, every member (active + still-invited, so an owner
// can see who hasn't answered yet), and combined stats across active members only — an invited-not-yet-accepted
// agent's numbers aren't the team's yet.
export async function fetchTeamDetail(db, teamId) {
  const team = await db.prepare('SELECT * FROM agent_teams WHERE id = ?').bind(teamId).first();
  if (!team) return null;
  const memberRows = await db.prepare(
    `SELECT agent_team_members.*, users.display_name AS agent_name
     FROM agent_team_members JOIN users ON users.id = agent_team_members.agent_user_id
     WHERE team_id = ? ORDER BY (agent_team_members.role = 'owner') DESC, agent_team_members.created_at ASC`
  ).bind(teamId).all();

  const members = [];
  let totalBids = 0, acceptedBids = 0, decidedBids = 0;
  for (const m of memberRows.results) {
    const entry = { userId: m.agent_user_id, name: m.agent_name, role: m.role, status: m.status };
    if (m.status === 'active') {
      const stats = await fetchAgentStats(db, m.agent_user_id);
      entry.stats = stats;
      totalBids += stats.totalBids;
      acceptedBids += stats.acceptedBids;
      decidedBids += stats.decidedBids;
    }
    members.push(entry);
  }
  return {
    id: team.id, name: team.name,
    members,
    teamStats: { totalBids, acceptedBids, winRate: decidedBids > 0 ? acceptedBids / decidedBids : null },
  };
}

export async function inviteToTeam(db, teamId, inviterUserId, targetUserId) {
  const inviter = await db.prepare("SELECT * FROM agent_team_members WHERE team_id = ? AND agent_user_id = ?").bind(teamId, inviterUserId).first();
  if (!inviter || inviter.role !== 'owner') return { error: 'Only the team owner can invite.' };
  if (targetUserId === inviterUserId) return { error: "You're already on this team." };

  const target = await db.prepare(
    "SELECT agent_profiles.status FROM agent_profiles WHERE agent_profiles.user_id = ?"
  ).bind(targetUserId).first();
  if (!target || target.status !== 'approved') return { error: 'That agent is not an approved agent.' };

  const existing = await fetchMyTeamRow(db, targetUserId);
  if (existing) return { error: existing.status === 'active' ? "That agent is already on a team." : "That agent already has a pending invite." };

  await db.prepare("INSERT INTO agent_team_members (team_id, agent_user_id, role, status, invited_by_user_id) VALUES (?, ?, 'member', 'invited', ?)")
    .bind(teamId, targetUserId, inviterUserId).run();
  return { ok: true };
}

export async function respondToInvite(db, userId, accept) {
  const row = await fetchMyTeamRow(db, userId);
  if (!row || row.status !== 'invited') return { error: 'No pending invite found.' };
  if (accept) {
    await db.prepare("UPDATE agent_team_members SET status = 'active' WHERE id = ?").bind(row.id).run();
  } else {
    await db.prepare('DELETE FROM agent_team_members WHERE id = ?').bind(row.id).run();
  }
  return { ok: true, teamId: row.team_id };
}

// Covers both "leave" (self) and "remove" (owner acting on someone else). If the person leaving/removed is the
// owner and teammates remain, the longest-tenured remaining ACTIVE member is promoted rather than leaving the
// team ownerless — a team shouldn't just get stuck. If they were the last member, the team itself is deleted.
export async function removeFromTeam(db, teamId, targetUserId) {
  const target = await db.prepare('SELECT * FROM agent_team_members WHERE team_id = ? AND agent_user_id = ?').bind(teamId, targetUserId).first();
  if (!target) return { error: 'Not a member of this team.' };

  await db.prepare('DELETE FROM agent_team_members WHERE id = ?').bind(target.id).run();

  if (target.role === 'owner') {
    const next = await db.prepare("SELECT id FROM agent_team_members WHERE team_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1").bind(teamId).first();
    if (next) {
      await db.prepare("UPDATE agent_team_members SET role = 'owner' WHERE id = ?").bind(next.id).run();
    } else {
      await db.prepare('DELETE FROM agent_teams WHERE id = ?').bind(teamId).run(); // cascades any leftover invited rows too
    }
  }
  return { ok: true };
}
