// Nuanced ideas batch, role H (server side): True Cost to Run, Will It Fit? and Signal Map. The homeData.js rules and
// lines, PUT /api/home-data/:kind/:id, GET /api/home-data/context (the launch gate, 5 owners per bill, one entry per
// owner), the listing page's new blocks (no extra statement against HEAD's page, nothing in JSON-LD, the lender note
// untouched), the carrier-coverage block from a stubbed FCC module, and the two hand-run loaders on fixtures.
// Runs the real handlers on an in-memory SQLite stand-in for D1 (schema.sql) with a statement counter. No network; the
// loaders are never run against real downloads here.
// Usage: node --disable-warning=ExperimentalWarning tools/home-data-test.mjs "<project root>"
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) { console.error('Usage: node --disable-warning=ExperimentalWarning tools/home-data-test.mjs <projectRoot>'); process.exit(2); }
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mod = p => import(pathToFileURL(path.join(root, p)).href);

let passed = 0, failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${String(detail).slice(0, 500)}`}`); };
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran without crashing`, false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); } };

// ---- D1 stand-in with a statement counter ----
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(read('schema.sql'));
let statements = 0;
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { statements++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { statements++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { statements++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*(SELECT|WITH)/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : (() => { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; })()),
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const st of stmts) { statements++; out.push(await st.batchResult()); } return out; },
};
const PHOTOS = { put: async () => {}, get: async () => null, delete: async () => {} };
const envAll = { DB, PHOTOS, NUANCED_ALL_LIVE: '1' };   // every tool on (the test harness and the preview env only)
const envShip = { DB, PHOTOS };                          // the gate as it ships
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const call = async (handler, method, urlPath, who, params = {}, body, env = envAll) => {
  const request = new Request(`https://amicohaus.com${urlPath}`, {
    method,
    headers: { ...(who ? { Cookie: `ah_session=t${who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const pending = [];
  statements = 0;
  const res = await handler({ request, env, params, waitUntil(p) { if (p && p.catch) pending.push(p.catch(() => {})); } });
  const counted = statements;
  await Promise.all(pending);
  const type = res.headers.get('Content-Type') || '';
  const text = await res.text();
  let json = null;
  if (type.includes('json')) { try { json = JSON.parse(text); } catch { json = null; } }
  return { status: res.status, headers: res.headers, text, json, statements: counted };
};
console.log = () => {};
console.warn = () => {};

// ---- People ----
// 1 owner, 2 member, 3 admin, 10-15 other owners in the ZIP, 16 a demo account, 17 suspended.
const people = [[1, 'Olive Owner', 'user'], [2, 'Max Member', 'user'], [3, 'Ada Admin', 'admin'], ...[10, 11, 12, 13, 14, 15].map(id => [id, `Owner ${id}`, 'user'])];
for (const [id, name, role] of people) run('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)', id, `u${id}@example.test`, name, role);
run("INSERT INTO users (id, email, display_name) VALUES (16, 'sample16@demo.amicohaus.local', 'Demo Owner')");
run("INSERT INTO users (id, email, display_name, status) VALUES (17, 'u17@example.test', 'Sus Owner', 'suspended')");
for (const id of [...people.map(p => p[0]), 16, 17]) run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);

const lib = await mod('functions/_lib/homeData.js');
const gate = await mod('functions/_lib/nuancedGate.js');
const { FCC_MOBILE } = await mod('functions/_lib/fccMobileSd.js');
const { SDGE_ZIP_USAGE } = await mod('functions/_lib/sdgeZipUsage.js');
const { pacificToday } = await mod('functions/_lib/timingMatch.js');
const { escapeHtml } = await mod('functions/_lib/util.js');
const homeText = await mod('functions/_lib/homeText.js');
const THIS_MONTH = pacificToday().slice(0, 7);
const THIS_YEAR = Number(THIS_MONTH.slice(0, 4));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = ym => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

// ---- Homes ----
const FACTS_SOLAR = { yard: { solar: 'ppa' }, toy: { gateIn: 120, drivewayFt: 40, garage: 2 } };
const RUN_COSTS = { bills: { electric: 183, gas: 40, water: 95, trashSewer: 0 }, basis: 'last_12', asOf: '2026-10', solar: { kw: 6.4, year: 2021, kwh12: 9800, warrantyEnd: 2046, program: 'nem2' } };
const FIT = { rooms: [{ room: 'living', widthIn: 170, lengthIn: 216, doorIn: 32 }, { room: 'primary_bed', widthIn: 150, lengthIn: 168 }], garage: { doorWidthIn: 192, doorHeightIn: 84, depthIn: 240, widthIn: 228 }, access: { sideWidthIn: 132, overheadIn: 108 } };
const SIGNAL = { speedTests: [{ down: 480.5, up: 22, provider: 'cox', conn: 'wifi', date: '2026-10' }, { down: 90, up: 12, provider: 'other', providerOther: 'Race Fiber', conn: 'wired', date: '2026-09' }],
  bars: [{ carrier: 'att', area: 'kitchen', bars: 4, net: '5g' }, { carrier: 'tmobile', area: 'backyard', bars: 2, net: 'lte' }, { carrier: 'verizon', area: 'upstairs', bars: 0, net: 'not_sure' }], date: '2026-10' };
const L = (id, userId, extra = {}) => {
  run(`INSERT INTO listings (id, user_id, title, address, neighborhood, city, state, zip, property_type, beds, baths, sqft, estimated_value, price_tier, is_rental, rent_amount,
         min_lease_months, is_portfolio, is_buyer_only, status, home_facts_json, run_costs_json, fit_json, signal_json)
       VALUES (?, ?, ?, '1218 La Vida Ct', 'EastLake', 'Chula Vista', 'CA', ?, 'Single Family Home', 3, 2, ?, 800000, '600k-1m', ?, ?, 12, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, extra.title || `Home ${id}`, extra.zip ?? '91915', extra.sqft ?? 2200, extra.rental ? 1 : 0, extra.rental ? 4500 : 0, extra.portfolio ? 1 : 0, extra.buyerOnly ? 1 : 0,
    extra.status || 'active', JSON.stringify(extra.facts || {}), JSON.stringify(extra.runCosts || {}), JSON.stringify(extra.fit || {}), JSON.stringify(extra.signal || {}));
  if (!extra.rental) run(`INSERT INTO desired_criteria (listing_id, locations, property_type, min_beds, min_baths, price_min, price_max) VALUES (?, 'Chula Vista', 'Any', 0, 0, 0, 1000000)`, id);
};
const PL = (id, userId, extra = {}) => run(`INSERT INTO pre_listings (id, user_id, title, address, neighborhood, city, state, zip, property_type, beds, baths, sqft, asking_price, status, run_costs_json)
     VALUES (?, ?, ?, '9 Test Ct', 'EastLake', 'Chula Vista', 'CA', ?, 'Condo', 2, 2, ?, 600000, ?, ?)`, id, userId, `Pre ${id}`, extra.zip ?? '91915', extra.sqft ?? 2000, extra.status || 'open', JSON.stringify(extra.runCosts || {}));
L(101, 1, { facts: FACTS_SOLAR, runCosts: RUN_COSTS, fit: FIT, signal: SIGNAL });     // every block
L(102, 1, { zip: '', sqft: 2200 });                                                     // nothing entered, no ZIP
L(103, 1, { portfolio: true });
L(104, 1, { buyerOnly: true });
L(105, 3, {});                                                                         // the admin's own home
L(106, 1, { facts: { yard: { solar: 'none' } }, runCosts: { solar: { kw: 5 } } });      // solar details without solar
L(107, 1, { facts: { toy: { gateIn: 96 } } });                                         // a toy measurement only
L(108, 1, { status: 'paused' });
PL(401, 1, {});
const bills = (electric, gas) => ({ bills: { electric, ...(gas !== undefined ? { gas } : {}) }, basis: 'estimate', asOf: '2026-10' });

// ===================== 1. homeData.js: rules =====================
await section('rules', async () => {
  const V = (input, opts = {}) => lib.validateHomeData(input, { kind: 'listing', ...opts });
  check('only the groups the body has come back', JSON.stringify(V({ fit: {} })) === '{"data":{"fit":{}}}' && JSON.stringify(V({})) === '{"data":{}}' && JSON.stringify(V(null)) === '{"data":{}}');
  check('unknown keys and values are dropped; blank = not given', JSON.stringify(V({ runCosts: { bills: { electric: '', gas: null, junk: 5 }, basis: 'nope', extra: 1 }, junk: {} }).data) === '{"runCosts":{}}');
  let d = V({ runCosts: { bills: { electric: '183', gas: 0 }, basis: 'last_12', asOf: '2001-01' } }).data.runCosts;
  check('bills: whole dollars kept as integers, a 0 is kept, asOf is the Pacific month of the save (never the body)', d.bills.electric === 183 && d.bills.gas === 0 && d.basis === 'last_12' && d.asOf === THIS_MONTH, JSON.stringify(d));
  check('asOf follows the clock handed in', V({ runCosts: { bills: { water: 50 }, basis: 'estimate' } }, { nowMs: Date.UTC(2027, 2, 15, 20) }).data.runCosts.asOf === '2027-03');
  for (const bad of [-1, 5001, 12.5, 'abc', true]) check(`bills: ${JSON.stringify(bad)} -> the exact error`, V({ runCosts: { bills: { electric: bad }, basis: 'estimate' } }).error === 'Monthly bills should be whole dollars from 0 to 5000.');
  check('bills without a basis -> the exact error', V({ runCosts: { bills: { gas: 40 } } }).error === 'Say whether these come from your last 12 months of bills or are a rough estimate.');
  check('a basis without bills stores nothing', JSON.stringify(V({ runCosts: { basis: 'last_12' } }).data.runCosts) === '{}');
  // Solar details: only for a home whose owner says it has solar.
  const solar = { kw: '6.44', year: 2021, kwh12: 9800, warrantyEnd: 2046, program: 'nbt' };
  d = V({ runCosts: { solar } }, { facts: { yard: { solar: 'owned' } } }).data.runCosts;
  check('solar: kept for an owned system, size to one decimal', JSON.stringify(d) === JSON.stringify({ solar: { kw: 6.4, year: 2021, kwh12: 9800, warrantyEnd: 2046, program: 'nbt' } }), JSON.stringify(d));
  check('solar: dropped when "Solar panels" is none or missing', JSON.stringify(V({ runCosts: { solar } }, { facts: { yard: { solar: 'none' } } }).data.runCosts) === '{}' && JSON.stringify(V({ runCosts: { solar } }, { facts: {} }).data.runCosts) === '{}');
  check('solar: out-of-range numbers are not even looked at when the home has no solar', !V({ runCosts: { solar: { kw: 900 } } }, { facts: {} }).error);
  const F = { facts: { yard: { solar: 'leased' } } };
  check('solar errors, word for word', V({ runCosts: { solar: { kw: 0.2 } } }, F).error === 'System size should be between 0.5 and 50 kW.' && V({ runCosts: { solar: { kw: 51 } } }, F).error === 'System size should be between 0.5 and 50 kW.'
    && V({ runCosts: { solar: { kwh12: 60001 } } }, F).error === 'Last-12-month production should be whole kWh from 0 to 60000.' && V({ runCosts: { solar: { year: 1989 } } }, F).error === lib.SOLAR_YEAR_ERROR
    && V({ runCosts: { solar: { year: THIS_YEAR + 1 } } }, F).error === lib.SOLAR_YEAR_ERROR && V({ runCosts: { solar: { warrantyEnd: 2076 } } }, F).error === lib.SOLAR_WARRANTY_ERROR);
  check('solar programs are the four fixed ones', JSON.stringify(lib.SOLAR_PROGRAMS) === JSON.stringify({ nem1: 'NEM 1.0', nem2: 'NEM 2.0', nbt: 'Net Billing (NBT)', not_sure: "the owner isn't sure" }) && !V({ runCosts: { solar: { program: 'sgip' } } }, F).data.runCosts.solar);

  // Fit.
  d = V({ fit: { rooms: [{ room: 'living', widthIn: '170', lengthIn: 216, doorIn: 32 }, { room: 'living', widthIn: 100, lengthIn: 100 }, {}, { room: 'office' }], garage: { doorWidthIn: 192, junk: 1 }, access: { overheadIn: 108 } } }).data.fit;
  check('fit: one row per room, empty rows dropped, overhead kept only with the path width', JSON.stringify(d) === JSON.stringify({ rooms: [{ room: 'living', widthIn: 170, lengthIn: 216, doorIn: 32 }], garage: { doorWidthIn: 192 } }), JSON.stringify(d));
  const FIT_ERR = 'Measurements should be whole inches in a sensible range.';
  for (const [what, fit] of [['room width under 36', { rooms: [{ room: 'living', widthIn: 35, lengthIn: 100 }] }], ['room length over 720', { rooms: [{ room: 'living', widthIn: 100, lengthIn: 721 }] }],
    ['doorway under 20', { rooms: [{ room: 'living', widthIn: 100, lengthIn: 100, doorIn: 19 }] }], ['a width with no length', { rooms: [{ room: 'living', widthIn: 100 }] }],
    ['garage door width', { garage: { doorWidthIn: 59 } }], ['garage door height', { garage: { doorHeightIn: 193 } }], ['garage depth', { garage: { depthIn: 119 } }], ['garage width', { garage: { widthIn: 601 } }],
    ['side-yard width', { access: { sideWidthIn: 23 } }], ['overhead', { access: { sideWidthIn: 100, overheadIn: 241 } }], ['a decimal', { garage: { depthIn: 200.5 } }]]) {
    check(`fit: ${what} -> the exact error`, V({ fit }).error === FIT_ERR, JSON.stringify(V({ fit })));
  }
  check('fit: sizes with no room picked -> its own message', V({ fit: { rooms: [{ widthIn: 100, lengthIn: 100 }] } }).error === lib.FIT_ROOM_ERROR);
  const many = Object.keys(lib.FIT_ROOMS).map(room => ({ room, widthIn: 100, lengthIn: 120 }));
  check('fit: the 12 fixed rooms, at most 12 rows', Object.keys(lib.FIT_ROOMS).length === 12 && V({ fit: { rooms: [...many, { room: 'attic', widthIn: 100, lengthIn: 100 }] } }).error === lib.FIT_ROOM_ERROR && V({ fit: { rooms: many } }).data.fit.rooms.length === 12);
  check('fit: the gate, the driveway and garage spaces are not asked again', !/gateIn|drivewayFt|spaces/.test(JSON.stringify(V({ fit: { gateIn: 120, drivewayFt: 40, garage: { spaces: 2 } } }).data)));

  // Signal.
  d = V({ signal: SIGNAL }).data.signal;
  check('signal: a full log is kept as typed', JSON.stringify(d) === JSON.stringify(SIGNAL), JSON.stringify(d));
  check('signal: at most 3 speed tests and 16 bars rows', V({ signal: { speedTests: Array(5).fill(SIGNAL.speedTests[0]), bars: Array(20).fill(SIGNAL.bars[0]), date: '2026-10' } }).data.signal.speedTests.length === 3
    && V({ signal: { bars: Array(20).fill(SIGNAL.bars[0]), date: '2026-10' } }).data.signal.bars.length === 16);
  check('signal: speed out of range', V({ signal: { speedTests: [{ down: 0, up: 5, date: '2026-10' }] } }).error === lib.SPEED_ERROR && V({ signal: { speedTests: [{ down: 5, up: 10001, date: '2026-10' }] } }).error === lib.SPEED_ERROR);
  check('signal: a speed test needs both speeds and its month', V({ signal: { speedTests: [{ down: 100, up: 10 }] } }).error === lib.SPEED_ROW_ERROR && V({ signal: { speedTests: [{ down: 100, date: '2026-10' }] } }).error === lib.SPEED_ROW_ERROR);
  check('signal: a month in the future or before 2020 is refused', V({ signal: { speedTests: [{ down: 100, up: 10, date: '2019-12' }] } }).error === lib.MONTH_ERROR
    && V({ signal: { speedTests: [{ down: 100, up: 10, date: `${THIS_YEAR + 1}-01` }] } }).error === lib.MONTH_ERROR && !V({ signal: { speedTests: [{ down: 100, up: 10, date: THIS_MONTH }] } }).error);
  check('signal: bars 0-5, a full row, and the month they were checked', V({ signal: { bars: [{ carrier: 'att', area: 'kitchen', bars: 6 }], date: '2026-10' } }).error === lib.BARS_ERROR
    && V({ signal: { bars: [{ carrier: 'att', bars: 3 }], date: '2026-10' } }).error === lib.BARS_ROW_ERROR && V({ signal: { bars: [{ carrier: 'att', area: 'kitchen', bars: 3 }] } }).error === lib.BARS_DATE_ERROR);
  check('signal: a provider or carrier name only with "other", through the shared text checks', !V({ signal: { speedTests: [{ down: 5, up: 5, provider: 'cox', providerOther: 'Mine', date: '2026-10' }] } }).data.signal.speedTests[0].providerOther
    && V({ signal: { speedTests: [{ down: 5, up: 5, provider: 'other', providerOther: 'Great for families with kids', date: '2026-10' }] } }).error === homeText.STEERING_ERROR
    && V({ signal: { bars: [{ carrier: 'other', carrierOther: 'guaranteed binding contract', area: 'garage', bars: 1 }], date: '2026-10' } }).error && V({ signal: { bars: [{ carrier: 'other', carrierOther: 'x'.repeat(60), area: 'garage', bars: 1 }], date: '2026-10' } }).data.signal.bars[0].carrierOther.length === 30);

  // Reading a row back never throws and drops what it can't print.
  const back = lib.homeDataFromRow({ run_costs_json: '{"bills":{"electric":99999,"gas":40},"basis":"last_12","asOf":"2026-10"}', fit_json: 'not json', signal_json: '{"bars":[{"carrier":"att","area":"kitchen","bars":3}]}' });
  check('read back: bad JSON is {}, bad values are dropped, bars without their month are dropped', JSON.stringify(back) === JSON.stringify({ runCosts: { bills: { gas: 40 }, basis: 'last_12', asOf: '2026-10' }, fit: {}, signal: {} }), JSON.stringify(back));
  check('read back: nothing entered', JSON.stringify(lib.homeDataFromRow({})) === '{"runCosts":{},"fit":{},"signal":{}}' && JSON.stringify(lib.homeDataFromRow(null)) === '{"runCosts":{},"fit":{},"signal":{}}');
});

// ===================== 2. homeData.js: lines and HTML =====================
const DATA = lib.homeDataFromRow({ run_costs_json: JSON.stringify(RUN_COSTS), fit_json: JSON.stringify(FIT), signal_json: JSON.stringify(SIGNAL) });
const ALL_ON = gate.liveTools(envAll);
const NO_MONEY_WORDS = /total|per year|\/yr|sav(e|ings)|payback|offset|estimate[ds]? (bill|cost)|typical|average home/i;
await section('lines', async () => {
  const g = lib.homeDataLines(DATA, FACTS_SOLAR, { zip: '91915' });
  check('bills: "about" and "/mo", a 0 prints "$0/mo", the block ends with the basis line', JSON.stringify(g.runCosts) === JSON.stringify(['Electric about $183/mo', 'Gas about $40/mo', 'Water about $95/mo', 'Trash and sewer $0/mo', "Monthly averages from the owner's last 12 months of bills, entered Oct 2026"]), JSON.stringify(g.runCosts));
  check('bills: the rough-estimate basis line', lib.homeDataLines({ runCosts: { bills: { electric: 1200 }, basis: 'estimate', asOf: '2026-11' } }, {}).runCosts.join('|') === "Electric about $1,200/mo|Monthly averages the owner's rough estimate, entered Nov 2026");
  check('solar: the six lines, PPA spelled out', JSON.stringify(g.solar) === JSON.stringify(['Solar panels: power purchase agreement (PPA)', 'System size 6.4 kW', 'Installed 2021', "Made about 9,800 kWh in the last 12 months (owner's reading)", 'Warranty through 2046', 'Billing program: NEM 2.0']), JSON.stringify(g.solar));
  check('solar: never rendered when "Solar panels" is none or missing, or with no details', lib.homeDataLines(DATA, { yard: { solar: 'none' } }).solar.length === 0 && lib.homeDataLines(DATA, {}).solar.length === 0 && lib.homeDataLines({ runCosts: {} }, FACTS_SOLAR).solar.length === 0);
  check('fit: rooms, garage and side yard in feet and inches', JSON.stringify(g.fit) === JSON.stringify(['Living room about 14 ft 2 in. × 18 ft, doorway 32 in.', 'Primary bedroom about 12 ft 6 in. × 14 ft', 'Garage door about 16 ft wide × 7 ft high', 'Garage inside about 20 ft deep × 19 ft wide', 'Side-yard path about 11 ft wide at its narrowest', 'Lowest overhead along it about 9 ft']), JSON.stringify(g.fit));
  check('ftIn(170) is "14 ft 2 in."', lib.ftIn(170) === '14 ft 2 in.' && lib.ftIn(120) === '10 ft' && lib.ftIn(8) === '8 in.');
  check('signal: every line carries its month; each bars entry on its own, then "Bars checked"', JSON.stringify(g.signal) === JSON.stringify(['Internet speed test: 480.5 Mbps down / 22 Mbps up on Cox (Wi-Fi), Oct 2026', 'Internet speed test: 90 Mbps down / 12 Mbps up on Race Fiber (wired), Sep 2026',
    'Cell bars: AT&T 4 of 5 in the kitchen (5G)', 'Cell bars: T-Mobile 2 of 5 in the backyard (LTE)', 'Cell bars: Verizon 0 of 5 upstairs', 'Bars checked Oct 2026']), JSON.stringify(g.signal));
  check('coverage: nothing while the FCC module is empty', g.coverage.length === 0 && FCC_MOBILE.asOf === '' && Object.keys(FCC_MOBILE.zips).length === 0);

  const html = lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '91915', live: ALL_ON, signedIn: true, kind: 'listing', id: 101 });
  check('hasBlock: the bills paragraph under its heading, then the confirm line', html.hasBlock.startsWith(`<p class="tiny home-facts"><span class="label">Cost to run (the owner&#39;s own bills)</span> ${escapeHtml(g.runCosts.join(' · '))}</p><p class="tiny">${escapeHtml(lib.RUN_COSTS_CONFIRM_LINE)}</p>`), html.hasBlock.slice(0, 300));
  check('hasBlock: the solar paragraph and its confirm line', html.hasBlock.includes(`<p class="tiny home-facts"><span class="label">Solar (from the owner)</span> ${escapeHtml(g.solar.join(' · '))}</p><p class="tiny">${escapeHtml(lib.SOLAR_CONFIRM_LINE)}</p>`));
  const moneyHtml = html.hasBlock.split('<p class="tiny"><button')[0];
  check('jury: no bills or solar HTML says total, per year, /yr, savings, payback, offset, estimated bill, typical or average home', !NO_MONEY_WORDS.test(moneyHtml), (moneyHtml.match(NO_MONEY_WORDS) || [])[0]);
  check('jury: no line adds the bills up (318 is their sum)', !/318/.test(moneyHtml));
  check('exact headings and confirm lines', lib.RUN_COSTS_HEADING === "Cost to run (the owner's own bills)" && lib.SOLAR_HEADING === 'Solar (from the owner)' && lib.FIT_HEADING === "Will it fit? (from the owner's measurements)" && lib.SIGNAL_HEADING === 'Signal and internet (from the owner)'
    && lib.RUN_COSTS_CONFIRM_LINE === "These are this owner's bills, not a prediction of yours. Bills change with rates, weather, who lives in a home and how they use it. Ask to see recent bills."
    && lib.SOLAR_CONFIRM_LINE === "A billing program, a lease or a PPA doesn't always pass to a new owner the same way. Ask the utility and the solar company, and read the contract."
    && lib.FIT_CONFIRM_LINE === "Based on the owner's measurements; measure before you move. Stairs, hallways, turns and slopes aren't included."
    && lib.SIGNAL_CONFIRM_LINE === "The owner's own tests on their own devices and plans, on the dates shown. Signal and speed change with the device, the plan, the weather and where you stand, so test it yourself on your visit."
    && lib.COVERAGE_LINE === "Reported by the carrier to the FCC; real signal varies. It's outdoor coverage across the whole ZIP code as carriers report it, not a test at this home.");
  check('area context button: only with the gate, a sign-in and a ZIP', html.hasBlock.includes('<p class="tiny"><button type="button" class="link-btn" data-action="hd-area-context" data-kind="listing" data-id="101">How do bills run nearby?</button></p><div class="hd-context" data-hd-context></div>')
    && !lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '91915', live: ALL_ON, signedIn: false, id: 101 }).hasBlock.includes('hd-area-context')
    && !lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '', live: ALL_ON, signedIn: true, id: 101 }).hasBlock.includes('hd-area-context')
    && !lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '91915', live: gate.liveTools(envShip), signedIn: true, id: 101 }).hasBlock.includes('hd-area-context'));

  // The fit card.
  const m = html.cards.match(/<div class="card about-card" data-fit='([^']*)'><h2>Will it fit\? \(from the owner&#39;s measurements\)<\/h2>/);
  check('fit card: heading, lines, the checker mount and the confirm line', !!m && html.cards.includes(`<p class="tiny home-facts">${escapeHtml(g.fit.join(' · '))}</p><div class="fit-checker" data-fit-checker></div><p class="tiny">${escapeHtml(lib.FIT_CONFIRM_LINE)}</p></div>`), html.cards.slice(0, 300));
  const spaces = m ? JSON.parse(m[1]) : {};
  const leaves = [];
  const walk = (v, key) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k); else leaves.push([key, v]); };
  walk(spaces);
  check('data-fit: the owner\'s numbers plus the gate and driveway from the home facts', spaces.gateIn === 120 && spaces.drivewayFt === 40 && spaces.rooms.length === 2 && spaces.garage.depthIn === 240 && spaces.access.overheadIn === 108, m && m[1]);
  check('data-fit: only numbers (and the fixed room keys), no "<"', !!m && !m[1].includes('<') && leaves.every(([k, v]) => (k === 'room' ? Object.hasOwn(lib.FIT_ROOMS, v) : typeof v === 'number')), JSON.stringify(leaves));
  check('fit card: shown for a toy measurement alone, hidden with no measurement or with the gate off', lib.homeDataHtml({}, { toy: { gateIn: 96 } }, { live: ALL_ON }).cards.includes('data-fit=\'{"gateIn":96}\'')
    && lib.homeDataHtml({}, {}, { live: ALL_ON }).cards === '' && !lib.homeDataHtml(DATA, FACTS_SOLAR, { live: { ...ALL_ON, willItFit: false } }).cards.includes('data-fit'));
  check('fit wording: never "will fit", "guarantee" or "plenty"', !/will fit|guarantee|plenty/i.test(html.cards));

  // The signal card and the carrier-reported coverage under it.
  check('signal card: heading, lines and the confirm line; no coverage block while the module is empty', html.cards.includes(`<div class="card about-card"><h2>Signal and internet (from the owner)</h2><p class="tiny home-facts">${escapeHtml(g.signal.join(' · '))}</p><p class="tiny">${escapeHtml(lib.SIGNAL_CONFIRM_LINE)}</p></div>`) && !html.cards.includes('Carrier-reported'));
  FCC_MOBILE.asOf = 'June 2026';
  FCC_MOBILE.zips['91915'] = { att: [3, 2], tmobile: [3, 3], verizon: [1, 0] };
  try {
    const cov = lib.homeDataLines(DATA, FACTS_SOLAR, { zip: '91915' }).coverage;
    check('coverage lines: four plain words per carrier, 5G first', JSON.stringify(cov) === JSON.stringify(['AT&T: 5G reported in most of the ZIP; 4G reported across the ZIP', 'T-Mobile: 5G reported across the ZIP; 4G reported across the ZIP', 'Verizon: 5G reported not reported; 4G reported in parts of the ZIP']), JSON.stringify(cov));
    const on = lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '91915', live: ALL_ON }).cards;
    check('coverage block: label with the ZIP and the data date, the coverage line, the FCC link', on.includes(`<p class="tiny home-facts"><span class="label">Carrier-reported coverage for ZIP 91915 (FCC, data as of June 2026)</span> ${escapeHtml(cov.join(' · '))}</p><p class="tiny">${escapeHtml(lib.COVERAGE_LINE)}</p><p class="tiny"><a href="https://broadbandmap.fcc.gov/" target="_blank" rel="noopener noreferrer">Check an exact address on the FCC map ↗</a></p>`), on.slice(-600));
    const href = (on.match(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">Check an exact address/) || [])[1] || '';
    check('the FCC link carries no query string, ZIP or address', href === 'https://broadbandmap.fcc.gov/' && !href.includes('?') && !/91915|La%20Vida/.test(href), href);
    check('no coverage block with the gate off (as it ships)', !lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '91915', live: gate.liveTools(envShip) }).cards.includes('Carrier-reported') && gate.liveTools(envShip).fccCoverage === false);
    check('no coverage block for a home with no ZIP, or a ZIP the module does not hold', !lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '', live: ALL_ON }).cards.includes('Carrier-reported') && !lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '91910', live: ALL_ON }).cards.includes('Carrier-reported'));
    check('coverage never stands alone under the owner\'s heading (no owner log -> no signal card)', lib.homeDataHtml({}, {}, { zip: '91915', live: ALL_ON }).cards === '');
    check('no score, rating or ranking of carriers', !/score|rating|best|great|strong|excellent/i.test(on));
  } finally { FCC_MOBILE.asOf = ''; delete FCC_MOBILE.zips['91915']; }
  check('every tool off -> nothing at all', JSON.stringify(lib.homeDataHtml(DATA, FACTS_SOLAR, { zip: '91915', live: {}, signedIn: true, id: 101 })) === '{"hasBlock":"","cards":""}');
  check('homeDataBlocksHtml reads the row itself', JSON.stringify(lib.homeDataBlocksHtml(one('SELECT * FROM listings WHERE id = 101'), ALL_ON, { signedIn: true })) === JSON.stringify(html));
});

// ===================== 3. PUT /api/home-data/:kind/:id =====================
await section('route', async () => {
  const api = await mod('functions/api/home-data/[kind]/[id].js');
  const put = (who, kind, id, body, env) => call(api.onRequestPut, 'PUT', `/api/home-data/${kind}/${id}`, who, { kind, id: String(id) }, body, env);
  let r = await put(null, 'listing', 102, { fit: {} });
  check('route: signed out -> 401', r.status === 401, r.status);
  r = await put(2, 'listing', 102, { fit: {} });
  check('route: another member -> 403', r.status === 403, r.status);
  r = await put(1, 'augmented_home', 1, { fit: {} });
  const sessionOnly = r.statements;
  check('route: augmented_home -> 404 "Unknown kind of home."', r.status === 404 && r.json.error === 'Unknown kind of home.', r.text);
  r = await put(1, 'green_home', 1, {});
  check('route: green_home -> 404 too (listings and pre-listings only in v1)', r.status === 404);
  r = await put(1, 'listing', 999, {});
  check('route: missing home -> 404 "Home not found."', r.status === 404 && r.json.error === 'Home not found.', r.text);
  for (const id of [103, 104]) {
    r = await put(1, 'listing', id, { fit: { garage: { depthIn: 240 } } });
    check(`route: ${id === 103 ? 'portfolio' : 'buyer-only'} listing -> 400 data_not_for_this_listing`, r.status === 400 && r.json.code === 'data_not_for_this_listing' && r.json.error === 'These details are for a single home you own.', r.text);
  }
  const refused = [
    [{ runCosts: { bills: { electric: 9000 }, basis: 'estimate' } }, 'Monthly bills should be whole dollars from 0 to 5000.'],
    [{ runCosts: { bills: { electric: 100 } } }, 'Say whether these come from your last 12 months of bills or are a rough estimate.'],
    [{ fit: { garage: { depthIn: 5 } } }, 'Measurements should be whole inches in a sensible range.'],
    [{ signal: { bars: [{ carrier: 'att', area: 'kitchen', bars: 9 }], date: '2026-10' } }, lib.BARS_ERROR],
  ];
  for (const [body, error] of refused) {
    r = await put(1, 'listing', 102, body);
    check(`route: refuses with the exact error: ${error.slice(0, 40)}...`, r.status === 400 && r.json.error === error, r.text);
  }
  const untouched = one('SELECT run_costs_json, fit_json, signal_json FROM listings WHERE id = 102');
  check('route: a refused save stores nothing', untouched.run_costs_json === '{}' && untouched.fit_json === '{}' && untouched.signal_json === '{}');

  r = await put(1, 'listing', 102, { runCosts: { bills: { electric: 150 }, basis: 'last_12', asOf: '1999-01', solar: { kw: 5 } }, junk: 1 });
  let row = one('SELECT run_costs_json, fit_json, signal_json FROM listings WHERE id = 102');
  check('route: saved; asOf comes from the server clock, not the body; solar dropped (the home has none)', r.status === 200 && r.json.ok === true && row.run_costs_json === JSON.stringify({ bills: { electric: 150 }, basis: 'last_12', asOf: THIS_MONTH }), row.run_costs_json);
  check('route: only the given column is written', row.fit_json === '{}' && row.signal_json === '{}' && JSON.stringify(Object.keys(r.json.data)) === '["runCosts"]');
  check('route: 2 statements + the session lookup', r.statements === sessionOnly + 2, `${r.statements} vs session ${sessionOnly}`);
  check('route: private, no-store', /private/.test(r.headers.get('Cache-Control') || '') && /no-store/.test(r.headers.get('Cache-Control') || ''));
  r = await put(1, 'listing', 102, { fit: FIT, signal: SIGNAL });
  row = one('SELECT run_costs_json, fit_json, signal_json FROM listings WHERE id = 102');
  check('route: two groups in one UPDATE; the third keeps its value', r.status === 200 && row.fit_json === JSON.stringify(FIT) && row.signal_json === JSON.stringify(SIGNAL) && row.run_costs_json.includes('"electric":150') && r.statements === sessionOnly + 2, row.fit_json);
  r = await put(1, 'listing', 102, { runCosts: {}, fit: {}, signal: {} });
  row = one('SELECT run_costs_json, fit_json, signal_json FROM listings WHERE id = 102');
  check('route: saving empty groups stores {}', r.status === 200 && row.run_costs_json === '{}' && row.fit_json === '{}' && row.signal_json === '{}');
  r = await put(1, 'listing', 102, {});
  check('route: a body with no group writes nothing (session + the home row only)', r.status === 200 && JSON.stringify(r.json.data) === '{}' && r.statements === sessionOnly + 1, r.statements);
  r = await put(1, 'pre_listing', 401, { runCosts: { bills: { water: 80 }, basis: 'estimate' }, fit: { access: { sideWidthIn: 60 } } });
  row = one('SELECT run_costs_json, fit_json FROM pre_listings WHERE id = 401');
  check('route: a pre-listing saves the same way', r.status === 200 && row.run_costs_json === JSON.stringify({ bills: { water: 80 }, basis: 'estimate', asOf: THIS_MONTH }) && row.fit_json === '{"access":{"sideWidthIn":60}}', row.run_costs_json);
  run("UPDATE pre_listings SET run_costs_json = '{}', fit_json = '{}' WHERE id = 401");
  r = await put(1, 'listing', 101, { runCosts: { solar: { kw: 7.25, program: 'not_sure' } } });
  check('route: solar details are kept on a home with a PPA', r.status === 200 && JSON.stringify(r.json.data.runCosts) === '{"solar":{"kw":7.3,"program":"not_sure"}}', r.text);
  run('UPDATE listings SET run_costs_json = ? WHERE id = 101', JSON.stringify(RUN_COSTS));

  // The launch gate: as shipped, the three groups are live for everyone...
  r = await put(1, 'listing', 102, { signal: { speedTests: [{ down: 50, up: 5, date: '2026-10' }] } }, envShip);
  check('gate as shipped: bills, sizes and signal save for a normal member', r.status === 200 && one('SELECT signal_json FROM listings WHERE id = 102').signal_json.includes('"down":50'));
  run("UPDATE listings SET signal_json = '{}' WHERE id = 102");
  // ...and a group whose tool is dark is ignored for a member and stored for an admin.
  gate.NUANCED_TOOLS.signalMap = false;
  try {
    r = await put(1, 'listing', 102, { signal: { speedTests: [{ down: 50, up: 5, date: '2026-10' }] }, fit: { garage: { depthIn: 240 } } }, envShip);
    row = one('SELECT fit_json, signal_json FROM listings WHERE id = 102');
    check('a dark group is ignored for a normal member (the live one still saves)', r.status === 200 && row.signal_json === '{}' && row.fit_json === '{"garage":{"depthIn":240}}' && !('signal' in r.json.data), JSON.stringify(row));
    r = await put(1, 'listing', 102, { signal: { bars: [{ carrier: 'att', area: 'kitchen', bars: 9 }] } }, envShip);
    check('...and is not even validated for them', r.status === 200, r.text);
    r = await put(3, 'listing', 105, { signal: { speedTests: [{ down: 50, up: 5, date: '2026-10' }] } }, envShip);
    check('...and stored for an admin', r.status === 200 && one('SELECT signal_json FROM listings WHERE id = 105').signal_json.includes('"down":50'), r.text);
  } finally { gate.NUANCED_TOOLS.signalMap = true; }
  run("UPDATE listings SET fit_json = '{}', signal_json = '{}' WHERE id IN (102, 105)");
  const src = read('functions/api/home-data/[kind]/[id].js');
  check('route: no rate limit and no notification (the owner\'s own facts)', !/claimUserAction|INSERT INTO notifications|notifyAndMaybeEmail|notifyNew/.test(src));
});

// ===================== 4. GET /api/home-data/context =====================
await section('area context', async () => {
  const api = await mod('functions/api/home-data/context.js');
  const get = (who, kind, id, env) => call(api.onRequestGet, 'GET', `/api/home-data/context?kind=${kind}&id=${id}`, who, {}, undefined, env);
  let r = await get(null, 'listing', 101);
  check('context: signed out -> 401', r.status === 401, r.status);
  r = await get(2, 'listing', 101, envShip);
  check('context, gate as shipped: a member gets 404 "Not found."', r.status === 404 && r.json.error === 'Not found.', r.text);
  r = await get(null, 'listing', 101, envShip);
  check('context, gate as shipped: signed out gets the same 404', r.status === 404);
  r = await get(3, 'listing', 101, envShip);
  check('context, gate as shipped: an admin gets through', r.status === 200, r.text);
  r = await get(2, 'augmented_home', 1);
  const sessionOnly = r.statements;
  check('context: an unknown kind -> 404', r.status === 404 && r.json.error === 'Unknown kind of home.');
  r = await get(2, 'listing', 999);
  check('context: a missing home -> 404', r.status === 404);
  r = await get(2, 'listing', 108);
  check('context: a paused listing is "not there" for other members, still there for its owner', r.status === 404 && (await get(1, 'listing', 108)).status === 200);
  r = await get(2, 'pre_listing', 401);
  check('context: a pre-listing answers only its owner (403 otherwise)', r.status === 403 && (await get(3, 'pre_listing', 401)).status === 403 && (await get(1, 'pre_listing', 401)).status === 200);
  r = await get(2, 'listing', 102);
  check('context: a home with no ZIP -> nothing', r.status === 200 && JSON.stringify(r.json) === '{"zip":"","sqftBand":"","utility":null,"members":null}', r.text);

  // Nothing loaded, nobody else in the ZIP yet.
  r = await get(2, 'listing', 101);
  check('context: empty modules and an empty pool -> utility null, members null', r.status === 200 && r.json.zip === '91915' && r.json.sqftBand === '1,650–2,750 sqft' && r.json.utility === null && r.json.members === null, r.text);
  check('context: 2 statements + the session', r.statements === sessionOnly + 2, `${r.statements} vs ${sessionOnly}`);
  check('context: private, no-store', /private/.test(r.headers.get('Cache-Control') || '') && /no-store/.test(r.headers.get('Cache-Control') || ''));

  // Four other owners (one of them with two homes) + the home itself: still under 5.
  L(201, 10, { runCosts: bills(104, 30) });
  L(202, 10, { runCosts: bills(999, 99) });   // the same owner's second home: counts once
  L(203, 11, { runCosts: bills(151, 35) });
  L(204, 12, { runCosts: bills(183, 41) });
  L(205, 13, { runCosts: bills(222, 52) });
  r = await get(2, 'listing', 101);
  check('context: 4 owners (two homes of one owner count once; the home itself is excluded) -> no bill shown', r.json.members === null, JSON.stringify(r.json.members));
  // People and homes that never count.
  L(206, 16, { runCosts: bills(500, 60) });                       // a demo account
  L(207, 17, { runCosts: bills(500, 60) });                       // a suspended owner
  L(208, 14, { runCosts: bills(500, 60), status: 'paused' });     // a paused listing
  L(209, 14, { runCosts: bills(500, 60), zip: '91910' });         // another ZIP
  L(210, 14, { runCosts: bills(500, 60), sqft: 4000 });           // outside the size band
  L(211, 14, { runCosts: bills(500, 60), buyerOnly: true });
  L(212, 14, { runCosts: bills(500, 60), portfolio: true });
  L(213, 14, { runCosts: {} });                                   // no bills entered
  PL(402, 14, { runCosts: bills(500, 60), status: 'closed' });    // a closed pre-listing
  r = await get(2, 'listing', 101);
  check('context: demo and suspended owners, paused or closed homes, other ZIPs and sizes, buyer profiles and portfolios are not counted', r.json.members === null, JSON.stringify(r.json.members));
  // A fifth owner, through an open pre-listing, with electric only.
  PL(403, 14, { runCosts: { bills: { electric: 296 }, basis: 'last_12', asOf: '2026-10' } });
  r = await get(2, 'listing', 101);
  check('context: 5 owners for electric -> homes, low, middle and high, each to the nearest $10', JSON.stringify(r.json.members) === JSON.stringify({ electric: { homes: 5, low: 100, mid: 180, high: 300 } }), JSON.stringify(r.json.members));
  check('context: gas has 4 owners, so it is left out', !('gas' in (r.json.members || {})));
  check('context: still 2 statements + the session', r.statements === sessionOnly + 2, r.statements);
  // A sixth owner makes gas 5 and the electric count even (the middle of two).
  L(214, 15, { runCosts: bills(240, 47) });
  r = await get(2, 'listing', 101);
  check('context: an even count takes the middle of the two middle values', JSON.stringify(r.json.members) === JSON.stringify({ electric: { homes: 6, low: 100, mid: 200, high: 300 }, gas: { homes: 5, low: 30, mid: 40, high: 50 } }), JSON.stringify(r.json.members));
  r = await get(1, 'pre_listing', 401);
  check("context: a pre-listing compares at its own size (2,000 sqft ± 25%) and never counts itself (its owner's other home counts as one more owner)", r.json.sqftBand === '1,500–2,500 sqft' && r.json.members.electric.homes === 7 && r.json.members.gas.homes === 6, JSON.stringify(r.json));
  run('UPDATE listings SET sqft = NULL WHERE id = 107');
  r = await get(2, 'listing', 107);
  check('context: a home with no size -> no comparison', r.status === 200 && r.json.members === null && r.json.sqftBand === '', r.text);

  // The utility's own published average, never dollars.
  SDGE_ZIP_USAGE.period = 'Oct 2025 – Sep 2026';
  SDGE_ZIP_USAGE.zips['91915'] = [520, 22];
  try {
    r = await get(2, 'listing', 101);
    check('context: SDG&E average in kWh and therms with its period', JSON.stringify(r.json.utility) === '{"period":"Oct 2025 – Sep 2026","kwhPerMonth":520,"thermsPerMonth":22}', JSON.stringify(r.json.utility));
    check('context: the utility figure has no dollars anywhere', !/\$|dollar|cost|bill/i.test(JSON.stringify(r.json.utility)));
  } finally { SDGE_ZIP_USAGE.period = ''; delete SDGE_ZIP_USAGE.zips['91915']; }
  const src = read('functions/api/home-data/context.js');
  check('context: one compound SELECT of two terms, 6 bound values', (src.match(/UNION ALL/g) || []).length === 1 && /\.bind\(zip, lo, hi, DEMO_EMAIL_PATTERN, kind, id\)/.test(src));
  check('context: no outside call from the Function', !/fetch\(/.test(src) && !/fetch\(/.test(read('functions/_lib/homeData.js')));
});

// ===================== 5. The listing page =====================
await section('listing page', async () => {
  const page = await mod('functions/listing/[id].js');
  const listing = (id, who, env = envAll) => call(page.onRequestGet, 'GET', `/listing/${id}`, who, { id: String(id) }, undefined, env);
  // The first signed-in visit creates the home's discussion thread (one extra statement, once), so it's made before
  // anything is counted.
  await listing(101, 2);
  const out = await listing(101, null), member = await listing(101, 2), owner = await listing(101, 1);
  const t = out.text;
  const g = lib.homeDataLines(DATA, FACTS_SOLAR, { zip: '91915' });
  const hasBlock = (t.split('<span class="label">Has</span>')[1] || '').split('<span class="label">Wants</span>')[0];
  check('page: the bills and solar paragraphs sit in the Has block, after the home facts', hasBlock.includes(`Cost to run (the owner&#39;s own bills)</span> ${escapeHtml(g.runCosts.join(' · '))}`) && hasBlock.includes('Solar (from the owner)')
    && hasBlock.indexOf('Parking and garage (from the owner)') > 0 && hasBlock.indexOf('Parking and garage (from the owner)') < hasBlock.indexOf('Cost to run'), hasBlock.slice(0, 200));
  const cardsAt = ['<h2>Contact Olive Owner</h2>', '<h2>Make an Offer</h2>', 'Will it fit? (from the owner&#39;s measurements)', 'Signal and internet (from the owner)', 'class="card about-card mortgage-calc', 'Discussion</h2>'].map(x => t.indexOf(x));
  check('page: the fit and signal cards come after the offer card and before the calculator', cardsAt.slice(0, 4).every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1])) && cardsAt[5] > cardsAt[3], cardsAt.join(','));
  check('page: the fit card carries the confirm line and the checker mount', t.includes('<div class="fit-checker" data-fit-checker></div>') && t.includes(escapeHtml(lib.FIT_CONFIRM_LINE)) && t.includes(escapeHtml(lib.SIGNAL_CONFIRM_LINE)));
  check('page: the area-context button only for a signed-in viewer', !t.includes('hd-area-context') && member.text.includes('data-action="hd-area-context" data-kind="listing" data-id="101"'));
  check('page, gate as shipped: bills, fit and signal show to everyone; no area-context button, no coverage', (await listing(101, 2, envShip)).text.includes('Cost to run') && (await listing(101, null, envShip)).text.includes('data-fit-checker')
    && !(await listing(101, 2, envShip)).text.includes('hd-area-context') && (await listing(101, 3, envShip)).text.includes('hd-area-context'));
  const ld = (t.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || '';
  const head = t.split('</head>')[0];
  check('page: JSON-LD carries none of Electric, Mbps, kWh, Garage door', !!ld && !/Electric|Mbps|kWh|Garage door/.test(ld), ld.slice(0, 200));
  check('page: the description and og tags carry nothing from these tools', !/Electric|Mbps|kWh|Garage door|Cost to run|Will it fit/.test(head));
  check('page: signed in -> private, no-store; signed out unchanged', ['private', 'no-store'].every(w => (member.headers.get('Cache-Control') || '').includes(w)) && !(out.headers.get('Cache-Control') || '').includes('private'));
  for (const id of [103, 104]) {
    const p = await listing(id, null);
    check(`page ${id}: a ${id === 103 ? 'portfolio' : 'buyer profile'} shows none of it`, p.status === 200 && !/Cost to run|data-fit|Signal and internet/.test(p.text));
  }
  check('page: a home with nothing entered shows no block and no card', !/Cost to run|data-fit|Signal and internet \(from/.test((await listing(102, null)).text));
  check('page: solar details never show when "Solar panels" is none', !(await listing(106, null)).text.includes('Solar (from the owner)'));
  check('page: a gate opening alone gets the fit card (the checker reads it)', (await listing(107, null)).text.includes('data-fit=\'{"gateIn":96}\''));
  check('page: no inline style or handler in the new HTML', !/ style=| on[a-z]+=/.test(lib.homeDataBlocksHtml(one('SELECT * FROM listings WHERE id = 101'), ALL_ON, { signedIn: true }).cards + hasBlock));

  // Against HEAD's page (the committed file, run on this tree's libs): the same statements with every block on, and
  // the same lender note.
  let headPage = null, tmp = null;
  try {
    const src = execFileSync('git', ['-C', root, 'show', 'HEAD:functions/listing/[id].js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const libUrl = pathToFileURL(path.join(root, 'functions', '_lib')).href;
    tmp = path.join(os.tmpdir(), `amico-head-page-${process.pid}.mjs`);
    fs.writeFileSync(tmp, src.replace(/from '\.\.\/_lib\//g, `from '${libUrl}/`));
    headPage = await import(pathToFileURL(tmp).href);
  } catch { headPage = null; } finally { if (tmp) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } } }
  check('HEAD\'s listing page could be loaded for the comparison (git is available)', !!headPage);
  if (headPage) {
    const headCall = (id, who) => call(headPage.onRequestGet, 'GET', `/listing/${id}`, who, { id: String(id) });
    for (const [who, label, now] of [[null, 'signed out', out], [2, 'signed in', member], [1, 'the owner', owner]]) {
      const before = await headCall(101, who);
      check(`page statements, ${label}: every block on === HEAD (${before.statements})`, before.status === 200 && now.statements === before.statements, `${before.statements} -> ${now.statements}`);
    }
    const note = html => (html.match(/<p class="form-note trust"><strong>Talk to a lender\.<\/strong>[\s\S]*?<\/p>/) || [''])[0];
    const headNote = note((await headCall(101, null)).text);
    check('page: the "Talk to a lender" note is byte-identical to HEAD', headNote.length > 100 && note(t) === headNote && note(member.text) === headNote);
    check('page: nothing from the financing block sits inside the lender note', !/financing-flags|Financing ideas|seller financing|assumable/i.test(note(t)));
    check('page: the value line is unchanged while no schedule runs', t.includes('$800,000') && (await headCall(101, null)).text.includes('$800,000'));
  }
});

// ===================== 6. The hand-run loaders (fixtures only; never real downloads) =====================
await section('loaders', async () => {
  const fcc = await mod('tools/load-fcc-mobile.mjs');
  check('fcc buckets: 0%, 49%, 98%, 99% -> 0, 1, 2, 3', [fcc.coverageBucket(0, 100), fcc.coverageBucket(49, 100), fcc.coverageBucket(98, 100), fcc.coverageBucket(99, 100)].join() === '0,1,2,3');
  check('fcc buckets: 50% is "most", 100% is "across", an empty ZIP is 0', fcc.coverageBucket(50, 100) === 2 && fcc.coverageBucket(100, 100) === 3 && fcc.coverageBucket(5, 0) === 0);
  // A 3-ZIP fixture, 100 cells each.
  const cells = (zip, n) => new Set(Array.from({ length: n }, (_, i) => `${zip}-${i}`));
  const zipCells = new Map([['91910', cells('91910', 100)], ['91913', cells('91913', 100)], ['91915', cells('91915', 100)]]);
  const some = (zip, n) => [...cells(zip, n)];
  const carrierCells = {
    att: { '4g': new Set([...some('91910', 100), ...some('91913', 99), ...some('91915', 98)]), '5g': new Set([...some('91910', 49), ...some('91915', 50)]) },
    tmobile: { '4g': new Set(some('91913', 1)) },
  };
  const zips = fcc.buildCoverage(zipCells, carrierCells);
  check('fcc fixture: buckets per ZIP, carrier and technology; a carrier with no file is left out', JSON.stringify(zips) === JSON.stringify({ 91910: { att: [3, 1], tmobile: [0, 0] }, 91913: { att: [3, 0], tmobile: [1, 0] }, 91915: { att: [2, 2], tmobile: [0, 0] } }), JSON.stringify(zips));
  const text = fcc.fccModuleText({ asOf: 'June 2026', zips });
  check('fcc module text: the shape homeData.js reads', text.includes("export const FCC_MOBILE = { asOf: \"June 2026\", zips: {") && text.includes("'91913': {\"att\":[3,0],\"tmobile\":[1,0]},") && text.startsWith('// GENERATED by tools/load-fcc-mobile.mjs'));
  check('fcc: --file names the carrier and technology (no guessing from file names)', JSON.stringify(fcc.parseFileArg('att:5g=a b.gpkg')) === '{"carrier":"att","tech":"5g","name":"a b.gpkg"}' && (() => { try { fcc.parseFileArg('sprint:4g=x.gpkg'); return false; } catch { return true; } })());
  const runTool = (file, args) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(root, 'tools', file), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; } };
  let r = runTool('load-fcc-mobile.mjs', ['--fcc', 'x', '--zcta', 'y', '--h3', 'z', '--as-of', 'June 2026']);
  check('fcc: refuses to run without --layer and --h3-column', r.code === 1 && r.out.includes(fcc.NEEDS_LAYER_ERROR), r.out);
  r = runTool('load-fcc-mobile.mjs', ['--layer', 'hexes', '--fcc', 'x', '--zcta', 'y', '--h3', 'z', '--as-of', 'June 2026']);
  check('fcc: ...and with only one of them', r.code === 1 && r.out.includes(fcc.NEEDS_LAYER_ERROR));

  // End to end on a tiny fixture in a temp folder: two SQLite "GeoPackage" files, three square outlines, and a
  // stand-in h3-js (cells are whole-number grid points), so the real h3-js is never needed here.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amico-fcc-'));
  try {
    fs.mkdirSync(path.join(dir, 'h3', 'node_modules', 'h3-js'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'h3', 'node_modules', 'h3-js', 'package.json'), '{"name":"h3-js","version":"0.0.0","main":"index.js"}');
    fs.writeFileSync(path.join(dir, 'h3', 'node_modules', 'h3-js', 'index.js'), `exports.polygonToCells = (rings, res, isGeoJson) => { const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]); const out = [];
      for (let x = Math.min(...xs); x < Math.max(...xs); x++) for (let y = Math.min(...ys); y < Math.max(...ys); y++) out.push('c' + x + '_' + y); return out; };
      exports.cellToLatLng = c => { const [x, y] = c.slice(1).split('_').map(Number); return [y, x]; };`);
    const square = (zip, x0) => ({ type: 'Feature', properties: { ZCTA5CE20: zip }, geometry: { type: 'Polygon', coordinates: [[[x0, 0], [x0 + 10, 0], [x0 + 10, 10], [x0, 10], [x0, 0]]] } });
    fs.writeFileSync(path.join(dir, 'zcta.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [square('91910', 0), square('91913', 10), square('91915', 20)] }));
    fs.mkdirSync(path.join(dir, 'fcc'));
    const gpkg = (name, list) => { const db = new DatabaseSync(path.join(dir, 'fcc', name)); db.exec('CREATE TABLE hexes (fid INTEGER PRIMARY KEY, h3_res9_id TEXT)'); const ins = db.prepare('INSERT INTO hexes (h3_res9_id) VALUES (?)'); for (const c of list) ins.run(c); db.close(); };
    const grid = (x0, n) => { const out = []; for (let x = x0; x < x0 + 10; x++) for (let y = 0; y < 10; y++) out.push(`c${x}_${y}`); return out.slice(0, n); };
    gpkg('att4g.gpkg', [...grid(0, 100), ...grid(10, 99), ...grid(20, 98), 'c999_999']);
    gpkg('att5g.gpkg', [...grid(0, 49)]);
    const outFile = path.join(dir, 'fccMobileSd.js'), hexFile = path.join(dir, 'hex.sql');
    r = runTool('load-fcc-mobile.mjs', ['--inspect', '--fcc', path.join(dir, 'fcc'), '--zcta', path.join(dir, 'zcta.geojson')]);
    check('fcc --inspect: lists each file\'s tables and columns, and stops', r.code === 0 && r.out.includes('att4g.gpkg') && r.out.includes('hexes: fid INTEGER, h3_res9_id TEXT') && r.out.includes('ZCTA5CE20') && !fs.existsSync(outFile), r.out);
    const base = ['--fcc', path.join(dir, 'fcc'), '--zcta', path.join(dir, 'zcta.geojson'), '--h3', path.join(dir, 'h3'), '--as-of', 'June 2026', '--layer', 'hexes', '--h3-column', 'h3_res9_id'];
    r = runTool('load-fcc-mobile.mjs', base);
    check('fcc: refuses to guess which file is which', r.code === 1 && /--file/.test(r.out), r.out);
    r = runTool('load-fcc-mobile.mjs', [...base, '--file', 'att:4g=att4g.gpkg', '--file', 'att:5g=att5g.gpkg', '--out', outFile, '--hex-out', hexFile]);
    const made = r.code === 0 && fs.existsSync(outFile) ? (await import(pathToFileURL(outFile).href)).FCC_MOBILE : null;
    check('fcc end to end on the fixture: 3 ZIPs, buckets 3/1, 3/0, 2/0, as of June 2026', !!made && made.asOf === 'June 2026' && JSON.stringify(made.zips) === JSON.stringify({ 91910: { att: [3, 1] }, 91913: { att: [3, 0] }, 91915: { att: [2, 0] } }), `${r.out}\n${made && JSON.stringify(made.zips)}`);
    const hex = fs.existsSync(hexFile) ? fs.readFileSync(hexFile, 'utf8') : '';
    check('fcc --hex-out: the cell-center table for a later batch (300 cells, bits per carrier and technology)', hex.startsWith('CREATE TABLE IF NOT EXISTS fcc_mobile_hex (lat REAL, lng REAL, bits INTEGER);') && (hex.match(/^INSERT INTO fcc_mobile_hex/gm) || []).length === 300 && hex.includes('VALUES (0.00000, 0.00000, 3);'), hex.slice(0, 200));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const sdge = await mod('tools/load-sdge-usage.mjs');
  const months = []; for (let i = 0; i < 12; i++) { const m = ((9 + i) % 12) + 1; months.push([m >= 10 ? 2025 : 2026, m]); } // Oct 2025 .. Sep 2026
  const csv = (unit, { customers = true, zips = { 91910: 500, 91913: 600 }, skipMonth = null } = {}) => [
    `ZipCode,Year,Month,CustomerClass,Total${unit}${customers ? ',TotalCustomers' : ''}`,
    ...Object.entries(zips).flatMap(([zip, per]) => months.filter(([, m]) => !(skipMonth && zip === skipMonth[0] && m === skipMonth[1])).flatMap(([y, m]) => [
      `${zip},${y},${m},Residential,"${(per * 1000).toLocaleString('en-US')}"${customers ? ',1000' : ''}`,
      `${zip},${y},${m},Commercial,999999${customers ? ',10' : ''}`])),
    ...(customers ? [`"91901, 91902",2026,9,Residential,5000,10`] : []),
  ].join('\r\n');
  const built = sdge.buildSdgeUsage({ electricCsv: csv('kWh'), gasCsv: csv('Therms', { zips: { 91910: 25, 91913: 30 } }) });
  check('sdge fixture: residential rows only, total ÷ customers, whole numbers, the 12-month period', built.period === 'Oct 2025 – Sep 2026' && JSON.stringify(built.zips) === '{"91910":[500,25],"91913":[600,30]}', JSON.stringify(built));
  check('sdge: a ZIP merged with a neighbor is skipped and named', built.skipped.some(([z, why]) => z === '91901, 91902' && /merged/.test(why)), JSON.stringify(built.skipped));
  const short = sdge.buildSdgeUsage({ electricCsv: csv('kWh', { skipMonth: ['91913', 3] }), gasCsv: csv('Therms', { zips: { 91910: 25, 91913: 30 } }) });
  check('sdge: a ZIP missing a month in either file is skipped', JSON.stringify(short.zips) === '{"91910":[500,25]}' && short.skipped.some(([z]) => z === '91913'));
  let stopped = '';
  try { sdge.buildSdgeUsage({ electricCsv: csv('kWh', { customers: false }), gasCsv: csv('Therms') }); } catch (e) { stopped = e.message; }
  check('sdge: stops when there is no customer-count column (it never divides by anything else)', stopped === sdge.NO_CUSTOMERS_ERROR, stopped);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'amico-sdge-'));
  try {
    fs.writeFileSync(path.join(dir2, 'e.csv'), csv('kWh', { customers: false }));
    fs.writeFileSync(path.join(dir2, 'g.csv'), csv('Therms'));
    r = runTool('load-sdge-usage.mjs', ['--electric', path.join(dir2, 'e.csv'), '--gas', path.join(dir2, 'g.csv'), '--out', path.join(dir2, 'out.js')]);
    check('sdge CLI: the same stop, exit 1, nothing written', r.code === 1 && r.out.includes('No customer-count column found') && !fs.existsSync(path.join(dir2, 'out.js')), r.out);
    r = runTool('load-sdge-usage.mjs', ['--electric', path.join(dir2, 'e.csv'), '--gas', path.join(dir2, 'g.csv'), '--inspect']);
    check('sdge --inspect: prints the headers and stops', r.code === 0 && r.out.includes('ZipCode | Year | Month | CustomerClass | TotalkWh') && r.out.includes('TotalCustomers'), r.out);
  } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
  const moduleText = sdge.sdgeModuleText(built);
  check('sdge module text: the shape the context route reads', moduleText.includes('export const SDGE_ZIP_USAGE = { period: "Oct 2025 – Sep 2026", zips: {') && moduleText.includes("'91910': [500, 25],"));

  // Nothing under functions/ may import a loader, and the two data modules ship empty.
  const walkJs = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walkJs(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const importers = walkJs(path.join(root, 'functions')).filter(f => /(import|require)[^;\n]*load-(fcc-mobile|sdge-usage)/.test(fs.readFileSync(f, 'utf8')));
  check('no file under functions/ imports a loader', importers.length === 0, importers.join(', '));
  check('the two data modules ship empty (the loaders were not run)', FCC_MOBILE.asOf === '' && Object.keys(FCC_MOBILE.zips).length === 0 && SDGE_ZIP_USAGE.period === '' && Object.keys(SDGE_ZIP_USAGE.zips).length === 0);
  check('the loaders make no network call', !/fetch\(|https?\.get|node:https|node:http'/.test(read('tools/load-fcc-mobile.mjs') + read('tools/load-sdge-usage.mjs')));
  check('h3-js is never a dependency of the repo', !fs.existsSync(path.join(root, 'node_modules', 'h3-js')) && !/h3-js/.test(fs.existsSync(path.join(root, 'package.json')) ? read('package.json') : ''));
});

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
