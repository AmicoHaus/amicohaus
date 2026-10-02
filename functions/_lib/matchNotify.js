import { rowsToProfiles, matchScore, MATCH_THRESHOLD, findRentalMatches } from './matching.js';
import { sendEmail } from './email.js';
import { sendPushToUser } from './webpush.js';
import { DEMO_EMAIL_PATTERN } from './util.js';

const LISTING_FIELDS = `listings.id AS listing_id, listings.user_id, listings.city, listings.state, listings.neighborhood,
            listings.property_type, listings.beds, listings.baths, listings.estimated_value,
            listings.is_buyer_only, listings.is_rental, listings.rent_amount,
            desired_criteria.locations, desired_criteria.property_type AS desired_type,
            desired_criteria.min_beds, desired_criteria.min_baths, desired_criteria.price_min, desired_criteria.price_max`;

// A real scheduled digest needs a cron-triggered worker this project doesn't
// have, so 'capped' email_frequency gets the same spam-reduction effect a
// simpler way: once someone's already gotten this many match emails in the
// last 24 hours, skip the email (the in-app bell notification still always
// fires) rather than send another right away.
const CAPPED_EMAILS_PER_DAY = 3;

// Matches are otherwise only ever computed on demand (when a user opens the
// Matches tab) — nobody was ever actually told a new one appeared. Called
// right after a listing is created: checks that one new listing against
// every other active listing (O(n), not the full O(n^2) graph recompute
// buildEdges would do) and notifies both sides of any brand-new mutual match.
export async function notifyNewMatches(context, newListingId) {
  const db = context.env.DB;

  // LEFT JOIN, not JOIN — a rental listing has no desired_criteria row at
  // all, so an inner join would either exclude the new listing outright (if
  // it's a rental) or drop every existing rental from the candidate pool.
  const newRow = await db.prepare(
    `SELECT ${LISTING_FIELDS}, users.display_name AS owner_name, users.email AS owner_email, users.notify_matches, users.email_frequency
     FROM listings JOIN users ON users.id = listings.user_id
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.id = ?`
  ).bind(newListingId).first();
  if (!newRow) return;

  // A bundled member listing is only tradeable through its portfolio now, so
  // it's excluded from the candidate pool the same way as matches.js.
  const others = await db.prepare(
    `SELECT ${LISTING_FIELDS}, users.display_name AS owner_name, users.email AS owner_email, users.notify_matches, users.email_frequency
     FROM listings JOIN users ON users.id = listings.user_id
     LEFT JOIN desired_criteria ON desired_criteria.listing_id = listings.id
     WHERE listings.status = 'active' AND listings.user_id != ? AND users.email NOT LIKE ?
       AND listings.id NOT IN (SELECT member_listing_id FROM portfolio_members) LIMIT 1500`
  ).bind(newRow.user_id, DEMO_EMAIL_PATTERN).all();

  const [newProfile] = rowsToProfiles([newRow]);

  // One new listing can clear the match threshold against many existing
  // listings at once (a broker's first listing landing in an active area
  // routinely produces a dozen-plus) — and a single owner can hold more than
  // one of those listings. Collecting hits per user first, instead of firing
  // a notification/email per match found, turns what would otherwise be a
  // wall of near-identical pings into one digest each. Rental hits are
  // tracked separately from plain score hits since they carry an extra year
  // range on top of the score and read out differently in the digest text.
  const perUser = new Map(); // userId -> { email, notifyMatches, emailFrequency, hits: [{name, score}], rentalHits: [{name, score, yearsLow, yearsHigh}] }
  function ensureUser(userId, email, notifyMatches, emailFrequency) {
    if (!perUser.has(userId)) perUser.set(userId, { email, notifyMatches, emailFrequency, hits: [], rentalHits: [] });
    return perUser.get(userId);
  }
  function addHit(userId, email, notifyMatches, emailFrequency, otherName, score) {
    ensureUser(userId, email, notifyMatches, emailFrequency).hits.push({ name: otherName, score });
  }
  function addRentalHit(userId, email, notifyMatches, emailFrequency, otherName, score, yearsLow, yearsHigh) {
    ensureUser(userId, email, notifyMatches, emailFrequency).rentalHits.push({ name: otherName, score, yearsLow, yearsHigh });
  }

  if (newRow.is_rental) {
    // The new listing is a rental — check it against every other active
    // seller (a plain trade listing; buyer-only and other rentals don't
    // apply here) using the same score + lump-sum year-range math as the
    // Matches tab.
    const sellerRows = others.results.filter(r => !r.is_buyer_only && !r.is_rental);
    const [rentalProfile] = rowsToProfiles([newRow]);
    const sellerProfiles = rowsToProfiles(sellerRows);
    const hits = findRentalMatches(sellerProfiles, [rentalProfile]);
    for (const hit of hits) {
      const sellerRow = sellerRows.find(r => r.listing_id === hit.sellerId);
      addRentalHit(newRow.user_id, newRow.owner_email, newRow.notify_matches, newRow.email_frequency, sellerRow.owner_name, hit.score, hit.yearsLow, hit.yearsHigh);
      addRentalHit(sellerRow.user_id, sellerRow.owner_email, sellerRow.notify_matches, sellerRow.email_frequency, newRow.owner_name, hit.score, hit.yearsLow, hit.yearsHigh);
    }
  } else if (!newRow.is_buyer_only) {
    // The new listing is a plain seller listing — check it against every
    // existing rental the same way.
    const rentalRows = others.results.filter(r => r.is_rental);
    if (rentalRows.length > 0) {
      const [sellerProfile] = rowsToProfiles([newRow]);
      const rentalProfiles = rowsToProfiles(rentalRows);
      const hits = findRentalMatches([sellerProfile], rentalProfiles);
      for (const hit of hits) {
        const rentalRow = rentalRows.find(r => r.listing_id === hit.rentalId);
        addRentalHit(newRow.user_id, newRow.owner_email, newRow.notify_matches, newRow.email_frequency, rentalRow.owner_name, hit.score, hit.yearsLow, hit.yearsHigh);
        addRentalHit(rentalRow.user_id, rentalRow.owner_email, rentalRow.notify_matches, rentalRow.email_frequency, newRow.owner_name, hit.score, hit.yearsLow, hit.yearsHigh);
      }
    }

    // newRow is a plain seller here, so this is only ever "seller wants
    // otherRow's home" (otherRow.is_buyer_only) or a reciprocal trade check —
    // rentals are excluded since they're handled by the block above.
    for (const otherRow of others.results) {
      if (otherRow.is_rental) continue;

      const [otherProfile] = rowsToProfiles([otherRow]);
      let score;
      if (otherRow.is_buyer_only) {
        score = matchScore(otherProfile.desired, newProfile.current);
        if (score < MATCH_THRESHOLD) continue;
      } else {
        const newWantsOther = matchScore(newProfile.desired, otherProfile.current);
        const otherWantsNew = matchScore(otherProfile.desired, newProfile.current);
        if (newWantsOther < MATCH_THRESHOLD || otherWantsNew < MATCH_THRESHOLD) continue;
        score = Math.round((newWantsOther + otherWantsNew) / 2);
      }

      addHit(newRow.user_id, newRow.owner_email, newRow.notify_matches, newRow.email_frequency, otherRow.owner_name, score);
      addHit(otherRow.user_id, otherRow.owner_email, otherRow.notify_matches, otherRow.email_frequency, newRow.owner_name, score);
    }
  }
  // newRow is buyer-only here — only a one-directional "does this seller's
  // home fit what the buyer wants" check applies (rentals and other
  // buyer-only listings are excluded, same as the reasoning above).
  if (newRow.is_buyer_only) {
    for (const otherRow of others.results) {
      if (otherRow.is_rental || otherRow.is_buyer_only) continue;
      const [otherProfile] = rowsToProfiles([otherRow]);
      const score = matchScore(newProfile.desired, otherProfile.current);
      if (score < MATCH_THRESHOLD) continue;
      addHit(newRow.user_id, newRow.owner_email, newRow.notify_matches, newRow.email_frequency, otherRow.owner_name, score);
      addHit(otherRow.user_id, otherRow.owner_email, otherRow.notify_matches, otherRow.email_frequency, newRow.owner_name, score);
    }
  }

  if (perUser.size === 0) return;

  const statements = [];
  const emails = [];
  for (const [userId, info] of perUser) {
    const parts = [];
    if (info.hits.length > 0) {
      const best = info.hits.reduce((b, h) => (h.score > b.score ? h : b));
      parts.push(info.hits.length === 1
        ? `a new ${best.score}% match with ${best.name}`
        : `${info.hits.length} new matches (best: ${best.score}% with ${best.name})`);
    }
    if (info.rentalHits.length > 0) {
      const best = info.rentalHits.reduce((b, h) => (h.score > b.score ? h : b));
      const range = `${best.yearsLow.toFixed(1)}-${best.yearsHigh.toFixed(1)} years`;
      parts.push(info.rentalHits.length === 1
        ? `a new ${best.score}% rental match with ${best.name} (covers about ${range})`
        : `${info.rentalHits.length} new rental matches (best: ${best.score}% with ${best.name}, about ${range})`);
    }
    const body = `You have ${parts.join(' and ')}!`;
    statements.push(db.prepare(
      "INSERT INTO notifications (user_id, type, body, link) VALUES (?, 'match', ?, '/app')"
    ).bind(userId, body));

    if (info.notifyMatches) {
      let underCap = true;
      if (info.emailFrequency === 'capped') {
        const sent = await db.prepare(
          `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'match' AND created_at >= datetime('now', '-1 day')`
        ).bind(userId).first();
        underCap = sent.n < CAPPED_EMAILS_PER_DAY;
      }
      if (underCap) {
        const totalCount = info.hits.length + info.rentalHits.length;
        emails.push({
          to: info.email,
          subject: totalCount === 1 ? 'New match on Amico Haus' : `${totalCount} new matches on Amico Haus`,
          text: `${body} Log in to see the details and send a message: ${new URL(context.request.url).origin}/app`,
        });
      }
    }
  }

  await db.batch(statements);
  // In parallel (not a sequential await loop) and allSettled (not all) — this
  // already runs in the background via context.waitUntil() in the caller, so
  // nothing is blocking on it, but a slow or failing email/push provider for
  // one user still shouldn't hold up or cancel everyone else's.
  await Promise.allSettled([
    ...emails.map(e => sendEmail(context, e)),
    ...[...perUser.keys()].map(userId => sendPushToUser(context, userId)),
  ]);
}
