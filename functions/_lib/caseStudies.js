// Structured before/after portfolio pairs tied to a specific past sale —
// alongside (not replacing) the looser agent_portfolio_photos gallery. A
// more persuasive, comparable "case study" than a photo dump: a result
// line like "Sold in 12 days, 5% over asking" next to the transformation.
import { clampString } from './util.js';

const MAX_CASE_STUDIES = 6;

export async function fetchCaseStudies(db, agentUserId) {
  const rows = await db.prepare(
    'SELECT id, title, result_note, position FROM agent_case_studies WHERE agent_user_id = ? ORDER BY position ASC'
  ).bind(agentUserId).all();
  return rows.results.map(r => ({ id: r.id, title: r.title, resultNote: r.result_note }));
}

export async function insertCaseStudy(db, agentUserId, { title, resultNote, beforeKey, beforeContentType, afterKey, afterContentType }) {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM agent_case_studies WHERE agent_user_id = ?').bind(agentUserId).first();
  if (count.n >= MAX_CASE_STUDIES) return { error: `You can have at most ${MAX_CASE_STUDIES} case studies.` };

  const result = await db.prepare(
    `INSERT INTO agent_case_studies (agent_user_id, title, result_note, before_r2_key, before_content_type, after_r2_key, after_content_type, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(agentUserId, clampString(title, 120), clampString(resultNote, 200), beforeKey, beforeContentType, afterKey, afterContentType, count.n).run();
  return { id: result.meta.last_row_id };
}

export async function fetchCaseStudyForDelete(db, id, agentUserId) {
  return db.prepare('SELECT before_r2_key, after_r2_key FROM agent_case_studies WHERE id = ? AND agent_user_id = ?').bind(id, agentUserId).first();
}

export async function deleteCaseStudy(db, id, agentUserId) {
  await db.prepare('DELETE FROM agent_case_studies WHERE id = ? AND agent_user_id = ?').bind(id, agentUserId).run();
}
