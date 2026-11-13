// Nuanced ideas batch, role H (the app shell and client side): client.js homeDataDetailHtml against the server's HTML,
// the fit checker (pure arithmetic, wording, the form it mounts, nothing leaving the browser), the area-context
// sentences, the home-data form in main.js (exact copy, labels, what it reads back, the server's own error words),
// the launch gate in the app (a member sees no dark tool's control; an admin does), deep links, the message draft,
// app.html hooks, the stylesheet's new classes, CSP rules on everything added, and top-level names.
// Client code runs in a vm sandbox with a small stand-in DOM. No network.
// Usage: node --disable-warning=ExperimentalWarning tools/nuanced-ui-test.mjs "<project root>"
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) { console.error('Usage: node --disable-warning=ExperimentalWarning tools/nuanced-ui-test.mjs <projectRoot>'); process.exit(2); }
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mod = p => import(pathToFileURL(path.join(root, p)).href);

let passed = 0, failed = 0;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${String(detail).slice(0, 600)}`}`); };
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran without crashing`, false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); } };

const lib = await mod('functions/_lib/homeData.js');
const gate = await mod('functions/_lib/nuancedGate.js');
const homeFacts = await mod('functions/_lib/homeFacts.js');
const { FCC_MOBILE } = await mod('functions/_lib/fccMobileSd.js');
const clientSrc = read('client.js');
const mainSrc = read('main.js');
const appSrc = read('app.html');
const cssSrc = read('styles.css');
const headOf = (file) => { try { return execFileSync('git', ['-C', root, 'show', `HEAD:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

// ---- A stubbed browser (the client-ui-test sandbox), with a few elements the tests can look at ----
const noop = () => {};
const plainEl = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, insertBefore: noop, setAttribute: noop, getAttribute: () => null, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, parentNode: { insertBefore: noop }, innerHTML: '', value: '', checked: false, focus: noop });
function makeSandbox({ store = {}, ids = [] } = {}) {
  const els = Object.fromEntries(ids.map(id => [id, plainEl()]));
  const fetches = [], answers = {};
  const sb = {
    console: { log: noop, warn: noop, error: noop }, URLSearchParams, URL, setTimeout, clearTimeout, atob, btoa, Notification: {}, Intl, Date, JSON, Math,
    navigator: { userAgent: 'node' },
    window: { matchMedia: () => ({ matches: false }), addEventListener: noop, scrollTo: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
    document: { addEventListener: noop, getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: plainEl, body: plainEl(), readyState: 'complete', documentElement: { ...plainEl(), lang: 'en' }, referrer: '' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    // Every request is recorded as [path, method, body]; the answer is {} unless the test set one for that path.
    fetch: async (url, options = {}) => { fetches.push([String(url), options.method || 'GET', options.body ? JSON.parse(options.body) : undefined]); return { ok: true, status: 200, json: async () => (answers[String(url)] || {}) }; },
  };
  sb.window.document = sb.document;
  vm.createContext(sb);
  return { sb, els, fetches, answers, store };
}
// Stand-ins for the other roles' scripts: each helper answers with its own name, so a render shows who was asked.
const DOUBLES = `
function ltFieldsHtml() { return '[[ltFieldsHtml]]'; } function ltRead() { return { termsWishlist: ['as_is'] }; } async function ltSave() { return true; }
function ltDetailHtml() { return '[[ltDetailHtml]]'; } function ltStepDownPanelHtml() { return '[[ltStepDownPanelHtml]]'; }
function ltSavedSearchFieldsHtml() { return '[[ltSavedSearchFieldsHtml]]'; } function ltReadSavedSearch() { return { ownerCarry: true }; } function ltSavedSearchLabel() { return ' · owner may carry'; }
function ltSellStayBadgeHtml() { return '[[ltSellStayBadgeHtml]]'; } function ltPreListingFilterHtml() { return '[[ltPreListingFilterHtml]]'; } function ltPreListingFilterParams() { return { stay: '1', blank: '' }; }
function nbHeadStartFieldHtml() { return '[[nbHeadStartFieldHtml]]'; } function nbReadHeadStart() { return { hours: 24 }; } function nbHeadStartBadgeHtml() { return '[[nbHeadStartBadgeHtml]]'; }
var nbCalls = []; function loadWatchAreas() { nbCalls.push('loadWatchAreas'); } function nbStandingInterestButtonHtml(t) { return '[[nbStandingInterestButtonHtml ' + t.kind + ' ' + t.id + ']]'; }
function nbOwnerInterestsHtml() { return '[[nbOwnerInterestsHtml]]'; } function nbTradeTrialHtml() { return '[[nbTradeTrialHtml]]'; } function nbOpenTradeTrial(id) { nbCalls.push('nbOpenTradeTrial ' + id); }
function loadIdeasTab() { nbCalls.push('loadIdeasTab'); } function ideaCardLinkHtml() { return ''; }`;
const APP_SCRIPTS = ['client.js', 'agent-cards.js', 'seller-prep.js', 'decision-night.js', 'timing-match.js', 'ready-meter.js', 'opinion-refresh.js'];
const MOUNT_IDS = ['listingTermsFields', 'listingHeadStartField', 'listingDataFields', 'plTermsFields', 'plHeadStartField', 'plDataFields', 'ssDealFields', 'marketPreListingFilter', 'isRental', 'messageBody'];
function makeApp({ doubles = true } = {}) {
  const app = makeSandbox({ ids: MOUNT_IDS });
  for (const f of APP_SCRIPTS) vm.runInContext(read(f), app.sb, { filename: f });
  if (doubles) vm.runInContext(DOUBLES, app.sb, { filename: 'doubles.js' });
  vm.runInContext(mainSrc, app.sb, { filename: 'main.js' });
  vm.runInContext('currentUser = { id: 1, role: "user" };', app.sb);
  app.run = code => vm.runInContext(code, app.sb);
  app.setGate = tools => { app.sb.window.NUANCED = tools; };
  return app;
}
const SHIP_MEMBER = gate.liveTools({}, { role: 'user' });
const SHIP_ADMIN = gate.liveTools({}, { role: 'admin' });
const ALL_ON = gate.liveTools({ NUANCED_ALL_LIVE: '1' });

const FACTS = { yard: { solar: 'ppa' }, toy: { gateIn: 120, drivewayFt: 40, garage: 2 } };
const RUN_COSTS = { bills: { electric: 183, gas: 40, water: 95, trashSewer: 0 }, basis: 'last_12', asOf: '2026-10', solar: { kw: 6.4, year: 2021, kwh12: 9800, warrantyEnd: 2046, program: 'nem2' } };
const FIT = { rooms: [{ room: 'living', widthIn: 170, lengthIn: 216, doorIn: 32 }, { room: 'primary_bed', widthIn: 150, lengthIn: 168 }], garage: { doorWidthIn: 192, doorHeightIn: 84, depthIn: 240, widthIn: 228 }, access: { sideWidthIn: 132, overheadIn: 108 } };
const SIGNAL = { speedTests: [{ down: 480.5, up: 22, provider: 'cox', conn: 'wifi', date: '2026-10' }, { down: 90, up: 12, provider: 'other', providerOther: 'Race <Fiber>', conn: 'wired', date: '2026-09' }],
  bars: [{ carrier: 'att', area: 'kitchen', bars: 4, net: '5g' }, { carrier: 'other', carrierOther: 'Mint & Co', area: 'backyard', bars: 2, net: 'lte' }, { carrier: 'verizon', area: 'upstairs', bars: 0, net: 'not_sure' }], date: '2026-10' };

// ===================== 1. client.js mirrors the server =====================
const client = makeSandbox();
vm.runInContext(clientSrc, client.sb, { filename: 'client.js' });
const c = vm.runInContext(`({ homeDataDetailHtml, fitCheck, hdAreaContextLines, hdMountFitCheckers, hdFtIn, HD_BILLS, HD_BILL_BASIS, HD_SOLAR_PROGRAMS, HD_FIT_ROOMS, HD_ISPS, HD_CONNS, HD_CARRIERS,
  HD_SIGNAL_AREAS, HD_NETS, HD_COVER, HD_RUN_COSTS_HEADING, HD_RUN_COSTS_CONFIRM_LINE, HD_SOLAR_HEADING, HD_SOLAR_CONFIRM_LINE, HD_FIT_HEADING, HD_FIT_CONFIRM_LINE, HD_SIGNAL_HEADING,
  HD_SIGNAL_CONFIRM_LINE, HD_COVERAGE_LINE, HD_AREA_CONTEXT_BUTTON, HD_FCC_MAP_URL, HD_FCC_MAP_LINK, HF_SOLAR, HD_FIT_ITEM_KEY })`, client.sb);
await section('client mirror', async () => {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [name, mine, theirs] of [['BILLS', c.HD_BILLS, lib.BILLS], ['BILL_BASIS', c.HD_BILL_BASIS, lib.BILL_BASIS], ['SOLAR_PROGRAMS', c.HD_SOLAR_PROGRAMS, lib.SOLAR_PROGRAMS], ['FIT_ROOMS', c.HD_FIT_ROOMS, lib.FIT_ROOMS],
    ['ISPS', c.HD_ISPS, lib.ISPS], ['CONNS', c.HD_CONNS, lib.CONNS], ['CARRIERS', c.HD_CARRIERS, lib.CARRIERS], ['SIGNAL_AREAS', c.HD_SIGNAL_AREAS, lib.SIGNAL_AREAS], ['NETS', c.HD_NETS, lib.NETS], ['COVER', c.HD_COVER, lib.COVER],
    ['SOLAR (home facts)', c.HF_SOLAR, homeFacts.SOLAR]]) check(`client.js HD_${name} === the server's`, same(mine, theirs), JSON.stringify(mine));
  for (const [name, mine, theirs] of [['RUN_COSTS_HEADING', c.HD_RUN_COSTS_HEADING, lib.RUN_COSTS_HEADING], ['RUN_COSTS_CONFIRM_LINE', c.HD_RUN_COSTS_CONFIRM_LINE, lib.RUN_COSTS_CONFIRM_LINE], ['SOLAR_HEADING', c.HD_SOLAR_HEADING, lib.SOLAR_HEADING],
    ['SOLAR_CONFIRM_LINE', c.HD_SOLAR_CONFIRM_LINE, lib.SOLAR_CONFIRM_LINE], ['FIT_HEADING', c.HD_FIT_HEADING, lib.FIT_HEADING], ['FIT_CONFIRM_LINE', c.HD_FIT_CONFIRM_LINE, lib.FIT_CONFIRM_LINE], ['SIGNAL_HEADING', c.HD_SIGNAL_HEADING, lib.SIGNAL_HEADING],
    ['SIGNAL_CONFIRM_LINE', c.HD_SIGNAL_CONFIRM_LINE, lib.SIGNAL_CONFIRM_LINE], ['COVERAGE_LINE', c.HD_COVERAGE_LINE, lib.COVERAGE_LINE], ['AREA_CONTEXT_BUTTON', c.HD_AREA_CONTEXT_BUTTON, lib.AREA_CONTEXT_BUTTON],
    ['FCC_MAP_URL', c.HD_FCC_MAP_URL, lib.FCC_MAP_URL], ['FCC_MAP_LINK', c.HD_FCC_MAP_LINK, lib.FCC_MAP_LINK]]) check(`client.js HD_${name} is word for word the server's`, mine === theirs, mine);
  check('PPA is spelled out', c.HF_SOLAR.ppa === 'power purchase agreement (PPA)' && mainSrc.includes("['ppa', 'Power purchase agreement (PPA)']"));
  check('ftIn matches', [8, 36, 120, 170, 721].every(n => c.hdFtIn(n) === lib.ftIn(n)));

  const shaped = (rc, fit, sig) => lib.homeDataFromRow({ run_costs_json: JSON.stringify(rc), fit_json: JSON.stringify(fit), signal_json: JSON.stringify(sig) });
  const fixtures = [
    ['every block', shaped(RUN_COSTS, FIT, SIGNAL), FACTS, { zip: '91915', live: ALL_ON, signedIn: true, kind: 'listing', id: 101 }],
    ['every block, signed out, gate as it ships', shaped(RUN_COSTS, FIT, SIGNAL), FACTS, { zip: '91915', live: gate.liveTools({}), signedIn: false, kind: 'listing', id: 101 }],
    ['bills only, a rough estimate, no solar', shaped({ bills: { electric: 1200, gas: 0 }, basis: 'estimate', asOf: '2026-11' }, {}, {}), { yard: { solar: 'none' } }, { zip: '', live: ALL_ON, signedIn: true, kind: 'pre_listing', id: 401 }],
    ['a gate opening only (the fit card with no lines)', shaped({}, {}, {}), { toy: { gateIn: 96 } }, { zip: '91910', live: ALL_ON, signedIn: true, kind: 'listing', id: 7 }],
    ['signal only, half-filled garage', shaped({}, { garage: { doorHeightIn: 84 }, access: { sideWidthIn: 60 } }, { speedTests: [{ down: 50, up: 5, date: '2026-01' }] }), {}, { zip: '91915', live: ALL_ON, signedIn: false, kind: 'listing', id: 9 }],
    ['nothing entered', shaped({}, {}, {}), {}, { zip: '91915', live: ALL_ON, signedIn: false, kind: 'listing', id: 3 }],
  ];
  for (const [what, data, facts, opts] of fixtures) {
    const server = lib.homeDataHtml(data, facts, opts);
    const mine = c.homeDataDetailHtml(data, facts, opts);
    check(`client homeDataDetailHtml === server HTML: ${what}`, mine === server.hasBlock + server.cards, `\nclient: ${mine}\nserver: ${server.hasBlock + server.cards}`);
  }
  check('nothing entered -> empty (and no area button without bills... only the button when the gate, sign-in and ZIP allow)', c.homeDataDetailHtml({}, {}, { live: ALL_ON, signedIn: false }) === '' && c.homeDataDetailHtml(null, null) === '');
  check('owner text is escaped', c.homeDataDetailHtml({ signal: SIGNAL }, {}, { live: ALL_ON }).includes('on Race &lt;Fiber&gt; (wired)') && c.homeDataDetailHtml({ signal: SIGNAL }, {}, { live: ALL_ON }).includes('Mint &amp; Co 2 of 5'));
  // With a ZIP's carrier-reported coverage handed in, the client prints the server's coverage block too.
  FCC_MOBILE.asOf = 'June 2026'; FCC_MOBILE.zips['91915'] = { att: [3, 2], verizon: [1, 0] };
  try {
    const data = shaped({}, {}, SIGNAL);
    const server = lib.homeDataHtml(data, {}, { zip: '91915', live: ALL_ON });
    check('client coverage block === server (when the caller has the ZIP\'s coverage)', c.homeDataDetailHtml(data, {}, { zip: '91915', live: ALL_ON, coverage: { asOf: 'June 2026', reported: FCC_MOBILE.zips['91915'] } }) === server.cards && server.cards.includes('Carrier-reported coverage for ZIP 91915'));
    check('the app\'s own views carry no coverage (none is handed in)', !c.homeDataDetailHtml(data, {}, { zip: '91915', live: ALL_ON }).includes('Carrier-reported'));
  } finally { FCC_MOBILE.asOf = ''; delete FCC_MOBILE.zips['91915']; }
  // In the app the gate comes from window.NUANCED when none is passed.
  client.sb.window.NUANCED = { runCosts: true };
  const viaWindow = c.homeDataDetailHtml({ runCosts: RUN_COSTS, fit: FIT }, FACTS, { zip: '91915' });
  check('in the app, window.NUANCED decides which blocks show', viaWindow.includes('Cost to run') && !viaWindow.includes('data-fit'));
  delete client.sb.window.NUANCED;
  check('before the gate is read, nothing shows', c.homeDataDetailHtml({ runCosts: RUN_COSTS, fit: FIT }, FACTS, { zip: '91915' }) === '');
});

// ===================== 2. fitCheck =====================
await section('fit check', async () => {
  const SPACES = { rooms: FIT.rooms, garage: FIT.garage, access: FIT.access, gateIn: 120, drivewayFt: 40 };
  const text = (spaces, item) => c.fitCheck(spaces, item).map(r => r.text);
  const SOFA = { kind: 'furniture', lengthIn: 84, widthIn: 38, heightIn: 34 }, KING = { kind: 'furniture', lengthIn: 80, widthIn: 76, heightIn: 14 };
  const PICKUP = { kind: 'vehicle', lengthIn: 232, widthIn: 80, heightIn: 78 }, RV = { kind: 'rv', lengthIn: 300, widthIn: 100, heightIn: 132 };
  const fixtures = [
    ['1. a sofa through a 32 in. doorway', text(SPACES, SOFA)[0], "Living room: floor space fits, but the doorway (32 in.) is narrower than the item's smallest side (34 in.)"],
    ['2. a king bed through the same doorway (its 14 in. side passes)', text(SPACES, KING)[0], 'Living room: fits by the numbers'],
    ['3. a room whose doorway the owner did not measure', text(SPACES, SOFA)[1], "Primary bedroom: floor space fits by the numbers (the owner didn't measure the doorway)"],
    ['4. a footprint that fits only the other way round', text({ rooms: [{ room: 'office', widthIn: 90, lengthIn: 40, doorIn: 36 }] }, SOFA)[0], 'Office: fits by the numbers'],
    ['5. too long for the room', text({ rooms: [{ room: 'office', widthIn: 80, lengthIn: 60 }] }, SOFA)[0], "Office: doesn't fit by the numbers (4 in. too long for the room)"],
    ['6. too wide for the room', text({ rooms: [{ room: 'laundry', widthIn: 36, lengthIn: 100 }] }, SOFA)[0], "Laundry room: doesn't fit by the numbers (2 in. too wide for the room)"],
    ['7. a pickup under a 7 ft door', text(SPACES, PICKUP)[0], 'Garage: fits by the numbers, with 6 in. to spare on height'],
    ['8. an RV too tall for the garage door', text(SPACES, RV)[0], "Garage: doesn't fit by the numbers (48 in. too tall for the door)"],
    ['9. an RV through a 10 ft gate', text(SPACES, RV)[1], 'Gate: fits by the numbers, with 20 in. to spare on width'],
    ['10. ...but under a 9 ft overhead along the side yard', text(SPACES, RV)[2], "Side yard: doesn't fit by the numbers (24 in. too tall for the lowest overhead)"],
    ['11. a driveway shorter than the truck', text({ drivewayFt: 15 }, PICKUP)[0], "Driveway: doesn't fit by the numbers (52 in. too long)"],
    ['12. a missing measurement', text({ garage: { doorWidthIn: 192 } }, PICKUP)[0], "Garage: the owner didn't give enough measurements"],
  ];
  for (const [what, got, want] of fixtures) check(`fitCheck ${what}`, got === want, got);
  check('a pickup: garage, gate, side yard and driveway, in that order', text(SPACES, PICKUP).map(t => t.split(':')[0]).join() === 'Garage,Gate,Side yard,Driveway', text(SPACES, PICKUP).join(' | '));
  check('furniture is never checked against the garage or the gate; a vehicle never against a room', text(SPACES, SOFA).every(t => /^(Living room|Primary bedroom):/.test(t)) && text(SPACES, PICKUP).every(t => !/room|bedroom/i.test(t)));
  check('never a line for a space the owner did not measure', text({ gateIn: 120 }, RV).length === 1 && text({}, RV).length === 0 && text({ rooms: [] }, SOFA).length === 0);
  check('an item with a missing size gets no answer', c.fitCheck(SPACES, { kind: 'vehicle', lengthIn: 232, widthIn: 80 }).length === 0 && c.fitCheck(SPACES, null).length === 0);
  const every = [SOFA, KING, PICKUP, RV].flatMap(item => [SPACES, { rooms: [{ room: 'office', widthIn: 40, lengthIn: 40 }], garage: { depthIn: 100 }, access: { overheadIn: 90 }, gateIn: 60, drivewayFt: 10 }].flatMap(sp => c.fitCheck(sp, item)));
  check('wording: every line says "fits by the numbers", "doesn\'t fit by the numbers", "didn\'t give enough measurements" or the doorway line', every.length > 12 && every.every(r => /fits by the numbers|doesn't fit by the numbers|didn't give enough measurements|floor space fits, but the doorway/.test(r.text)), every.map(r => r.text).join(' | '));
  check('wording: never "will fit", "guarantee" or "plenty"', !every.some(r => /will fit|guarantee|plenty/i.test(r.text)) && !/will fit|plenty of room|guaranteed/i.test(clientSrc.slice(clientSrc.indexOf('function fitCheck('), clientSrc.indexOf('const HD_FIT_ITEM_KEY'))));
  check('each answer says whether it fits (true / false / unknown), for the icon beside the words', every.every(r => r.ok === true || r.ok === false || r.ok === null) && c.fitCheck(SPACES, SOFA)[0].ok === false && c.fitCheck(SPACES, KING)[0].ok === true && c.fitCheck({ garage: { depthIn: 100 } }, RV)[0].ok === null);
  check('pure: the same input gives the same output and nothing is changed', JSON.stringify(c.fitCheck(SPACES, RV)) === JSON.stringify(c.fitCheck(SPACES, RV)) && SPACES.rooms.length === 2);

  // The form it mounts, on a small stand-in DOM.
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.own = ''; this.className = ''; this.value = ''; this.parent = null; }
    appendChild(ch) { ch.parent = this; this.children.push(ch); return ch; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    fire(type) { (this.listeners[type] || []).forEach(fn => fn({ target: this })); }
    set textContent(v) { this.children = []; this.own = String(v); }
    get textContent() { return this.own + this.children.map(ch => ch.textContent).join(''); }
    all() { return this.children.flatMap(ch => [ch, ...ch.all()]); }
    closest(sel) { let at = this; while (at) { if (sel === '[data-fit]' && at.dataset.fit !== undefined) return at; at = at.parent; } return null; }
    querySelectorAll(sel) { return sel === '[data-fit-checker]' ? this.all().filter(e => e.dataset.fitChecker !== undefined) : []; }
  }
  const store = {};
  const dom = makeSandbox({ store });
  dom.sb.document.createElement = tag => new El(tag);
  dom.sb.document.createTextNode = t => { const e = new El('#text'); e.own = String(t); return e; };
  vm.runInContext(clientSrc, dom.sb, { filename: 'client.js' });
  const page = new El('main'), card = page.appendChild(new El('div')), host = card.appendChild(new El('div'));
  card.dataset.fit = JSON.stringify(SPACES); host.dataset.fitChecker = '';
  vm.runInContext('hdMountFitCheckers', dom.sb)(page);
  const parts = host.all();
  const labels = parts.filter(e => e.tagName === 'LABEL'), inputs = parts.filter(e => ['INPUT', 'SELECT'].includes(e.tagName)), buttons = parts.filter(e => e.tagName === 'BUTTON');
  check('checker: the four labels, word for word', labels.map(l => l.textContent).join('|') === 'What are you checking?|Length (in.)|Width (in.)|Height (in.)', labels.map(l => l.textContent).join('|'));
  check('checker: every label is tied to its field (for=)', labels.length === 4 && labels.every(l => l.htmlFor && inputs.some(i => i.id === l.htmlFor)) && new Set(inputs.map(i => i.id)).size === 4);
  const select = inputs.find(i => i.tagName === 'SELECT');
  check('checker: the three kinds of item', select.children.map(o => o.textContent).join('|') === 'Furniture or an appliance|A car or truck|An RV, boat or trailer');
  check('checker: the four example buttons and their caption', buttons.map(b => b.textContent).join('|') === 'Sofa 84 × 38 × 34|King bed 80 × 76 × 14|Full-size pickup 232 × 80 × 78|Class C RV 300 × 100 × 132'
    && parts.some(e => e.tagName === 'P' && e.textContent === 'Example sizes only. Type the real size of yours.') && buttons.every(b => b.type === 'button'));
  const results = parts.find(e => e.className === 'fit-result');
  check('checker: no answer before a size is typed', !!results && results.textContent === '');
  buttons[2].fire('click');
  const lines = results.children.map(p => p.textContent);
  check('checker: an example fills the form and answers, one line per measured space, each with an icon and words', select.value === 'vehicle' && lines[0] === '✓ Garage: fits by the numbers, with 6 in. to spare on height' && lines.length === 5 && results.children[0].className.includes('fit-ok'), lines.join(' | '));
  check('checker: FIT_CONFIRM_LINE under the results, every time', lines[lines.length - 1] === lib.FIT_CONFIRM_LINE);
  buttons[0].fire('click');
  check('checker: a "doesn\'t fit" line carries its own icon and class', results.children[0].textContent.startsWith('✕ Living room: floor space fits, but the doorway') && results.children[0].className.includes('fit-no') && results.children[results.children.length - 1].textContent === lib.FIT_CONFIRM_LINE);
  check('checker: the item goes nowhere (no fetch); the last one is remembered in this browser only', dom.fetches.length === 0 && JSON.parse(store['amico.fitItem.v1']).lengthIn === 84 && c.HD_FIT_ITEM_KEY === 'amico.fitItem.v1');
  vm.runInContext('hdMountFitCheckers', dom.sb)(page);
  check('checker: mounting twice does not build a second form', host.all().filter(e => e.tagName === 'SELECT').length === 1);
  const checkerSrc = clientSrc.slice(clientSrc.indexOf('function fitCheck('), clientSrc.indexOf('// "How do bills run nearby?"'));
  check('checker source: no fetch, beacon, api call or innerHTML; storage is wrapped in try/catch', !/fetch\(|sendBeacon|apiGet|apiPost|apiPut|XMLHttpRequest|innerHTML/.test(checkerSrc) && (checkerSrc.match(/try \{ localStorage\.setItem\(HD_FIT_ITEM_KEY/g) || []).length === 1 && /try \{\s*const last = JSON\.parse\(localStorage\.getItem\(HD_FIT_ITEM_KEY\)/.test(checkerSrc));
  check('client.js mounts the checkers at load (the listing page) and tolerates a page without them', /\(function hdStartFitCheckers\(\) \{/.test(clientSrc) && clientSrc.includes("document.addEventListener('DOMContentLoaded', start)"));
});

// ===================== 3. Area context sentences =====================
await section('area context copy', async () => {
  const lines = c.hdAreaContextLines({ zip: '91915', sqftBand: '1,650–2,750 sqft', utility: { period: 'Oct 2025 – Sep 2026', kwhPerMonth: 520, thermsPerMonth: 22 },
    members: { electric: { homes: 6, low: 100, mid: 200, high: 1300 }, trashSewer: { homes: 5, low: 60, mid: 80, high: 90 } } });
  check('the SDG&E sentence, word for word', lines[0] === "SDG&E's published average for residential customers in ZIP 91915, Oct 2025 – Sep 2026: about 520 kWh of electricity and 22 therms of gas a month. All home sizes together. Source: SDG&E Energy Data Request Program.", lines[0]);
  check('no dollars in the utility sentence', !/\$|dollar/i.test(lines[0]));
  check('the owners sentence per bill, word for word', lines[1] === 'Owners of 6 similar-size homes (1,650–2,750 sqft) on Amico Haus in ZIP 91915 entered electric bills from $100 to $1,300 a month (middle: $200).'
    && lines[2] === 'Owners of 5 similar-size homes (1,650–2,750 sqft) on Amico Haus in ZIP 91915 entered trash and sewer bills from $60 to $90 a month (middle: $80).', lines.slice(1, 3).join(' | '));
  check('always closed by the "not checked, not a prediction" line', lines.length === 4 && lines[3] === 'What other owners and the utility reported, not checked by Amico Haus and not a prediction for this home.');
  check('nothing reported -> one plain line, no claim', JSON.stringify(c.hdAreaContextLines({ zip: '91915', sqftBand: '', utility: null, members: null })) === '["Nothing to show for this ZIP code yet."]');
  check('jury: no average, typical, estimate or "should" about this home', !lines.join(' ').match(/typical|estimate|should|expect|you(?:'ll| will) pay/i));
  check('the button asks the gated route by kind and id, and fills the box with text nodes', clientSrc.includes('`/api/home-data/context?kind=${encodeURIComponent(btn.dataset.kind || \'\')}&id=${encodeURIComponent(btn.dataset.id || \'\')}`') && clientSrc.includes("p.textContent = text; box.appendChild(p);"));
  check('client.js: a delegated Print handler for data-action="print" (the packet page)', clientSrc.includes(`if (e.target.closest('[data-action="print"]')) window.print();`) && clientSrc.includes(`if (e.target.closest('[data-action="print-page"]')) window.print();`));
});

// ===================== 4. The home-data form (main.js) =====================
const app = makeApp();
await section('form', async () => {
  app.setGate(ALL_ON);
  const html = app.run(`homeDataFieldsHtml('lf', ${JSON.stringify({ runCosts: RUN_COSTS, fit: FIT, signal: SIGNAL })}, { kind: 'listing', facts: ${JSON.stringify(FACTS)} })`);
  const blank = app.run(`homeDataFieldsHtml('plf', null, { kind: 'pre_listing' })`);
  check('form: the bills help line says who sees them (a trade listing is a public page; a pre-listing goes to approved agents)',
    html.includes('Anyone who opens your listing sees these as your own bills, never as a prediction.') && !html.includes('Approved agents see these')
    && blank.includes('Only what you want to share. Approved agents see these as your own bills, never as a prediction.') && !blank.includes('Anyone who opens your listing'));
  check('form: inside a <details class="score-breakdown"> with the exact summary', /<details class="score-breakdown home-data-fields" data-hd-prefix="lf" data-hd-kind="listing" open>\s*<summary>Bills, room sizes and signal \(optional\)<\/summary>/.test(html) && blank.includes('data-hd-prefix="plf" data-hd-kind="pre_listing">') && !/data-hd-kind="pre_listing" open/.test(blank));
  const COPY = ['Bills (your monthly averages)', 'Electric ($ a month)', 'Gas ($ a month)', 'Water ($ a month)', 'Trash and sewer ($ a month)', 'Where these come from', '>Choose one<', '>My last 12 months of bills<', '>My rough estimate<',
    'Only what you want to share. Approved agents see these as your own bills, never as a prediction.', 'Solar details', 'Set &quot;Solar panels&quot; under Yard and sun to add solar details.'.replace(/&quot;/g, '"'), 'System size (kW)', 'Year installed',
    'Electricity made in the last 12 months (kWh, from your app or bill)', 'Warranty ends (year)', 'Billing program', '>Not sure<', '>NEM 1.0<', '>NEM 2.0<', '>Net Billing (NBT)<',
    'Room and garage sizes (inches, measured by you)', '>Room<', '>Width<', '>Length<', '>Narrowest doorway into it<', '>Add a room<', 'Garage door width', 'Garage door height', 'Garage depth inside', 'Garage width inside',
    'Side-yard path, narrowest width', 'Lowest overhead along the side yard (blank if open sky)', 'Your gate opening and driveway length come from Parking and garage above.',
    'Signal and internet (your own tests)', 'Download (Mbps)', 'Upload (Mbps)', '>Provider<', 'Wi-Fi or wired', 'Month tested', '>Carrier<', '>Where<', 'Bars (0 to 5)', '5G, LTE or not sure', '>Add a spot<', 'Month you checked the bars',
    'Run a speed test on your phone or computer and type what it shows.'];
  const missing = COPY.filter(s => !blank.includes(s));
  check('form: every label, option and help line of spec 4.8, word for word', missing.length === 0, missing.join(' | '));
  for (const [what, h] of [['filled', html], ['blank', blank]]) {
    const labelFor = [...h.matchAll(/<label([^>]*)>/g)].map(m => (m[1].match(/ for="([^"]+)"/) || [])[1]);
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
    check(`form (${what}): every <label> has for= and its field exists; ids are unique`, labelFor.length > 20 && labelFor.every(f => f && ids.includes(f)) && new Set(ids).size === ids.length, labelFor.filter(f => !f || !ids.includes(f)).join());
    check(`form (${what}): no inline style, handler or script`, !/ style=| on[a-z]+=|<script/i.test(h));
    check(`form (${what}): every field id starts with the prefix + "Hd"`, ids.every(id => /^(lf|plf)Hd[A-Z]/.test(id)), ids.filter(id => !/^(lf|plf)Hd[A-Z]/.test(id)).join());
  }
  check('form: three speed-test rows, one room row and one spot row to start', (blank.match(/data-hd-speed-row/g) || []).length === 3 && (blank.match(/data-hd-room-row/g) || []).length === 1 && (blank.match(/data-hd-bars-row/g) || []).length === 1);
  check('form: saved values come back (rooms, bills, the other-provider name, escaped)', (html.match(/data-hd-room-row/g) || []).length === 2 && html.includes('id="lfHdElectric" min="0" max="5000" step="1" inputmode="numeric" value="183"') && html.includes('value="Race &lt;Fiber&gt;"') && html.includes('<option value="last_12" selected>'));
  check('form: solar details open only when the home facts say Owned, Leased or PPA', /<div data-hd-solar-on>/.test(html) && /data-hd-solar-off>Set "Solar panels"/.test(html.replace(' hidden"', '"')) && html.includes('<p class="tiny field-hint hidden" data-hd-solar-off>')
    && blank.includes('<div data-hd-solar-on class="hidden">') && blank.includes('<p class="tiny field-hint" data-hd-solar-off>'));
  check('form: the gate opening, driveway length and garage spaces are not asked again', !/Gate opening|Driveway length|Garage spaces/.test(blank));
  check('form: no total, no yearly figure, no savings field', !/total|per year|a year\b|savings|payback/i.test(blank.replace('Warranty ends (year)', '').replace('Year installed', '')));
  // The gate decides which groups are drawn.
  app.setGate({ ...ALL_ON, willItFit: false, signalMap: false });
  const billsOnly = app.run(`homeDataFieldsHtml('lf', null, {})`);
  check('form: a group whose tool is not live is not drawn', billsOnly.includes('Bills (your monthly averages)') && !billsOnly.includes('Room and garage sizes') && !billsOnly.includes('Signal and internet'));
  app.setGate({});
  check('form: nothing at all before the gate is read or with every tool off', app.run(`homeDataFieldsHtml('lf', null, {})`) === '');
  app.setGate(SHIP_MEMBER);
  const ship = app.run(`homeDataFieldsHtml('lf', null, {})`);
  check('form, gate as it ships: a member gets all three groups', ['Bills (your monthly averages)', 'Room and garage sizes', 'Signal and internet (your own tests)'].every(s => ship.includes(s)));

  // The client's error words are the server's.
  const E = app.run('HD_FORM_ERRORS');
  check('main.js HD_FORM_ERRORS are the server\'s messages, word for word', E.bill === lib.BILL_ERROR && E.basis === lib.BASIS_ERROR && E.kw === lib.SOLAR_KW_ERROR && E.kwh12 === lib.SOLAR_KWH_ERROR && E.year === lib.SOLAR_YEAR_ERROR && E.warrantyEnd === lib.SOLAR_WARRANTY_ERROR
    && E.fit === lib.FIT_ERROR && E.fitRoom === lib.FIT_ROOM_ERROR && E.speed === lib.SPEED_ERROR && E.speedRow === lib.SPEED_ROW_ERROR && E.bars === lib.BARS_ERROR && E.barsRow === lib.BARS_ROW_ERROR && E.barsDate === lib.BARS_DATE_ERROR && E.month === lib.MONTH_ERROR, JSON.stringify(E));
  check('main.js row limits are the server\'s', JSON.stringify(app.run('HD_FORM_MAX')) === JSON.stringify({ rooms: lib.MAX_ROOMS, speedTests: lib.MAX_SPEED_TESTS, bars: lib.MAX_BARS }));

  // readHomeData on a stand-in form: fields by id, rows by their data-hd-f cells.
  const form = ({ fields = {}, rooms = null, speed = null, bars = null, solar = 'owned' }) => {
    const row = r => ({ querySelector: sel => ({ value: String(r[(/data-hd-f="(\w+)"/.exec(sel) || [])[1]] ?? '') }) });
    const rootEl = { querySelector: sel => (sel === '[data-hd-rooms]' ? (rooms ? {} : null) : sel === '[data-hd-speed]' ? (speed ? {} : null) : null),
      querySelectorAll: sel => (sel === '[data-hd-room-row]' ? (rooms || []) : sel === '[data-hd-speed-row]' ? (speed || []) : sel === '[data-hd-bars-row]' ? (bars || []) : []).map(row) };
    app.sb.document.querySelector = sel => (sel === '[data-hd-prefix="lf"]' ? rootEl : null);
    app.sb.document.getElementById = id => (id === 'lfYardSolar' ? { value: solar } : id.startsWith('lfHd') && (id.slice(4) in fields) ? { value: String(fields[id.slice(4)]) } : null);
  };
  const BILL_FIELDS = { Electric: '183', Gas: '', Water: '95', TrashSewer: '0', Basis: 'last_12', SolarKw: '6.44', SolarYear: '2021', SolarKwh: '', SolarWarranty: '', SolarProgram: '' };
  const FIT_FIELDS = { GarageDoorW: '192', GarageDoorH: '84', GarageDepth: '', GarageWidth: '', SideWidth: '132', Overhead: '' };
  form({ fields: { ...BILL_FIELDS, ...FIT_FIELDS, BarsDate: '2026-10' },
    rooms: [{ room: 'living', widthIn: '170', lengthIn: '216', doorIn: '32' }, { room: '', widthIn: '', lengthIn: '', doorIn: '' }],
    speed: [{ down: '480.5', up: '22', provider: 'other', providerOther: 'Race Fiber', conn: 'wifi', date: '2026-10' }, {}, {}],
    bars: [{ carrier: 'att', carrierOther: 'ignored', area: 'kitchen', bars: '4', net: '' }, {}] });
  const body = JSON.parse(JSON.stringify(app.run(`readHomeData('lf')`)));
  const stored = lib.validateHomeData(body, { kind: 'listing', facts: { yard: { solar: 'owned' } }, nowMs: Date.UTC(2026, 10, 12, 20) });
  check('readHomeData -> the server accepts it and stores what was typed (blank rows dropped; "Not sure" beside solar details reads "the owner isn\'t sure")', !stored.error && JSON.stringify(stored.data) === JSON.stringify({
    runCosts: { bills: { electric: 183, water: 95, trashSewer: 0 }, basis: 'last_12', asOf: '2026-11', solar: { kw: 6.4, year: 2021, program: 'not_sure' } },
    fit: { rooms: [{ room: 'living', widthIn: 170, lengthIn: 216, doorIn: 32 }], garage: { doorWidthIn: 192, doorHeightIn: 84 }, access: { sideWidthIn: 132 } },
    signal: { speedTests: [{ down: 480.5, up: 22, provider: 'other', providerOther: 'Race Fiber', conn: 'wifi', date: '2026-10' }], bars: [{ carrier: 'att', area: 'kitchen', bars: 4 }], date: '2026-10' } }), JSON.stringify(stored));
  form({ fields: { ...BILL_FIELDS, SolarKw: '', SolarYear: '' }, solar: 'none' });
  check('readHomeData: no solar on the home -> no solar details sent, and no "not sure" on its own', JSON.stringify(app.run(`readHomeData('lf')`).runCosts.solar) === '{}');
  form({ fields: { ...BILL_FIELDS, SolarKw: '', SolarYear: '' } });
  check('readHomeData: solar with nothing typed sends no program', app.run(`readHomeData('lf')`).runCosts.solar.program === '');
  form({ fields: { Electric: '', Gas: '', Water: '', TrashSewer: '', Basis: '' }, rooms: [{}], speed: [{}, {}, {}], bars: [{}] });
  const empty = app.run(`readHomeData('lf')`);
  check('readHomeData: an untouched form reads as empty (a new home then skips the save)', app.run('hdDataIsEmpty')(empty) === true && app.run('hdDataIsEmpty')({ runCosts: { bills: { electric: 0 } } }) === false && app.run('hdDataIsEmpty')(null) === true);
  const throwsWith = (state, message) => { form(state); try { app.run(`readHomeData('lf')`); return 'no error'; } catch (e) { return e.message === message ? true : e.message; } };
  const badForms = [
    [{ fields: { ...BILL_FIELDS, Electric: '9000' } }, lib.BILL_ERROR], [{ fields: { ...BILL_FIELDS, Electric: '12.5' } }, lib.BILL_ERROR], [{ fields: { ...BILL_FIELDS, Basis: '' } }, lib.BASIS_ERROR],
    [{ fields: { ...BILL_FIELDS, SolarKw: '80' } }, lib.SOLAR_KW_ERROR], [{ fields: { ...BILL_FIELDS, SolarYear: '1950' } }, lib.SOLAR_YEAR_ERROR], [{ fields: { ...BILL_FIELDS, SolarKwh: '70000' } }, lib.SOLAR_KWH_ERROR],
    [{ fields: { ...BILL_FIELDS, SolarWarranty: '1999' } }, lib.SOLAR_WARRANTY_ERROR],
    [{ fields: FIT_FIELDS, rooms: [{ room: 'living', widthIn: '20', lengthIn: '100' }] }, lib.FIT_ERROR], [{ fields: FIT_FIELDS, rooms: [{ room: 'living', widthIn: '100', lengthIn: '' }] }, lib.FIT_ERROR],
    [{ fields: FIT_FIELDS, rooms: [{ room: '', widthIn: '100', lengthIn: '100' }] }, lib.FIT_ROOM_ERROR], [{ fields: { ...FIT_FIELDS, GarageDepth: '50' }, rooms: [] }, lib.FIT_ERROR],
    [{ fields: { BarsDate: '' }, speed: [{ down: '0', up: '5', date: '2026-10' }] }, lib.SPEED_ERROR], [{ fields: { BarsDate: '' }, speed: [{ down: '50', up: '', date: '2026-10' }] }, lib.SPEED_ROW_ERROR],
    [{ fields: { BarsDate: '' }, speed: [{ down: '50', up: '5', date: '2019-05' }] }, lib.MONTH_ERROR], [{ fields: { BarsDate: '2026-10' }, speed: [], bars: [{ carrier: 'att', area: 'kitchen', bars: '7' }] }, lib.BARS_ERROR],
    [{ fields: { BarsDate: '2026-10' }, speed: [], bars: [{ carrier: 'att', area: '', bars: '3' }] }, lib.BARS_ROW_ERROR], [{ fields: { BarsDate: '' }, speed: [], bars: [{ carrier: 'att', area: 'kitchen', bars: '3' }] }, lib.BARS_DATE_ERROR],
  ];
  for (const [state, message] of badForms) { const got = throwsWith(state, message); check(`readHomeData stops the submit with the server's words: ${message.slice(0, 48)}...`, got === true, got); }
  app.sb.document.querySelector = () => null;
  check('readHomeData: no form on the page -> null (nothing is sent)', app.run(`readHomeData('zz')`) === null);
  app.sb.document.getElementById = id => app.els[id] || null;

  // Saving.
  const puts = app.fetches;
  puts.length = 0;
  await app.run(`saveHomeData('listing', 5, { runCosts: { bills: { electric: '', gas: '' }, basis: '', solar: {} }, fit: { rooms: [], garage: { depthIn: '' }, access: {} } }, { isNew: true })`);
  check('saveHomeData: a new home with nothing typed sends no request', puts.length === 0);
  await app.run(`saveHomeData('listing', 5, { fit: { rooms: [] } })`);
  await app.run(`saveHomeData('pre_listing', 9, { runCosts: { bills: { electric: 150 }, basis: 'estimate', solar: {} } }, { isNew: true })`);
  await app.run(`saveHomeData('listing', 5, null)`);
  check('saveHomeData: an edit always saves (so a group can be cleared); PUT /api/home-data/:kind/:id', puts.length === 2 && puts[0][0] === '/api/home-data/listing/5' && puts[0][1] === 'PUT' && puts[1][0] === '/api/home-data/pre_listing/9' && puts[1][2].runCosts.bills.electric === 150, JSON.stringify(puts));
  const note = await app.run(`hdSaveAfterPost(async () => { throw new Error('Leave the street address out.'); })`);
  check('a refusal after the home was posted never undoes the post: it becomes a note on the "posted" message', note === " Some optional details weren't saved: Leave the street address out." && (await app.run('hdSaveAfterPost(async () => {})')) === '');

  // Where the forms call it.
  check('main.js: the listing form reads the home data before posting and saves it right after the costs', /homeData = readHomeData\('lf'\);/.test(mainSrc) && mainSrc.includes("await saveHomeCosts('listing', listingId, costs);\n      const dataNote = await hdSaveAfterPost(() => saveHomeData('listing', listingId, homeData, { isNew: !wasEditing }));"));
  check('main.js: a buyer profile sends none of it', /if \(!payload\.isBuyerOnly\) \{[\s\S]{0,700}homeData = readHomeData\('lf'\);/.test(mainSrc) && mainSrc.includes('let homeData = null;'));
  check('main.js: the listing body gains zip, terms and (a new listing only) headStart', mainSrc.includes("zip: document.getElementById('isBuyerOnly').checked ? '' : document.getElementById('listingZip').value.trim(),") &&mainSrc.includes("if (terms) payload.terms = terms;") && mainSrc.includes("const headStart = editingListingId ? null : hdReadHeadStart('lf');"));
  check('main.js: a pre-listing saves terms and home data after its facts, at create and on edit', mainSrc.includes("await saveHomeFacts('pre_listing', id, facts);\n    if (terms && typeof ltSave === 'function') await ltSave('pre_listing', id, terms);\n    await saveHomeData('pre_listing', id, homeData);")
    && /resetHomeFactsFields\('plFactsFields', 'plf', \{ kind: 'pre_listing' \}\);\n\s+\/\/[^\n]*\n\s+const extrasNote = await hdSaveAfterPost\(async \(\) => \{\n\s+if \(terms && typeof ltSave === 'function'\) await ltSave\('pre_listing', id, terms\);\n\s+await saveHomeData\('pre_listing', id, homeData, \{ isNew: true \}\);/.test(mainSrc));
  check('main.js: the pre-listing create body gains headStart', mainSrc.includes("...(headStart ? { headStart } : {}),"));
  check('main.js: the listing ZIP rides in the draft, the edit fill and the clone', mainSrc.includes("'city', 'state', 'listingZip', 'neighborhood'") && mainSrc.includes("document.getElementById('listingZip').value = l.zip || '';"));
  check('main.js: a copy starts the terms and home data blank', mainSrc.includes('hdResetListingMounts(forClone ? null : l);'));
  check('main.js: the owner\'s card and the pre-listing detail mount the fit checker after they draw', mainSrc.includes('hdMountFitCheckers(summaryEl);') && mainSrc.includes('hdMountFitCheckers(contentEl);'));
});

// ===================== 5. The launch gate in the app =====================
await section('gate walk', async () => {
  const L1 = { id: 7, zip: '91915', is_rental: 0, run_costs_json: JSON.stringify(RUN_COSTS), fit_json: JSON.stringify(FIT), signal_json: '{}', home_facts_json: JSON.stringify(FACTS) };
  const MATCH = { a: { userId: 1, owner: 'Me', listingId: 10, propertyType: 'Condo', city: 'X', state: 'CA', estimatedValue: 1 }, b: { userId: 2, owner: 'You', listingId: 11, propertyType: 'Condo', city: 'Y', state: 'CA', estimatedValue: 1 }, scoreAWantsB: 80, scoreBWantsA: 80 };
  const P1 = { id: 12, city: 'Chula Vista', state: 'CA', zip: '91913', propertyType: 'Condo', beds: 2, baths: 2, askingPrice: 600000, createdAt: '2026-11-01 10:00:00', status: 'open' };
  const walk = (tools) => {
    app.setGate(tools);
    app.run('editingListingId = null; hdResetListingMounts(); hdResetPreListingMounts(); hdResetSavedSearchDeal(); nbCalls.length = 0; hdLoadWatchAreas();');
    const params = new URLSearchParams();
    app.sb.__params = params;
    app.run('hdPreListingFilterParams(__params); hdSyncPreListingFilter(false, true);');
    return {
      listingForm: MOUNT_IDS.slice(0, 3).map(id => app.els[id].innerHTML).join(''),
      preListingForm: MOUNT_IDS.slice(3, 6).map(id => app.els[id].innerHTML).join(''),
      savedSearch: app.els.ssDealFields.innerHTML + JSON.stringify(app.run('hdSavedSearchDeal()')) + app.run('hdSavedSearchDealLabel({})'),
      ownerCard: app.run(`hdOwnerListingExtrasHtml(${JSON.stringify(L1)})`),
      ownerBar: app.run(`renderPreListingOwnerBar(${JSON.stringify(P1)})`),
      teaser: app.run(`preListingTeaserCardHtml(${JSON.stringify({ ...P1, teaser: true })})`),
      match: app.run(`renderMatchCard(${JSON.stringify(MATCH)})`),
      rentalMatch: app.run(`renderMatchCard(${JSON.stringify({ ...MATCH, isRentalMatch: true, b: { ...MATCH.b, isRental: true, rentAmount: 5000, minLeaseMonths: 12 } })})`),
      detail: app.run(`hdPreListingExtrasHtml(${JSON.stringify({ ...P1, homeData: { runCosts: RUN_COSTS }, facts: FACTS })}, true)`),
      facts: app.run(`preListingFactsHtml(${JSON.stringify(P1)}, { zip: '91913' })`),
      headStart: JSON.stringify(app.run(`hdReadHeadStart('lf')`)),
      filter: app.els.marketPreListingFilter.innerHTML + params.toString(),
      watch: app.run('nbCalls.join()'),
      ideasTab: app.run('hdIdeasTabOn()'),
    };
  };
  const DARK = ['nbHeadStartFieldHtml', 'nbHeadStartBadgeHtml', 'nbStandingInterestButtonHtml', 'nbOwnerInterestsHtml', 'nbTradeTrialHtml', 'ltStepDownPanelHtml', 'ltSavedSearchFieldsHtml', 'owner may carry', 'ownerCarry', 'stepDownPanel', '"hours"'];
  const member = walk(SHIP_MEMBER);
  const everything = Object.values(member).join('\n');
  const leaked = DARK.filter(s => everything.includes(s));
  check('gate as it ships, a member: no head-start, standing-interest, step-down, owner-will-carry or test-drive control anywhere', leaked.length === 0, leaked.join());
  check('...while the live tools show: the terms fields, the home-data form, the terms detail, the stay badge, the agents\' filter, watch areas, the Ideas tab',
    member.listingForm.includes('[[ltFieldsHtml]]') && member.listingForm.includes('Bills (your monthly averages)') && member.preListingForm.includes('[[ltFieldsHtml]]') && member.preListingForm.includes('data-hd-prefix="plf"')
    && member.ownerCard.includes('[[ltDetailHtml]]') && member.ownerCard.includes('Cost to run') && member.ownerCard.includes('data-fit-checker') && member.detail.includes('[[ltSellStayBadgeHtml]]') && member.facts.includes('[[ltSellStayBadgeHtml]]')
    && member.filter === '[[ltPreListingFilterHtml]]stay=1' && member.watch === 'loadWatchAreas' && member.ideasTab === true, JSON.stringify(member).slice(0, 500));
  check('...and no area-context button (that gate is off)', !everything.includes('hd-area-context'));
  const admin = walk(SHIP_ADMIN);
  check('gate as it ships, an admin: every dark control is there to walk through', admin.listingForm.includes('[[nbHeadStartFieldHtml]]') && admin.preListingForm.includes('[[nbHeadStartFieldHtml]]') && admin.savedSearch.includes('[[ltSavedSearchFieldsHtml]]')
    && admin.savedSearch.includes('"deal":{"ownerCarry":true}') && admin.savedSearch.includes('owner may carry') && admin.ownerCard.includes('<div id="stepDownPanel-7" data-step-down-panel="7">[[ltStepDownPanelHtml]]</div>')
    && admin.ownerCard.includes('[[nbHeadStartBadgeHtml]]') && admin.ownerBar.includes('[[nbHeadStartBadgeHtml]][[nbOwnerInterestsHtml]]') && admin.teaser.includes('[[nbStandingInterestButtonHtml pre_listing 12]]')
    && admin.match.includes('[[nbTradeTrialHtml]]') && admin.headStart === '{"hours":24}' && admin.detail.includes('hd-area-context'), JSON.stringify(admin).slice(0, 800));
  check('a trial stay is offered on a mutual trade match only (never a rental or buyer match)', !admin.rentalMatch.includes('[[nbTradeTrialHtml]]'));
  const off = walk({});
  check('every tool off (or the gate not read yet): none of it, and the Ideas tab is hidden', !/\[\[|Cost to run|data-hd-prefix|data-fit/.test(Object.values(off).filter(v => typeof v === 'string').join('\n')) && off.ideasTab === false && off.watch === '' && off.headStart === 'null');
  check('the Ideas tab shows when any of its seven tools is live', JSON.stringify(app.run('HD_IDEAS_TOOLS')) === JSON.stringify(['easementIdeas', 'openFor', 'sellAndStay', 'ownerCarry', 'testDrive', 'stepDown', 'watchAreas'])
    && (app.setGate({ stepDown: true }), app.run('hdIdeasTabOn()')) === true && (app.setGate({ runCosts: true, willItFit: true, signalMap: true }), app.run('hdIdeasTabOn()')) === false);
  // An edit never offers a head start; a rental hides the sale terms; a teaser list hides the agents' filter.
  app.setGate(SHIP_ADMIN);
  app.run('editingListingId = 7; hdResetListingMounts({ id: 7, is_rental: 0 });');
  check('editing a listing: no head-start field (a new listing only)', app.els.listingHeadStartField.innerHTML === '' && app.els.listingTermsFields.innerHTML === '[[ltFieldsHtml]]');
  app.run('editingListingId = null; hdSyncPreListingFilter(true, true);');
  check('a member who sees teaser cards never gets the agents\' filter', app.els.marketPreListingFilter.innerHTML === '');
  // A script that didn't load draws nothing and breaks nothing.
  const bare = makeApp({ doubles: false });
  bare.setGate(ALL_ON);
  bare.run('hdResetListingMounts(); hdResetPreListingMounts(); hdResetSavedSearchDeal(); hdLoadWatchAreas();');
  const bareOut = [bare.run(`hdOwnerListingExtrasHtml(${JSON.stringify(L1)})`), bare.run(`renderMatchCard(${JSON.stringify(MATCH)})`), bare.run(`preListingTeaserCardHtml(${JSON.stringify({ ...P1, teaser: true })})`), bare.run(`renderPreListingOwnerBar(${JSON.stringify(P1)})`)].join('\n');
  check('without listing-terms.js, neighbors.js and ideas.js the app still draws (their mounts are simply empty)', bareOut.includes('Cost to run') && bareOut.includes('match-card') && bare.els.listingTermsFields.innerHTML === '' && bare.els.listingDataFields.innerHTML.includes('data-hd-prefix="lf"')
    && bare.run(`hdReadTerms('lf')`) === null && bare.run(`hdReadHeadStart('lf')`) === null && JSON.stringify(bare.run('hdSavedSearchDeal()')) === '{}');
  // Boot order and tab wiring (source).
  const boot = mainSrc.slice(mainSrc.indexOf("document.addEventListener('DOMContentLoaded', async () => {"));
  check('boot: window.NUANCED is read from /api/nuanced-tools before anything draws', /const user = await requireAuthOrRedirect\(\);\n\s+if \(!user\) return;\n\s+document\.getElementById\('whoami'\)[^\n]*\n(\s+\/\/[^\n]*\n)+\s+try \{ window\.NUANCED = \(await apiGet\('\/api\/nuanced-tools'\)\)\.tools \|\| \{\}; \} catch \{ window\.NUANCED = \{\}; \}\n\s+hdSyncIdeasTab\(\);/.test(boot)
    && boot.indexOf("apiGet('/api/nuanced-tools')") < boot.indexOf('goToTab(lastTab)') && boot.indexOf("apiGet('/api/nuanced-tools')") < boot.indexOf('hdResetListingMounts();'));
  check('boot: the gate is asked once', (mainSrc.match(/apiGet\('\/api\/nuanced-tools'\)/g) || []).length === 1);
  check('tabs: Saved loads the watch areas, Ideas loads its tab; the open-house line is untouched', mainSrc.includes("if (name === 'saved') { loadFavorites(); loadHidden(); loadTrash(); loadOpenHousePlan(); }\n  if (name === 'saved') hdLoadWatchAreas();\n  if (name === 'ideas' && typeof loadIdeasTab === 'function') loadIdeasTab();"));
  check('tabs: Ideas is a remembered tab only while it shows', mainSrc.includes("...(hdIdeasTabOn() ? ['ideas'] : [])];"));
  check('saved searches: the deal fields ride in the body and the label', mainSrc.includes('...hdSavedSearchDeal(),') && mainSrc.includes('${escapeHtml(savedSearchLabel(s) + hdSavedSearchDealLabel(s))}'));
  check('browse: the agents\' filter adds its parameters and reloads the list', mainSrc.includes('hdPreListingFilterParams(params);') && mainSrc.includes("document.getElementById('marketPreListingFilter').addEventListener('change', () => loadMarketplaceBrowse());"));
});

// ===================== 6. Deep links and the message draft =====================
await section('links and draft', async () => {
  const grab = (name) => { const start = mainSrc.indexOf(`function ${name}(`); const from = mainSrc.lastIndexOf('\n', start) + 1; let depth = 0, i = mainSrc.indexOf('{', start); for (; i < mainSrc.length; i++) { if (mainSrc[i] === '{') depth++; else if (mainSrc[i] === '}' && --depth === 0) break; } return mainSrc.slice(from, i + 1); };
  const consts = mainSrc.slice(mainSrc.indexOf('const AGENT_TAB_SECTIONS'), mainSrc.indexOf('function openAgentTabSection'));
  const code = consts + ['openAgentTabSection', 'parseAppLink', 'openAppLink'].map(grab).join('\n\n');
  const log = [];
  let ideasHidden = false;
  const sb = { window: { location: {} }, console, requestAnimationFrame: fn => fn(), goToTab: t => log.push(['goToTab', t]), nbOpenTradeTrial: id => log.push(['nbOpenTradeTrial', id]),
    openPreListingDetail: id => log.push(['openPreListingDetail', id]), openTransactionDetail: noop, openConversation: noop, toast: noop, apiGet: async () => ({ conversations: [] }),
    document: { getElementById: id => ({ tagName: 'DIV', scrollIntoView: () => log.push(['scrollIntoView', id]) }), querySelector: sel => (sel === '.tab[data-tab="ideas"]' ? { classList: { contains: () => ideasHidden } } : null) } };
  vm.createContext(sb);
  vm.runInContext(`${code}\nthis.__t = { parseAppLink, openAppLink };`, sb);
  const open = async (link, tools) => { log.length = 0; sb.window.NUANCED = tools; const handled = await sb.__t.openAppLink(link); return JSON.stringify([handled, ...log]); };
  check('#watch-areas -> the Saved tab, scrolled to the panel', (await open('/app#watch-areas', SHIP_MEMBER)) === '[true,["goToTab","saved"],["scrollIntoView","watchAreasPanel"]]');
  check('#standing-interests -> the same panel', (await open('/app#standing-interests', SHIP_ADMIN)) === '[true,["goToTab","saved"],["scrollIntoView","watchAreasPanel"]]');
  check('#ideas -> the Ideas tab', (await open('/app#ideas', SHIP_MEMBER)) === '[true,["goToTab","ideas"]]');
  ideasHidden = true;
  check('#ideas while the tab is hidden -> not handled (falls back like a plain /app link)', (await open('/app#ideas', {})) === '[false]');
  ideasHidden = false;
  check('#trade-trial-7 for an admin -> the Matches tab, then the trial', (await open('/app#trade-trial-7', SHIP_ADMIN)) === '[true,["goToTab","matches"],["nbOpenTradeTrial",7]]');
  check('#trade-trial-7 for a member while the tool is dark -> the Matches tab only', (await open('/app#trade-trial-7', SHIP_MEMBER)) === '[true,["goToTab","matches"]]');
  check('parseAppLink: trade-trial joins the known kinds; junk is still refused', JSON.stringify(sb.__t.parseAppLink('/app#trade-trial-7')) === '{"kind":"trade-trial","id":7}' && sb.__t.parseAppLink('/app#trade-trial-x') === null && sb.__t.parseAppLink('/app#trade-trial-7"><img>') === null);
  check('the older links are unchanged', (await open('/app#pre-listing-12', SHIP_MEMBER)) === '[true,["goToTab","marketplace"],["openPreListingDetail",12]]' && (await open('/app#messages', SHIP_MEMBER)) === '[true,["goToTab","messages"]]');

  // startConversationWith(userId, name, draft): the draft is put in the box, never sent.
  const posts = app.fetches;
  app.answers['/api/conversations'] = { id: 44 };
  app.run(`goToTab = () => {}; openConversation = async () => {}; 0`);
  posts.length = 0;
  app.els.messageBody.value = '';
  await app.run(`startConversationWith(5, 'Sam', 'About your idea outline in 91915')`);
  check('draft: placed in the message box for the person to read and send themselves', app.els.messageBody.value === 'About your idea outline in 91915');
  check('draft: nothing is sent (the only request opens the conversation)', posts.length === 1 && posts[0][0] === '/api/conversations' && posts[0][1] === 'POST' && JSON.stringify(posts[0][2]) === '{"userId":5}', JSON.stringify(posts));
  app.els.messageBody.value = 'typed already';
  await app.run(`startConversationWith(5, 'Sam')`);
  check('draft: existing callers (two arguments) are unchanged', app.els.messageBody.value === 'typed already' && /async function startConversationWith\(userId, name, draft = ''\) \{/.test(mainSrc));
  app.els.messageBody.disabled = true; app.els.messageBody.value = '';
  await app.run(`startConversationWith(5, 'Sam', 'About your idea')`);
  check('draft: left out when the composer is off (Quiet mode, a block)', app.els.messageBody.value === '');
  app.els.messageBody.disabled = false;
});

// ===================== 7. app.html, styles.css, CSP, names =====================
await section('shell', async () => {
  check('app.html: the three scripts in order, after open-house-plan.js and before main.js', ['open-house-plan.js', 'listing-terms.js', 'neighbors.js', 'ideas.js', 'main.js'].map(n => appSrc.indexOf(`<script src="${n}"></script>`)).every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1])));
  check('app.html: the listing ZIP field (optional, 5 digits, numeric keypad) beside city and state, with its help line', appSrc.includes('<div class="field"><label for="listingZip">ZIP code</label><input type="text" id="listingZip" maxlength="5" inputmode="numeric"')
    && appSrc.includes('Optional. It lets members who watch your ZIP code find your home.') && appSrc.indexOf('id="state"') < appSrc.indexOf('id="listingZip"') && appSrc.indexOf('id="listingZip"') < appSrc.indexOf('id="neighborhood"') && !/id="listingZip"[^>]*required/.test(appSrc));
  const order = ['listingPlanFields', 'listingTermsFields', 'listingHeadStartField', 'listingDataFields', 'listingPhotos'].map(id => appSrc.indexOf(`id="${id}"`));
  check('app.html: the terms, head-start and home-data containers right after the floor plan, inside "What you have"', order.every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1])) && appSrc.indexOf('id="whatYouHaveFieldset"') < order[0] && order[3] < appSrc.indexOf('id="whatYouWantFieldset"'), order.join());
  const plOrder = ['plFactsFields', 'plTermsFields', 'plHeadStartField', 'plDataFields', 'plPhotos'].map(id => appSrc.indexOf(`id="${id}"`));
  check('app.html: the same three on the pre-listing form, after its facts', plOrder.every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1])), plOrder.join());
  check('app.html: #ssDealFields inside the saved-search form; #marketPreListingFilter under the browse filters', appSrc.indexOf('id="ssDealFields"') > appSrc.indexOf('id="savedSearchForm"') && appSrc.indexOf('id="ssDealFields"') < appSrc.indexOf('id="addSavedSearchBtn"')
    && appSrc.indexOf('id="marketPreListingFilter"') > appSrc.indexOf('id="marketOnlyInArea"') && appSrc.indexOf('id="marketPreListingFilter"') < appSrc.indexOf('id="marketplaceBrowseList"'));
  check('app.html: the Ideas tab and its panel, and the watch-areas panel on Saved (the Phase 0 hooks) are still there', appSrc.includes('<button class="tab" data-tab="ideas">Ideas</button>') && appSrc.includes('<div id="ideasRoot"></div>') && /<div id="openHousePlan"><\/div>\s*<div id="watchAreasPanel"><\/div>/.test(appSrc));
  check('app.html: every label is tied to a field', !/<label>/.test(appSrc));
  check('app.html: nothing dark is written into the static page', !/head start|standing interest|step-down|seller financing|test-drive|easement|Open For/i.test(appSrc));

  // Every class of spec 4.9 has a style; the phone block stays last; the packet prints clean.
  const CLASSES = ['hd-context', 'fit-checker', 'fit-result', 'fit-ok', 'fit-no', 'signal-grid', 'terms-wishlist', 'financing-flags', 'step-schedule', 'step-now', 'sell-stay-badge', 'head-start-badge', 'watch-areas', 'watch-area-chip',
    'watch-digest', 'early-look-card', 'standing-interest-card', 'trial-card', 'trial-checklist', 'idea-card', 'idea-card-lines', 'outline-builder', 'outline-ladder', 'outline-option', 'outline-notes', 'sketch-grid', 'sk-cell', 'sk-area',
    'sk-house', 'open-for-chip', 'open-for-long', 'packet', 'packet-line'];
  const noStyle = CLASSES.filter(cls => !new RegExp(`\\.${cls}(?![\\w-])`).test(cssSrc));
  check(`styles.css: all ${CLASSES.length} new classes have a rule`, noStyle.length === 0, noStyle.join());
  const lastMedia = cssSrc.lastIndexOf('@media');
  check('styles.css: the final @media (max-width: 720px) block is still the last block in the file', cssSrc.slice(lastMedia).startsWith('@media (max-width: 720px) {') && cssSrc.trimEnd().endsWith('}') && cssSrc.indexOf('.fit-checker {') < lastMedia && cssSrc.slice(lastMedia).includes('.signal-grid'));
  check('styles.css: braces balance', (cssSrc.match(/\{/g) || []).length === (cssSrc.match(/\}/g) || []).length);
  const print = cssSrc.slice(cssSrc.indexOf('body:has(.packet) .agent-strip'));
  check('styles.css: printing the packet hides the top bar, the footer and the buttons', /body:has\(\.packet\) \.agent-strip, body:has\(\.packet\) \.topbar, body:has\(\.packet\) \.site-footer/.test(cssSrc) && /body:has\(\.packet\) button, body:has\(\.packet\) \.btn/.test(print) && cssSrc.lastIndexOf('@media print', cssSrc.indexOf('body:has(.packet) .agent-strip')) > 0);
  check('styles.css: fit answers never rely on color alone (the words, plus an icon span the checker writes)', /\.fit-ok, \.fit-no \{[^}]*font-weight/.test(cssSrc) && /\.fit-ok span, \.fit-no span/.test(cssSrc) && clientSrc.includes("textContent: r.ok === true ? '✓ ' : r.ok === false ? '✕ ' : '? '"));
  check('styles.css: the sketch grid scales to its column (12 across, never wider than the page)', /\.sketch-grid \{[^}]*grid-template-columns: repeat\(12, 1fr\)[^}]*width: 100%[^}]*max-width: 360px/.test(cssSrc) && /svg\.sketch-grid \{[^}]*height: auto/.test(cssSrc));
  check('styles.css: gold is a fill or border here, never text', !/(^|[;{\s])color: var\(--gold\)/.test(cssSrc));

  // CSP and wording on everything this role added (lines added since HEAD; a new file is checked whole).
  const added = (file) => {
    const before = headOf(file);
    const now = read(file).split('\n');
    if (before === null) return now;
    const had = new Map();
    for (const l of before.split('\n')) had.set(l, (had.get(l) || 0) + 1);
    return now.filter(l => { const n = had.get(l) || 0; if (n > 0) { had.set(l, n - 1); return false; } return true; });
  };
  const OWNED = ['main.js', 'client.js', 'app.html', 'styles.css', 'functions/listing/[id].js', 'functions/_lib/homeData.js', 'functions/_lib/homeFacts.js', 'functions/_lib/fccMobileSd.js', 'functions/_lib/sdgeZipUsage.js',
    'functions/api/home-data/[kind]/[id].js', 'functions/api/home-data/context.js', 'tools/load-fcc-mobile.mjs', 'tools/load-sdge-usage.mjs'];
  const addedBy = Object.fromEntries(OWNED.map(f => [f, added(f)]));
  check('git could read HEAD for the comparison', headOf('main.js') !== null);
  for (const f of OWNED) {
    const lines = addedBy[f];
    check(`${f}: no inline style="" added`, !lines.some(l => /\sstyle\s*=\s*["'`]/i.test(l)), lines.find(l => /\sstyle\s*=\s*["'`]/i.test(l)));
    check(`${f}: no inline on*= handler added`, !lines.some(l => /\son[a-z]+\s*=\s*["'`]/i.test(l)), lines.find(l => /\son[a-z]+\s*=\s*["'`]/i.test(l)));
    check(`${f}: no <iframe>, geolocation or inline <script> added`, !lines.some(l => /<iframe|geolocation|<script(?![^>]*\bsrc=)[^>]*>/i.test(l)), lines.find(l => /<iframe|geolocation|<script(?![^>]*\bsrc=)/i.test(l)));
    check(`${f}: never names McKelvey, Patti or Jeff`, !lines.some(l => /McKelvey|Patti|\bJeff\b/i.test(l)));
    check(`${f}: no control byte from a broken regex edit`, !read(f).includes('\x08'));
  }
  // What a person can read: the added lines without their comments.
  const shown = [...addedBy['main.js'], ...addedBy['client.js'], ...addedBy['app.html'], ...addedBy['functions/_lib/homeData.js'], ...addedBy['functions/listing/[id].js']]
    .filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const strings = (shown.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}\n]+</g) || []).join('\n');
  check('jury words: nothing added says verified, certified, guaranteed or approved', !/verified|certified|guaranteed|\bapproved\b(?! agent)/i.test(strings.replace(/isApprovedAgentNow|approved agents?|status === 'approved'/g, '')), (strings.match(/[^\n]*(verified|certified|guaranteed)[^\n]*/i) || [])[0]);
  check('jury words: no savings, payback, total cost, investor, yield or passive income', !/savings|payback|total cost|cost to own|investor|\byield|passive income|\breturn on\b/i.test(strings), (strings.match(/[^\n]*(savings|payback|total cost|investor|yield)[^\n]*/i) || [])[0]);
  check('jury words: the fit tool never says "will fit" or "plenty of room"', !/will fit\b(?!\?)|plenty of room/i.test(strings.replace(/Will it fit\?|Will It Fit\?/g, '')));
  check('jury words: no "1 mile", radius or residents (watch areas are whole ZIP codes)', !/1 mile|\bradius\b|residents/i.test(strings));
  check('no lender is named anywhere in what was added', !/Point Mortgage|NMLS/i.test(shown));
  check('every owner fact is labeled as the owner\'s', ['the owner&#39;s own bills'.replace('&#39;', "'"), '(from the owner)', "from the owner's measurements"].every(s => read('functions/_lib/homeData.js').includes(s)));

  // Top-level names: only the six agreed ones, or the HD_/hd prefix.
  const topLevel = src => [...src.matchAll(/^(?:async )?function (\w+)|^(?:const|let|var) (\w+)/gm)].map(m => m[1] || m[2]);
  for (const [file, allowed] of [['main.js', ['homeDataFieldsHtml', 'readHomeData', 'saveHomeData', 'resetHomeDataFields']], ['client.js', ['homeDataDetailHtml', 'fitCheck']]]) {
    const before = headOf(file);
    const old = new Set(before === null ? [] : topLevel(before));
    const fresh = topLevel(read(file)).filter(n => !old.has(n));
    const stray = fresh.filter(n => !allowed.includes(n) && !/^(HD_|hd)/.test(n));
    check(`${file}: declares ${allowed.join(', ')}; every other new top-level name starts with HD_ or hd`, allowed.every(n => fresh.includes(n)) && stray.length === 0, `stray: ${stray.join()} | missing: ${allowed.filter(n => !fresh.includes(n)).join()}`);
    check(`${file}: no earlier top-level name was removed`, before === null || topLevel(before).every(n => topLevel(read(file)).includes(n)));
  }
  // Every call to another role's helper sits right behind a "typeof <that helper> ... 'function'" check.
  const unguarded = [...mainSrc.matchAll(/\b(lt[A-Z]\w+|nb[A-Z]\w+|loadWatchAreas|loadIdeasTab)\(/g)]
    .filter(m => !new RegExp(`typeof ${m[1]} [!=]== 'function'`).test(mainSrc.slice(Math.max(0, m.index - 260), m.index))).map(m => m[1]);
  check('main.js never calls another role\'s helper without checking it loaded', unguarded.length === 0 && (mainSrc.match(/\b(lt[A-Z]\w+|nb[A-Z]\w+)\(/g) || []).length >= 15, unguarded.join());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
