// "Share my contact info with this agent" and "Who saw my address" on a pre-listing. The exact street address
// (and the owner's phone and email) reach an agent only two ways: the owner shares their contact info with that
// agent, or the agent RSVPs to a broker preview the owner opened (sellerPrep.js fetchPreviews). Each time either
// shows the address to an agent it's logged here, so the owner can see exactly who saw it and when. Rows go away
// with the pre-listing (ON DELETE CASCADE).

export const SHARE_NOT_ENGAGED = "You can share with agents who've sent you a proposal, opinion or request for this home.";

// Logs one look at the address: the first one adds the row, later ones move last_seen_at and count up.
export async function logAddressView(db, preListingId, agentId, via) {
  await db.prepare(
    `INSERT INTO address_views (pre_listing_id, agent_id, via) VALUES (?, ?, ?)
     ON CONFLICT(pre_listing_id, agent_id, via) DO UPDATE SET last_seen_at = datetime('now'), view_count = view_count + 1`
  ).bind(Number(preListingId), Number(agentId), via).run();
}

// Whether this agent has done something on THIS home the owner can see: a proposal (not withdrawn), a price vote
// or opinion, an interview, a showing request or a broker preview RSVP. Sharing is offered only to them.
export async function hasEngagedWithPreListing(db, preListingId, agentId) {
  const row = await db.prepare(
    `SELECT 1 AS yes WHERE
       EXISTS (SELECT 1 FROM service_bids WHERE request_type = 'pre_listing' AND request_id = ?1 AND agent_user_id = ?2 AND status != 'withdrawn')
       OR EXISTS (SELECT 1 FROM pre_listing_price_votes WHERE pre_listing_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM pre_listing_price_opinions WHERE pre_listing_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM pre_listing_interviews WHERE pre_listing_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM pre_listing_showings WHERE pre_listing_id = ?1 AND agent_user_id = ?2)
       OR EXISTS (SELECT 1 FROM pre_listing_preview_rsvps r JOIN pre_listing_previews p ON p.id = r.preview_id
                  WHERE p.pre_listing_id = ?1 AND r.agent_user_id = ?2)`
  ).bind(Number(preListingId), Number(agentId)).first();
  return !!row;
}

// An approved agent on an active account (who a share can go to).
export async function isActiveApprovedAgent(db, agentId) {
  const row = await db.prepare(
    `SELECT 1 AS yes FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.user_id = ? AND agent_profiles.status = 'approved' AND users.status = 'active'`
  ).bind(agentId).first();
  return !!row;
}

// Idempotent: sharing twice keeps the first shared_at. isNew says whether this call made the share.
export async function shareContact(db, preListingId, ownerId, agentId) {
  const added = await db.prepare('INSERT OR IGNORE INTO contact_shares (pre_listing_id, owner_id, agent_id) VALUES (?, ?, ?)')
    .bind(preListingId, ownerId, agentId).run();
  const row = await db.prepare('SELECT shared_at FROM contact_shares WHERE pre_listing_id = ? AND agent_id = ?').bind(preListingId, agentId).first();
  return { isNew: !!(added.meta && added.meta.changes), sharedAt: row ? row.shared_at : null };
}

export async function stopSharingContact(db, preListingId, agentId) {
  await db.prepare('DELETE FROM contact_shares WHERE pre_listing_id = ? AND agent_id = ?').bind(preListingId, agentId).run();
}

// For the owner only: who they've shared with, newest first, each with the agent's identity line parts.
export async function fetchContactShares(db, preListingId) {
  const rows = await db.prepare(
    `SELECT s.agent_id, s.shared_at, users.display_name AS agent_name, ap.license_number, ap.brokerage_name
     FROM contact_shares s JOIN users ON users.id = s.agent_id LEFT JOIN agent_profiles ap ON ap.user_id = s.agent_id
     WHERE s.pre_listing_id = ? ORDER BY s.shared_at DESC, s.id DESC`
  ).bind(preListingId).all();
  return rows.results.map(r => ({
    agentId: r.agent_id, agentName: r.agent_name, licenseNumber: r.license_number || '', brokerageName: r.brokerage_name || '',
    sharedAt: r.shared_at,
  }));
}

// For the owner only: every agent the exact address was shown to, most recent look first.
export async function fetchAddressViews(db, preListingId) {
  const rows = await db.prepare(
    `SELECT v.agent_id, v.via, v.first_seen_at, v.last_seen_at, v.view_count, users.display_name AS agent_name, ap.license_number, ap.brokerage_name
     FROM address_views v JOIN users ON users.id = v.agent_id LEFT JOIN agent_profiles ap ON ap.user_id = v.agent_id
     WHERE v.pre_listing_id = ? ORDER BY v.last_seen_at DESC, v.first_seen_at DESC`
  ).bind(preListingId).all();
  return rows.results.map(r => ({
    agentId: r.agent_id, agentName: r.agent_name, licenseNumber: r.license_number || '', brokerageName: r.brokerage_name || '',
    via: r.via, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, viewCount: r.view_count,
  }));
}

// What an agent the owner shared with sees: the exact address, the owner's phone ('' if none) and email. Only
// while the share stands and the home is still open or awarded; each look is logged for the owner.
export async function fetchSharedContact(db, preListing, agentId) {
  if (preListing.status !== 'open' && preListing.status !== 'awarded') return null;
  const row = await db.prepare(
    `SELECT s.shared_at, users.display_name, users.phone, users.email
     FROM contact_shares s JOIN users ON users.id = s.owner_id
     WHERE s.pre_listing_id = ? AND s.agent_id = ? AND s.owner_id = ?`
  ).bind(preListing.id, agentId, preListing.user_id).first();
  if (!row) return null;
  await logAddressView(db, preListing.id, agentId, 'share');
  return { address: preListing.address || '', phone: row.phone || '', email: row.email || '', ownerName: row.display_name, sharedAt: row.shared_at };
}
