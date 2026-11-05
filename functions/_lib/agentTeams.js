import { clampString } from './util.js';
import { fetchAgentStats } from './marketplace.js';

const MAX_TEAM_NAME = 80;

// California team-name rules (B&P 10159.7) and Rudy 11.04: a team name includes the surname of at least one member,
// never uses words that make a team sound like its own brokerage or company, and every member works under the same
// brokerage. Teams named before these rules keep their names.
const BANNED_TEAM_WORDS = /(^|[^\p{L}])(realty|real\s+estate|brokers?|brokerage|inc|incorporated|company|corp|corporation|llc)(?=$|[^\p{L}])/iu;
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

// The last real word of a display name ("Rudy Flores" -> "Flores"), skipping Jr./Sr. and single letters.
export function surnameOf(displayName) {
  const words = String(displayName || '').split(/\s+/).map(w => w.replace(/[^\p{L}'-]/gu, '')).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    if (NAME_SUFFIXES.has(words[i].toLowerCase())) continue;
    if (words[i].replace(/[^\p{L}]/gu, '').length >= 2) return words[i];
  }
  return '';
}

// True if word appears in text as a whole word (any letters, any case).
function hasWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, 'iu').test(text);
}

// { name } or { error }. surnames: the members' surnames (when a team is created, the creator's).
export function validateTeamName(name, surnames) {
  const clean = clampString(name, MAX_TEAM_NAME).replace(/\s+/g, ' ');
  if (!clean) return { error: 'Give your team a name.' };
  if (BANNED_TEAM_WORDS.test(clean)) {
    return { error: "A team name can't use words like realty, real estate, broker, brokerage, inc or company: they make a team sound like its own brokerage." };
  }
  const list = (surnames || []).filter(Boolean);
  const hasSurname = list.some(sn => hasWord(clean, sn) || sn.split('-').some(part => part.length >= 2 && hasWord(clean, part)));
  if (!hasSurname) return { error: `Your team name needs to include your last name (for example, "${list[0] || 'Garcia'} Team").` };
  return { name: clean };
}

// How a team name reads on cards and profiles: "<name> Team", unless it already ends in Team, Group or Associates.
export function teamDisplayName(name) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  return /(^|\s)(team|group|associates)$/i.test(clean) ? clean : `${clean} Team`;
}

// The same brokerage once case, punctuation and a trailing "Inc" or "LLC" are ignored. A blank brokerage never matches.
export function sameBrokerage(a, b) {
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|incorporated|llc|corp|corporation|co|company|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const na = norm(a);
  return !!na && na === norm(b);
}

const SAME_BROKERAGE_ERROR = 'A team can only include agents at the same brokerage.';

async function brokerageOf(db, userId) {
  const row = await db.prepare('SELECT brokerage_name FROM agent_profiles WHERE user_id = ?').bind(userId).first();
  return row ? row.brokerage_name : '';
}

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
  const creator = await db.prepare('SELECT display_name FROM users WHERE id = ?').bind(userId).first();
  const checked = validateTeamName(name, [surnameOf(creator && creator.display_name)]);
  if (checked.error) return checked;

  const team = await db.prepare('INSERT INTO agent_teams (name, created_by_user_id) VALUES (?, ?)').bind(checked.name, userId).run();
  const teamId = team.meta.last_row_id;
  await db.prepare("INSERT INTO agent_team_members (team_id, agent_user_id, role, status) VALUES (?, ?, 'owner', 'active')").bind(teamId, userId).run();
  return { teamId };
}

// Full team view for a member or invitee: the team's name, every member (active + still-invited, so an owner
// can see who hasn't answered yet), and plain combined counts across active members only — an invited-not-yet-
// accepted agent's numbers aren't the team's yet. No win rate (the site doesn't score agents); winRate stays null so
// an older screen shows nothing.
export async function fetchTeamDetail(db, teamId) {
  const team = await db.prepare('SELECT * FROM agent_teams WHERE id = ?').bind(teamId).first();
  if (!team) return null;
  const memberRows = await db.prepare(
    `SELECT agent_team_members.*, users.display_name AS agent_name
     FROM agent_team_members JOIN users ON users.id = agent_team_members.agent_user_id
     WHERE team_id = ? ORDER BY (agent_team_members.role = 'owner') DESC, agent_team_members.created_at ASC`
  ).bind(teamId).all();

  const members = [];
  let totalBids = 0, acceptedBids = 0;
  for (const m of memberRows.results) {
    const entry = { userId: m.agent_user_id, name: m.agent_name, role: m.role, status: m.status };
    if (m.status === 'active') {
      const stats = await fetchAgentStats(db, m.agent_user_id);
      entry.stats = { totalBids: stats.totalBids || 0, acceptedBids: stats.acceptedBids || 0 };
      totalBids += entry.stats.totalBids;
      acceptedBids += entry.stats.acceptedBids;
    }
    members.push(entry);
  }
  return {
    id: team.id, name: team.name, displayName: teamDisplayName(team.name),
    members,
    teamStats: { totalBids, acceptedBids, winRate: null },
  };
}

export async function inviteToTeam(db, teamId, inviterUserId, targetUserId) {
  const inviter = await db.prepare("SELECT * FROM agent_team_members WHERE team_id = ? AND agent_user_id = ?").bind(teamId, inviterUserId).first();
  if (!inviter || inviter.role !== 'owner') return { error: 'Only the team owner can invite.' };
  if (targetUserId === inviterUserId) return { error: "You're already on this team." };

  const target = await db.prepare(
    "SELECT agent_profiles.status, agent_profiles.brokerage_name FROM agent_profiles WHERE agent_profiles.user_id = ?"
  ).bind(targetUserId).first();
  if (!target || target.status !== 'approved') return { error: 'That agent is not an approved agent.' };
  if (!sameBrokerage(await brokerageOf(db, inviterUserId), target.brokerage_name)) return { error: SAME_BROKERAGE_ERROR };

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
    // Brokerages can change between the invite and the answer: check against the team owner again.
    const owner = await db.prepare("SELECT agent_user_id FROM agent_team_members WHERE team_id = ? AND role = 'owner'").bind(row.team_id).first();
    if (owner && !sameBrokerage(await brokerageOf(db, owner.agent_user_id), await brokerageOf(db, userId))) return { error: SAME_BROKERAGE_ERROR };
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
