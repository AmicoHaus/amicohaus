import { priceTierFor, priceTierLabel } from './util.js';

async function ensureGroup(db, type, key, label) {
  await db.prepare('INSERT OR IGNORE INTO groups (type, key, label) VALUES (?, ?, ?)').bind(type, key, label).run();
  return db.prepare('SELECT id FROM groups WHERE type = ? AND key = ?').bind(type, key).first();
}

async function ensureMembership(db, groupId, userId) {
  await db.prepare('INSERT OR IGNORE INTO group_memberships (group_id, user_id) VALUES (?, ?)').bind(groupId, userId).run();
}

// Called whenever a listing is created or its city/state/value changes, so the
// user's group memberships (price tier + local area) stay in sync automatically.
export async function syncGroupMemberships(db, userId, { city, state, estimatedValue }) {
  const tierKey = priceTierFor(estimatedValue);
  const tierGroup = await ensureGroup(db, 'price_tier', tierKey, priceTierLabel(tierKey));
  await ensureMembership(db, tierGroup.id, userId);

  const locKey = `${city}, ${state}`.toLowerCase();
  const locGroup = await ensureGroup(db, 'location', locKey, `${city}, ${state}`);
  await ensureMembership(db, locGroup.id, userId);

  return { tierGroupId: tierGroup.id, locationGroupId: locGroup.id };
}
