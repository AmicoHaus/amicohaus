// A homeowner's saved agent-directory search — the reverse of the existing
// new-request alert (marketplaceNotify.js notifyAgentsNewRequest): instead
// of pinging agents about a new request, this pings a homeowner when an
// agent newly matches criteria they've saved. Checked at the two points an
// agent's directory-visible data actually changes: getting approved, and
// saving/updating a package (see checkAlertsForAgent's call sites).
import { clampString } from './util.js';
import { agentMatchesFilters, buildAgentDirectoryEntry } from './agentDirectory.js';

const MAX_ALERTS_PER_USER = 10;

function sanitizeFilters(body) {
  const num = v => (v || v === 0) ? Number(v) : null;
  return {
    q: clampString(body.q, 80) || null,
    service: clampString(body.service, 40) || null,
    minRating: num(body.minRating),
    topRatedOnly: !!body.topRatedOnly,
    licenseVerifiedOnly: !!body.licenseVerifiedOnly,
    hasVideoOnly: !!body.hasVideoOnly,
    priceMin: num(body.priceMin),
    priceMax: num(body.priceMax),
    zip: clampString(body.zip, 10) || null,
    specialtyTag: clampString(body.specialtyTag, 40) || null,
    language: clampString(body.language, 40) || null,
    soloAgentOnly: !!body.soloAgentOnly,
    minReviewCount: num(body.minReviewCount),
    minYearsExperience: num(body.minYearsExperience),
    maxAvgDaysOnMarket: num(body.maxAvgDaysOnMarket),
    minHomesSoldLastYear: num(body.minHomesSoldLastYear),
    minSaleToListRatio: num(body.minSaleToListRatio),
    maxCommissionPct: num(body.maxCommissionPct),
    maxTurnaroundDays: num(body.maxTurnaroundDays),
    openHouseDay: clampString(body.openHouseDay, 12) || null,
    hasCaseStudiesOnly: !!body.hasCaseStudiesOnly,
    acceptingClientsOnly: !!body.acceptingClientsOnly,
    eoInsuranceOnly: !!body.eoInsuranceOnly,
    localSpecialistOnly: !!body.localSpecialistOnly,
  };
}

export async function saveAlert(db, userId, body) {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM agent_search_alerts WHERE user_id = ?').bind(userId).first();
  if (count.n >= MAX_ALERTS_PER_USER) return { error: `You can have at most ${MAX_ALERTS_PER_USER} saved searches.` };

  const label = clampString(body.label, 80) || 'Agent search';
  const filters = sanitizeFilters(body.filters || body);

  // A search with nothing selected matches every agent, so the alert would
  // fire for each one that ever joins — almost certainly a mis-click.
  const hasCriterion = Object.values(filters).some(v => v !== null && v !== false);
  if (!hasCriterion) return { error: 'Pick at least one filter first — an alert with no filters would match every agent.' };
  const result = await db.prepare(
    'INSERT INTO agent_search_alerts (user_id, label, filters_json) VALUES (?, ?, ?)'
  ).bind(userId, label, JSON.stringify(filters)).run();
  return { id: result.meta.last_row_id };
}

export async function fetchMyAlerts(db, userId) {
  const rows = await db.prepare(
    'SELECT id, label, filters_json, created_at FROM agent_search_alerts WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return rows.results.map(r => ({ id: r.id, label: r.label, filters: JSON.parse(r.filters_json || '{}'), createdAt: r.created_at }));
}

export async function deleteAlert(db, userId, alertId) {
  await db.prepare('DELETE FROM agent_search_alerts WHERE id = ? AND user_id = ?').bind(alertId, userId).run();
}

// Called after an agent becomes approved, or after they save a package —
// the two events that can newly bring them into a saved search's results.
// Only ever notifies once per (alert, agent) pair.
export async function checkAlertsForAgent(db, agentUserId) {
  const entry = await buildAgentDirectoryEntry(db, agentUserId);
  if (!entry) return;

  const alerts = await db.prepare('SELECT * FROM agent_search_alerts').all();
  for (const alert of alerts.results) {
    const notified = new Set(JSON.parse(alert.notified_agent_ids_json || '[]'));
    if (notified.has(agentUserId)) continue;

    const filters = JSON.parse(alert.filters_json || '{}');
    if (!(await agentMatchesFilters(db, entry, filters))) continue;

    notified.add(agentUserId);
    await db.prepare('UPDATE agent_search_alerts SET notified_agent_ids_json = ? WHERE id = ?')
      .bind(JSON.stringify([...notified]), alert.id).run();
    await db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'marketplace', ?, ?)"
    ).bind(alert.user_id, `${entry.displayName} newly matches your saved search "${alert.label}".`, `/app#agent-${agentUserId}`).run();
  }
}
