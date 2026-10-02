// Basic/Standard/Premium service packages — a preset an agent fills out once
// on their profile, Fiverr-gig style, rather than re-describing what's
// included on every custom proposal. Purely a comparison-shopping aid: an
// agent can still submit any custom proposal regardless of what's defined
// here, and a package is never itself a bid (see service_bids for that).
import { clampString } from './util.js';
import { validateServices } from './agents.js';

export const PACKAGE_TIERS = ['basic', 'standard', 'premium'];
const TIER_LABELS = { basic: 'Basic', standard: 'Standard', premium: 'Premium' };

function num(value, { min = 0, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

export function validatePackageInput(body) {
  const title = clampString(body.title, 80) || TIER_LABELS[body.tier] || '';
  const description = clampString(body.description, 500);
  const commissionPct = body.commissionPct ? num(body.commissionPct, { min: 0, max: 100 }) : null;
  const flatFee = body.flatFee ? num(body.flatFee, { min: 0, max: 500000 }) : null;
  const services = validateServices(body.services);
  const turnaroundDays = body.turnaroundDays ? num(body.turnaroundDays, { min: 1, max: 365 }) : null;

  if (commissionPct === null && flatFee === null) {
    return { error: 'Enter a commission % or flat fee for this package.' };
  }
  if (services.length === 0) {
    return { error: 'Pick at least one included service for this package.' };
  }
  return { data: { title, description, commissionPct, flatFee, services, turnaroundDays } };
}

export async function upsertPackage(db, agentUserId, tier, body) {
  if (!PACKAGE_TIERS.includes(tier)) return { error: 'Invalid package tier.' };
  const validated = validatePackageInput({ ...body, tier });
  if (validated.error) return validated;
  const d = validated.data;

  await db.prepare(
    `INSERT INTO agent_packages (agent_user_id, tier, title, description, commission_pct, flat_fee, services_json, turnaround_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_user_id, tier) DO UPDATE SET
       title = excluded.title, description = excluded.description, commission_pct = excluded.commission_pct,
       flat_fee = excluded.flat_fee, services_json = excluded.services_json, turnaround_days = excluded.turnaround_days,
       updated_at = datetime('now')`
  ).bind(agentUserId, tier, d.title, d.description, d.commissionPct, d.flatFee, JSON.stringify(d.services), d.turnaroundDays).run();

  return { ok: true };
}

export async function deletePackage(db, agentUserId, tier) {
  await db.prepare('DELETE FROM agent_packages WHERE agent_user_id = ? AND tier = ?').bind(agentUserId, tier).run();
}

function mapPackageRow(r) {
  return {
    tier: r.tier, title: r.title, description: r.description,
    commissionPct: r.commission_pct, flatFee: r.flat_fee,
    services: JSON.parse(r.services_json || '[]'), turnaroundDays: r.turnaround_days,
  };
}

export async function fetchAgentPackages(db, agentUserId) {
  const rows = await db.prepare(
    "SELECT * FROM agent_packages WHERE agent_user_id = ? ORDER BY CASE tier WHEN 'basic' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END"
  ).bind(agentUserId).all();
  return rows.results.map(mapPackageRow);
}

// A flat-fee price range across whatever packages an agent has defined —
// commission-based packages are excluded since a percentage of an unknown
// future sale price isn't a comparable dollar figure the way a flat fee is.
export function packagePriceRange(packages) {
  const flatFees = packages.map(p => p.flatFee).filter(f => f !== null && f !== undefined);
  if (flatFees.length === 0) return null;
  return { min: Math.min(...flatFees), max: Math.max(...flatFees) };
}
