import { clampString } from './util.js';
import { num } from './listings.js';
import { validAdaptationKeys } from './adaptations.js';
import { validGreenFeatureKeys } from './greenFeatures.js';

export const PROJECT_TYPES = ['flip', 'new_construction', 'multifamily', 'commercial', 'land', 'other'];
export const PROJECT_TYPE_LABELS = {
  flip: 'Fix & Flip',
  new_construction: 'New Construction',
  multifamily: 'Multi-Family',
  commercial: 'Commercial',
  land: 'Land / Entitlement',
  other: 'Other',
};
export const PROJECT_STAGES = ['concept', 'permitting', 'under_construction', 'funded', 'completed'];
export const PROJECT_STAGE_LABELS = {
  concept: 'Concept',
  permitting: 'Permitting',
  under_construction: 'Under Construction',
  funded: 'Fully Funded',
  completed: 'Completed',
};

export function validateDevProjectInput(body) {
  const title = clampString(body.title, 120);
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  const projectType = PROJECT_TYPES.includes(body.projectType) ? body.projectType : null;
  const stage = PROJECT_STAGES.includes(body.stage) ? body.stage : 'concept';
  const fundingGoal = num(body.fundingGoal, { min: 0, max: 5000000000 });
  const minInvestment = body.minInvestment ? num(body.minInvestment, { min: 0, max: 5000000000 }) : 0;
  const timelineMonths = body.timelineMonths ? num(body.timelineMonths, { min: 0, max: 600 }) : null;

  if (!title || !city || !state || !projectType) {
    return { error: 'Fill in a title, city, state, and project type.' };
  }

  return {
    data: {
      title, city, state, projectType, stage,
      description: clampString(body.description, 3000),
      address: clampString(body.address, 150),
      neighborhood: clampString(body.neighborhood, 80),
      zip: clampString(body.zip, 10),
      fundingGoal: fundingGoal || 0,
      minInvestment: minInvestment || 0,
      targetReturn: clampString(body.targetReturn, 80),
      timelineMonths,
      // Purely informational/filterable -- which accessibility adaptations this project is being built for,
      // reusing the exact same taxonomy AugmentedHomes uses. Optional, unlike AugmentedHomes' own requirement
      // of at least one, since most dev projects have nothing to do with accessibility at all.
      adaptations: validAdaptationKeys(body.adaptations),
      // Same crossover pattern, for GreenHomes' green-feature taxonomy. Also optional.
      greenFeatures: validGreenFeatureKeys(body.greenFeatures),
    },
  };
}

export async function insertDevProject(db, userId, d) {
  const result = await db.prepare(
    `INSERT INTO dev_projects (user_id, title, description, address, neighborhood, city, state, zip,
       project_type, stage, funding_goal, min_investment, target_return, timeline_months, adaptations_json, green_features_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip,
    d.projectType, d.stage, d.fundingGoal, d.minInvestment, d.targetReturn, d.timelineMonths,
    JSON.stringify(d.adaptations), JSON.stringify(d.greenFeatures)
  ).run();
  return result.meta.last_row_id;
}

export async function updateDevProject(db, id, d) {
  await db.prepare(
    `UPDATE dev_projects SET title = ?, description = ?, address = ?, neighborhood = ?, city = ?, state = ?, zip = ?,
       project_type = ?, stage = ?, funding_goal = ?, min_investment = ?, target_return = ?, timeline_months = ?,
       adaptations_json = ?, green_features_json = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    d.title, d.description, d.address, d.neighborhood, d.city, d.state, d.zip,
    d.projectType, d.stage, d.fundingGoal, d.minInvestment, d.targetReturn, d.timelineMonths,
    JSON.stringify(d.adaptations), JSON.stringify(d.greenFeatures), id
  ).run();
}

export async function fetchDevProjectPhotos(db, projectId) {
  const rows = await db.prepare(
    'SELECT id, position FROM dev_project_photos WHERE dev_project_id = ? ORDER BY position ASC'
  ).bind(projectId).all();
  return rows.results;
}

const STATUSES = ['open', 'closed', 'funded'];

export async function setDevProjectStatus(db, id, status) {
  if (!STATUSES.includes(status)) return { error: 'Invalid status.' };
  await db.prepare("UPDATE dev_projects SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id).run();
  return { ok: true };
}

export async function fetchInterestCount(db, projectId) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM dev_project_interests WHERE dev_project_id = ?').bind(projectId).first();
  return row.n;
}

export async function toggleInterest(db, projectId, investorUserId, note) {
  const existing = await db.prepare('SELECT id FROM dev_project_interests WHERE dev_project_id = ? AND investor_user_id = ?').bind(projectId, investorUserId).first();
  if (existing) {
    await db.prepare('DELETE FROM dev_project_interests WHERE id = ?').bind(existing.id).run();
    return { interested: false };
  }
  await db.prepare('INSERT INTO dev_project_interests (dev_project_id, investor_user_id, note) VALUES (?, ?, ?)')
    .bind(projectId, investorUserId, clampString(note, 300)).run();
  return { interested: true };
}

export async function hasExpressedInterest(db, projectId, investorUserId) {
  const row = await db.prepare('SELECT id FROM dev_project_interests WHERE dev_project_id = ? AND investor_user_id = ?').bind(projectId, investorUserId).first();
  return !!row;
}

export async function fetchInterestedInvestors(db, projectId) {
  const rows = await db.prepare(
    `SELECT dev_project_interests.investor_user_id AS user_id, dev_project_interests.note, dev_project_interests.created_at,
            users.display_name
     FROM dev_project_interests JOIN users ON users.id = dev_project_interests.investor_user_id
     WHERE dev_project_interests.dev_project_id = ? ORDER BY dev_project_interests.created_at DESC`
  ).bind(projectId).all();
  return rows.results;
}
