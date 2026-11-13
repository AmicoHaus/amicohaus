// True Cost to Run, Will It Fit? and Signal Map (migration_v47): owner-entered bills and solar details, measurements,
// and the owner's own speed tests and cell bars on a trade listing or a pre-listing (run_costs_json, fit_json,
// signal_json; '{}' = nothing entered, a missing key = the owner didn't say). Pages print them under a "(from the
// owner)" heading with a confirm line. The site adds nothing up, estimates nothing and vouches for nothing (Rudy's jury
// test): no totals, no yearly figures, no savings or payback, no "will fit", no coverage score.
import { clampString, escapeHtml } from './util.js';
import { ideaTextProblem } from './ideaText.js';
import { SOLAR, homeFactsFromRow } from './homeFacts.js';
import { pacificToday } from './timingMatch.js';
import { FCC_MOBILE } from './fccMobileSd.js';

export const HOME_DATA_KINDS = { listing: 'listings', pre_listing: 'pre_listings' };
// Each group's column, and the launch-gate tool it belongs to (nuancedGate.js).
export const HOME_DATA_GROUPS = {
  runCosts: { column: 'run_costs_json', tool: 'runCosts' },
  fit: { column: 'fit_json', tool: 'willItFit' },
  signal: { column: 'signal_json', tool: 'signalMap' },
};

// ---- Allowed values -> the label pages print ----
export const BILLS = { electric: 'Electric', gas: 'Gas', water: 'Water', trashSewer: 'Trash and sewer' };
export const BILL_BASIS = { last_12: "from the owner's last 12 months of bills", estimate: "the owner's rough estimate" };
export const SOLAR_PROGRAMS = { nem1: 'NEM 1.0', nem2: 'NEM 2.0', nbt: 'Net Billing (NBT)', not_sure: "the owner isn't sure" };
export const FIT_ROOMS = {
  living: 'Living room', family: 'Family room', dining: 'Dining room', kitchen: 'Kitchen', primary_bed: 'Primary bedroom',
  bed2: 'Bedroom 2', bed3: 'Bedroom 3', bed4: 'Bedroom 4', bed5: 'Bedroom 5', office: 'Office', bonus: 'Bonus room', laundry: 'Laundry room',
};
export const ISPS = { cox: 'Cox', att: 'AT&T', spectrum: 'Spectrum', tmobile_home: 'T-Mobile Home Internet', verizon_home: 'Verizon Home Internet', starlink: 'Starlink', other: 'another provider' };
export const CONNS = { wifi: 'Wi-Fi', wired: 'wired' };
export const CARRIERS = { att: 'AT&T', tmobile: 'T-Mobile', verizon: 'Verizon', other: 'another carrier' };
export const SIGNAL_AREAS = {
  inside_front: 'inside at the front', inside_back: 'inside at the back', upstairs: 'upstairs', kitchen: 'in the kitchen',
  primary_bed: 'in the primary bedroom', office: 'in the office', garage: 'in the garage', backyard: 'in the backyard', front_yard: 'out front',
};
export const NETS = { '5g': '5G', lte: 'LTE', not_sure: '' };
// What a carrier reported to the FCC for a ZIP code, as the loader buckets it (fccMobileSd.js).
export const COVER = ['not reported', 'in parts of the ZIP', 'in most of the ZIP', 'across the ZIP'];

// ---- Limits and the owner's error messages ----
export const MAX_ROOMS = 12, MAX_SPEED_TESTS = 3, MAX_BARS = 16;
export const BILL_ERROR = 'Monthly bills should be whole dollars from 0 to 5000.';
export const BASIS_ERROR = 'Say whether these come from your last 12 months of bills or are a rough estimate.';
export const SOLAR_KW_ERROR = 'System size should be between 0.5 and 50 kW.';
export const SOLAR_KWH_ERROR = 'Last-12-month production should be whole kWh from 0 to 60000.';
export const SOLAR_YEAR_ERROR = 'Year installed should be a year from 1990 to this year.';
export const SOLAR_WARRANTY_ERROR = 'Warranty end should be a year from 2000 to 2075.';
export const FIT_ERROR = 'Measurements should be whole inches in a sensible range.';
export const FIT_ROOM_ERROR = 'Pick a room for each row of sizes.';
export const SPEED_ERROR = 'Speeds should be between 0.1 and 10000 Mbps.';
export const SPEED_ROW_ERROR = 'Each speed test needs a download speed, an upload speed and the month you ran it.';
export const BARS_ERROR = 'Bars should be a whole number from 0 to 5.';
export const BARS_ROW_ERROR = 'Each signal spot needs a carrier, a place and the number of bars.';
export const BARS_DATE_ERROR = 'Add the month you checked the bars.';
export const MONTH_ERROR = 'Months should be from January 2020 to this month.';
const RANGES = {
  bill: [0, 5000, BILL_ERROR], kwh12: [0, 60000, SOLAR_KWH_ERROR], warrantyEnd: [2000, 2075, SOLAR_WARRANTY_ERROR],
  room: [36, 720, FIT_ERROR], door: [20, 96, FIT_ERROR],
  garageDoorWidth: [60, 240, FIT_ERROR], garageDoorHeight: [60, 192, FIT_ERROR], garageDepth: [120, 600, FIT_ERROR], garageWidth: [96, 600, FIT_ERROR],
  sideWidth: [24, 480, FIT_ERROR], overhead: [60, 240, FIT_ERROR], bars: [0, 5, BARS_ERROR],
};

// ---- Headings and confirm lines (exact; client.js mirrors them word for word) ----
export const RUN_COSTS_HEADING = "Cost to run (the owner's own bills)";
export const RUN_COSTS_CONFIRM_LINE = "These are this owner's bills, not a prediction of yours. Bills change with rates, weather, who lives in a home and how they use it. Ask to see recent bills.";
export const SOLAR_HEADING = 'Solar (from the owner)';
export const SOLAR_CONFIRM_LINE = "A billing program, a lease or a PPA doesn't always pass to a new owner the same way. Ask the utility and the solar company, and read the contract.";
export const FIT_HEADING = "Will it fit? (from the owner's measurements)";
export const FIT_CONFIRM_LINE = "Based on the owner's measurements; measure before you move. Stairs, hallways, turns and slopes aren't included.";
export const SIGNAL_HEADING = 'Signal and internet (from the owner)';
export const SIGNAL_CONFIRM_LINE = "The owner's own tests on their own devices and plans, on the dates shown. Signal and speed change with the device, the plan, the weather and where you stand, so test it yourself on your visit.";
export const COVERAGE_LINE = "Reported by the carrier to the FCC; real signal varies. It's outdoor coverage across the whole ZIP code as carriers report it, not a test at this home.";
export const AREA_CONTEXT_BUTTON = 'How do bills run nearby?';
export const FCC_MAP_URL = 'https://broadbandmap.fcc.gov/';
export const FCC_MAP_LINK = 'Check an exact address on the FCC map ↗';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (map, v) => (typeof v === 'string' && Object.hasOwn(map, v) ? v : undefined);
const blank = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
class DataError extends Error {}

// Keeps only the keys that have a value, so an empty group is left out.
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) continue;
    out[k] = v;
  }
  return out;
}
// "2026-11" -> "Nov 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
// 170 -> "14 ft 2 in."
export function ftIn(inches) {
  const ft = Math.floor(inches / 12), inch = inches % 12;
  return ft && inch ? `${ft} ft ${inch} in.` : ft ? `${ft} ft` : `${inch} in.`;
}

// The shape rules, shared by the validator (strict: a bad value is an error for the owner) and by reading a row back
// (not strict: a bad value is dropped). month = the current Pacific month ('YYYY-MM').
function shaper({ strict, month }) {
  const fail = (error) => { if (strict) throw new DataError(error); return undefined; };
  // Blank = not given; anything else must be a whole number in range.
  const whole = (v, [min, max, error]) => {
    if (blank(v)) return undefined;
    const n = typeof v === 'number' ? v : (/^\s*\d+\s*$/.test(v) ? Number(v) : NaN);
    return Number.isInteger(n) && n >= min && n <= max ? n : fail(error);
  };
  // A number kept to one decimal (system size, speeds).
  const oneDecimal = (v, min, max, error) => {
    if (blank(v)) return undefined;
    const n = typeof v === 'number' ? v : (/^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
    if (!Number.isFinite(n) || n < min || n > max) return fail(error);
    return Math.round(n * 10) / 10;
  };
  // 'YYYY-MM', from January 2020 to this month.
  const ym = (v) => {
    if (blank(v)) return undefined;
    const s = String(v).trim();
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && s >= '2020-01' && s <= month ? s : fail(MONTH_ERROR);
  };
  // "Another provider / carrier": the owner's own few words, only with 'other', through the shared text checks.
  const otherName = (key, v, max) => {
    if (key !== 'other') return undefined;
    const s = clampString(typeof v === 'string' ? v : '', max);
    if (!s) return undefined;
    if (strict) { const e = ideaTextProblem(s); if (e) throw new DataError(e); }
    return s;
  };

  return {
    // Bills need their basis (and, read back, the month they were entered). Solar details are kept only for a home
    // whose owner says it has solar (hasSolar; null = not known here, so they're kept).
    runCosts(input, { hasSolar = null } = {}) {
      const src = isObj(input) ? input : {};
      const b = isObj(src.bills) ? src.bills : {};
      const bills = compact(Object.fromEntries(Object.keys(BILLS).map(k => [k, whole(b[k], RANGES.bill)])));
      const out = {};
      if (Object.keys(bills).length) {
        const basis = pick(BILL_BASIS, src.basis);
        // Never from the request: the Pacific month of the save.
        const asOf = strict ? month : (monthLabel(src.asOf) ? src.asOf : undefined);
        if (!basis) fail(BASIS_ERROR);
        if (basis && asOf) Object.assign(out, { bills, basis, asOf });
      }
      if (hasSolar !== false) {
        const s = isObj(src.solar) ? src.solar : {};
        const solar = compact({
          kw: oneDecimal(s.kw, 0.5, 50, SOLAR_KW_ERROR), year: whole(s.year, [1990, Number(month.slice(0, 4)), SOLAR_YEAR_ERROR]),
          kwh12: whole(s.kwh12, RANGES.kwh12), warrantyEnd: whole(s.warrantyEnd, RANGES.warrantyEnd), program: pick(SOLAR_PROGRAMS, s.program),
        });
        if (Object.keys(solar).length) out.solar = solar;
      }
      return out;
    },

    fit(input) {
      const src = isObj(input) ? input : {};
      const rooms = [];
      const seen = new Set();
      for (const r of Array.isArray(src.rooms) ? src.rooms : []) {
        if (!isObj(r)) continue;
        const room = pick(FIT_ROOMS, r.room);
        const widthIn = whole(r.widthIn, RANGES.room), lengthIn = whole(r.lengthIn, RANGES.room), doorIn = whole(r.doorIn, RANGES.door);
        if (widthIn === undefined && lengthIn === undefined && doorIn === undefined) continue; // an empty row
        if (!room) { fail(FIT_ROOM_ERROR); continue; }
        if (widthIn === undefined || lengthIn === undefined) { fail(FIT_ERROR); continue; }
        if (seen.has(room) || rooms.length >= MAX_ROOMS) continue; // one row per room
        seen.add(room);
        rooms.push(compact({ room, widthIn, lengthIn, doorIn }));
      }
      const g = isObj(src.garage) ? src.garage : {}, a = isObj(src.access) ? src.access : {};
      const sideWidthIn = whole(a.sideWidthIn, RANGES.sideWidth);
      return compact({
        rooms,
        garage: compact({
          doorWidthIn: whole(g.doorWidthIn, RANGES.garageDoorWidth), doorHeightIn: whole(g.doorHeightIn, RANGES.garageDoorHeight),
          depthIn: whole(g.depthIn, RANGES.garageDepth), widthIn: whole(g.widthIn, RANGES.garageWidth),
        }),
        // The overhead is "along the side-yard path", so it's kept only with the path's width.
        access: compact({ sideWidthIn, overheadIn: sideWidthIn === undefined ? undefined : whole(a.overheadIn, RANGES.overhead) }),
      });
    },

    signal(input) {
      const src = isObj(input) ? input : {};
      const speedTests = [];
      for (const t of Array.isArray(src.speedTests) ? src.speedTests : []) {
        if (!isObj(t)) continue;
        const down = oneDecimal(t.down, 0.1, 10000, SPEED_ERROR), up = oneDecimal(t.up, 0.1, 10000, SPEED_ERROR), date = ym(t.date);
        if (down === undefined && up === undefined && date === undefined) continue; // an empty row
        if (down === undefined || up === undefined || date === undefined) { fail(SPEED_ROW_ERROR); continue; }
        if (speedTests.length >= MAX_SPEED_TESTS) continue;
        const provider = pick(ISPS, t.provider);
        speedTests.push(compact({ down, up, provider, providerOther: otherName(provider, t.providerOther, 40), conn: pick(CONNS, t.conn), date }));
      }
      const bars = [];
      for (const r of Array.isArray(src.bars) ? src.bars : []) {
        if (!isObj(r)) continue;
        const carrier = pick(CARRIERS, r.carrier), area = pick(SIGNAL_AREAS, r.area), n = whole(r.bars, RANGES.bars);
        if (!carrier && !area && n === undefined) continue; // an empty row
        if (!carrier || !area || n === undefined) { fail(BARS_ROW_ERROR); continue; }
        if (bars.length >= MAX_BARS) continue;
        bars.push(compact({ carrier, carrierOther: otherName(carrier, r.carrierOther, 30), area, bars: n, net: pick(NETS, r.net) }));
      }
      const out = compact({ speedTests });
      if (bars.length) {
        const date = ym(src.date);
        if (!date) fail(BARS_DATE_ERROR);
        else Object.assign(out, { bars, date });
      }
      return out;
    },
  };
}

// The owner's form -> what gets stored: { data } holding only the groups the body has (runCosts, fit, signal), each
// with only known keys and values, or { error } (a message for the owner). facts = the home's stored home facts (for
// "does this home have solar"); nowMs sets the month bills are stamped with.
export function validateHomeData(input, { kind, facts = null, nowMs = Date.now() } = {}) {
  const src = isObj(input) ? input : {};
  const shape = shaper({ strict: true, month: pacificToday(nowMs).slice(0, 7) });
  const solar = facts && isObj(facts.yard) ? facts.yard.solar : undefined;
  try {
    const data = {};
    if (Object.hasOwn(src, 'runCosts')) data.runCosts = shape.runCosts(src.runCosts, { hasSolar: facts === null ? null : !!solar && solar !== 'none' });
    if (Object.hasOwn(src, 'fit')) data.fit = shape.fit(src.fit);
    if (Object.hasOwn(src, 'signal')) data.signal = shape.signal(src.signal);
    return { data };
  } catch (e) {
    if (e instanceof DataError) return { error: e.message };
    throw e;
  }
}

// The three groups parsed from a listings or pre_listings row. Never throws: bad JSON is {}, bad values are dropped.
export function homeDataFromRow(row, { nowMs = Date.now() } = {}) {
  const parse = (text) => { try { return JSON.parse(text || '{}') || {}; } catch { return {}; } };
  const shape = shaper({ strict: false, month: pacificToday(nowMs).slice(0, 7) });
  const r = row || {};
  const safe = (fn, text) => { try { return fn(parse(text)); } catch { return {}; } };
  return { runCosts: safe(shape.runCosts, r.run_costs_json), fit: safe(shape.fit, r.fit_json), signal: safe(shape.signal, r.signal_json) };
}

// The lines each block prints (plain text; the page escapes them and joins them with ' · '). Every number is one the
// owner typed: nothing is added up. coverage comes from the generated FCC module and only for a ZIP it holds.
export function homeDataLines(data, facts, { zip = '' } = {}) {
  const d = isObj(data) ? data : {};
  const rc = isObj(d.runCosts) ? d.runCosts : {}, fit = isObj(d.fit) ? d.fit : {}, sig = isObj(d.signal) ? d.signal : {};
  const yard = isObj(facts) && isObj(facts.yard) ? facts.yard : {};
  const dollars = n => `$${Number(n).toLocaleString('en-US')}`;

  const runCosts = [];
  const bills = isObj(rc.bills) ? rc.bills : {};
  for (const [k, label] of Object.entries(BILLS)) {
    if (!Number.isInteger(bills[k])) continue;
    runCosts.push(bills[k] === 0 ? `${label} $0/mo` : `${label} about ${dollars(bills[k])}/mo`);
  }
  if (runCosts.length) runCosts.push(`Monthly averages ${BILL_BASIS[rc.basis] || ''}, entered ${monthLabel(rc.asOf)}`);

  const solar = [];
  const s = isObj(rc.solar) ? rc.solar : {};
  if (SOLAR[yard.solar] && yard.solar !== 'none' && Object.keys(s).length) {
    solar.push(`Solar panels: ${SOLAR[yard.solar]}`);
    if (s.kw) solar.push(`System size ${s.kw} kW`);
    if (s.year) solar.push(`Installed ${s.year}`);
    if (Number.isInteger(s.kwh12)) solar.push(`Made about ${s.kwh12.toLocaleString('en-US')} kWh in the last 12 months (owner's reading)`);
    if (s.warrantyEnd) solar.push(`Warranty through ${s.warrantyEnd}`);
    if (SOLAR_PROGRAMS[s.program]) solar.push(`Billing program: ${SOLAR_PROGRAMS[s.program]}`);
  }

  const fitLines = [];
  for (const r of Array.isArray(fit.rooms) ? fit.rooms : []) {
    if (!FIT_ROOMS[r.room]) continue;
    fitLines.push(`${FIT_ROOMS[r.room]} about ${ftIn(r.widthIn)} × ${ftIn(r.lengthIn)}${r.doorIn ? `, doorway ${r.doorIn} in.` : ''}`);
  }
  const g = isObj(fit.garage) ? fit.garage : {}, a = isObj(fit.access) ? fit.access : {};
  const pair = (x, xWord, y, yWord) => [x ? `${ftIn(x)} ${xWord}` : '', y ? `${ftIn(y)} ${yWord}` : ''].filter(Boolean).join(' × ');
  if (g.doorWidthIn || g.doorHeightIn) fitLines.push(`Garage door about ${pair(g.doorWidthIn, 'wide', g.doorHeightIn, 'high')}`);
  if (g.depthIn || g.widthIn) fitLines.push(`Garage inside about ${pair(g.depthIn, 'deep', g.widthIn, 'wide')}`);
  if (a.sideWidthIn) {
    fitLines.push(`Side-yard path about ${ftIn(a.sideWidthIn)} wide at its narrowest`);
    if (a.overheadIn) fitLines.push(`Lowest overhead along it about ${ftIn(a.overheadIn)}`);
  }

  const signal = [];
  for (const t of Array.isArray(sig.speedTests) ? sig.speedTests : []) {
    const isp = t.provider === 'other' && t.providerOther ? t.providerOther : ISPS[t.provider];
    signal.push(`Internet speed test: ${t.down} Mbps down / ${t.up} Mbps up${isp ? ` on ${isp}` : ''}${CONNS[t.conn] ? ` (${CONNS[t.conn]})` : ''}, ${monthLabel(t.date)}`);
  }
  const bars = Array.isArray(sig.bars) ? sig.bars : [];
  for (const r of bars) {
    const carrier = r.carrier === 'other' && r.carrierOther ? r.carrierOther : CARRIERS[r.carrier];
    signal.push(`Cell bars: ${carrier} ${r.bars} of 5 ${SIGNAL_AREAS[r.area]}${NETS[r.net] ? ` (${NETS[r.net]})` : ''}`);
  }
  if (bars.length) signal.push(`Bars checked ${monthLabel(sig.date)}`);

  const coverage = [];
  const reported = /^\d{5}$/.test(String(zip || '')) && Object.hasOwn(FCC_MOBILE.zips, zip) ? FCC_MOBILE.zips[zip] : null;
  if (isObj(reported)) {
    for (const [k, label] of Object.entries(CARRIERS)) {
      const v = reported[k];
      if (!Array.isArray(v)) continue;
      coverage.push(`${label}: 5G reported ${COVER[v[1]] || COVER[0]}; 4G reported ${COVER[v[0]] || COVER[0]}`);
    }
  }
  return { runCosts, solar, fit: fitLines, signal, coverage };
}

// What the fit checker needs, as numbers and fixed room keys only (never text the owner typed): the owner's
// measurements plus the gate opening and driveway length from the home facts (homeFacts.js toy group).
export function fitSpaces(data, facts) {
  const fit = isObj(data) && isObj(data.fit) ? data.fit : {};
  const toy = isObj(facts) && isObj(facts.toy) ? facts.toy : {};
  return compact({
    rooms: Array.isArray(fit.rooms) ? fit.rooms : [], garage: isObj(fit.garage) ? fit.garage : {}, access: isObj(fit.access) ? fit.access : {},
    gateIn: Number.isInteger(toy.gateIn) ? toy.gateIn : undefined, drivewayFt: Number.isInteger(toy.drivewayFt) ? toy.drivewayFt : undefined,
  });
}

// The blocks as escaped HTML, from already-parsed data (client.js homeDataDetailHtml prints the same HTML).
// live = liveTools(...). signedIn + kind + id place the area-context button (gate areaContext; needs a ZIP).
export function homeDataHtml(data, facts, { zip = '', live = {}, signedIn = false, kind = 'listing', id = 0 } = {}) {
  const on = isObj(live) ? live : {};
  const g = homeDataLines(data, facts, { zip });
  const block = (heading, lines, extra) => (lines.length
    ? `<p class="tiny home-facts"><span class="label">${escapeHtml(heading)}</span> ${escapeHtml(lines.join(' · '))}</p><p class="tiny">${escapeHtml(extra)}</p>` : '');

  let hasBlock = '';
  if (on.runCosts) hasBlock += block(RUN_COSTS_HEADING, g.runCosts, RUN_COSTS_CONFIRM_LINE) + block(SOLAR_HEADING, g.solar, SOLAR_CONFIRM_LINE);
  if (on.areaContext && signedIn && /^\d{5}$/.test(String(zip || '')) && Number(id) > 0) {
    hasBlock += `<p class="tiny"><button type="button" class="link-btn" data-action="hd-area-context" data-kind="${escapeHtml(kind)}" data-id="${Number(id)}">${escapeHtml(AREA_CONTEXT_BUTTON)}</button></p><div class="hd-context" data-hd-context></div>`;
  }

  let cards = '';
  const spaces = fitSpaces(data, facts);
  if (on.willItFit && Object.keys(spaces).length) {
    // Numbers and fixed keys only; '<', '&' and the quote are escaped so the JSON can sit in the attribute.
    const jsonText = JSON.stringify(spaces).replace(/</g, '\\u003c').replace(/&/g, '\\u0026').replace(/'/g, '\\u0027');
    cards += `<div class="card about-card" data-fit='${jsonText}'><h2>${escapeHtml(FIT_HEADING)}</h2>${g.fit.length ? `<p class="tiny home-facts">${escapeHtml(g.fit.join(' · '))}</p>` : ''}<div class="fit-checker" data-fit-checker></div><p class="tiny">${escapeHtml(FIT_CONFIRM_LINE)}</p></div>`;
  }
  if (on.signalMap && g.signal.length) {
    const coverage = on.fccCoverage && g.coverage.length
      ? `<p class="tiny home-facts"><span class="label">${escapeHtml(`Carrier-reported coverage for ZIP ${zip} (FCC, data as of ${FCC_MOBILE.asOf})`)}</span> ${escapeHtml(g.coverage.join(' · '))}</p><p class="tiny">${escapeHtml(COVERAGE_LINE)}</p><p class="tiny"><a href="${FCC_MAP_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(FCC_MAP_LINK)}</a></p>`
      : '';
    cards += `<div class="card about-card"><h2>${escapeHtml(SIGNAL_HEADING)}</h2><p class="tiny home-facts">${escapeHtml(g.signal.join(' · '))}</p><p class="tiny">${escapeHtml(SIGNAL_CONFIRM_LINE)}</p>${coverage}</div>`;
  }
  return { hasBlock, cards };
}

// Escaped HTML for the listing page, from the row it already fetched (three small JSON parses, no query): hasBlock
// goes inside the "Has" block, cards after it. live = liveTools(...). facts = the row's home facts when the caller
// has already parsed them (the listing page has).
export function homeDataBlocksHtml(row, live, { signedIn = false, kind = 'listing', facts = null } = {}) {
  const r = row || {};
  return homeDataHtml(homeDataFromRow(r), facts || homeFactsFromRow(r), { zip: r.zip || '', live, signedIn, kind, id: r.id });
}
