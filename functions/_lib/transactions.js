import { clampString } from './util.js';
import { matchScore, rowsToProfiles, MATCH_THRESHOLD } from './matching.js';

const LISTING_FIELDS = `listings.id, listings.user_id, listings.city, listings.state, listings.neighborhood,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value,
            listings.is_buyer_only, listings.is_rental, listings.is_portfolio,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min, desired_criteria.price_max`;

// Opened from an EXISTING mutual match — re-verified here rather than
// trusted from the client, since a transaction request is otherwise just
// two arbitrary listing ids. Matches are never persisted anywhere (matches.js
// computes them fresh every time), so this is the one place that has to
// re-derive "are these two actually a mutual match" from scratch.
export async function openTransactionRequest(db, openedByUserId, listingId1, listingId2, note) {
  const id1 = Number(listingId1);
  const id2 = Number(listingId2);
  if (!Number.isInteger(id1) || !Number.isInteger(id2) || id1 === id2) {
    return { error: 'Pick two different listings.' };
  }
  const [lowId, highId] = id1 < id2 ? [id1, id2] : [id2, id1];

  const rows = await db.prepare(
    `SELECT ${LISTING_FIELDS} FROM listings LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.id IN (?, ?) AND listings.status = 'active'`
  ).bind(lowId, highId).all();
  const rowLow = rows.results.find(r => r.id === lowId);
  const rowHigh = rows.results.find(r => r.id === highId);
  if (!rowLow || !rowHigh) return { error: 'Both listings must be active.' };
  if (rowLow.user_id === rowHigh.user_id) return { error: "You can't open a transaction request against your own listing." };
  if (rowLow.user_id !== openedByUserId && rowHigh.user_id !== openedByUserId) {
    return { error: 'You must own one of these two listings.' };
  }
  if (rowLow.is_buyer_only || rowHigh.is_buyer_only || rowLow.is_rental || rowHigh.is_rental) {
    return { error: 'Only a genuine reciprocal trade match can be opened to bid — buyer profiles and rentals have nothing reciprocal to close.' };
  }

  const [profileLow, profileHigh] = rowsToProfiles([rowLow, rowHigh]);
  const scoreLowWantsHigh = matchScore(profileLow.desired, profileHigh.current);
  const scoreHighWantsLow = matchScore(profileHigh.desired, profileLow.current);
  if (scoreLowWantsHigh < MATCH_THRESHOLD || scoreHighWantsLow < MATCH_THRESHOLD) {
    return { error: "These two listings aren't actually a mutual match." };
  }

  const existing = await db.prepare('SELECT id FROM transaction_requests WHERE listing_a_id = ? AND listing_b_id = ?').bind(lowId, highId).first();

  await db.prepare(
    `INSERT INTO transaction_requests (opened_by_user_id, listing_a_id, listing_b_id, user_a_id, user_b_id, note)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(listing_a_id, listing_b_id) DO UPDATE SET note = excluded.note, updated_at = datetime('now')`
  ).bind(openedByUserId, lowId, highId, rowLow.user_id, rowHigh.user_id, clampString(note, 1000)).run();

  const row = await db.prepare('SELECT id FROM transaction_requests WHERE listing_a_id = ? AND listing_b_id = ?').bind(lowId, highId).first();
  return { id: row.id, isNew: !existing };
}

export async function fetchTransactionRequest(db, id) {
  const row = await db.prepare(
    `SELECT transaction_requests.*,
            la.title AS listing_a_title, la.city AS listing_a_city, la.state AS listing_a_state, la.estimated_value AS listing_a_value, la.property_type AS listing_a_type,
            lb.title AS listing_b_title, lb.city AS listing_b_city, lb.state AS listing_b_state, lb.estimated_value AS listing_b_value, lb.property_type AS listing_b_type,
            ua.display_name AS user_a_name, ub.display_name AS user_b_name
     FROM transaction_requests
     JOIN listings AS la ON la.id = transaction_requests.listing_a_id
     JOIN listings AS lb ON lb.id = transaction_requests.listing_b_id
     JOIN users AS ua ON ua.id = transaction_requests.user_a_id
     JOIN users AS ub ON ub.id = transaction_requests.user_b_id
     WHERE transaction_requests.id = ?`
  ).bind(id).first();
  if (!row) return null;

  return {
    id: row.id, status: row.status, note: row.note, createdAt: row.created_at, awardedBidId: row.awarded_bid_id,
    listingA: { id: row.listing_a_id, userId: row.user_a_id, owner: row.user_a_name, title: row.listing_a_title, city: row.listing_a_city, state: row.listing_a_state, estimatedValue: row.listing_a_value, propertyType: row.listing_a_type },
    listingB: { id: row.listing_b_id, userId: row.user_b_id, owner: row.user_b_name, title: row.listing_b_title, city: row.listing_b_city, state: row.listing_b_state, estimatedValue: row.listing_b_value, propertyType: row.listing_b_type },
  };
}

export async function fetchMyTransactionRequests(db, userId) {
  const rows = await db.prepare(
    `SELECT id FROM transaction_requests WHERE user_a_id = ? OR user_b_id = ? ORDER BY created_at DESC`
  ).bind(userId, userId).all();
  const out = [];
  for (const r of rows.results) {
    const full = await fetchTransactionRequest(db, r.id);
    if (full) out.push(full);
  }
  return out;
}

// Open requests only, for agents browsing the marketplace.
export async function fetchOpenTransactionRequests(db, limit = 60) {
  const rows = await db.prepare(
    `SELECT id FROM transaction_requests WHERE status = 'open' ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  const out = [];
  for (const r of rows.results) {
    const full = await fetchTransactionRequest(db, r.id);
    if (full) out.push(full);
  }
  return out;
}
