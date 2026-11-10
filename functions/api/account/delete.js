import { getSessionUser, verifyPassword, clearSessionCookieHeader } from '../../_lib/auth.js';
import { json, badRequest, unauthorized } from '../../_lib/util.js';
import { deleteR2Keys } from '../../_lib/r2Cleanup.js';
import { REMOVE_ACTION } from '../../_lib/agentReviewAdmin.js';
import { allUnionAll } from '../../_lib/compoundSelect.js';

// Every stored file tied to an account, read before the rows that point at them cascade away: listing photos (live
// and in the trash), pre-listing photos, Then & Now photo pairs, walkthrough videos and the price-opinion decks and
// pitch reels on them (and the ones this person sent as an agent), AugmentedHomes / GreenHomes / project photos, and
// an agent's intro video, license photo (an ID document), portfolio photos and case-study photos. ?1 = the account.
const STORED_FILES_SQL = `
  SELECT listing_photos.r2_key AS k FROM listing_photos JOIN listings ON listings.id = listing_photos.listing_id WHERE listings.user_id = ?1
  UNION ALL SELECT json_extract(p.value, '$.r2_key') FROM deleted_listings d,
    json_each(CASE WHEN json_valid(d.snapshot) THEN d.snapshot ELSE '{}' END, '$.photos') p WHERE d.user_id = ?1
  UNION ALL SELECT r2_key FROM pre_listing_photos WHERE pre_listing_id IN (SELECT id FROM pre_listings WHERE user_id = ?1)
  UNION ALL SELECT then_r2_key FROM pre_listing_then_now WHERE pre_listing_id IN (SELECT id FROM pre_listings WHERE user_id = ?1)
  UNION ALL SELECT now_r2_key FROM pre_listing_then_now WHERE pre_listing_id IN (SELECT id FROM pre_listings WHERE user_id = ?1)
  UNION ALL SELECT video_r2_key FROM pre_listings WHERE user_id = ?1
  UNION ALL SELECT deck_r2_key FROM pre_listing_price_opinions
    WHERE agent_user_id = ?1 OR pre_listing_id IN (SELECT id FROM pre_listings WHERE user_id = ?1)
  UNION ALL SELECT pitch_video_r2_key FROM service_bids
    WHERE agent_user_id = ?1 OR (request_type = 'pre_listing' AND request_id IN (SELECT id FROM pre_listings WHERE user_id = ?1))
  UNION ALL SELECT r2_key FROM augmented_home_photos WHERE augmented_home_id IN (SELECT id FROM augmented_homes WHERE user_id = ?1)
  UNION ALL SELECT r2_key FROM green_home_photos WHERE green_home_id IN (SELECT id FROM green_homes WHERE user_id = ?1)
  UNION ALL SELECT r2_key FROM dev_project_photos WHERE dev_project_id IN (SELECT id FROM dev_projects WHERE user_id = ?1)
  UNION ALL SELECT video_r2_key FROM agent_profiles WHERE user_id = ?1
  UNION ALL SELECT license_photo_r2_key FROM agent_profiles WHERE user_id = ?1
  UNION ALL SELECT r2_key FROM agent_portfolio_photos WHERE agent_user_id = ?1
  UNION ALL SELECT before_r2_key FROM agent_case_studies WHERE agent_user_id = ?1
  UNION ALL SELECT after_r2_key FROM agent_case_studies WHERE agent_user_id = ?1`;

// Deletes the account and everything the schema cascades from it (listings,
// posts, comments, messages, notifications, sessions, etc. all reference
// users.id with ON DELETE CASCADE), then the stored files.
export async function onRequestPost(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  let body;
  try { body = await context.request.json(); } catch { return badRequest('Invalid request body.'); }

  const ok = await verifyPassword(String(body.password || ''), user.password_hash);
  if (!ok) return badRequest('Incorrect password.');

  const db = context.env.DB;
  // In chunks of at most 5 terms: D1 refuses a longer compound SELECT (compoundSelect.js).
  const stored = await allUnionAll(db, STORED_FILES_SQL, [user.id], ['k']);

  // One batch, so it all happens or none of it does:
  // - a team member this person invited keeps their membership (invited_by has no ON DELETE rule, so the account
  //   delete would otherwise fail on it);
  // - proposals, invites and the hire checklist on their pre-listings point at them by type and id (no foreign
  //   key), so they're removed here rather than left behind;
  // - a removed agent review lives on as a copy in the admin log (agentReviewAdmin.js); copies written by or about
  //   this person go too;
  // - then the account itself.
  const ownPreListings = "request_type = 'pre_listing' AND request_id IN (SELECT id FROM pre_listings WHERE user_id = ?)";
  await db.batch([
    db.prepare('UPDATE agent_team_members SET invited_by_user_id = NULL WHERE invited_by_user_id = ?').bind(user.id),
    db.prepare(`DELETE FROM service_bids WHERE ${ownPreListings}`).bind(user.id),
    db.prepare(`DELETE FROM agent_invites WHERE ${ownPreListings}`).bind(user.id),
    db.prepare(`DELETE FROM bid_milestones WHERE ${ownPreListings}`).bind(user.id),
    db.prepare(
      `DELETE FROM admin_audit_log WHERE action = ?2 AND target_type = 'agent_review'
         AND (CASE WHEN json_valid(details) THEN json_extract(details, '$.review.reviewer_user_id') END = ?1
              OR CASE WHEN json_valid(details) THEN json_extract(details, '$.review.agent_user_id') END = ?1)`
    ).bind(user.id, REMOVE_ACTION),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);

  // R2 objects aren't referenced by the schema's FK cascades, so they'd otherwise be orphaned.
  await deleteR2Keys(context.env.PHOTOS, stored.map(r => r.k));

  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookieHeader() } });
}
