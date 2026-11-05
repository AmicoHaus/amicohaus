// Shared progress checklist for an awarded engagement: a status tracker both the homeowner and the awarded agent
// can update. No payment ever moves through Amico Haus. The default steps follow a normal listing (a salesperson is
// paid through their broker, normally through escrow at closing), so nothing here suggests paying an agent directly
// or in advance. migration_v43.sql renamed the old deposit / final-payment steps on existing checklists.
import { clampString } from './util.js';

export const DEFAULT_MILESTONE_LABELS = [
  "Listing agreement signed with the agent's brokerage",
  'Home prepped and photographed',
  'Listed',
  'In escrow',
  'Closed',
];
const DEFAULT_LABELS = DEFAULT_MILESTONE_LABELS;
const MAX_MILESTONES = 20;

export async function seedDefaultMilestones(db, requestType, requestId) {
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM bid_milestones WHERE request_type = ? AND request_id = ?').bind(requestType, requestId).first();
  if (existing.n > 0) return;
  const stmts = DEFAULT_LABELS.map((label, i) =>
    db.prepare('INSERT INTO bid_milestones (request_type, request_id, label, sort_order) VALUES (?, ?, ?, ?)').bind(requestType, requestId, label, i)
  );
  await db.batch(stmts);
}

export async function listMilestones(db, requestType, requestId) {
  const rows = await db.prepare(
    'SELECT bid_milestones.*, users.display_name AS done_by_name FROM bid_milestones LEFT JOIN users ON users.id = bid_milestones.done_by_user_id WHERE request_type = ? AND request_id = ? ORDER BY sort_order ASC, id ASC'
  ).bind(requestType, requestId).all();
  return rows.results.map(r => ({
    id: r.id, label: r.label, isDone: !!r.is_done, doneByName: r.done_by_name, doneAt: r.done_at, createdAt: r.created_at,
  }));
}

export async function addMilestone(db, requestType, requestId, userId, label) {
  const clean = clampString(label, 200);
  if (!clean) return { error: 'Enter a checklist item.' };
  const count = await db.prepare('SELECT COUNT(*) AS n FROM bid_milestones WHERE request_type = ? AND request_id = ?').bind(requestType, requestId).first();
  if (count.n >= MAX_MILESTONES) return { error: `You can have at most ${MAX_MILESTONES} checklist items.` };
  const maxOrder = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM bid_milestones WHERE request_type = ? AND request_id = ?').bind(requestType, requestId).first();
  const result = await db.prepare(
    'INSERT INTO bid_milestones (request_type, request_id, label, created_by_user_id, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).bind(requestType, requestId, clean, userId, maxOrder.m + 1).run();
  return { id: result.meta.last_row_id };
}

export async function toggleMilestone(db, milestoneId, userId, isDone) {
  if (isDone) {
    await db.prepare("UPDATE bid_milestones SET is_done = 1, done_by_user_id = ?, done_at = datetime('now') WHERE id = ?").bind(userId, milestoneId).run();
  } else {
    await db.prepare('UPDATE bid_milestones SET is_done = 0, done_by_user_id = NULL, done_at = NULL WHERE id = ?').bind(milestoneId).run();
  }
}

export async function deleteMilestone(db, milestoneId) {
  await db.prepare('DELETE FROM bid_milestones WHERE id = ?').bind(milestoneId).run();
}
