// Posts and comments are hidden, not deleted, when someone else takes them down (Rudy 11.04): an admin with a
// reason, or a home's owner on their own home's discussion thread. Hidden items stay in the database (columns from
// migration_v43), only their author and admins still see them, and the author gets an in-app note with the reason.
// The author can still delete their own post or comment outright.
import { clampString } from './util.js';

export const REASON_REQUIRED_ERROR = 'Give a reason. It is shown to the author.';
export const OWNER_HIDE_REASON = "Removed from this home's discussion by the home's owner";

const TABLE = { post: 'posts', comment: 'comments' };

export function cleanReason(reason) {
  return clampString(reason, 300);
}

// Hides one post or comment and tells its author why. Returns true if it was showing before.
export async function hideContent(db, kind, id, reason) {
  const table = TABLE[kind];
  if (!table) throw new Error(`Unknown kind: ${kind}`);
  const row = await db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) return false;
  const r = await db.prepare(`UPDATE ${table} SET hidden_at = datetime('now'), hidden_reason = ? WHERE id = ? AND hidden_at IS NULL`)
    .bind(reason, id).run();
  const changed = !!(r.meta && r.meta.changes);
  if (changed) {
    await db.prepare("INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'moderation', ?, '/app')")
      .bind(row.user_id, `Your ${kind} was hidden: ${reason}`).run();
  }
  return changed;
}

export async function unhideContent(db, kind, id) {
  const table = TABLE[kind];
  if (!table) throw new Error(`Unknown kind: ${kind}`);
  const r = await db.prepare(`UPDATE ${table} SET hidden_at = NULL, hidden_reason = NULL WHERE id = ?`).bind(id).run();
  return !!(r.meta && r.meta.changes);
}

// The owner of the home or project a deal-thread post belongs to (dealThreads.js), or null for a feed or group post.
export async function threadOwnerId(db, postId) {
  const row = await db.prepare(
    `SELECT COALESCE(
       (SELECT user_id FROM listings WHERE listings.id = posts.listing_id),
       (SELECT user_id FROM augmented_homes WHERE augmented_homes.id = posts.augmented_home_id),
       (SELECT user_id FROM green_homes WHERE green_homes.id = posts.green_home_id),
       (SELECT user_id FROM dev_projects WHERE dev_projects.id = posts.dev_project_id)
     ) AS owner_id
     FROM posts WHERE posts.id = ?`
  ).bind(postId).first();
  return row && row.owner_id ? row.owner_id : null;
}

// Someone other than the author hides a comment: an admin (a reason is required) or the owner of the home whose
// thread it's on (a short default reason if they don't give one). Returns { ok, changed, asAdmin, reason } or
// { notFound } | { forbidden } | { error, code }.
export async function hideCommentAs(db, user, commentId, rawReason) {
  const comment = await db.prepare('SELECT id, user_id, post_id FROM comments WHERE id = ?').bind(commentId).first();
  if (!comment) return { notFound: true };
  if (comment.user_id === user.id) return { error: 'You can delete your own comment instead.', code: 'own_comment' };
  const ownerId = await threadOwnerId(db, comment.post_id);
  const isHomeOwner = ownerId !== null && ownerId === user.id;
  const isAdmin = user.role === 'admin';
  if (!isHomeOwner && !isAdmin) return { forbidden: true };
  let reason = cleanReason(rawReason);
  if (!reason) {
    if (!isHomeOwner) return { error: REASON_REQUIRED_ERROR, code: 'reason_required' };
    reason = OWNER_HIDE_REASON;
  }
  const changed = await hideContent(db, 'comment', comment.id, reason);
  return { ok: true, changed, asAdmin: !isHomeOwner, reason };
}

// Only an admin hides someone else's post, always with a reason.
export async function hidePostAs(db, user, postId, rawReason) {
  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').bind(postId).first();
  if (!post) return { notFound: true };
  if (user.role !== 'admin') return { forbidden: true };
  if (post.user_id === user.id) return { error: 'You can delete your own post instead.', code: 'own_post' };
  const reason = cleanReason(rawReason);
  if (!reason) return { error: REASON_REQUIRED_ERROR, code: 'reason_required' };
  const changed = await hideContent(db, 'post', post.id, reason);
  return { ok: true, changed, asAdmin: true, reason };
}

// The reason sent with a request: a JSON body { reason } or ?reason= (a DELETE may come without a body).
export async function reasonFrom(request) {
  let body = {};
  try { body = await request.clone().json(); } catch { body = {}; }
  return { body: body && typeof body === 'object' ? body : {}, reason: (body && body.reason) || new URL(request.url).searchParams.get('reason') || '' };
}

// An approved agent's identity on their posts and comments (California rule: name, DRE # and broker at a point of
// contact). Join: LEFT JOIN agent_profiles author_agent ON author_agent.user_id = <author col> AND
// author_agent.status = 'approved', selecting author_agent.license_number AS author_license and
// author_agent.brokerage_name AS author_brokerage.
export function authorAgentJoin(userCol) {
  return `LEFT JOIN agent_profiles author_agent ON author_agent.user_id = ${userCol} AND author_agent.status = 'approved'`;
}
export const AUTHOR_AGENT_COLUMNS = 'author_agent.license_number AS author_license, author_agent.brokerage_name AS author_brokerage, author_agent.user_id AS author_agent_id';

export function authorAgentFrom(row) {
  if (!row.author_agent_id) return null;
  return { licenseNumber: String(row.author_license || '').trim(), brokerageName: String(row.author_brokerage || '').trim() };
}

// Shapes a post or comment row for the API: the agent identity, and the hidden state only for the author or an
// admin (everyone else never receives a hidden row at all).
export function moderationFields(row, viewer) {
  const canSeeHidden = viewer && (viewer.id === row.user_id || viewer.role === 'admin');
  const out = { authorAgent: authorAgentFrom(row) };
  if (row.hidden_at && canSeeHidden) { out.hidden = true; out.hiddenReason = row.hidden_reason || ''; }
  return out;
}
