// MLS tools (11.16): the generated CRMLS data module (aggregates only, floors kept, no address / MLS #, no forbidden
// word, no tax or difference key, no financing / concessions / compensation / #Exp key, every share passes the strict
// share rule), the launch gate (all seven on since Rudy's 11.16 broker OK, the monthly email off), every view's wording
// rules (source credit, "recent sold range, not an appraisal", the fixed feature line, no verdict, no price in Where My
// Home Fits, watchers never called buyers, never "null%"), the new cells (days to accepted offer, new construction and
// accessibility-features shares) and the Five Years card, the three endpoints on an in-memory SQLite copy of schema.sql
// (who sees what: all three need a sign-in since Rudy's 11.17 answer, signed out gets the same 401 and no data; statement counts, private no-store), mls-tools.js in a vm sandbox (nothing drawn while dark, escaping, the showcase
// draft, no inline styles), app.html / main.js hooks, the stylesheet, build-dist and .gitignore. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/mls-tools-test.mjs "<project root>"
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) { console.error('Usage: node --disable-warning=ExperimentalWarning tools/mls-tools-test.mjs <projectRoot>'); process.exit(2); }
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mod = p => import(pathToFileURL(path.join(root, p)).href);
let passed = 0, failed = 0;
const realLog = console.log;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${String(detail).slice(0, 600)}`}`); };
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran without crashing`, false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); } };

if (!fs.existsSync(path.join(root, 'functions/_lib/mlsAreaStats.js'))) {
  realLog('FAIL  functions/_lib/mlsAreaStats.js is missing: run node _tools/mls-amico-export.js in the sites folder first');
  process.exit(1);
}
const { MLS_AREA_STATS: S } = await mod('functions/_lib/mlsAreaStats.js');
const lib = await mod('functions/_lib/mlsTools.js');
const gate = await mod('functions/_lib/nuancedGate.js');
const { WISHLIST_ITEMS } = await mod('functions/_lib/listingTerms.js');
const { EMAIL_POSTAL_LINE } = await mod('functions/_lib/email.js');

const ADDR_RE = /\b\d{1,6}[- ]?[A-Za-z]?\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9'.-]+\s+){0,4}(?:st|street|ave|avenue|dr|drive|rd|road|ct|court|ln|lane|way|pl|place|blvd|boulevard|cir|circle|ter|terrace|pkwy|parkway|loop|trl|trail|caminito|calle|via|camino|paseo)\b\.?/i;
const MLS_RE = /\b(?:[A-Z]{2,3}\d{7,8}|\d{7,9}[A-Z]{2}|\d{8})\b/;
// Words no MLS tool may print. "appraisal" only inside "not an appraisal"; "value" and "worth" never.
const JURY_RE = /\b(best|hottest|hot|cold|safest|safe|safety|schools?|crime|family[- ]friendly|disabilit(y|ies)|demograph\w*|worth|value|premium|adds?|uplift|buyers?|demand|buyer's market|seller's market|balanced market|should|recommend\w*)\b/i;
const juryText = s => String(s).split('not an appraisal').join('').split('what a feature adds').join('');
const MIN = { sold: 5, active: 3, path: 10, fit: 20, within: 20, curve: 30, pace: 10 };
const ZIPS = ['91902', '91910', '91911', '91913', '91914', '91915', '91932', '91941', '91942', '91977', '91978', '92008', '92009', '92010', '92011', '92019',
  '92021', '92024', '92037', '92054', '92101', '92106', '92107', '92109', '92118', '92154', '92672', '92673'];
const AREAS = ['carlsbad', 'coronado', 'eastcounty', 'eastlake', 'imperialbeach', 'northcoastal', 'sanclemente', 'sandiego-coastal-urban', 'southbay-otaymesa'];
const AREAS_BY_NAME = ['carlsbad', 'coronado', 'eastcounty', 'eastlake', 'northcoastal', 'imperialbeach', 'southbay-otaymesa', 'sanclemente', 'sandiego-coastal-urban'];
// Keys the Amico slice never carries: the financing mix and lender note, central air, concessions, compensation, DPRYN,
// #Exp / #Oth, and the monthly stats' prices.
const NEVER_KEY_RE = /concession|bacomp|compensation|dpryn|financ|lender|centralAir|cooling|^mix$|^(cash|conventional|fha|va)$|^#?(exp|expired|oth)$|^(medSale|medList\w*|typicalSale|pendingAvg|activeAvg)$/i;
// The strict share rule, worked out on its own here (not borrowed from the exporter): a share is a whole percent, so its
// count is only known to a range; it breaks the rule when its base is under 20 or every count that rounds to it (or
// every rest of the base) is 1 to 4.
function shareBreaks(share, base) {
  if (share == null) return false;
  if (!(base >= 20)) return true;
  const lo = Math.max(0, Math.ceil(((share - 0.5) * base) / 100 - 1e-9)), hi = Math.min(base, Math.floor(((share + 0.5) * base) / 100 + 1e-9));
  return (lo >= 1 && hi <= 4) || (base - hi >= 1 && base - lo <= 4);
}
function allShares(S) {
  const out = [], add = (p, share, base) => { if (share != null) out.push({ p, share, base }); };
  const cell = (p, c) => {
    if (!c) return;
    if (c.path && c.path.stl) for (const k of ['over', 'at', 'under']) add(`${p}.stl.${k}`, c.path.stl[k], c.path.stl.n);
    if (c.path && c.path.cut) add(`${p}.cut`, c.path.cut.share, c.path.cut.n);
    if (c.curve && c.curve.within) for (const [k, v] of Object.entries(c.curve.within)) if (/^d\d+$/.test(k)) add(`${p}.within.${k}`, v, c.curve.within.n);
    if (c.curve && Array.isArray(c.curve.curve)) c.curve.curve.forEach((x, i) => add(`${p}.curve[${i}]`, x.share, c.curve.n));
    if (c.pace) add(`${p}.pending`, c.pace.pendingShare, c.pace.n);
    if (c.fit) for (const k of ['beds', 'baths', 'garage', 'stories']) if (c.fit[k]) for (const [b, v] of Object.entries(c.fit[k])) if (b !== 'n') add(`${p}.fit.${k}.${b}`, v, c.fit[k].n);
  };
  const lens = (p, L) => { if (!L) return; for (const [t, c] of Object.entries(L.byType || {})) cell(`${p}.${t}`, c); (L.bands || []).forEach((b, i) => cell(`${p}.band${i}`, b)); };
  const cols = (p, C) => { if (!C) return; for (const k of ['newConstruction', 'accessibility']) if (C[k] && C[k].n != null) add(`${p}.${k}`, C[k].share, C[k].n); const w = C.offerDays && C.offerDays.within; if (w) for (const [k, v] of Object.entries(w)) if (/^d\d+$/.test(k)) add(`${p}.offer.${k}`, v, w.n); };
  for (const [a, A] of Object.entries(S.areas)) { lens(a, A.lens); cols(`${a}.cols`, A.cols); for (const t of ['sfr', 'attached']) cols(`${a}.cols.${t}`, A.colsByType && A.colsByType[t]); }
  for (const [z, Z] of Object.entries(S.zips)) { lens(z, Z.lens); cols(`${z}.cols`, Z.cols); }
  return out;
}

// ===================== 1. The generated data module =====================
await section('data module', async () => {
  const text = read('functions/_lib/mlsAreaStats.js');
  check('data: says it is generated and kept out of git', /^\/\/ GENERATED by sites\/_tools\/mls-amico-export\.js/.test(text) && /\.gitignore/.test(text.split('\n').slice(0, 5).join('\n')));
  check('data: the 28 covered ZIP codes (27 + 91911), nine areas, an as-of date', JSON.stringify(Object.keys(S.zips).sort()) === JSON.stringify(ZIPS)
    && JSON.stringify(Object.keys(S.areas).sort()) === JSON.stringify(AREAS) && /^\d{4}-\d{2}-\d{2}$/.test(S.asOf), Object.keys(S.zips).sort().join());
  check('data: 91910 and 91911 joined the EastLake area; 91911 has no active export and says so; its own place names', JSON.stringify(S.areas.eastlake.zipList) === JSON.stringify(['91913', '91914', '91915', '91902', '91910', '91911'])
    && S.zips['91911'].active.n === null && S.zips['91911'].active.nLabel === 'no active listing export for this ZIP yet' && JSON.stringify(S.areas.eastlake.coverage.activeMissing) === '["91911"]'
    && S.zips['91902'].place === 'Bonita' && S.zips['92037'].place === 'La Jolla');
  const problems = [];
  (function walk(o, p) {
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (/^(address|mls|_id|_addr|raw|rows|sales|associations|hoods|mello|dues|hoaTotal|listingPictures|bacomp)$/i.test(k)) problems.push(`${p}.${k}: a key the slice never carries`);
        if (NEVER_KEY_RE.test(k)) problems.push(`${p}.${k}: financing, concessions, compensation, #Exp / #Oth or a monthly price`);
        if (/tax|prop ?1[39]|assess/i.test(k)) problems.push(`${p}.${k}: tax key`);
        if (/diff|delta|premium|adds|worth|uplift|gap|estimate|value$/i.test(k) && k !== 'nLabel') problems.push(`${p}.${k}: difference / value key`);
        walk(o[k], `${p}.${k}`);
      }
      if (o.k) {
        const floor = o.k === 'active' ? MIN.active : /\.path(\.noCut|\.afterCut)?$/.test(p) ? MIN.path : /\.fit$/.test(p) ? MIN.fit : MIN.sold;
        if (o.n != null && o.n < floor) problems.push(`${p}: n ${o.n} under ${floor}`);
        if (o.n == null && Object.keys(o).some(k => !['k', 'n', 'nLabel'].includes(k))) problems.push(`${p}: a suppressed cell still holds numbers`);
        if (o.n == null && !o.nLabel) problems.push(`${p}: a suppressed cell has no label`);
        if (o.curve && o.n < MIN.curve) problems.push(`${p}: curve under ${MIN.curve}`);
        if (o.within && o.within.n < MIN.within) problems.push(`${p}: within shares under ${MIN.within}`);
        if (o.pendingShare != null && o.n < MIN.pace) problems.push(`${p}: pending share under ${MIN.pace}`);
        if (o.status) for (const [s, v] of Object.entries(o.status)) if (v != null && v < MIN.active) problems.push(`${p}.status.${s} under 3`);
        for (const k of ['sqftStrip', 'builtStrip', 'lotStrip', 'beds', 'baths', 'garage', 'stories']) if (o[k] && o[k].n != null && o[k].n < MIN.fit && /\.fit$/.test(p)) problems.push(`${p}.${k} under 20`);
      }
      return;
    }
    if (typeof o === 'string') {
      if (ADDR_RE.test(o)) problems.push(`${p}: address-like text`);
      if (MLS_RE.test(o)) problems.push(`${p}: MLS-number-like text`);
      if (/\$\s?\d/.test(o) && !/\.bands\[\d+\]\.label$/.test(p)) problems.push(`${p}: dollar figure in text`);
      if (/\b(best|hottest|safest|schools?|worth|premium|buyers?|demand)\b/i.test(juryText(o)) && !/\.about$/.test(p)) problems.push(`${p}: forbidden word`);
    }
  })(S, 'S');
  check('data: no row-level, tax or difference key; every cell meets its floor; no address, MLS #, dollar text or forbidden word', problems.length === 0, problems.slice(0, 8).join(' | '));
  for (const [a, A] of Object.entries(S.areas)) {
    check(`data: ${a} carries the CRMLS source credit with its date range and as-of line`, /^Based on CRMLS data for .+ to .+\. Information deemed reliable but not guaranteed\. As of .+\.$/.test(A.source.full) && A.source.from && A.source.to);
  }
  check('data: the source wording is the engine template (one constant)', S.rules.sourceCredit === 'Based on CRMLS data for {range}. Information deemed reliable but not guaranteed.');
  check('data: no photo, commission or MLS media reference', !/listing pictures|bacomp|commission|media\.crmls|paragon/i.test(text));
  check('data: no HOA or Mello-Roos dollar figures (not part of the Amico slice)', !/mello|"dues"|hoaTotal/i.test(text));
  check('data: no concessions, BAComp / compensation, DPRYN, financing mix, lender note, central air or #Exp anywhere', !/concession|bacomp|compensation|dpryn|financ|lender|centralAir|"cash"|conventional|"fha"|"va"|#exp|expired/i.test(text));
  // The strict share rule (11.16): every share shown has a base of 20+, and no share can point to 1 to 4 sales (count or rest).
  const breaks = allShares(S).filter(x => shareBreaks(x.share, x.base));
  check(`data: all ${allShares(S).length} shares pass the share rule (base 20+, neither the count nor the rest 1 to 4)`, breaks.length === 0 && allShares(S).length > 1000, breaks.slice(0, 5).map(x => `${x.p} ${x.share}% of ${x.base}`).join(' | '));
  check('share rule self-test: 3% of 120, 98% of 120, 50% of 12 and 4% of 100 break it; 0% of 300, 96% of 120 and 5% of 100 pass', shareBreaks(3, 120) && shareBreaks(98, 120) && shareBreaks(50, 12) && shareBreaks(4, 100)
    && !shareBreaks(0, 300) && !shareBreaks(96, 120) && !shareBreaks(5, 100) && !shareBreaks(null, 3));
  const nc = S.zips['91911'].cols.newConstruction;
  check('data: a withheld share is null with its label (91911 new construction: fewer than 5 of 200)', nc.share === null && nc.shareLabel === 'fewer than 5 of 200' && nc.n === 200, JSON.stringify(nc));
  check('data: the new cells exist for the new export, not for Coronado (its export has no such columns)', S.areas.eastlake.cols && S.areas.eastlake.cols.offerDays.days.med > 0 && S.areas.carlsbad.colsByType.sfr.accessibility
    && S.areas.coronado.cols === null && S.zips['92118'].cols === null);
  // Five-year trend: months Jan 2021 to Oct 2026 (Nov 2026 partial, dropped), sold 5+ or null, months of supply only with a sold count.
  const tr = S.zips['91913'].trend, badT = [];
  for (const [key, T] of [...Object.entries(S.zips).map(([z, Z]) => [z, Z.trend]), ...Object.entries(S.areas).map(([a, A]) => [a, A.trend])]) {
    if (!T || T.missing) continue;
    for (const m of T.months) { if (m.sold != null && m.sold < 5) badT.push(`${key} ${m.ym} sold ${m.sold}`); if (m.mos != null && m.sold == null) badT.push(`${key} ${m.ym} mos without sold`); if (Object.keys(m).some(k => !['ym', 'sold', 'mos'].includes(k))) badT.push(`${key} ${m.ym} extra key`); }
    if (T.months.some(m => m.ym === '2026-11')) badT.push(`${key}: the partial month is in`);
    if (!/^Based on CRMLS data for January 2021 to October 2026\. Information deemed reliable but not guaranteed\. As of .+\.$/.test(T.source.full)) badT.push(`${key}: trend credit`);
  }
  check('data: Five Years rows (70 months, Jan 2021 to Oct 2026) meet the floors, carry only ym / sold / mos, and cite their own CRMLS dates', tr.months.length === 70 && tr.from === '2021-01' && tr.to === '2026-10' && badT.length === 0, badT.slice(0, 5).join(' | '));
  check('data: 91911 is not in the monthly stats and says so; the EastLake area lists it as missing', S.zips['91911'].trend.missing === true && JSON.stringify(S.areas.eastlake.trend.missingZips) === '["91911"]');
});

// ===================== 2. The gate and the email switch =====================
await section('gate', async () => {
  const member = { id: 3, role: 'user' }, admin = { id: 5, role: 'admin' }, agent = { id: 4, role: 'agent' };
  check('gate: the seven MLS tools are in the launch gate, all true as shipped (Rudy\'s broker OK, 11.16)', lib.MLS_TOOLS.length === 7 && lib.MLS_TOOLS.every(t => gate.NUANCED_TOOLS[t] === true));
  check('gate: on for signed-out visitors, members, agents and admins', lib.MLS_TOOLS.every(t => gate.toolLive({}, t, null) && gate.toolLive({}, t, member) && gate.toolLive({}, t, agent) && gate.toolLive({}, t, admin)));
  check('gate: written as one line of seven trues in nuancedGate.js', /areaPulse: true, pricePath: true, marketPace: true, homeFits: true, featureLens: true, daysCurve: true, watchersPulse: true,/.test(read('functions/_lib/nuancedGate.js')));
  check('gate: the Five Years card has no gate key of its own (it rides on marketPace)', lib.FIVE_YEAR_GATE === 'marketPace' && !Object.hasOwn(gate.NUANCED_TOOLS, 'fiveYear'));
  check('gate: the lens tools are the MLS tools minus Area Pulse and Where My Home Fits', JSON.stringify(lib.LENS_TOOLS) === JSON.stringify(lib.MLS_TOOLS.filter(t => t !== 'areaPulse' && t !== 'homeFits')));
  check('the Area Pulse monthly email is switched off', lib.AREA_PULSE_EMAIL_LIVE === false && /export const AREA_PULSE_EMAIL_LIVE = false;/.test(read('functions/_lib/mlsTools.js')));
  check('no job runs the Area Pulse email (not in the lazy-job list)', !/mlsTools|areaPulse/i.test(read('functions/api/_middleware.js')));
});

// ===================== 3. The views =====================
const allText = [];
const collect = v => { if (!v) return; for (const x of [v.heading, v.scope, v.note, v.footnote, v.trend && v.trend.mosLabel, v.trend && v.trend.soldLabel, v.trending, v.curveLabel, v.carry, v.button, ...(v.lines || []), ...((v.table && [v.table.caption, ...v.table.head, ...v.table.rows.flat()]) || [])]) if (x) allText.push(String(x)); };
await section('views', async () => {
  const credited = v => /^Based on CRMLS data for .+ Information deemed reliable but not guaranteed\. As of .+\.$/.test(v.credit);
  const zip = lib.resolveScope('91913'), small = lib.resolveScope('91902'), area = lib.resolveScope('eastlake'), cor = lib.resolveScope('92118');
  check('scopes: a covered ZIP, an area, and nothing for an uncovered ZIP or junk', zip.kind === 'zip' && area.kind === 'area' && lib.resolveScope('90210') === null && lib.resolveScope('92101').kind === 'zip' && lib.resolveScope("'; DROP") === null && lib.resolveScope('') === null);
  check('scope list: areas alphabetical by name, then the 28 ZIPs in order (no ranking)', JSON.stringify(lib.scopeList().map(s => s.key)) === JSON.stringify([...AREAS_BY_NAME, ...ZIPS]), lib.scopeList().map(s => s.key).join());
  check('scope list: no doubled place names ("Carlsbad", not "Carlsbad (Carlsbad)"); ZIPs say their own place', !lib.scopeList().some(s => /^(.+) \(\1\)$/.test(s.label) || /\) \(/.test(s.label))
    && lib.scopeList().find(s => s.key === 'eastlake').label === 'EastLake area (Chula Vista and Bonita)' && lib.scopeList().find(s => s.key === '91902').label === 'ZIP 91902 (Bonita)', lib.scopeList().map(s => s.label).join(' / '));

  const card = lib.areaPulseCard('91913', 'Our block');
  collect(card);
  check('Area Pulse: heading, sold count, middle range with the not-an-appraisal label, median days, active + pending, credit', card.covered && card.heading === 'ZIP 91913 · Our block'
    && /^\d[\d,]* homes sold in the last 12 months/.test(card.lines[0]) && card.lines.some(l => /^Middle price range \$[\d,]+ to \$[\d,]+, median \$[\d,]+ \(recent sold range, not an appraisal\)$/.test(l))
    && card.lines.some(l => /^Median days on market: \d+$/.test(l)) && card.lines.some(l => /^On the MLS now: .+ active · .+ pending · .+ active under contract$/.test(l)) && credited(card), JSON.stringify(card));
  check('Area Pulse: the median days from listing to accepted offer (new column)', card.lines.some(l => /^Median days from listing to accepted offer: \d+$/.test(l)), card.lines.join(' | '));
  const nc = lib.areaPulseCard('90210');
  check('Area Pulse: an uncovered ZIP says so, lists the covered ones, and has no numbers', !nc.covered && nc.lines.length === 1 && nc.lines[0] === `No MLS numbers for this ZIP code yet. So far they cover ${ZIPS.slice(0, -1).join(', ')} and ${ZIPS[ZIPS.length - 1]}.` && nc.credit === '', nc.lines[0]);
  const c911 = lib.areaPulseCard('91911');
  collect(c911);
  check('Area Pulse 91911: sold numbers, and "no active listing export for this ZIP yet" (not "fewer than 3")', c911.covered && c911.lines.includes('On the MLS now: no active listing export for this ZIP yet') && /^\d[\d,]* homes sold/.test(c911.lines[0]), c911.lines.join(' | '));

  for (const [s, t] of [[zip, 'all'], [zip, 'sfr'], [small, 'attached'], [area, 'all'], [cor, 'sfr']]) {
    const pp = lib.pricePathView(s, t), mp = lib.marketPaceView(s, t), fl = lib.featureLensView(s, t), dc = lib.daysCurveView(s, t);
    for (const v of [pp, mp, fl, dc]) collect(v);
    check(`views ${s.key}/${t}: every card has its heading and the CRMLS credit`, [pp, mp, fl, dc].every(v => v.heading === lib.HEADINGS[v.tool] && credited(v)));
    check(`Price Path ${s.key}/${t}: sale-to-list and price-cut lines, both day sides shown (never subtracted)`, pp.lines.some(l => l.startsWith('Sold without a price cut')) && pp.lines.some(l => l.startsWith('Sold after a price cut'))
      && !pp.lines.some(l => /faster|slower|longer|shorter|more days|fewer days|difference|vs\. sold/i.test(l)), pp.lines.join(' | '));
    check(`Market Pace ${s.key}/${t}: a number on a neutral scale, the months-of-supply definition, no verdict`, mp.note === lib.PACE_LINE && (!mp.gauge || (mp.gauge.max === 8 && mp.gauge.value >= 0))
      && ![...mp.lines, mp.gauge ? mp.gauge.label : ''].some(l => /buyer|seller|hot|cold|balanced|favor|strong|weak|competitive/i.test(l)));
    check(`Feature Lens ${s.key}/${t}: with / without rows, no difference column, the fixed line`, fl.note === 'This is what sold, not what a feature adds.' && fl.table
      && JSON.stringify(fl.table.head) === JSON.stringify(['Feature', '', 'Sales', 'Median $ per sq ft', 'Median days on market', 'Median sale-to-list'])
      && fl.table.rows.every((r, i) => r[1] === (i % 2 ? 'Without' : 'With') && r.length === 6), JSON.stringify(fl.table && fl.table.head));
    check(`Days to Sold ${s.key}/${t}: median line, shares or their fewer label, curve only at 30+ sales`, dc.lines.length >= 1 && dc.note.startsWith(lib.DAYS_LINE) && (dc.curve === null || dc.curve === undefined || (Array.isArray(dc.curve) && dc.curve.length >= 2)));
  }
  // Widening: ZIP 91902 condos and townhomes have under 10 sales without a cut: that side says so; the curve widens when the ZIP is short.
  const pp902 = lib.pricePathView(small, 'attached');
  check('Price Path: a side under 10 sales shows "fewer than 10 sales", not a number', pp902.lines.includes('Sold without a price cut: fewer than 10 sales'), pp902.lines.join(' | '));
  check('Price Path: withheld sale-to-list parts are named, never "null%" (91902 condos and townhomes: only below list shown)', pp902.lines[0] === 'Sale price vs. final list price: median 100%. 43% below; above list and at list: not split out (small counts) (21 sales)', pp902.lines[0]);

  // Every view, every scope, every type: never null / undefined / NaN in the words, never a withheld curve point drawn.
  const nulls = [];
  for (const sc of lib.scopeList().map(x => lib.resolveScope(x.key))) for (const t of ['all', 'sfr', 'attached']) {
    const vs = [lib.pricePathView(sc, t), lib.marketPaceView(sc, t), lib.fiveYearView(sc, t), lib.featureLensView(sc, t), lib.daysCurveView(sc, t)];
    if (sc.kind === 'zip') vs.push(lib.areaPulseCard(sc.key), lib.watchersPulseView(sc, { watchers: 0, wishers: 0, wishes: [] }), lib.homeFitsView({ zip: sc.key, type: t, beds: 3, baths: 2, sqft: 1800, lot: 5000, year: 1990, stories: 2, garage: 2 }));
    for (const v of vs) {
      collect(v);
      const words = JSON.stringify([v.lines, v.scope, v.note, v.table, v.curveLabel, v.trending, v.trend && [v.trend.soldLabel, v.trend.mosLabel]].filter(x => x !== undefined && x !== null && x !== ''));
      if (/null|undefined|NaN/.test(words)) nulls.push(`${sc.key}/${t}/${v.tool}`);
      if (Array.isArray(v.curve) && v.curve.some(pt => pt.share == null)) nulls.push(`${sc.key}/${t}: curve point withheld but drawn`);
    }
  }
  check('every view x 37 scopes x 3 types: no "null", "undefined" or "NaN" in what prints, no withheld curve point drawn', nulls.length === 0, nulls.slice(0, 6).join(' | '));
  check('fits buckets: a withheld bucket is named, not numbered', lib.homeFitsView({ zip: '91902', type: 'all', stories: 2 }).lines[0] === 'Stories: 2. 1: 67% · 2 and 3 or more: not split out (small counts)', lib.homeFitsView({ zip: '91902', type: 'all', stories: 2 }).lines[0]);

  // The new cells (phase 2).
  const elDays = lib.daysCurveView(area, 'all'), elFeat = lib.featureLensView(area, 'all');
  check('Days to Sold: days from listing to accepted offer (median, middle range, count) and the within-7/14/30 shares, with its definition', elDays.lines.some(l => /^Days from listing to accepted offer: median \d+ \(middle range \d+ to \d+, [\d,]+ sales\)$/.test(l))
    && elDays.lines.some(l => /^Accepted offer within 7 days: \d+% · 14 days: \d+% · 30 days: \d+%$/.test(l)) && elDays.note.includes(lib.OFFER_LINE), elDays.lines.join(' | '));
  check('Feature Lens: the new construction share (of sales where the field is filled in) and "homes with accessibility features"', elFeat.lines.some(l => /^Marked new construction in the MLS: \d+% of [\d,]+ sales where the field is filled in$/.test(l))
    && elFeat.lines.some(l => /^Homes with accessibility features: \d+% of [\d,]+ sales$/.test(l)), elFeat.lines.join(' | '));
  const z911 = lib.featureLensView(lib.resolveScope('91911'), 'sfr');
  check('Feature Lens 91911: the withheld share reads "fewer than 5 of 200 sales"; a ZIP with a home type says the cell is all home types', z911.lines[0] === 'Marked new construction in the MLS: fewer than 5 of 200 sales where the field is filled in (all home types in ZIP 91911)', z911.lines.join(' | '));
  check('Coronado: no new-cell lines (its export has none of these columns)', !lib.featureLensView(cor, 'all').lines.length && !lib.daysCurveView(cor, 'all').lines.some(l => /accepted offer/.test(l)));
  const sfrA = lib.colsLines(area, 'sfr'), attA = lib.colsLines(area, 'attached');
  check('the area cells follow the home type (single-family and condo/townhome medians differ)', sfrA.offer[0] !== attA.offer[0] && sfrA.offer.length === 2);
  const money = [];
  for (const sc of lib.scopeList().map(x => lib.resolveScope(x.key))) for (const t of ['all', 'sfr', 'attached']) { const c = lib.colsLines(sc, t); for (const l of [...c.offer, ...c.features]) if (/cash|conventional|\bFHA\b|\bVA\b|financ|loan|lender|mortgage|concession|credit|compensation|central air/i.test(l)) money.push(l); }
  check('no financing mix, lender, concessions, compensation or central air line anywhere (Amico shows none of them)', money.length === 0, money.slice(0, 3).join(' | '));

  // Five Years
  const fy = lib.fiveYearView(zip, 'all'), fyA = lib.fiveYearView(area, 'all'), fy911 = lib.fiveYearView(lib.resolveScope('91911'), 'sfr');
  for (const v of [fy, fyA, fy911]) collect(v);
  check('Five Years: heading, 70 months, year marks, homes sold by year, latest months of supply (with its asterisk) and the partial-month note', fy.heading === 'Five Years, Month by Month' && fy.trend.months.length === 70
    && fy.trend.yearTicks.map(y => y.label).join() === '2021,2022,2023,2024,2025,2026' && /^Homes sold by year: 2021: [\d,]+ · .+ · 2026 \(January to October\): [\d,]+$/.test(fy.lines[0])
    && /^Months of supply\*, October 2026: \d+\.\d$/.test(fy.lines[1]) && fy.note === 'November 2026 (partial month, left out).', JSON.stringify([fy.lines, fy.note]));
  // Rudy 11.17: keep the figure, put an asterisk on it and explain underneath (active / sold that month vs the 12-month Market Pace figure).
  check('Five Years: the asterisk footnote under the chart, plain words: homes for sale / homes sold that month, can differ from the 12-month Market Pace figure', [fy, fyA, fy911].every(v => v.footnote === lib.TREND_LINE)
    && lib.TREND_LINE === '*Months of supply here = homes for sale that month divided by homes sold that month, so it can differ from the 12-month figure on the Market Pace gauge.'
    && fy.trend.mosLabel.startsWith('Months of supply* each month, ') && [fy, fyA].every(v => v.lines.some(l => l.startsWith('Months of supply*, ')))
    && lib.marketPaceView(zip, 'all').lines.every(l => !l.includes('*')) && !/^\*?(This|Here) (card|chart|page)/i.test(lib.TREND_LINE), JSON.stringify([fy.footnote, fy.trend.mosLabel]));
  check('Five Years: every asterisk has its footnote (no orphan mark, no footnote without a mark)', [fy, fyA, fy911].every(v => { const marked = JSON.stringify([v.lines, v.trend && v.trend.mosLabel]).includes('supply*'); return marked === !!v.footnote && (!v.footnote || v.footnote.startsWith('*')); }));
  check('Five Years: its own CRMLS credit (January 2021 to October 2026), not the 12-month one', /^Based on CRMLS data for January 2021 to October 2026\. Information deemed reliable but not guaranteed\. As of .+\.$/.test(fy.credit));
  check('Five Years: months of supply is active / sold that month (ZIP 91913 has it in every month, not just 2026)', fy.trend.months.filter(m => m.mos != null).length >= 60, fy.trend.months.filter(m => m.mos != null).length);
  check('Five Years: no price, no pending or expired figure in the card', !/\$|price|expired|pending/i.test(JSON.stringify([fy.lines, fy.note, fy.scope, fy.trend.soldLabel, fy.trend.mosLabel])) && fy.trend.months.every(m => Object.keys(m).join() === 'ym,label,sold,mos'));
  check('Five Years 91911: widens to the EastLake area and says why; the area card names the ZIP it leaves out', fy911.scope === 'EastLake area · All home types · January 2021 to October 2026 (ZIP 91911 is not in the monthly CRMLS stats export, so this is the whole area) (the monthly CRMLS stats cover all home types together)'
    && fyA.lines.includes('ZIP 91911 is not in the monthly CRMLS stats export, so it is left out here.'), fy911.scope);
  const zipCurve = { k: 'sold', n: 25, days: { med: 9, lo: 4, hi: 20, n: 25 }, within: { d7: 40, d14: 60, d30: 80, d60: 90, d90: 96, n: 25 }, curve: [{ d: 0, share: 1 }, { d: 7, share: 40 }] };
  const areaPath = { k: 'sold', n: 50, stl: { med: 100, over: 40, at: 20, under: 40, n: 50 }, cut: { share: 30, n: 50 }, noCut: { k: 'sold', n: 35, days: { med: 10, lo: 5, hi: 20, n: 35 } }, afterCut: { k: 'sold', n: 15, days: { med: 50, lo: 30, hi: 80, n: 15 } } };
  const fakeZ = { name: 'ZIP 99999', lens: { byType: { all: { path: { k: 'sold', n: null, nLabel: 'fewer than 10 sales' }, curve: zipCurve } }, bands: [] }, features: {} };
  const fakeA = { name: 'Test area', source: { full: 'Based on CRMLS data for X to Y. Information deemed reliable but not guaranteed. As of Y.' }, lens: { byType: { all: { path: areaPath } }, bands: [] }, features: { all: {} }, trendingZips: null };
  const fake = { kind: 'zip', key: '99999', name: 'ZIP 99999', Z: fakeZ, A: fakeA };
  const wid = lib.pricePathView(fake, 'all');
  check('widening: a ZIP under its floor shows the whole area and says why', wid.scope === 'Test area · All home types (ZIP 99999 has fewer than 10 sales for this, so this is the whole area)' && wid.lines.some(l => l.includes('50 sales')), wid.scope);
  const dc25 = lib.daysCurveView(fake, 'all');
  check('Days to Sold: no curve drawn under 30 sales even if a cell carried one', dc25.curve === null && /30 or more/.test(dc25.curveLabel), JSON.stringify(dc25));
  // The cumulative guard (11.17): a within / curve figure the data module held (null, with heldLabels / shareLabel) is named, never a number.
  const heldCurve = { k: 'sold', n: 40, days: { med: 12, lo: 5, hi: 30, n: 40 }, within: { d7: 40, d14: null, d30: 80, d60: null, d90: 95, n: 40, heldLabels: { d14: 'fewer than 5 sales from the figure before it', d60: 'fewer than 5 sales from the figure before it' } },
    curve: [{ d: 0, share: null, shareLabel: 'fewer than 5 of 40' }, { d: 7, share: 40 }, { d: 14, share: null, shareLabel: 'fewer than 5 sales from the figure before it' }, { d: 30, share: 80 }] };
  const fakeH = Object.assign({}, fake, { Z: Object.assign({}, fakeZ, { lens: { byType: { all: { path: fakeZ.lens.byType.all.path, curve: heldCurve } }, bands: [] } }) });
  const dcH = lib.daysCurveView(fakeH, 'all');
  check('Days to Sold: held within days are named after the shown ones ("14 days and 60 days: not split out")', dcH.lines.includes('Sold within 7 days: 40% · 30 days: 80% · 90 days: 95%; 14 days and 60 days: not split out (small counts)'), dcH.lines.join(' | '));
  check('Days to Sold: held curve points are left off, the rest drawn in order', Array.isArray(dcH.curve) && JSON.stringify(dcH.curve.map(p => p.d)) === '[7,30]' && /from day 7 to day 30/.test(dcH.curveLabel), JSON.stringify(dcH.curve));
  const oneLeft = Object.assign({}, heldCurve, { curve: [{ d: 0, share: null, shareLabel: 'fewer than 5 of 40' }, { d: 7, share: 40 }, { d: 14, share: null, shareLabel: 'fewer than 5 sales from the figure before it' }] });
  const dc1 = lib.daysCurveView(Object.assign({}, fake, { Z: Object.assign({}, fakeZ, { lens: { byType: { all: { path: fakeZ.lens.byType.all.path, curve: oneLeft } }, bands: [] } }) }), 'all');
  check('Days to Sold: a 30+ curve with under 2 shown points says why (not "needs 30 or more sales")', dc1.curve === null && /^Too few separate points to draw the curve/.test(dc1.curveLabel), dc1.curveLabel);
  // the data module itself: within and curve agree, and no two neighbouring shown figures of a series sit 1 to 4 sales apart (every count the
  // rounding allows), the same test as sites/_tools/mls-data.js --check
  const cumBad = [];
  const rng = (v, B) => [Math.max(0, Math.ceil(((v - 0.5) * B) / 100 - 1e-9)), Math.min(B, Math.floor(((v + 0.5) * B) / 100 + 1e-9))];
  const series = (p, pts, B) => { let prev = null; for (const [d, v] of pts.sort((a, b) => a[0] - b[0])) { if (v == null) continue; if (prev) { const [lo, hi] = rng(v, B), [plo, phi] = rng(prev[1], B); if (v < prev[1] || (lo - phi >= 1 && hi - plo <= 4)) cumBad.push(`${p}: day ${prev[0]} ${prev[1]}% to day ${d} ${v}% of ${B}`); } prev = [d, v]; } };
  const curveSeries = (p, c) => { if (!c || c.n == null) return; const m = new Map((c.curve || []).map(x => [x.d, x.share])); for (const [k, v] of Object.entries(c.within || {})) if (/^d\d+$/.test(k)) { const d = Number(k.slice(1)); if (m.has(d) && m.get(d) !== v) cumBad.push(`${p}: within ${k} and curve disagree`); if (!m.has(d)) m.set(d, v); } series(p, [...m.entries()], c.n); };
  const lensSeries = (p, L) => { if (!L) return; for (const [t, c] of Object.entries(L.byType || {})) curveSeries(`${p}.${t}`, c.curve); (L.bands || []).forEach((b, i) => curveSeries(`${p}.band${i}`, b.curve)); };
  const offerSeries = (p, C) => { const w = C && C.offerDays && C.offerDays.within; if (w) series(`${p}.offer`, Object.keys(w).filter(k => /^d\d+$/.test(k)).map(k => [Number(k.slice(1)), w[k]]), w.n); };
  for (const [a, A] of Object.entries(S.areas)) { lensSeries(a, A.lens); offerSeries(a, A.cols); for (const t of ['sfr', 'attached']) offerSeries(`${a}.${t}`, A.colsByType && A.colsByType[t]); }
  for (const [z, Z] of Object.entries(S.zips)) { lensSeries(z, Z.lens); offerSeries(z, Z.cols); }
  check('data: the cumulative guard holds on every days curve, within-N-days and accepted-offer series (no step of 1 to 4 sales, within and curve agree)', cumBad.length === 0, cumBad.slice(0, 4).join(' | '));
  const pace = lib.marketPaceView(area, 'all');
  check('Market Pace: the approved Trending activity sort, labeled, by homes sold in the last 90 days', pace.trending.startsWith('Trending: most homes sold in the last 90 days: ZIP ') && /\(\d+\)/.test(pace.trending));
  check('Market Pace: band table has listings, months of supply and pending share columns only', JSON.stringify(pace.table.head) === JSON.stringify(['Price band', 'Listings now', 'Months of supply', 'Pending or under contract']));

  // Where My Home Fits
  check('fits: an uncovered ZIP is refused', lib.validateHomeFits({ zip: '90210' }).error === lib.FITS_ZIP_ERROR && lib.validateHomeFits(null).error === lib.FITS_ZIP_ERROR);
  check('fits: odd numbers are refused (negative, fractional beds, 2.25 baths, a year from the future, text)', ['-1', '2.5', 'abc'].every(v => lib.validateHomeFits({ zip: '91913', beds: v }).error === lib.FITS_NUMBER_ERROR)
    && lib.validateHomeFits({ zip: '91913', baths: '2.25' }).error === lib.FITS_NUMBER_ERROR && lib.validateHomeFits({ zip: '91913', year: '2999' }).error === lib.FITS_NUMBER_ERROR);
  const ok = lib.validateHomeFits({ zip: '91913', type: 'sfr', beds: '4', baths: '2.5', sqft: '2100', lot: '5000', year: '2005', stories: '2', garage: '2', price: '900000', address: '12 Main St' });
  check('fits: only the known fields are kept (no price, no address)', ok.data && JSON.stringify(Object.keys(ok.data).sort()) === JSON.stringify(['baths', 'beds', 'garage', 'lot', 'sqft', 'stories', 'type', 'year', 'zip']), JSON.stringify(ok));
  const fv = lib.homeFitsView(ok.data);
  collect(fv);
  check('fits: a line for each answer, positions in tenths, no price or dollar sign anywhere', fv.lines.length === 7 && /^Size: 2,100 sq ft\. (About \d|Fewer than 1|More than 9) in 10 recent sales were smaller\.$/.test(fv.lines[0])
    && fv.lines.some(l => /^Year built: 2005\. /.test(l)) && fv.lines.some(l => /^Bedrooms: 4\. \d+% of recent sales had 4 too · /.test(l)) && !JSON.stringify(fv).includes('$') && !/null|undefined|NaN/.test(JSON.stringify(fv)), fv.lines.join(' | '));
  check('fits: the showcase draft carries ZIP, type, beds, baths, size, garage and nothing else', JSON.stringify(fv.draft) === JSON.stringify({ zip: '91913', propertyType: 'Single Family Home', beds: 4, baths: 2.5, sqft: 2100, garage: 2 }));
  check('fits: the no-price line, the carry-over line and the button words', fv.note === lib.FITS_LINE && fv.carry === lib.FITS_CARRY_LINE && fv.button === lib.FITS_DRAFT_BUTTON);
  const attached = lib.homeFitsView(lib.validateHomeFits({ zip: '91913', type: 'attached', lot: '5000' }).data);
  check('fits: condos and townhomes never get a lot line', !attached.lines.some(l => l.startsWith('Lot')) && attached.draft.propertyType === '');
  check('fits: position words at the ends', lib.stripPosition({ p10: 1, p20: 2, p30: 3, p40: 4, p50: 5, p60: 6, p70: 7, p80: 8, p90: 9 }, 0) === 0 && lib.stripPosition({ p10: 1, p20: 2, p30: 3, p40: 4, p50: 5, p60: 6, p70: 7, p80: 8, p90: 9 }, 10) === 9
    && lib.stripPosition({ p10: 1 }, 5) === null);

  // Watchers and Listings
  const w0 = lib.watchersPulseView(zip, { watchers: 4, wishers: 9, wishes: [{ item: 'as_is', n: 9 }] });
  const w1 = lib.watchersPulseView(zip, { watchers: 12, wishers: 14, wishes: [{ item: 'quick_close', n: 8 }, { item: 'as_is', n: 6 }] });
  for (const v of [w0, w1]) collect(v);
  check('Watchers: under 5 members reads "Fewer than 5", under 10 wish lists shows no item', w0.lines[0] === 'Fewer than 5 Amico Haus members watch ZIP 91913 so far' && !w0.lines.some(l => l.includes(WISHLIST_ITEMS.as_is)));
  check('Watchers: 5+ members counted, 10+ wish lists show the top items as "n of N"', w1.lines[0] === '12 Amico Haus members watch ZIP 91913' && w1.lines.some(l => l.includes(`${WISHLIST_ITEMS.quick_close} (8 of 14)`)));
  check('Watchers: MLS listing line and the where-from note', w1.lines.some(l => /^On the MLS now: \d+ listings/.test(l)) && /from Amico Haus; listing counts are from the MLS/.test(w1.note));
  check('Watchers: an area scope asks for a ZIP code', lib.watchersPulseView(area, null).lines[0] === 'Pick a ZIP code to see how many members watch it.');

  // The monthly email (built, off)
  const mail = lib.areaPulseEmail([card, nc], { stopUrl: 'https://amicohaus.com/stop' });
  check('email: true subject, only covered cards, the credit, why-you-got-this, a stop link and the postal line', mail.subject === 'Your watch areas this month' && mail.text.includes('ZIP 91913 · Our block') && !mail.text.includes('No MLS numbers')
    && mail.text.includes('Information deemed reliable but not guaranteed') && mail.text.includes('Stop these emails: https://amicohaus.com/stop') && mail.text.endsWith(EMAIL_POSTAL_LINE) && mail.live === false);
  check('email: the HTML escapes its text', lib.areaPulseEmail([{ ...card, heading: 'ZIP 91913 · <b>&' }]).html.includes('ZIP 91913 · &lt;b&gt;&amp;'));

  const bad = allText.filter(t => JURY_RE.test(juryText(t)) || ADDR_RE.test(t) || MLS_RE.test(t));
  check(`jury words: none of ${allText.length} printed strings says best / hot / safe / school / worth / value / buyers / demand / should, or looks like an address or MLS #`, bad.length === 0, bad.slice(0, 5).join(' | '));
  check('copy: no page-explaining meta lines', !allText.some(t => /^(This (page|tool|card) (shows|lists|picks)|Every item|says why)/i.test(t)));
  check('copy: no McKelvey, Patti or Jeff in the MLS files', ['functions/_lib/mlsTools.js', 'mls-tools.js', 'functions/api/mls/lens.js', 'functions/api/mls/area-pulse.js', 'functions/api/mls/home-fits.js', 'functions/_lib/mlsAreaStats.js'].every(f => !/McKelvey|Patti|\bJeff\b/i.test(read(f))));
});

// ===================== 4. The endpoints (in-memory SQLite) =====================
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec(read('schema.sql'));
const used = { n: 0 };
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => { used.n++; return sqlite.prepare(sql).get(...args) ?? null; },
      all: async () => { used.n++; return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => { used.n++; const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    };
    return stmt;
  },
  batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
};
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const user = (id, role = 'user', email = `u${id}@example.test`) => {
  run('INSERT INTO users (id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?)', id, email, `User ${id}`, role, 'active');
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
};
user(1); user(3); user(5, 'admin'); user(6); // 6: a second member (agents are members with an agent profile; role is user or admin)
const call = async (handler, method, p, who, env = { DB }, body) => {
  const headers = who ? { Cookie: `ah_session=t${who}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://amicohaus.com${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  used.n = 0;
  const res = await handler({ request, env, params: {}, waitUntil() {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, cache: res.headers.get('Cache-Control'), statements: used.n };
};
await section('endpoints', async () => {
  const lens = await mod('functions/api/mls/lens.js');
  const pulse = await mod('functions/api/mls/area-pulse.js');
  const fits = await mod('functions/api/mls/home-fits.js');
  const ALL = { DB, NUANCED_ALL_LIVE: '1' };
  // As shipped (gate on): Area Pulse and Where My Home Fits need a sign-in (401 signed out); members get them, no-store.
  for (const [name, h, m, p, b] of [['area pulse', pulse.onRequestGet, 'GET', '/api/mls/area-pulse'], ['home fits GET', fits.onRequestGet, 'GET', '/api/mls/home-fits'], ['home fits POST', fits.onRequestPost, 'POST', '/api/mls/home-fits', { zip: '91913' }]]) {
    const out = await call(h, m, p, null, { DB }, b), mem = await call(h, m, p, 3, { DB }, b), agt = await call(h, m, p, 6, { DB }, b), adm = await call(h, m, p, 5, { DB }, b);
    check(`${name}: as shipped, 401 signed out; 200 for members, agents and admins, private no-store`, out.status === 401 && [mem, agt, adm].every(x => x.status === 200 && x.cache === 'private, no-store'), `${out.status} ${mem.status} ${agt.status} ${adm.status}`);
  }
  // The lenses are sign-in only (Rudy 11.17, no public page): signed out gets the same 401 as Area Pulse / Home Fits, no data.
  {
    const out = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=91913', null), mem = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=91913', 3);
    const agt = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=91913', 6), adm = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=91913', 5);
    const pOut = await call(pulse.onRequestGet, 'GET', '/api/mls/area-pulse', null), fOut = await call(fits.onRequestGet, 'GET', '/api/mls/home-fits', null);
    check('lens signed out: 401 with no lens data (no views, scopes, numbers or CRMLS credit)', out.status === 401 && !('views' in (out.json || {})) && !('scopes' in (out.json || {})) && !/CRMLS|supply|Price Path|Five Years|\d{5}/i.test(out.text), out.text.slice(0, 200));
    check('lens signed out: the very same response the other sign-in-only MLS endpoints give (status, body, cache header)', [pOut, fOut].every(x => x.status === out.status && x.text === out.text && x.cache === out.cache), `${out.text} | ${pOut.text} | ${fOut.text}`);
    check('lens signed out: never a public cache, and no statement (no session to look up)', !/public|max-age/i.test(String(out.cache)) && out.statements === 0, `${out.cache} ${out.statements}`);
    const res = await lens.onRequestGet({ request: new Request('https://amicohaus.com/api/mls/lens'), env: { DB }, params: {}, waitUntil() {} });
    check('lens signed out: the old public path is gone (no Vary: Cookie)', res.status === 401 && !res.headers.get('Vary'));
    check('lens signed in: members, agents and admins get every card including Watchers and Listings, private no-store', [mem, agt, adm].every(x => x.status === 200 && x.json.views.watchersPulse && x.json.views.fiveYear && x.cache === 'private, no-store'), `${mem.status} ${agt.status} ${adm.status} ${mem.cache}`);
    check('lens.js: no public cache, max-age or Vary left in the code (comments aside)', !/public|max-age|Vary/.test(read('functions/api/mls/lens.js').replace(/^\s*\/\/.*$/gm, '')));
    // Turned dark again (a one-word change per tool): back to the admin preview: 404 for everyone else.
    const saved = Object.fromEntries(lib.MLS_TOOLS.map(t => [t, gate.NUANCED_TOOLS[t]]));
    for (const t of lib.MLS_TOOLS) gate.NUANCED_TOOLS[t] = false;
    try {
      const d0 = await call(lens.onRequestGet, 'GET', '/api/mls/lens', null), d1 = await call(lens.onRequestGet, 'GET', '/api/mls/lens', 3), d2 = await call(lens.onRequestGet, 'GET', '/api/mls/lens', 5);
      const p0 = await call(pulse.onRequestGet, 'GET', '/api/mls/area-pulse', 3), f0 = await call(fits.onRequestGet, 'GET', '/api/mls/home-fits', 3);
      check('gate off again: 404 signed out and for members, 200 for an admin (the old preview still works)', d0.status === 404 && d1.status === 404 && d2.status === 200 && p0.status === 404 && f0.status === 404, `${d0.status} ${d1.status} ${d2.status} ${p0.status} ${f0.status}`);
    } finally { Object.assign(gate.NUANCED_TOOLS, saved); }
    const anon = await call(lens.onRequestGet, 'GET', '/api/mls/lens', null, ALL);
    check('lens: even with the test flag on, signed out gets the 401 and no lens data', anon.status === 401 && !/views|watchers/i.test(anon.text));
  }
  // Watchers: 6 members watch 91913 (one is a demo account, one is suspended: 4 count), 10 owners there have wish lists.
  for (let i = 20; i < 26; i++) { user(i, 'user', i === 25 ? `demo${i}@demo.amicohaus.local` : `u${i}@example.test`); run('INSERT INTO watch_areas (user_id, zip) VALUES (?, ?)', i, '91913'); }
  run("UPDATE users SET status = 'suspended' WHERE id = 24");
  let r = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=91913&type=sfr', 5);
  check('lens (admin): every lens view, the scope list, the types, the credit and the call to action', r.status === 200 && ['pricePath', 'marketPace', 'featureLens', 'daysCurve', 'watchersPulse'].every(k => r.json.views[k]) && r.json.scope === '91913' && r.json.type === 'sfr'
    && r.json.scopes.length === 37 && r.json.cta.button === 'Post a pre-listing' && /CRMLS/.test(r.json.credit) && r.json.views.fiveYear && r.json.views.fiveYear.trend.months.length === 70, r.text.slice(0, 300));
  check('lens: 4 real watchers is under 5 (demo and suspended left out)', r.json.views.watchersPulse.lines[0] === 'Fewer than 5 Amico Haus members watch ZIP 91913 so far', r.json.views.watchersPulse.lines[0]);
  check('lens: the session + 1 statement when fewer than 10 owners have wish lists', r.statements === 2, r.statements);
  user(26); run('INSERT INTO watch_areas (user_id, zip) VALUES (?, ?)', 26, '91913');
  for (let i = 30; i < 41; i++) {
    user(i);
    run("INSERT INTO pre_listings (user_id, city, state, zip, property_type, asking_price, terms_wishlist_json, status) VALUES (?, 'Chula Vista', 'CA', '91913', 'Single Family Home', 900000, ?, 'open')", i, JSON.stringify(i < 38 ? ['quick_close', 'as_is'] : ['as_is', 'bogus_item']));
  }
  // An owner in a head start and a closed pre-listing never count.
  run("INSERT INTO pre_listings (user_id, city, state, zip, property_type, asking_price, terms_wishlist_json, status, head_start_until) VALUES (1, 'Chula Vista', 'CA', '91913', 'Condo', 500000, '[\"stay_after\"]', 'open', datetime('now', '+1 day'))");
  run("INSERT INTO pre_listings (user_id, city, state, zip, property_type, asking_price, terms_wishlist_json, status) VALUES (3, 'Chula Vista', 'CA', '91913', 'Condo', 500000, '[\"stay_after\"]', 'closed')");
  r = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=91913', 5);
  const wl = r.json.views.watchersPulse.lines;
  check('lens: 5 watchers now counted, 11 owners with wish lists, top items as "n of 11", unknown and head-start items left out', wl[0] === '5 Amico Haus members watch ZIP 91913'
    && wl[2].includes(`${WISHLIST_ITEMS.as_is} (11 of 11)`) && wl[2].includes(`${WISHLIST_ITEMS.quick_close} (8 of 11)`) && !wl[2].includes('bogus') && !wl[2].includes(WISHLIST_ITEMS.stay_after), wl.join(' | '));
  check('lens: the session + 2 statements with 10+ wish lists', r.statements === 3, r.statements);
  r = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=nowhere&type=weird', 5);
  check('lens: an unknown scope or type falls back to the first area and all home types', r.status === 200 && r.json.scope === 'carlsbad' && r.json.type === 'all', r.json.scope);
  r = await call(lens.onRequestGet, 'GET', '/api/mls/lens?scope=eastlake', 5);
  check('lens: an area scope runs no watcher statement', r.statements === 1 && r.json.views.watchersPulse.lines[0].startsWith('Pick a ZIP code'), r.statements);

  run('INSERT INTO watch_areas (user_id, zip, label) VALUES (5, ?, ?)', '91913', 'Mom <3');
  run('INSERT INTO watch_areas (user_id, zip) VALUES (5, ?)', '90210');
  r = await call(pulse.onRequestGet, 'GET', '/api/mls/area-pulse', 5);
  check('area pulse (admin): one card per watch area, in order; the uncovered one says so; 1 statement + the session', r.status === 200 && r.json.cards.length === 2 && r.json.cards[0].heading === 'ZIP 91913 · Mom <3' && r.json.cards[0].covered && !r.json.cards[1].covered
    && r.statements === 2 && r.json.emailLive === false && !r.json.emailPreview, r.text.slice(0, 300));
  r = await call(pulse.onRequestGet, 'GET', '/api/mls/area-pulse?email=1', 5);
  check('area pulse: ?email=1 shows an admin the email preview (nothing sent)', r.json.emailPreview && r.json.emailPreview.subject === 'Your watch areas this month' && r.json.emailPreview.live === false);
  r = await call(pulse.onRequestGet, 'GET', '/api/mls/area-pulse?email=1', 3, ALL);
  check('area pulse: a member never gets the email preview, and with no watch areas sees the empty line', r.status === 200 && !r.json.emailPreview && r.json.cards.length === 0 && r.json.empty === lib.NO_WATCH_AREAS_LINE);

  r = await call(fits.onRequestGet, 'GET', '/api/mls/home-fits', 5);
  check('home fits GET: the 28 covered ZIPs and types, the session only', JSON.stringify(r.json.zips) === JSON.stringify(ZIPS) && r.json.types.length === 3 && r.statements === 1);
  r = await call(fits.onRequestPost, 'POST', '/api/mls/home-fits', 5, { DB }, { zip: '91915', type: 'sfr', sqft: 2600, beds: 4, garage: 3 });
  check('home fits POST: lines and a draft, nothing stored (the session only)', r.status === 200 && r.json.view.lines.length === 3 && r.json.view.draft.zip === '91915' && r.statements === 1, r.text.slice(0, 300));
  r = await call(fits.onRequestPost, 'POST', '/api/mls/home-fits', 5, { DB }, { zip: '90210' });
  check('home fits POST: an uncovered ZIP is a 400 with the words', r.status === 400 && r.json.error === lib.FITS_ZIP_ERROR);
  const before = sqlite.prepare('SELECT COUNT(*) AS n FROM pre_listings').get().n;
  await call(fits.onRequestPost, 'POST', '/api/mls/home-fits', 5, { DB }, { zip: '91913', sqft: 1500 });
  check('home fits POST: no pre-listing is created (the owner posts it from the form)', sqlite.prepare('SELECT COUNT(*) AS n FROM pre_listings').get().n === before);
});

// ===================== 5. mls-tools.js in a sandbox =====================
await section('client', async () => {
  const src = read('mls-tools.js');
  const noop = () => {};
  const mkEl = (id) => ({ id, innerHTML: '', value: '', dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, querySelector: () => null, querySelectorAll: () => [], parentNode: null });
  const ids = ['mlsAreaPulse', 'mlsLensRoot', 'mlsHomeFits', 'plZip', 'plBeds', 'plBaths', 'plSqft', 'plPropertyType', 'plfToyGarage', 'mlLensScope', 'mlLensType'];
  const els = Object.fromEntries(ids.map(id => [id, mkEl(id)]));
  const fetches = [], answers = {}, calls = [];
  const sb = {
    console: { log: noop, warn: noop, error: noop }, URLSearchParams, JSON, Math, Number, String, Array, Object,
    window: {}, document: { getElementById: id => els[id] || null, addEventListener: noop },
    escapeHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    apiGet: async p => { fetches.push(['GET', p]); for (const k of Object.keys(answers)) if (p.startsWith(k)) return answers[k]; return {}; },
    apiPost: async (p, b) => { fetches.push(['POST', p, b]); return answers[`POST ${p}`] || {}; },
    toast: m => calls.push(`toast ${m}`), goToTab: t => calls.push(`goToTab ${t}`), openAgentTabSection: s => calls.push(`open ${s}`),
  };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'mls-tools.js' });
  const runIn = code => vm.runInContext(code, sb);
  // Dark (a tool switched off again): nothing drawn and nothing fetched.
  sb.window.NUANCED = Object.fromEntries(Object.keys(gate.NUANCED_TOOLS).map(k => [k, lib.MLS_TOOLS.includes(k) ? false : gate.NUANCED_TOOLS[k]]));
  els.mlsAreaPulse.innerHTML = 'old';
  await runIn('mlLoadAreaPulse()'); await runIn('mlLoadLens()'); await runIn('mlMountHomeFits()');
  check('client, with the MLS tools dark: every mount empty and no request made', els.mlsAreaPulse.innerHTML === '' && els.mlsLensRoot.innerHTML === '' && els.mlsHomeFits.innerHTML === '' && fetches.length === 0, JSON.stringify(fetches));
  // As shipped for a member (the gate's own values): every mount asks its endpoint.
  sb.window.NUANCED = Object.fromEntries(Object.keys(gate.NUANCED_TOOLS).map(k => [k, gate.NUANCED_TOOLS[k]]));
  await runIn('mlLoadAreaPulse()'); await runIn('mlLoadLens()'); await runIn('mlMountHomeFits()');
  check('client, as shipped for a member: Area Pulse, the lenses and Where My Home Fits each ask once', ['/api/mls/area-pulse', '/api/mls/lens', '/api/mls/home-fits'].every(u => fetches.filter(f => f[1].startsWith(u)).length === 1), JSON.stringify(fetches));
  fetches.length = 0; els.mlsHomeFits.innerHTML = '';
  // An admin: the server's lines, escaped.
  sb.window.NUANCED = Object.fromEntries(Object.keys(gate.NUANCED_TOOLS).map(k => [k, true]));
  const card = lib.areaPulseCard('91913', 'Mom <script>');
  answers['/api/mls/area-pulse'] = { cards: [card], cta: lib.CTA };
  await runIn('mlLoadAreaPulse()');
  check('client Area Pulse: draws the card, escapes the label, prints the credit and the call to action', els.mlsAreaPulse.innerHTML.includes('ZIP 91913 · Mom &lt;script&gt;') && !els.mlsAreaPulse.innerHTML.includes('<script>')
    && els.mlsAreaPulse.innerHTML.includes('recent sold range, not an appraisal') && els.mlsAreaPulse.innerHTML.includes('Information deemed reliable') && els.mlsAreaPulse.innerHTML.includes('data-action="ml-post-home"'));
  const s = lib.resolveScope('eastlake');
  const fyv = lib.fiveYearView(s, 'all');
  answers['/api/mls/lens'] = { scopes: lib.scopeList(), scope: 'eastlake', type: 'all', types: [{ key: 'all', label: 'All home types' }], views: { pricePath: lib.pricePathView(s, 'all'), marketPace: lib.marketPaceView(s, 'all'), fiveYear: fyv, featureLens: lib.featureLensView(s, 'all'), daysCurve: lib.daysCurveView(s, 'all') }, cta: lib.CTA };
  await runIn('mlLoadLens()');
  const html = els.mlsLensRoot.innerHTML;
  check('client lens: the four cards, the pickers, a gauge and a curve as SVG, the fixed feature line', ['Price Path', 'Market Pace', 'Feature Lens', 'Days to Sold'].every(h => html.includes(`<h3>${h}</h3>`))
    && html.includes('id="mlLensScope"') && html.includes('<svg class="ml-gauge"') && html.includes('<polyline class="ml-curve-line"') && html.includes('This is what sold, not what a feature adds.'));
  check('client lens: asked once with the scope and type in the query, nothing personal', fetches.filter(f => f[1].startsWith('/api/mls/lens')).length === 1);
  const bars = (html.match(/<rect class="ml-trend-bar"/g) || []).length, soldN = fyv.trend.months.filter(m => m.sold != null).length;
  check('client Five Years: after Market Pace, two SVG charts (one bar per month with a sold count, a months-of-supply line), year labels, its credit', html.indexOf('<h3>Five Years, Month by Month</h3>') > html.indexOf('<h3>Market Pace</h3>')
    && html.indexOf('<h3>Five Years, Month by Month</h3>') < html.indexOf('<h3>Feature Lens</h3>') && bars === soldN && /<polyline class="ml-trend-line"/.test(html) && />2021<\/text>/.test(html) && />2026<\/text>/.test(html)
    && html.includes('January 2021 to October 2026. Information deemed reliable'), `${bars} ${soldN}`);
  const fnAt = html.indexOf(`<p class="tiny ml-note ml-footnote">${lib.TREND_LINE}</p>`), mosAt = html.lastIndexOf('<svg class="ml-trend ml-trend-mos"');
  check('client Five Years: the asterisk footnote sits right under the months-of-supply chart, inside the Five Years card', fnAt > mosAt && mosAt > html.indexOf('<h3>Five Years, Month by Month</h3>')
    && fnAt < html.indexOf('<h3>Feature Lens</h3>') && (html.match(/ml-footnote/g) || []).length === 1 && html.includes('Months of supply*, '), `${fnAt} ${mosAt}`);
  const gap = vm.runInContext('mlTrendHtml', sb)({ months: [{ ym: '2021-01', label: 'Jan 2021', sold: 9, mos: 2 }, { ym: '2021-02', label: 'Feb 2021', sold: null, mos: null }, { ym: '2021-03', label: 'Mar 2021', sold: 12, mos: 3 }, { ym: '2021-04', label: 'Apr 2021', sold: 8, mos: 4 }], yearTicks: [{ at: 0, label: '2021' }], soldMax: 12, mosMax: 4, soldLabel: 'a <b>', mosLabel: 'b' });
  check('client Five Years: a month with no number is a gap (no bar, the line breaks), labels escaped, no NaN', (gap.match(/<rect class="ml-trend-bar"/g) || []).length === 3 && /<circle class="ml-trend-dot" cx="[\d.]+" cy="[\d.]+" r="1.4">/.test(gap) && (gap.match(/<polyline/g) || []).length === 1
    && gap.includes('a &lt;b&gt;') && !/NaN|undefined/.test(gap), gap.slice(0, 300));
  check('client: no inline style anywhere it draws (Five Years included)', !/style=/.test(els.mlsAreaPulse.innerHTML + html + gap));
  answers['/api/mls/home-fits'] = { zips: ['91913'], types: [{ key: 'sfr', label: 'Single-family homes' }], line: lib.FITS_LINE };
  await runIn('mlMountHomeFits()');
  check('client fits: the form with every field and the no-price line', ['beds', 'baths', 'sqft', 'lot', 'year', 'stories', 'garage'].every(k => els.mlsHomeFits.innerHTML.includes(`data-ml-fit="${k}"`)) && els.mlsHomeFits.innerHTML.includes(lib.FITS_LINE));
  runIn("mlFitsDraft = { zip: '91913', propertyType: 'Single Family Home', beds: 4, baths: 2.5, sqft: 2100, garage: 2 }; mlStartShowcase();");
  check('client fits: the draft fills the showcase form fields and opens it, without posting anything', els.plZip.value === '91913' && els.plBeds.value === '4' && els.plBaths.value === '2.5' && els.plSqft.value === '2100'
    && els.plfToyGarage.value === '2' && els.plPropertyType.value === 'Single Family Home' && calls.includes('goToTab marketplace') && calls.includes('open postHomeWrap') && !fetches.some(f => f[0] === 'POST'));
  // Source rules.
  const top = [...src.matchAll(/^(?:async )?function (\w+)|^(?:const|let|var) (\w+)/gm)].map(m => m[1] || m[2]);
  const GLOBALS = ['mlLoadAreaPulse', 'mlLoadLens', 'mlMountHomeFits'];
  check('mls-tools.js: declares the three globals main.js calls; every top-level name starts with ML_ or ml', GLOBALS.every(g => top.includes(g)) && top.every(n => /^(ML_|ml)/.test(n)), top.join());
  check('mls-tools.js: no inline style, no inline handler, no eval, no location lookup', !/style=|\son[a-z]+=|eval\(|new Function|geolocation|getCurrentPosition/.test(src));
  check('mls-tools.js: no stray backspace character', !src.includes('\b'));
});

// ===================== 6. Wiring: app.html, main.js, styles.css, build-dist, .gitignore =====================
await section('wiring', async () => {
  const app = read('app.html'), main = read('main.js'), css = read('styles.css'), build = read('build-dist.js'), ignore = read('.gitignore');
  check('app.html: mls-tools.js after ideas.js and before main.js', /<script src="ideas\.js"><\/script>\s*<script src="mls-tools\.js"><\/script>\s*<script src="main\.js"><\/script>/.test(app));
  check('app.html: the three mounts in their tabs', /id="watchAreasPanel"><\/div>\s*<div id="mlsAreaPulse"><\/div>/.test(app) && /id="marketLeaderboard"><\/div>\s*<div id="mlsLensRoot"><\/div>/.test(app) && /<div id="mlsHomeFits"><\/div>\s*<details class="panel bulk-upload" id="postHomeWrap">/.test(app)
    && app.indexOf('id="mlsLensRoot"') > app.indexOf('id="tab-marketpulse"') && app.indexOf('id="mlsAreaPulse"') > app.indexOf('id="tab-saved"'));
  check('app.html: no inline style added', !/<div id="mls[A-Za-z]+"[^>]*style=/.test(app));
  check('main.js: goToTab calls each MLS mount only when mls-tools.js is there', main.includes("if (name === 'saved' && typeof mlLoadAreaPulse === 'function') mlLoadAreaPulse();")
    && main.includes("if (name === 'marketpulse' && typeof mlLoadLens === 'function') mlLoadLens();") && main.includes("if (name === 'marketplace' && typeof mlMountHomeFits === 'function') mlMountHomeFits();"));
  const used = [...new Set([...read('mls-tools.js').matchAll(/class="([^"$]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => c.startsWith('ml-')))];
  const missing = used.filter(c => !new RegExp(`\\.${c.replace(/-/g, '\\-')}\\b`).test(css));
  check('styles.css: every ml- class mls-tools.js uses is defined', missing.length === 0, missing.join());
  check('styles.css: the MLS rules sit before the phone block (which stays last)', css.indexOf('/* MLS tools (mls-tools.js') > 0 && css.indexOf('/* MLS tools (mls-tools.js') < css.indexOf('/* Phones. Kept at the END'));
  check('build-dist.js: MLS-TOOLS-NOTES.md in the skip list (functions/ is never copied)', /'MLS-TOOLS-NOTES\.md'/.test(build) && /'functions'/.test(build));
  check('.gitignore: the generated CRMLS module and the notes stay out of the public repo', ignore.includes('/functions/_lib/mlsAreaStats.js') && ignore.includes('/MLS-TOOLS-NOTES.md'));
  const notes = fs.existsSync(path.join(root, 'MLS-TOOLS-NOTES.md')) ? read('MLS-TOOLS-NOTES.md') : '';
  check('MLS-TOOLS-NOTES.md: exists and names the gate and the email switch', notes.includes('nuancedGate.js') && notes.includes('AREA_PULSE_EMAIL_LIVE'));
  check('MLS-TOOLS-NOTES.md: says the tools are on, who each endpoint answers, and that deploys go out from dist/ on Rudy\'s machine', /## Status: on for every signed-in member/.test(notes) && /sign-in only/i.test(notes) && !/public, max-age/.test(notes) && notes.includes('node build-dist.js') && notes.includes('pages deploy dist') && !/admin-only until/i.test(notes));
  if (fs.existsSync(path.join(root, 'dist'))) {
    const inDist = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/mlsAreaStats|MLS-TOOLS-NOTES|mls-rollups|\.csv$/i.test(e.name)) inDist.push(f); } })(path.join(root, 'dist'));
    check('dist/: no CRMLS data module, notes, rollups or CSV', inDist.length === 0, inDist.join());
  }
});

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
