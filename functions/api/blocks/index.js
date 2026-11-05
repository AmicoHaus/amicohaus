import { getSessionUser } from '../../_lib/auth.js';
import { json, badRequest, unauthorized, notFound } from '../../_lib/util.js';

// The people the viewer blocked, newest first. createdAt is "Blocked on {date}"; an approved agent also carries the
// DRE number and brokerage so the viewer can tell who it is (null for everyone else).
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const rows = await db.prepare(
    `SELECT user_blocks.blocked_id, user_blocks.created_at, users.display_name, ap.user_id AS agent_id, ap.license_number, ap.brokerage_name
     FROM user_blocks JOIN users ON users.id = user_blocks.blocked_id
     LEFT JOIN agent_profiles ap ON ap.user_id = user_blocks.blocked_id AND ap.status = 'approved'
     WHERE user_blocks.blocker_id = ? ORDER BY user_blocks.created_at DESC`
  ).bind(user.id).all();

  const blocked = rows.results.map(r => ({
    blocked_id: r.blocked_id, display_name: r.display_name, createdAt: r.created_at,
    licenseNumber: r.agent_id ? r.license_number || '' : null,
    brokerageName: r.agent_id ? r.brokerage_name || '' : null,
  }));
  return json({ blocked });
}

// A block takes effect right away, both ways: shared contact info is unshared, the blocked person's RSVPs to the
// other's upcoming broker previews are removed, waiting showing requests and open interviews are canceled, and
// waiting invites are declined. Nobody is told. Proposals, price votes and opinions stay stored (the owner's lists
// just leave them out), so unblocking brings those back; the rest doesn't come back.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }
  const blockedId = Number(body.userId);
  if (!Number.isInteger(blockedId) || blockedId <= 0 || blockedId === user.id) return badRequest('Invalid user.');

  const db = context.env.DB;
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(blockedId).first();
  if (!target) return notFound('User not found.');

  // ?1 = the blocker, ?2 = the blocked person; ?3 = now (a preview's ends_at is an ISO time).
  const pair = (sql, ...more) => db.prepare(sql).bind(user.id, blockedId, ...more);
  await db.batch([
    pair('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?1, ?2)'),
    pair('DELETE FROM contact_shares WHERE (owner_id = ?1 AND agent_id = ?2) OR (owner_id = ?2 AND agent_id = ?1)'),
    pair(`DELETE FROM pre_listing_preview_rsvps WHERE id IN (
            SELECT r.id FROM pre_listing_preview_rsvps r JOIN pre_listing_previews pv ON pv.id = r.preview_id JOIN pre_listings p ON p.id = pv.pre_listing_id
            WHERE pv.ends_at > ?3 AND ((p.user_id = ?1 AND r.agent_user_id = ?2) OR (p.user_id = ?2 AND r.agent_user_id = ?1)))`, new Date().toISOString()),
    pair(`UPDATE pre_listing_showings SET status = 'canceled', updated_at = datetime('now')
          WHERE status = 'pending' AND id IN (
            SELECT s.id FROM pre_listing_showings s JOIN pre_listings p ON p.id = s.pre_listing_id
            WHERE (p.user_id = ?1 AND s.agent_user_id = ?2) OR (p.user_id = ?2 AND s.agent_user_id = ?1))`),
    pair(`UPDATE pre_listing_interviews SET status = 'canceled', updated_at = datetime('now')
          WHERE status IN ('requested', 'scheduled') AND id IN (
            SELECT i.id FROM pre_listing_interviews i JOIN pre_listings p ON p.id = i.pre_listing_id
            WHERE (p.user_id = ?1 AND i.agent_user_id = ?2) OR (p.user_id = ?2 AND i.agent_user_id = ?1))`),
    pair(`UPDATE agent_invites SET status = 'declined'
          WHERE status = 'pending' AND ((invited_by_user_id = ?1 AND agent_user_id = ?2) OR (invited_by_user_id = ?2 AND agent_user_id = ?1))`),
  ]);
  return json({ ok: true }, { status: 201 });
}
