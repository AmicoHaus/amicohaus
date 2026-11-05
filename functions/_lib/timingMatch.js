// Timing Match (R3-1b): the owner's closing window + stay, a buyer's move-in window + stay offer, and when they fit.
// Pure (no DB). Dates are Pacific calendar dates as 'YYYY-MM-DD' text, built and compared as strings and through
// Date.UTC, never parsed in local time. Only days are stored: no rent-back amount, deposit or per diem, ever.

// The stay after closing is capped at 29 days (Rudy 11.04): a stay of 30 days or more can create a tenancy, and the
// agents write any rent-back terms. The migration_v44 CHECKs cap it at 29 too.
export const STAY_DAYS = [0, 7, 14, 29];
export const STAY_MAX_DAYS = 29;
// A window can be up to a year long, and both ends must fall within two years from today.
export const WINDOW_MAX_DAYS = 366;
export const WINDOW_HORIZON_DAYS = 730;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function pacificToday(nowMs = Date.now()) {
  return new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function utcMs(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function ymdFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return ymdFromMs(Date.UTC(y, m - 1, d + Number(n || 0)));
}

// A real calendar date in the 'YYYY-MM-DD' shape ('2027-02-30' isn't one).
function isDate(s) {
  return typeof s === 'string' && YMD.test(s) && addDays(s, 0) === s;
}

const LABEL_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const LABEL_FMT_NO_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// "Mar 1 – May 31, 2027" in one year, "Dec 1, 2026 – Feb 15, 2027" across two.
export function windowLabel(from, to) {
  if (!isDate(from) || !isDate(to)) return '';
  const a = utcMs(from), b = utcMs(to);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${LABEL_FMT_NO_YEAR.format(a)} – ${LABEL_FMT.format(b)}`;
  return `${LABEL_FMT.format(a)} – ${LABEL_FMT.format(b)}`;
}

const blank = (v) => v === '' || v === null || v === undefined;

const WINDOW_TEXT = {
  closing: { half: 'Pick both dates for your closing window, or clear both.', range: 'Pick closing dates between today and two years from now.' },
  move: { half: 'Pick both dates for your move-in window, or clear both.', range: 'Pick move-in dates between today and two years from now.' },
};

// { value: { from, to } }, { value: null } (both blank = cleared) or { error }. prev: the window already saved; an
// unchanged window skips the date checks, so one that slid into the past can be re-saved with a new stay.
export function validateWindow(fromRaw, toRaw, { prev = null, kind = 'closing', nowMs = Date.now() } = {}) {
  const text = WINDOW_TEXT[kind] || WINDOW_TEXT.closing;
  if (blank(fromRaw) && blank(toRaw)) return { value: null };
  if (blank(fromRaw) || blank(toRaw)) return { error: text.half };
  const from = String(fromRaw).trim(), to = String(toRaw).trim();
  if (prev && prev.from === from && prev.to === to) return { value: { from, to } };
  const today = pacificToday(nowMs);
  if (!isDate(from) || !isDate(to) || from < today || to > addDays(today, WINDOW_HORIZON_DAYS)) return { error: text.range };
  if (to < from) return { error: 'The end date has to be on or after the start date.' };
  if ((utcMs(to) - utcMs(from)) / DAY_MS > WINDOW_MAX_DAYS) return { error: 'Keep the window to one year or less.' };
  return { value: { from, to } };
}

export function validateStayDays(raw) {
  if (blank(raw)) return { value: 0 };
  const n = Number(raw);
  if (typeof raw !== 'boolean' && STAY_DAYS.includes(n)) return { value: n };
  return { error: 'Pick no stay, or up to 7, 14 or 29 days.' };
}

// The owner's side: body.closeFrom, body.closeTo, body.stayAfterDays. prevRow: the saved pre_listings row, if any.
export function validateOwnerTiming(body, prevRow = null) {
  const b = body || {};
  const prev = prevRow ? { from: prevRow.close_from, to: prevRow.close_to } : null;
  const w = validateWindow(b.closeFrom, b.closeTo, { prev, kind: 'closing' });
  if (w.error) return { error: w.error };
  const stay = validateStayDays(b.stayAfterDays);
  if (stay.error) return { error: stay.error };
  return { data: { closeFrom: w.value ? w.value.from : null, closeTo: w.value ? w.value.to : null, stayAfterDays: stay.value } };
}

// The buyer's side, on a saved search: body.moveFrom, body.moveTo, body.stayOfferDays. prevRow: the saved row, if any.
export function validateSearchTiming(body, prevRow = null) {
  const b = body || {};
  const prev = prevRow ? { from: prevRow.move_from, to: prevRow.move_to } : null;
  const w = validateWindow(b.moveFrom, b.moveTo, { prev, kind: 'move' });
  if (w.error) return { error: w.error };
  const stay = validateStayDays(b.stayOfferDays);
  if (stay.error) return { error: stay.error };
  return { data: { moveFrom: w.value ? w.value.from : null, moveTo: w.value ? w.value.to : null, stayOfferDays: stay.value } };
}

// A yes/no between two people's own entries, never a score. search: a saved_searches row { move_from, move_to,
// stay_offer_days }; home: { closeFrom, closeTo, stayAfterDays }. It fits when the buyer can offer at least the stay
// the owner wants AND the buyer's move-in window overlaps the hand-over window (the closing window moved by the
// stay). Touching days count. A window that has passed never fits.
export function timingFits(search, home, today = pacificToday()) {
  if (!search || !home) return false;
  if (!search.move_from || !search.move_to || !home.closeFrom || !home.closeTo) return false;
  if (home.closeTo < today || search.move_to < today) return false;
  const stay = Number(home.stayAfterDays) || 0;
  if ((Number(search.stay_offer_days) || 0) < stay) return false;
  return search.move_from <= addDays(home.closeTo, stay) && search.move_to >= addDays(home.closeFrom, stay);
}

// What the detail GET sends. The owner always gets their timing (with windowPassed). Admins and approved agents get
// it only when something is set, and never a window that has passed (it goes out as null dates, so an agent never
// reads a stale window). Nobody else.
export function timingForViewer(row, { isOwner = false, isAdmin = false, isAgent = false } = {}) {
  if (!row) return undefined;
  const closeFrom = row.close_from || null, closeTo = row.close_to || null;
  const stayAfterDays = Number(row.stay_after_days) || 0;
  const passed = !!closeTo && closeTo < pacificToday();
  if (isOwner) return { closeFrom, closeTo, stayAfterDays, windowPassed: passed };
  if (!isAdmin && !isAgent) return undefined;
  if (!closeFrom && !closeTo && !stayAfterDays) return undefined;
  return { closeFrom: passed ? null : closeFrom, closeTo: passed ? null : closeTo, stayAfterDays };
}

// One line for Rudy's new-pre-listing alert; '' when nothing is set.
export function timingAlertLine(d) {
  if (!d) return '';
  const n = Number(d.stayAfterDays) || 0;
  const hasWindow = !!(d.closeFrom && d.closeTo);
  if (!hasWindow && !n) return '';
  const stay = n ? ` · stay up to ${n} days after closing` : '';
  return `Ideal closing: ${hasWindow ? windowLabel(d.closeFrom, d.closeTo) : 'not picked'}${stay}`;
}
