// Test-Drive Trade (nuanced ideas batch, migration_v47): two owners of a mutual trade match record that both said yes
// to a short trial stay, the dates (Pacific dates) and the checklist each confirmed (trade_trials). Not a contract,
// and never called an agreement on screen (the site only keeps a record of the two yeses);
// no addresses and no money fields on the site.
//
// What the site stores: the pair, the dates, each side's ticked checklist and the time each said yes. No amount, no
// deposit, no house rules text, no document, no signature. A block either way, a suspended owner or a listing that
// is no longer active makes the trial disappear for both (and "agree" answers 404).
import { DEMO_EMAIL_PATTERN } from './util.js';
import { notBlockedSql } from './blocks.js';
import { pacificToday, addDays, windowLabel } from './timingMatch.js';
import { toolLive } from './nuancedGate.js';

export const TRIAL_MAX_NIGHTS = 29; export const TRIAL_LONG_MAX_NIGHTS = 90;
export const TRIAL_LINE = "A trial stay is between the two of you. Amico Haus only records that you both said yes, the dates and this checklist. That record isn't a contract, and Amico Haus doesn't provide one, handle money or share addresses.";
export const TRIAL_ADDRESS_LINE = "Addresses aren't shared here. Exchange them yourselves in Messages when you're both ready.";
export const TRIAL_LONG_LINE = 'A stay of 30 days or more can create a tenancy with tenant protections, and your lender, insurer, HOA and city may each have a say. Have an attorney write your agreement first.';
export const TRIAL_CHECKLIST = {
  insurance: "I've checked that my homeowner's insurance covers a guest staying in my home.",
  hoa: "I've checked my HOA's rules on guests and short stays.",
  city: "I've checked my city's rules on short stays (they can apply even when no money changes hands).",
  no_money: 'No money, deposit or fee goes through Amico Haus, and none is recorded here.',
  own_home: 'I stay responsible for my own home, mortgage, bills and belongings.',
  own_agreement: "We'll write down what we agree between ourselves. Amico Haus doesn't provide a contract.",
};
export const TRIAL_LONG_ACK = "I understand a stay of 30 days or more can create a tenancy, and that we'll have an attorney write our agreement first.";

// The "Test-drive a trade" idea card (ideaCards.js, key trial), word for word.
export const TRIAL_CARD_LINES = [
  "Before you commit to a trade, the two of you can try staying in each other's homes for a short time. The default is up to 29 nights: you pick the dates and each tick a short checklist.",
  TRIAL_LINE,
  `Longer stays are an option with one more note: ${TRIAL_LONG_LINE}`,
];

export const TRIAL_LONG_ERROR = 'Trial stays here are up to 29 nights. Longer is an option: read the note and tick the box.';
export const TRIAL_CHECKLIST_ERROR = 'Tick every line to continue.';
export const TRIAL_DATES_ERROR = 'Pick a start date and an end date.';
export const TRIAL_START_ERROR = 'The start date should be today or later, and within a year.';
export const TRIAL_ORDER_ERROR = 'The end date should be after the start date.';
export const TRIAL_TOO_LONG_ERROR = 'A trial stay here can be up to 90 nights.';
export const TRIAL_PARTNER_ONLY_ERROR = 'Only your trade partner can say yes to these dates.';
export const TRIAL_CANCELED_ERROR = 'This trial stay was canceled. Suggest new dates to start again.';
export const TRIAL_PAST_ERROR = 'These dates have passed. Suggest new dates.';
// A member gets at most this many 'trade_trial' notices a day.
export const TRIAL_NOTICES_PER_DAY = 10;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => typeof s === 'string' && YMD.test(s) && addDays(s, 0) === s;
const dayNumber = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400e3); };

// Pacific dates. The start is from today to a year out; nights = the day difference: 1 to 29, or 30 to 90 only with
// the long-stay acknowledgment. { data: { startDate, endDate, nights, longStay } } or { error }.
export function validateTrialDates(body, nowMs = Date.now()) {
  const b = body || {};
  if (!isDate(b.startDate) || !isDate(b.endDate)) return { error: TRIAL_DATES_ERROR };
  const today = pacificToday(nowMs);
  if (b.startDate < today || b.startDate > addDays(today, 365)) return { error: TRIAL_START_ERROR };
  const nights = dayNumber(b.endDate) - dayNumber(b.startDate);
  if (nights < 1) return { error: TRIAL_ORDER_ERROR };
  if (nights > TRIAL_LONG_MAX_NIGHTS) return { error: TRIAL_TOO_LONG_ERROR };
  if (nights > TRIAL_MAX_NIGHTS && b.longStayAck !== true) return { error: TRIAL_LONG_ERROR };
  return { data: { startDate: b.startDate, endDate: b.endDate, nights, longStay: nights > TRIAL_MAX_NIGHTS ? 1 : 0 } };
}

// The checklist must hold every TRIAL_CHECKLIST key (an array of keys, or an object of key: true). Returns the keys
// in the written order, or null when a line is missing.
export function validateTrialChecklist(raw) {
  const ticked = Array.isArray(raw)
    ? new Set(raw.map(String))
    : new Set(Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(([, v]) => v === true).map(([k]) => k));
  const keys = Object.keys(TRIAL_CHECKLIST);
  return keys.every(k => ticked.has(k)) ? keys : null;
}

// "Mar 1 – Mar 15, 2027" (the Timing Match label).
export function trialRangeLabel(startDate, endDate) {
  return windowLabel(startDate, endDate);
}

export const trialProposedNotice = (name, start, end) => `${name || 'Your trade partner'} suggested a trial stay for your trade match, ${trialRangeLabel(start, end)}. Nothing is recorded as a yes until you both say yes.`;
export const trialAgreedNotice = (name, start, end) => `${name || 'Your trade partner'} said yes to the trial stay, ${trialRangeLabel(start, end)}. This record isn't a contract: write down what you agree between yourselves.`;
export const trialCanceledNotice = (name) => `${name || 'Your trade partner'} canceled the trial stay for your trade match.`;

// In-app note to the partner (ONE statement; never an email or a push). Left out: a suspended or demo partner, a
// partner past today's cap, and, while the tool is admin-only (nuancedGate.js), anyone who isn't an admin.
export async function notifyTrialPartner(db, env, partnerId, body, trialId) {
  await db.prepare(
    `INSERT INTO notifications (user_id, type, body, link)
     SELECT u.id, 'trade_trial', ?2, ?3 FROM users u
     WHERE u.id = ?1 AND u.status = 'active' AND u.email NOT LIKE ?4
       AND (SELECT COUNT(*) FROM notifications n WHERE n.user_id = u.id AND n.type = 'trade_trial' AND n.created_at > datetime('now', '-1 day')) < ${TRIAL_NOTICES_PER_DAY}
       AND (?5 = 1 OR u.role = 'admin')`
  ).bind(partnerId, body, `/app#trade-trial-${trialId}`, DEMO_EMAIL_PATTERN, toolLive(env, 'testDrive', null) ? 1 : 0).run();
}

// The trials a person is part of, joined to both listings and both owners: only where both listings are active,
// both owners active and there is no block either way. ?1 = the viewer; oneId: also "AND t.id = ?2".
function visibleSql({ oneId = false } = {}) {
  return `SELECT t.id, t.listing_a_id, t.listing_b_id, t.user_a_id, t.user_b_id, t.proposed_by_user_id, t.start_date, t.end_date, t.nights, t.long_stay,
            t.a_agreed_at, t.b_agreed_at, t.status, t.updated_at,
            la.property_type AS a_type, la.city AS a_city, la.state AS a_state, lb.property_type AS b_type, lb.city AS b_city, lb.state AS b_state,
            oa.display_name AS a_name, ob.display_name AS b_name
     FROM trade_trials t
     JOIN listings la ON la.id = t.listing_a_id JOIN listings lb ON lb.id = t.listing_b_id
     JOIN users oa ON oa.id = t.user_a_id JOIN users ob ON ob.id = t.user_b_id
     WHERE (t.user_a_id = ?1 OR t.user_b_id = ?1) AND la.status = 'active' AND lb.status = 'active'
       AND oa.status = 'active' AND ob.status = 'active'
       AND ${notBlockedSql('t.user_a_id', 't.user_b_id')}
       ${oneId ? 'AND t.id = ?2' : ''}
     ORDER BY t.updated_at DESC, t.id DESC LIMIT ${oneId ? 1 : 50}`;
}

// One trial as its viewer sees it. No address, ever: the two exchange them in Messages.
export function trialItem(r, userId) {
  const iAmA = r.user_a_id === userId;
  const home = (type, city, state) => `${type} in ${[city, state].filter(Boolean).join(', ')}`;
  return {
    id: r.id,
    myListingId: iAmA ? r.listing_a_id : r.listing_b_id,
    otherListingId: iAmA ? r.listing_b_id : r.listing_a_id,
    other: { id: iAmA ? r.user_b_id : r.user_a_id, name: iAmA ? r.b_name : r.a_name },
    otherHome: iAmA ? home(r.b_type, r.b_city, r.b_state) : home(r.a_type, r.a_city, r.a_state),
    startDate: r.start_date, endDate: r.end_date, rangeLabel: trialRangeLabel(r.start_date, r.end_date),
    nights: r.nights, longStay: !!r.long_stay,
    iAgreed: !!(iAmA ? r.a_agreed_at : r.b_agreed_at), theyAgreed: !!(iAmA ? r.b_agreed_at : r.a_agreed_at),
    status: r.status, proposedByMe: r.proposed_by_user_id === userId,
  };
}

// Mine, newest change first. ONE statement.
export async function fetchMyTrials(db, userId) {
  const rows = await db.prepare(visibleSql()).bind(userId).all();
  return (rows.results || []).map(r => trialItem(r, userId));
}

// The raw row of one trial the viewer can see, or null (not theirs, a block, a suspension, a listing not active).
export async function fetchVisibleTrial(db, userId, trialId) {
  return db.prepare(visibleSql({ oneId: true })).bind(userId, trialId).first();
}

// Writes a proposal onto the pair (pair = verifyMutualPair's answer). A new row is 'proposed' with the proposer's
// checklist and yes. On an existing row: different dates replace the dates and clear the OTHER side's yes; the same
// dates from the other owner count as their yes; a canceled row starts over. Returns { id, status, isNew, notice } (notice:
// 'proposed' | 'agreed' | null = what the partner should be told). Two statements (the pair's row, the write).
export async function proposeTrial(db, userId, pair, dates, checklistKeys) {
  const { lowId, highId, rowLow, rowHigh } = pair;
  const iAmA = rowLow.user_id === userId;
  const checklist = JSON.stringify(checklistKeys);
  const existing = await db.prepare(
    'SELECT id, status, start_date, end_date, a_agreed_at, b_agreed_at FROM trade_trials WHERE listing_a_id = ? AND listing_b_id = ?'
  ).bind(lowId, highId).first();

  if (!existing) {
    const result = await db.prepare(
      `INSERT INTO trade_trials (listing_a_id, listing_b_id, user_a_id, user_b_id, proposed_by_user_id, start_date, end_date, nights, long_stay,
         checklist_a_json, checklist_b_json, a_agreed_at, b_agreed_at, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ${iAmA ? "datetime('now')" : 'NULL'}, ${iAmA ? 'NULL' : "datetime('now')"}, 'proposed')
       ON CONFLICT(listing_a_id, listing_b_id) DO NOTHING`
    ).bind(lowId, highId, rowLow.user_id, rowHigh.user_id, userId, dates.startDate, dates.endDate, dates.nights, dates.longStay,
      iAmA ? checklist : '[]', iAmA ? '[]' : checklist).run();
    if (result.meta && result.meta.changes) return { id: result.meta.last_row_id, status: 'proposed', isNew: true, notice: 'proposed' };
    // Both owners proposed at the same moment: the other one's row is there now.
    const row = await db.prepare('SELECT id, status FROM trade_trials WHERE listing_a_id = ? AND listing_b_id = ?').bind(lowId, highId).first();
    return { id: row.id, status: row.status, isNew: false, notice: null };
  }

  const sameDates = existing.status !== 'canceled' && existing.start_date === dates.startDate && existing.end_date === dates.endDate;
  const otherAgreed = sameDates && !!(iAmA ? existing.b_agreed_at : existing.a_agreed_at);
  const status = otherAgreed ? 'agreed' : 'proposed';
  const mine = iAmA ? 'a' : 'b', theirs = iAmA ? 'b' : 'a';
  await db.prepare(
    `UPDATE trade_trials SET start_date = ?1, end_date = ?2, nights = ?3, long_stay = ?4, status = ?5,
       checklist_${mine}_json = ?6, ${mine}_agreed_at = COALESCE(${sameDates ? `${mine}_agreed_at` : 'NULL'}, datetime('now')),
       ${sameDates ? '' : `checklist_${theirs}_json = '[]', ${theirs}_agreed_at = NULL, proposed_by_user_id = ?8,`}
       canceled_by_user_id = NULL, updated_at = datetime('now')
     WHERE id = ?7`
  ).bind(...[dates.startDate, dates.endDate, dates.nights, dates.longStay, status, checklist, existing.id].concat(sameDates ? [] : [userId])).run();
  // The partner hears about new dates, or about a yes that completes the pair; resubmitting the same thing is quiet.
  const notice = !sameDates ? 'proposed' : (otherAgreed && existing.status !== 'agreed' ? 'agreed' : null);
  return { id: existing.id, status, isNew: false, notice };
}
