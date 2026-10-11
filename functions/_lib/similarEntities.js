// "Similar homes nearby" strip for a public detail page -- real active entries from the SAME table,
// matching the current one's city or property/project type, never demo data, never itself. Same-city
// matches are preferred over same-type-only matches, most recent first within each group.
import { DEMO_EMAIL_PATTERN, escapeHtml } from './util.js';

const CONFIG = {
  listing: {
    table: 'listings', priceCol: 'estimated_value', typeCol: 'property_type', titleCol: 'title',
    statusWhere: "listings.status = 'active' AND listings.is_buyer_only = 0", userCol: 'user_id', href: id => `/listing/${id}`,
  },
  augmented_home: {
    table: 'augmented_homes', priceCol: 'asking_price', typeCol: 'property_type', titleCol: 'title',
    statusWhere: "augmented_homes.status = 'active'", userCol: 'user_id', href: id => `/augmented-home/${id}`,
  },
  green_home: {
    table: 'green_homes', priceCol: 'asking_price', typeCol: 'property_type', titleCol: 'title',
    statusWhere: "green_homes.status = 'active'", userCol: 'user_id', href: id => `/green-home/${id}`,
  },
  dev_project: {
    table: 'dev_projects', priceCol: 'funding_goal', typeCol: 'project_type', titleCol: 'title',
    statusWhere: "dev_projects.status = 'open'", userCol: 'user_id', href: id => `/project/${id}`,
  },
};

export async function fetchSimilarEntities(db, kind, { excludeId, city, state, propertyType }, limit = 4) {
  const c = CONFIG[kind];
  if (!c || (!city && !propertyType)) return [];
  const rows = await db.prepare(
    `SELECT ${c.table}.id AS id, ${c.table}.${c.titleCol} AS title, ${c.table}.${c.typeCol} AS property_type,
            ${c.table}.city AS city, ${c.table}.state AS state, ${c.table}.${c.priceCol} AS amount
     FROM ${c.table} JOIN users ON users.id = ${c.table}.${c.userCol}
     WHERE ${c.statusWhere} AND ${c.table}.id != ? AND users.email NOT LIKE ?
       AND (LOWER(${c.table}.city) = LOWER(?) OR LOWER(${c.table}.${c.typeCol}) = LOWER(?))
     ORDER BY CASE WHEN LOWER(${c.table}.city) = LOWER(?) THEN 0 ELSE 1 END, ${c.table}.created_at DESC
     LIMIT ?`
  ).bind(excludeId, DEMO_EMAIL_PATTERN, city || '', propertyType || '', city || '', limit).all();
  return rows.results.map(r => ({ id: r.id, title: r.title, propertyType: r.property_type, city: r.city, state: r.state, amount: r.amount, href: c.href(r.id) }));
}

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

export function similarEntitiesHtml(items) {
  if (!items.length) return '';
  return `
    <div class="card about-card">
      <h2>Similar Homes Nearby</h2>
      <div class="similar-grid">
        ${items.map(it => `
          <a class="similar-card" href="${it.href}">
            <strong>${escapeHtml(it.title || it.propertyType)}</strong>
            <span class="tiny">${escapeHtml(it.city)}, ${escapeHtml(it.state)}</span>
            <span class="tiny">${money(it.amount)}</span>
          </a>
        `).join('')}
      </div>
    </div>`;
}
