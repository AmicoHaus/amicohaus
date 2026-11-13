// Hand-run loader: SDG&E's published usage by ZIP code -> functions/_lib/sdgeZipUsage.js (the "How do bills run
// nearby?" context, gate areaContext). Nothing here runs in a request, and nothing is downloaded: you download the two
// CSV files yourself from energydata.sdge.com (Energy Data Request Program: electric and gas usage by ZIP code).
//
//   node tools/load-sdge-usage.mjs --electric <electric.csv> --gas <gas.csv> --inspect
//   node tools/load-sdge-usage.mjs --electric <electric.csv> --gas <gas.csv> --out functions/_lib/sdgeZipUsage.js
//
// What it does: residential rows only; the latest 12 months that both files hold; for each ZIP with all 12 months in
// both files, total kWh (or therms) divided by total customers = the average per residential customer per month, as a
// whole number. It NEEDS a customer-count column: without one it stops (it never divides by anything else). A ZIP that
// SDG&E merged with a neighbor (a ZIP cell that isn't one 5-digit code, or a "combined" flag) is skipped.
// The file layout isn't verified, so --inspect prints the headers first, and any column can be named by hand:
//   --zip-col, --year-col, --month-col, --class-col, --total-col, --customers-col, --merged-col (each a header name).
// Read the printed table before the areaContext gate is turned on (functions/_lib/nuancedGate.js).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const NO_CUSTOMERS_ERROR = 'No customer-count column found. This loader never divides by anything else, so it stops here. Name the column with --customers-col if the file has one.';
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A small CSV reader (quoted cells, doubled quotes, commas and line breaks inside quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

// Which header is which. A name given by hand wins; otherwise a header is matched by what it says, and when two
// headers could be the same thing the loader stops instead of picking one.
export function findColumns(headers, { unit, overrides = {} } = {}) {
  const norm = h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const names = headers.map(norm);
  const byName = (name) => {
    const at = names.indexOf(norm(name));
    if (at < 0) throw new Error(`No column named "${name}". Headers: ${headers.join(' | ')}`);
    return at;
  };
  const one = (label, test, required = true) => {
    const hits = names.map((n, i) => (test(n) ? i : -1)).filter(i => i >= 0);
    if (hits.length === 1) return hits[0];
    if (!hits.length && !required) return -1;
    throw new Error(`${hits.length ? 'More than one' : 'No'} column looks like the ${label}. Name it by hand. Headers: ${headers.join(' | ')}`);
  };
  const cols = {
    zip: overrides.zip ? byName(overrides.zip) : one('ZIP code (--zip-col)', n => /\bzip\b|zipcode|zip code/.test(n)),
    year: overrides.year ? byName(overrides.year) : one('year (--year-col)', n => n === 'year'),
    month: overrides.month ? byName(overrides.month) : one('month (--month-col)', n => n === 'month'),
    cls: overrides.cls ? byName(overrides.cls) : one('customer class (--class-col)', n => /customer ?class|customer ?type/.test(n)),
    total: overrides.total ? byName(overrides.total) : one(`total ${unit} (--total-col)`, n => (unit === 'kWh' ? /kwh/ : /therm/).test(n) && !/average|avg|per/.test(n)),
    merged: overrides.merged ? byName(overrides.merged) : one('merged flag', n => /combin|merg|aggregat/.test(n), false),
  };
  if (overrides.customers) cols.customers = byName(overrides.customers);
  else {
    const hits = names.map((n, i) => (/customers?\b|accounts?\b|meters?\b/.test(n) && !/class|type/.test(n) && /count|number|total|^customers?$|^accounts?$|^meters?$/.test(n) ? i : -1)).filter(i => i >= 0);
    if (!hits.length) throw new Error(NO_CUSTOMERS_ERROR);
    if (hits.length > 1) throw new Error(`More than one column looks like the customer count. Name it with --customers-col. Headers: ${headers.join(' | ')}`);
    cols.customers = hits[0];
  }
  return cols;
}

const number = (v) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
function monthNumber(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 12) return Number(s);
  const at = MONTH_NAMES.indexOf(s.slice(0, 3));
  return at >= 0 ? at + 1 : NaN;
}

// One file -> { months: Set('YYYY-MM'), zips: Map(zip -> Map('YYYY-MM' -> { total, customers })), merged: Set(zip text) }.
export function readUsage(csvText, { unit, overrides = {} } = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('The file has no rows.');
  const cols = findColumns(rows[0], { unit, overrides });
  const zips = new Map(), months = new Set(), merged = new Set();
  for (const r of rows.slice(1)) {
    if (!/^res/i.test(String(r[cols.cls] || '').trim())) continue; // residential only
    const zipText = String(r[cols.zip] || '').trim();
    const flagged = cols.merged >= 0 && /^(y|yes|true|1)$/i.test(String(r[cols.merged] || '').trim());
    if (!/^\d{5}$/.test(zipText) || flagged) { if (zipText) merged.add(zipText); continue; }
    const year = number(r[cols.year]), month = monthNumber(r[cols.month]);
    const total = number(r[cols.total]), customers = number(r[cols.customers]);
    if (!Number.isInteger(year) || !month || !Number.isFinite(total) || !(customers > 0)) continue;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    months.add(ym);
    if (!zips.has(zipText)) zips.set(zipText, new Map());
    const at = zips.get(zipText).get(ym) || { total: 0, customers: 0 };
    at.total += total; at.customers += customers;
    zips.get(zipText).set(ym, at);
  }
  // A ZIP flagged as merged anywhere is left out everywhere.
  for (const z of merged) zips.delete(z);
  return { months, zips, merged };
}

const ymLabel = ym => `${MONTH_LABELS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
function monthsEndingAt(ym, count) {
  const out = [];
  let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5));
  for (let i = 0; i < count; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

// Both files -> { period, zips: { zip: [kWh, therms] }, skipped: [[zip, why]] }. The period is the latest 12 months
// that both files hold; a ZIP needs every one of them in both files.
export function buildSdgeUsage({ electricCsv, gasCsv, electricCols = {}, gasCols = {} }) {
  const electric = readUsage(electricCsv, { unit: 'kWh', overrides: electricCols });
  const gas = readUsage(gasCsv, { unit: 'therms', overrides: gasCols });
  const shared = [...electric.months].filter(m => gas.months.has(m)).sort();
  if (!shared.length) throw new Error('The two files share no month.');
  const period = monthsEndingAt(shared[shared.length - 1], 12);
  if (!period.every(m => electric.months.has(m) && gas.months.has(m))) throw new Error(`The files don't both hold the 12 months ending ${ymLabel(shared[shared.length - 1])}.`);
  const zips = {}, skipped = [];
  for (const z of [...electric.merged, ...gas.merged]) skipped.push([z, 'merged with a neighbor by SDG&E']);
  const average = (byMonth) => {
    let total = 0, customers = 0;
    for (const m of period) { const at = byMonth.get(m); if (!at) return null; total += at.total; customers += at.customers; }
    return customers > 0 ? Math.round(total / customers) : null;
  };
  for (const zip of [...new Set([...electric.zips.keys(), ...gas.zips.keys()])].sort()) {
    const kwh = electric.zips.has(zip) ? average(electric.zips.get(zip)) : null;
    const therms = gas.zips.has(zip) ? average(gas.zips.get(zip)) : null;
    if (kwh === null || therms === null) { skipped.push([zip, 'not all 12 months in both files']); continue; }
    zips[zip] = [kwh, therms];
  }
  return { period: `${ymLabel(period[0])} – ${ymLabel(period[11])}`, zips, skipped };
}

export function sdgeModuleText({ period, zips }) {
  const rows = Object.keys(zips).sort().map(z => `  '${z}': [${zips[z][0]}, ${zips[z][1]}],`).join('\n');
  return `// GENERATED by tools/load-sdge-usage.mjs: ZIP -> [average kWh, average therms] per residential customer per
// month over the latest 12 full months SDG&E published. Source: SDG&E Energy Data Request Program.
export const SDGE_ZIP_USAGE = { period: ${JSON.stringify(period)}, zips: {
${rows}
} };
`;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function main() {
  const a = args(process.argv.slice(2));
  if (!a.electric || !a.gas || a.electric === true || a.gas === true) {
    console.error('Usage: node tools/load-sdge-usage.mjs --electric <csv> --gas <csv> [--inspect] [--out <path>]');
    process.exit(2);
  }
  const electricCsv = fs.readFileSync(a.electric, 'utf8'), gasCsv = fs.readFileSync(a.gas, 'utf8');
  if (a.inspect) {
    for (const [name, text] of [['electric', electricCsv], ['gas', gasCsv]]) {
      const rows = parseCsv(text);
      console.log(`${name}: ${rows.length - 1} rows\n  headers: ${(rows[0] || []).join(' | ')}\n  first row: ${(rows[1] || []).join(' | ')}`);
    }
    return;
  }
  const overrides = { zip: a['zip-col'], year: a['year-col'], month: a['month-col'], cls: a['class-col'], total: a['total-col'], customers: a['customers-col'], merged: a['merged-col'] };
  let built;
  try { built = buildSdgeUsage({ electricCsv, gasCsv, electricCols: overrides, gasCols: overrides }); }
  catch (e) { console.error(`Stopped: ${e.message}`); process.exit(1); }
  console.log(`Period: ${built.period}\nZIP     kWh/mo  therms/mo`);
  for (const z of Object.keys(built.zips).sort()) console.log(`${z}   ${String(built.zips[z][0]).padStart(6)}  ${String(built.zips[z][1]).padStart(9)}`);
  if (built.skipped.length) console.log(`Skipped: ${built.skipped.map(([z, why]) => `${z} (${why})`).join('; ')}`);
  const text = sdgeModuleText(built);
  if (a.out && a.out !== true) { fs.writeFileSync(a.out, text); console.log(`Wrote ${a.out}. Read the table above before turning the areaContext gate on.`); }
  else console.log(`\n(no --out given: nothing written)\n\n${text}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
