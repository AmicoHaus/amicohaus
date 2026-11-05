import { clampString } from './util.js';
import { num } from './listings.js';
import { validAdaptationKeys } from './adaptations.js';
import { validGreenFeatureKeys } from './greenFeatures.js';

export const PROJECT_TYPES = ['flip', 'new_construction', 'multifamily', 'commercial', 'land', 'other'];
// The stored key 'flip' stays (existing rows, filters and alerts use it); it reads as "Renovation" everywhere, so
// nothing sounds like an investment pitch (Rudy 11.04).
export const PROJECT_TYPE_LABELS = {
  flip: 'Renovation',
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
  funded: 'Ready to build', // older rows only: no new project can pick it (no investment terms, Rudy 11.04)
  completed: 'Completed',
};

export function validateDevProjectInput(body) {
  const title = clampString(body.title, 120);
  const city = clampString(body.city, 80);
  const state = clampString(body.state, 20);
  const projectType = PROJECT_TYPES.includes(body.projectType) ? body.projectType : null;
  const stage = PROJECT_STAGES.includes(body.stage) ? body.stage : 'concept';
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
      // No investment terms (Rudy 11.04): a funding amount, minimum investment or target return is never accepted.
      // The columns stay and every save writes them empty, which also clears anything stored before the rule.
      fundingGoal: 0,
      minInvestment: 0,
      targetReturn: '',
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

