// Step-Down Price (nuanced ideas batch, migration_v47), trade listings only: the owner publishes every step and date
// (listings.step_down_json), and the price changes by itself on those dates until they stop it. The last published
// step is the lowest; there is no private floor (a hidden lowest price would be a reserve, and a public "next step"
// above a secret stop would mislead buyers). The page lists now and the steps still to come, to the day: never a past
// price, a clock or a countdown. listing-terms.js (the app) mirrors the math and the strings.
import { escapeHtml, priceTierFor } from './util.js';
import { pacificToday, addDays } from './timingMatch.js';
import { sqlUtc } from './contactPolicy.js';
import { logMarketEventUnlessDemo } from './marketEvents.js';

export const STEP_DAYS = [7, 14, 30]; export const STEP_MAX_STEPS = 8; export const STEP_MIN_AMOUNT = 1000;
export const STEP_HEADING = 'Price schedule (from the owner)';
export const STEP_DOWN_LINE = "The owner published this schedule and can change or stop it at any time. It isn't an auction: there is no bidding, no deadline and no winner, and nothing sells by itself. An offer made on this page is a private note to the owner, who can say yes or no at any price. Each price is the owner's own number, not an appraisal.";
export const STEP_CONFIRM = "I understand my listing's price changes by itself on these dates until I stop the schedule.";
export const STEP_AGENT_ERROR = 'Price schedules are for owners posting their own home without an agent. With a listing agreement, price changes go through that agreement and the MLS.';
export const STEP_HALF_ERROR = 'Keep the last step at or above half of your starting price.';
export const STEP_CONFIRM_ERROR = 'Tick the box to publish your schedule.';
export const STEP_KIND_ERROR = 'A price schedule is for a single home for sale or trade.';
export const STEP_PAUSED_ERROR = 'Make your listing active before you publish a price schedule.';
export const STEP_AMOUNT_ERROR = 'Step amount should be whole dollars, $1,000 or more.';
export const STEP_DAYS_ERROR = 'Pick 7, 14 or 30 days between steps.';
export const STEP_COUNT_ERROR = 'Pick 1 to 8 steps.';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const whole = v => (typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN));
const dollars = n => '$' + Number(n).toLocaleString('en-US');
const DAY_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
// One formatter for the whole module (building one per step would cost real CPU on a page render).
const PACIFIC_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' });
// 9:00 AM Pacific on a calendar date: 16:00 UTC in daylight time, 17:00 UTC in standard time (the same instant
// agentDuty.js pacificToUtcMs gives; clocks change at 2 AM, so 9 AM is never inside a change).
function nineAmPacificMs(year, month, day) {
  const guess = Date.UTC(year, month - 1, day, 16, 0);
  return Number(PACIFIC_HOUR.format(guess)) === 9 ? guess : guess + 3600000;
}

// A stored or freshly built schedule that holds together, or null.
function cleanSchedule(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const { startPrice, stepAmount, stepDays, steps, startDate } = s;
  if (!Number.isInteger(startPrice) || startPrice <= 0) return null;
  if (!Number.isInteger(stepAmount) || stepAmount < STEP_MIN_AMOUNT) return null;
  if (!STEP_DAYS.includes(stepDays)) return null;
  if (!Number.isInteger(steps) || steps < 1 || steps > STEP_MAX_STEPS) return null;
  if (typeof startDate !== 'string' || !YMD.test(startDate) || addDays(startDate, 0) !== startDate) return null;
  if ((startPrice - steps * stepAmount) * 2 < startPrice) return null;
  return { startPrice, stepAmount, stepDays, steps, startDate };
}

// The instant step k takes effect: 9:00 AM Pacific on startDate + k x stepDays (9 AM is never inside a clock change).
function stepAtMs(schedule, k) {
  const [, y, m, d] = YMD.exec(addDays(schedule.startDate, k * schedule.stepDays));
  return nineAmPacificMs(Number(y), Number(m), Number(d));
}

// The day a step takes effect, as "Tue, Dec 1" (the Pacific calendar date; dates only to the day).
function stepDayLabel(schedule, k) {
  const [, y, m, d] = YMD.exec(addDays(schedule.startDate, k * schedule.stepDays));
  return DAY_LABEL.format(Date.UTC(Number(y), Number(m) - 1, Number(d))).replace(/ /g, ' ');
}

// { data } (the schedule to store) or { error, code }. listing = the listings row (is_rental, is_buyer_only,
// is_portfolio, status, client_name, estimated_value, and bundled and agent_owner when the caller looked them up).
export function validateStepDown(body, listing, nowMs = Date.now()) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const l = listing || {};
  if (l.is_rental || l.is_buyer_only || l.is_portfolio || l.bundled) return { error: STEP_KIND_ERROR, code: 'step_down_not_for_this_listing' };
  if (l.status !== 'active') return { error: STEP_PAUSED_ERROR, code: 'step_down_not_active' };
  // A home posted for a client, or by an approved agent (agent_owner, when the caller looked it up): price changes
  // go through the listing agreement and the MLS. The same "agent-posted" rule as the head start (watchAreas.js).
  if (l.client_name || l.agent_owner) return { error: STEP_AGENT_ERROR, code: 'step_down_agent_listing' };
  const stepAmount = whole(b.stepAmount);
  if (!Number.isInteger(stepAmount) || stepAmount < STEP_MIN_AMOUNT) return { error: STEP_AMOUNT_ERROR };
  const stepDays = whole(b.stepDays);
  if (!STEP_DAYS.includes(stepDays)) return { error: STEP_DAYS_ERROR };
  const steps = whole(b.steps);
  if (!Number.isInteger(steps) || steps < 1 || steps > STEP_MAX_STEPS) return { error: STEP_COUNT_ERROR };
  const startPrice = Math.round(Number(l.estimated_value) || 0);
  // The last published step is the lowest scheduled price, and it can't go under half of where the schedule starts.
  if (startPrice <= 0 || (startPrice - steps * stepAmount) * 2 < startPrice) return { error: STEP_HALF_ERROR };
  if (b.confirm !== true) return { error: STEP_CONFIRM_ERROR };
  return { data: { startPrice, stepAmount, stepDays, steps, startDate: pacificToday(nowMs) } };
}

// The schedule stored on a listings row, or null when there is none. Never throws.
export function stepDownFromRow(row) {
  if (!row || !row.step_down_json || row.step_down_json === '{}') return null;
  try { return cleanSchedule(JSON.parse(row.step_down_json)); } catch { return null; }
}

// Where a schedule stands at nowMs: { currentPrice, done, rows: [{ label: 'Now' | 'Tue, Dec 1', price }], lastPrice,
// nextAtMs }. rows = now and the steps still to come; past prices are never listed. null when there is no schedule.
export function stepDownState(schedule, nowMs = Date.now()) {
  const s = cleanSchedule(schedule);
  if (!s) return null;
  let done = 0;
  while (done < s.steps && stepAtMs(s, done + 1) <= nowMs) done++;
  const currentPrice = s.startPrice - done * s.stepAmount;
  const rows = [{ label: 'Now', price: currentPrice }];
  for (let k = done + 1; k <= s.steps; k++) rows.push({ label: stepDayLabel(s, k), price: s.startPrice - k * s.stepAmount });
  return { currentPrice, done, rows, lastPrice: s.startPrice - s.steps * s.stepAmount, nextAtMs: done < s.steps ? stepAtMs(s, done + 1) : null };
}

// When the next step is due, as datetime('now')-style text, or null (no schedule, or the last step has passed).
export function stepNextAt(schedule, nowMs = Date.now()) {
  const state = stepDownState(schedule, nowMs);
  return state && state.nextAtMs !== null ? sqlUtc(state.nextAtMs) : null;
}

// Escaped HTML for the listing page's schedule block, or '' (no schedule, or no step still to come).
export function stepDownBlockHtml(row, nowMs = Date.now()) {
  if (!row || row.is_rental || row.is_buyer_only || row.is_portfolio) return '';
  const state = stepDownState(stepDownFromRow(row), nowMs);
  if (!state || state.rows.length < 2) return '';
  const items = state.rows.map((r, i) => `<li${i === 0 ? ' class="step-now"' : ''}>${escapeHtml(r.label)}: ${dollars(r.price)}</li>`).join('');
  return `<div class="mini-block step-schedule"><span class="label">${escapeHtml(STEP_HEADING)}</span><ol>${items}</ol><p class="tiny">No further steps are scheduled after ${dollars(state.lastPrice)}.</p><p class="tiny">${escapeHtml(STEP_DOWN_LINE)}</p></div>`;
}

// The price a page shows for a listing at nowMs: the schedule's current price while one is running (a step can be
// due a few minutes before the job writes it), else the owner's number.
export function shownPrice(row, nowMs = Date.now()) {
  const state = row ? stepDownState(stepDownFromRow(row), nowMs) : null;
  return state ? state.currentPrice : (row ? row.estimated_value : 0);
}

// Lazy job (functions/api/_middleware.js): schedules whose next step is due take it. In-app only: no email, push or
// notice, just the same price_drop market event the edit path writes (so the sparkline and Market Pulse stay true).
// One statement when nothing is due. A paused listing is skipped and catches up in one move once it is active again;
// so is a home bundled into a portfolio. A home posted for a client never steps (naming a client in an edit stops the
// schedule; this is the second lock). Each row is claimed by its old step_next_at, so two runs can't step it twice.
export async function runDueStepDowns(context, nowMs = Date.now()) {
  const db = context.env.DB;
  const due = await db.prepare(
    `SELECT id, user_id, city, state, estimated_value, step_down_json, step_next_at FROM listings
     WHERE step_next_at IS NOT NULL AND step_next_at <= ? AND status = 'active' AND client_name IS NULL
       AND id NOT IN (SELECT member_listing_id FROM portfolio_members) LIMIT 3`
  ).bind(sqlUtc(nowMs)).all();
  for (const row of due.results) {
    const state = stepDownState(stepDownFromRow(row), nowMs);
    // A schedule that can't be read is cleared (the price stays where it is).
    if (!state) {
      await db.prepare("UPDATE listings SET step_down_json = '{}', step_next_at = NULL WHERE id = ? AND step_next_at = ?").bind(row.id, row.step_next_at).run();
      continue;
    }
    const finished = state.nextAtMs === null;
    const oldPrice = Number(row.estimated_value);
    const newPrice = state.currentPrice;
    const claimed = await db.prepare(
      `UPDATE listings SET estimated_value = ?, price_tier = ?, step_next_at = ?, step_down_json = ?, updated_at = datetime('now')
       WHERE id = ? AND step_next_at = ?`
    ).bind(newPrice, priceTierFor(newPrice), finished ? null : sqlUtc(state.nextAtMs), finished ? '{}' : row.step_down_json, row.id, row.step_next_at).run();
    if (!claimed.meta || !claimed.meta.changes || !(newPrice < oldPrice)) continue;
    await logMarketEventUnlessDemo(db, row.user_id, {
      eventType: 'price_drop', entityKind: 'listing', entityId: row.id, city: row.city, state: row.state,
      headline: `Price drop in ${row.city}, ${row.state}: ${dollars(oldPrice)} → ${dollars(newPrice)}`,
      amount: newPrice, delta: newPrice - oldPrice,
    });
  }
}
