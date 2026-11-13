import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized } from '../../_lib/util.js';
import { sqlUtc } from '../../_lib/contactPolicy.js';
import { proposalsSealed } from '../../_lib/decisionNight.js';

// The person's own pre-listings, for the queries below (?1 = the account).
const MY_PRE_LISTINGS = '(SELECT id FROM pre_listings WHERE user_id = ?1)';

// Every query, by the key it fills in the file. Only this person's own data: never a password hash, a two-factor
// secret, a session or link token, a storage (R2) key, or someone else's private notes (e.g. a homeowner's
// shortlist of an agent's proposal, or their interview scores, stay out of the agent's file). Files themselves
// aren't included, only their details. ?1 = the account, ?2 = now.
const QUERIES = {
  listings: 'SELECT * FROM listings WHERE user_id = ?1',
  posts: 'SELECT * FROM posts WHERE user_id = ?1',
  comments: 'SELECT * FROM comments WHERE user_id = ?1',
  conversations: `SELECT c.id, c.created_at, u.id AS other_user_id, u.display_name AS other_name
    FROM conversations c JOIN users u ON u.id = CASE WHEN c.user_a_id = ?1 THEN c.user_b_id ELSE c.user_a_id END
    WHERE c.user_a_id = ?1 OR c.user_b_id = ?1`,
  messagesSent: 'SELECT * FROM messages WHERE sender_id = ?1',
  // Received: what the inbox shows (a message still waiting for its weekly delivery time isn't delivered yet).
  messagesReceived: `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.read_at
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE (c.user_a_id = ?1 OR c.user_b_id = ?1) AND m.sender_id != ?1 AND (m.deliver_after IS NULL OR m.deliver_after <= ?2)`,
  savedSearches: 'SELECT * FROM saved_searches WHERE user_id = ?1',
  notifications: 'SELECT * FROM notifications WHERE user_id = ?1',
  // You're in Control: the record of each agent you shared your contact info with (and when), shares other
  // homeowners made with you, and "Who saw my address" on your own pre-listings.
  contactSharesGiven: 'SELECT pre_listing_id, agent_id, shared_at FROM contact_shares WHERE owner_id = ?1',
  contactSharesReceived: 'SELECT pre_listing_id, owner_id, shared_at FROM contact_shares WHERE agent_id = ?1',
  addressViewsOfMyHomes: `SELECT v.* FROM address_views v WHERE v.pre_listing_id IN ${MY_PRE_LISTINGS}`,

  // Pre-listings you posted, and what came in on them.
  preListings: 'SELECT * FROM pre_listings WHERE user_id = ?1',
  preListingPhotos: `SELECT id, pre_listing_id, content_type, position, swept_at, created_at FROM pre_listing_photos WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  preListingPriceHistory: `SELECT * FROM pre_listing_price_history WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  showingRequests: `SELECT * FROM pre_listing_showings WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  brokerPreviews: `SELECT * FROM pre_listing_previews WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  brokerPreviewRsvps: `SELECT r.id, r.preview_id, r.agent_user_id, r.created_at FROM pre_listing_preview_rsvps r
    JOIN pre_listing_previews p ON p.id = r.preview_id WHERE p.pre_listing_id IN ${MY_PRE_LISTINGS}`,
  interviews: `SELECT * FROM pre_listing_interviews WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  finalistFeedbackSent: `SELECT * FROM finalist_debriefs WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  proposalsReceived: `SELECT id, request_type, request_id, agent_user_id, message, commission_pct, flat_fee, services_json, status, owner_pick,
      submitted_at, created_at, updated_at
    FROM service_bids WHERE request_type = 'pre_listing' AND request_id IN ${MY_PRE_LISTINGS}`,
  agentInvitesSent: 'SELECT id, request_type, request_id, agent_user_id, message, status, created_at FROM agent_invites WHERE invited_by_user_id = ?1',
  // Ready Meter: your weekly check-ins on your own pre-listings.
  readyCheckIns: `SELECT pre_listing_id, week_key, readiness, topic, created_at, updated_at FROM pre_listing_checkins WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  // Price opinions agents sent you, every version of them, and the fresh looks you asked for.
  priceOpinionsReceived: `SELECT pre_listing_id, agent_user_id, price_opinion, comps_json, note, deck_name, deck_type, deck_size, prep_json, created_at, updated_at
    FROM pre_listing_price_opinions WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  priceOpinionHistoryOnMyHomes: `SELECT 'version' AS kind, pre_listing_id, agent_user_id,
      json_object('price_opinion', price_opinion, 'source', source, 'reason', reason, 'comp_json', comp_json) AS details_json, created_at AS at
    FROM pre_listing_opinion_versions WHERE pre_listing_id IN ${MY_PRE_LISTINGS}
    UNION ALL SELECT 'refresh_ask', pre_listing_id, agent_user_id, json_object('answer', answer, 'answered_at', answered_at), asked_at
    FROM pre_listing_opinion_asks WHERE pre_listing_id IN ${MY_PRE_LISTINGS}`,
  // Owner tools: your Then & Now list and photo pairs, your repost OKs, visit feedback agents left on your homes, and
  // visit feedback you left as an agent (kind says which). Storage keys are never included.
  ownerTools: `SELECT 'upgrade' AS kind, pre_listing_id, NULL AS agent_user_id,
      json_object('category', category, 'done_year', done_year, 'done_month', done_month, 'note', note, 'permit', permit) AS details_json, created_at AS at
    FROM pre_listing_upgrades WHERE pre_listing_id IN ${MY_PRE_LISTINGS}
    UNION ALL SELECT 'then_now_pair', pre_listing_id, NULL,
      json_object('caption', caption, 'then_year', then_year, 'then_content_type', then_content_type, 'now_content_type', now_content_type, 'swept_at', swept_at), created_at
    FROM pre_listing_then_now WHERE pre_listing_id IN ${MY_PRE_LISTINGS}
    UNION ALL SELECT 'repost_ok', pre_listing_id, NULL,
      json_object('moment', moment, 'consent_version', consent_version, 'withdrawn_at', withdrawn_at), consented_at
    FROM moment_repost_consents WHERE user_id = ?1
    UNION ALL SELECT 'visit_feedback_received', pre_listing_id, agent_user_id,
      json_object('visit_kind', visit_kind, 'visit_at', visit_at, 'skipped', skipped, 'price', price, 'asking_price_at', asking_price_at, 'condition', condition, 'top_prep', top_prep, 'updated_at', updated_at), created_at
    FROM pre_listing_visit_feedback WHERE pre_listing_id IN ${MY_PRE_LISTINGS}
    UNION ALL SELECT 'visit_feedback_given', pre_listing_id, NULL,
      json_object('visit_kind', visit_kind, 'visit_at', visit_at, 'skipped', skipped, 'price', price, 'asking_price_at', asking_price_at, 'condition', condition, 'top_prep', top_prep, 'updated_at', updated_at), created_at
    FROM pre_listing_visit_feedback WHERE agent_user_id = ?1`,
  // Open houses: the ones you RSVP'd to (all three kinds of home, with rsvp_named: 1 = the owner sees your name), and the
  // ones you hosted with their address-sharing choice. Who RSVP'd to yours stays out (their data).
  // The 5th term carries the nuanced-ideas rows (watch areas, home claims, standing interest, idea outlines, Open For
  // flags, trial stays) so the export stays at 46 statements. onRequestGet moves it to its own key (nuancedIdeas).
  // Only your side of a trial stay (never the other owner's checklist); who a standing interest reached stays out.
  // D1 allows 32 arguments per SQL function, so each json_object here holds at most 16 pairs.
  openHouses: `SELECT 'rsvp_listing' AS kind, oh.listing_id AS home_id, r.open_house_id, oh.starts_at, oh.ends_at, json_object('rsvp_named', r.rsvp_named) AS details_json, r.created_at
      FROM open_house_rsvps r JOIN open_houses oh ON oh.id = r.open_house_id WHERE r.user_id = ?1
    UNION ALL SELECT 'rsvp_augmented_home', oh.augmented_home_id, r.open_house_id, oh.starts_at, oh.ends_at, json_object('rsvp_named', r.rsvp_named), r.created_at
      FROM augmented_home_open_house_rsvps r JOIN augmented_home_open_houses oh ON oh.id = r.open_house_id WHERE r.user_id = ?1
    UNION ALL SELECT 'rsvp_green_home', oh.green_home_id, r.open_house_id, oh.starts_at, oh.ends_at, json_object('rsvp_named', r.rsvp_named), r.created_at
      FROM green_home_open_house_rsvps r JOIN green_home_open_houses oh ON oh.id = r.open_house_id WHERE r.user_id = ?1
    UNION ALL SELECT 'hosted', NULL, NULL, NULL, NULL, json_object(
        'listings', (SELECT json_group_array(json_object('id', id, 'home_id', listing_id, 'starts_at', starts_at, 'ends_at', ends_at, 'note', note, 'share_address_with_rsvps', share_address_with_rsvps)) FROM open_houses WHERE listing_id IN (SELECT id FROM listings WHERE user_id = ?1)),
        'augmented_homes', (SELECT json_group_array(json_object('id', id, 'home_id', augmented_home_id, 'starts_at', starts_at, 'ends_at', ends_at, 'note', note, 'share_address_with_rsvps', share_address_with_rsvps)) FROM augmented_home_open_houses WHERE augmented_home_id IN (SELECT id FROM augmented_homes WHERE user_id = ?1)),
        'green_homes', (SELECT json_group_array(json_object('id', id, 'home_id', green_home_id, 'starts_at', starts_at, 'ends_at', ends_at, 'note', note, 'share_address_with_rsvps', share_address_with_rsvps)) FROM green_home_open_houses WHERE green_home_id IN (SELECT id FROM green_homes WHERE user_id = ?1))), NULL
    UNION ALL SELECT 'nuanced_ideas', NULL, NULL, NULL, NULL, json_object(
        'watchAreas', (SELECT json_group_array(json_object('zip', zip, 'label', label, 'created_at', created_at)) FROM watch_areas WHERE user_id = ?1),
        'homeClaims', (SELECT json_group_array(json_object('zip', zip, 'street', street_label, 'created_at', created_at)) FROM home_claims WHERE user_id = ?1),
        'standingInterests', (SELECT json_group_array(json_object('id', id, 'target_kind', target_kind, 'zip', zip, 'street', street_label, 'pre_listing_id', pre_listing_id,
            'amount', amount, 'property_type', property_type, 'min_beds', min_beds, 'financing', financing, 'timing', timing, 'status', status,
            'expires_at', expires_at, 'created_at', created_at)) FROM standing_interests WHERE user_id = ?1),
        'dealOutlines', (SELECT json_group_array(json_object('id', id, 'kind', kind, 'use_key', use_key, 'use_note', use_note, 'area_note', area_note,
            'sketch_json', sketch_json, 'term_option', term_option, 'ask', json_object('amount', ask_amount, 'per', ask_per), 'questions_json', questions_json,
            'area', json_object('zip', zip, 'city', city, 'state', state), 'listed', listed, 'status', status, 'created_at', created_at, 'updated_at', updated_at))
            FROM deal_outlines WHERE user_id = ?1),
        'openFor', (SELECT json_group_array(json_object('id', id, 'property_kind', property_kind, 'zip', zip, 'city', city, 'state', state, 'uses_json', uses_json,
            'facts_json', facts_json, 'status', status, 'created_at', created_at, 'updated_at', updated_at)) FROM open_for WHERE user_id = ?1),
        'tradeTrials', (SELECT json_group_array(json_object('id', id,
            'my_listing_id', CASE WHEN user_a_id = ?1 THEN listing_a_id ELSE listing_b_id END,
            'other_listing_id', CASE WHEN user_a_id = ?1 THEN listing_b_id ELSE listing_a_id END,
            'start_date', start_date, 'end_date', end_date, 'nights', nights, 'long_stay', long_stay,
            'my_checklist_json', CASE WHEN user_a_id = ?1 THEN checklist_a_json ELSE checklist_b_json END,
            'my_agreed_at', CASE WHEN user_a_id = ?1 THEN a_agreed_at ELSE b_agreed_at END,
            'status', status, 'created_at', created_at)) FROM trade_trials WHERE user_a_id = ?1 OR user_b_id = ?1)), NULL`,

  // As an agent.
  agentProfile: 'SELECT * FROM agent_profiles WHERE user_id = ?1',
  agentPortfolioPhotos: 'SELECT id, content_type, caption, position, created_at FROM agent_portfolio_photos WHERE agent_user_id = ?1',
  agentCaseStudies: 'SELECT id, title, result_note, before_content_type, after_content_type, position, created_at FROM agent_case_studies WHERE agent_user_id = ?1',
  agentPackages: 'SELECT * FROM agent_packages WHERE agent_user_id = ?1',
  proposalsSent: `SELECT id, request_type, request_id, message, commission_pct, flat_fee, services_json, status, submitted_at, created_at, updated_at,
      pitch_video_r2_key IS NOT NULL AS has_pitch_video
    FROM service_bids WHERE agent_user_id = ?1`,
  priceVotesMade: 'SELECT id, pre_listing_id, vote, note, created_at FROM pre_listing_price_votes WHERE agent_user_id = ?1',
  priceOpinionsMade: `SELECT id, pre_listing_id, price_opinion, comps_json, note, deck_name, deck_type, deck_size, prep_json, created_at, updated_at
    FROM pre_listing_price_opinions WHERE agent_user_id = ?1`,
  // Every version of the price opinions you shared, and the fresh looks homeowners asked you for.
  priceOpinionHistoryMade: `SELECT 'version' AS kind, pre_listing_id,
      json_object('price_opinion', price_opinion, 'source', source, 'reason', reason, 'comp_json', comp_json) AS details_json, created_at AS at
    FROM pre_listing_opinion_versions WHERE agent_user_id = ?1
    UNION ALL SELECT 'refresh_ask', pre_listing_id, json_object('answer', answer, 'answered_at', answered_at), asked_at
    FROM pre_listing_opinion_asks WHERE agent_user_id = ?1`,
  foundingSpots: 'SELECT zip, granted_at FROM founding_agents WHERE agent_user_id = ?1',
  teamMemberships: `SELECT m.team_id, t.name AS team_name, m.role, m.status, m.created_at FROM agent_team_members m
    JOIN agent_teams t ON t.id = m.team_id WHERE m.agent_user_id = ?1`,
  reviewsReceived: 'SELECT id, request_type, request_id, rating, comment, created_at FROM agent_reviews WHERE agent_user_id = ?1',
  pastClientReviewsReceived: `SELECT id, rating, comment, client_side, sale_year, sale_city, status, created_at
    FROM past_client_reviews WHERE agent_user_id = ?1`,

  // Reviews you wrote of agents you hired here, and of agents you worked with before Amico Haus (with the optional
  // street address you gave).
  reviewsWritten: 'SELECT id, agent_user_id, request_type, request_id, rating, comment, created_at FROM agent_reviews WHERE reviewer_user_id = ?1',
  pastClientReviewsWritten: `SELECT id, agent_user_id, rating, comment, client_side, sale_year, sale_city, sale_address, status, created_at
    FROM past_client_reviews WHERE reviewer_user_id = ?1`,

  // Saved alerts (AugmentedHomes adaptations you need, GreenHomes features, FinderMine projects, Market Pulse, agent
  // searches). The bookkeeping of which homes each one already told you about stays out.
  alerts: `SELECT 'accessibility' AS kind, id, label, city, state, adaptations_json AS details_json, created_at FROM accessibility_needs_alerts WHERE user_id = ?1
    UNION ALL SELECT 'green', id, label, city, state, green_features_json, created_at FROM green_needs_alerts WHERE user_id = ?1
    UNION ALL SELECT 'dev_project', id, label, city, state, json_object('project_type', project_type), created_at FROM dev_project_needs_alerts WHERE user_id = ?1
    UNION ALL SELECT 'market_pulse', id, label, city, state, json_object('event_type', event_type, 'entity_kind', entity_kind), created_at FROM market_pulse_alerts WHERE user_id = ?1
    UNION ALL SELECT 'agent_search', id, label, NULL, NULL, filters_json, created_at FROM agent_search_alerts WHERE user_id = ?1`,

  // Homes and projects you posted on AugmentedHomes, GreenHomes and FinderMine.
  augmentedHomes: 'SELECT * FROM augmented_homes WHERE user_id = ?1',
  greenHomes: 'SELECT * FROM green_homes WHERE user_id = ?1',
  // The old investment fields (minimum investment, target return) are no longer part of FinderMine.
  devProjects: `SELECT id, title, description, address, neighborhood, city, state, zip, project_type, stage, timeline_months, status,
      adaptations_json, green_features_json, created_at, updated_at
    FROM dev_projects WHERE user_id = ?1`,

  // Safety and account.
  blocks: 'SELECT blocked_id, created_at FROM user_blocks WHERE blocker_id = ?1',
  reportsFiled: 'SELECT id, target_type, target_id, reason, status, created_at, resolved_at FROM reports WHERE reporter_id = ?1',
};

// Columns that never leave the database, even in the person's own file (storage keys, tokens, who reviewed them).
const NEVER_EXPORTED = ['video_r2_key', 'license_photo_r2_key', 'review_invite_token', 'reviewed_by', 'license_verified_by', 'deck_r2_key', 'pitch_video_r2_key', 'then_r2_key', 'now_r2_key'];
const withoutSecrets = rows => rows.map(r => {
  const out = { ...r };
  for (const col of NEVER_EXPORTED) delete out[col];
  return out;
});

// Self-serve data export (GDPR/CCPA-style access request) — everything the
// platform holds that's linked to this account, as a single downloadable file.
export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const db = context.env.DB;
  const keys = Object.keys(QUERIES);
  const now = sqlUtc();
  // One round trip for all of it (and well under D1's per-request query limit).
  const results = await db.batch(keys.map(k => {
    const sql = QUERIES[k];
    return sql.includes('?2') ? db.prepare(sql).bind(user.id, now) : db.prepare(sql).bind(user.id);
  }));
  const data = Object.fromEntries(keys.map((k, i) => [k, withoutSecrets(results[i].results || [])]));
  // While a pre-listing's Decision Night is still ahead, its proposals stay sealed here too (the app shows the owner
  // only a count until then, and agents are told nobody sees theirs). Filtered on the rows already fetched, so the ISO
  // proposals_due_at is never compared with SQL time.
  const sealedDue = new Map(data.preListings.filter(p => proposalsSealed(p)).map(p => [p.id, p.proposals_due_at]));
  data.proposalsReceived = data.proposalsReceived.map(b => sealedDue.has(b.request_id)
    ? { id: b.id, request_type: b.request_type, request_id: b.request_id, agent_user_id: b.agent_user_id, status: b.status, created_at: b.created_at, sealedUntil: sealedDue.get(b.request_id) }
    : b);
  // The nuanced-ideas row rode along as the 5th term of openHouses (see QUERIES): it moves to its own key, so
  // openHouses keeps exactly the rows it always had.
  const EMPTY_IDEAS = { watchAreas: [], homeClaims: [], standingInterests: [], dealOutlines: [], openFor: [], tradeTrials: [] };
  const ideasRow = data.openHouses.find(r => r.kind === 'nuanced_ideas');
  data.openHouses = data.openHouses.filter(r => r.kind !== 'nuanced_ideas');
  let nuancedIdeas = { ...EMPTY_IDEAS };
  try {
    const parsed = JSON.parse(ideasRow.details_json);
    for (const key of Object.keys(EMPTY_IDEAS)) {
      // A list arrives as an array, or as its JSON text if the database hands a subquery's result back as plain text.
      const list = typeof parsed[key] === 'string' ? JSON.parse(parsed[key]) : parsed[key];
      nuancedIdeas[key] = Array.isArray(list) ? list : [];
    }
  } catch { nuancedIdeas = { ...EMPTY_IDEAS }; }

  const exportData = {
    account: {
      id: user.id, email: user.email, displayName: user.display_name, role: user.role, status: user.status,
      bio: user.bio || '', phone: user.phone || '', phonePublic: !!user.phone_public,
      emailVerified: !!user.email_verified, isVerified: !!user.is_verified, twoFactorEnabled: !!user.totp_enabled,
      signedInWithGoogle: !!user.google_id, referralCode: user.referral_code || null, referredBy: user.referred_by || null,
      notifyMatches: user.notify_matches !== 0, emailFrequency: user.email_frequency || 'capped',
      sellerReportOptOut: !!user.seller_report_opt_out,
      uiLang: user.ui_lang || 'en',
      signupIntent: user.signup_intent, signupSource: user.signup_source,
      termsVersion: user.terms_version || null, termsAcceptedAt: user.terms_accepted_at || null, createdAt: user.created_at,
    },
    contactSettings: { contactMode: user.contact_mode, quietStart: user.quiet_start, quietEnd: user.quiet_end, phonePublic: !!user.phone_public },
    ...data,
    nuancedIdeas,
    agentProfile: data.agentProfile[0] || null,
    exportedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="amicohaus-data-export.json"',
      // Personal data: never kept by a browser or any cache in between.
      'Cache-Control': 'private, no-store',
    },
  });
}
