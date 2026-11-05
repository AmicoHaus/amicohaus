// R3-1b UI shell checks (role U): app.html's new fields and script order, the main.js wiring for Timing Match,
// Ready Meter and price opinion history, no clashing globals across the app's classic scripts, the new styles,
// the copy pages, and Rudy's 2026-11-04 calls (no "Middle" or any number worked out across agents, the take-home
// starts from the asking price or the owner's own guess, stays capped at 29 days).
// Usage: node --disable-warning=ExperimentalWarning tools/r3b-ui-test.mjs "<project root>"
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.argv[2] || '.';
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let failed = 0;
let passed = 0;
const check = (label, cond, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  ${detail}`}`);
};

const app = read('app.html');
const main = read('main.js');
const client = read('client.js');
const css = read('styles.css');

// ---- 1. app.html ----
const scripts = [...app.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const WANT_ORDER = ['client.js', 'agent-cards.js', 'seller-prep.js', 'decision-night.js', 'timing-match.js', 'ready-meter.js', 'opinion-refresh.js', 'agent-growth.js', 'main.js'];
check('app.html: script order', JSON.stringify(scripts) === JSON.stringify(WANT_ORDER), JSON.stringify(scripts));

for (const id of ['plCloseFrom', 'plCloseTo', 'plStayAfterDays', 'savedMoveFrom', 'savedMoveTo', 'savedStayOffer']) {
  const once = app.split(`id="${id}"`).length === 2;
  check(`app.html: #${id} exists once with a <label for=>`, once && app.includes(`<label for="${id}">`));
}
const STAY_OPTIONS = '<option value="0">No stay</option><option value="7">Up to 7 days</option><option value="14">Up to 14 days</option><option value="29">Up to 29 days</option>';
check('app.html: post form stay choices are 0 / 7 / 14 / 29', app.includes(`<select id="plStayAfterDays">${STAY_OPTIONS}</select>`));
check('app.html: saved-search stay choices are the same', app.includes(`<select id="savedStayOffer">${STAY_OPTIONS}</select>`));
check('app.html: no 30-day stay choice or copy', !/value="30"|30 days/.test(app));
check('app.html: post form timing hint, exact', app.includes('<p class="tiny field-hint">Optional. Your agents write the rent-back terms. Stays are capped at 29 days. Approved agents see your window and stay; buyers never see your dates.</p>'));
check('app.html: saved-search timing hint, exact', app.includes('<p class="tiny field-hint">Optional. Shows a "Timing fits" tag on upcoming pre-listings whose timing lines up with yours. Your dates are never shown to anyone; homeowners only see a count once 3 or more buyers fit.</p>'));
check('app.html: Saved Searches section-sub, exact', app.includes("<p class=\"section-sub\">Get notified the moment a new listing matches these criteria. Name a city or a neighborhood. You can keep up to 10. Add a move-in window to see which upcoming pre-listings' timing fits yours.</p>"));
// The post form's timing row sits right after the occupancy / showing-notice row; the saved-search one after the price row.
const occ = app.indexOf('id="plShowingNoticeHours"'), closeFrom = app.indexOf('id="plCloseFrom"'), special = app.indexOf('id="plSpecialInstructions"');
check('app.html: closing window row is after showing notice, before notes for agents', occ > 0 && occ < closeFrom && closeFrom < special);
const priceMax = app.indexOf('id="savedPriceMax"'), moveFrom = app.indexOf('id="savedMoveFrom"'), formEnd = app.indexOf('</form>', priceMax);
check('app.html: move-in row is inside #savedSearchForm, after the price row', priceMax > 0 && priceMax < moveFrom && moveFrom < formEnd);

// ---- 2. main.js wiring ----
for (const call of ['timingFactsHtml(p, isOwner)', 'timingDemandHtml(p)', 'agentViewStripHtml(p.agentView)', 'readyCheckInHtml(p)',
  'ownerToolsHtml(ownerSegments, p.readyMeter)', 'renderTimingPanel(p)', 'agentViewOwnerPanelHtml(p)', 'opinionRefreshBarHtml(data, preListingId)',
  'opinionCardExtrasHtml(o)', 'agentRefreshHtml(p, myRefreshAsk, myOpinionTrail, myVote)', 'timingFitIds', 'savedSearchTimingHtml(s)',
  'savedSearchTimingFromForm()', 'timingFromPostForm()', 'resetPostFormTiming()', 'resetSavedSearchTimingForm()']) {
  check(`main.js calls ${call}`, main.includes(call));
}
check('main.js: the detail GET destructures myOpinionTrail and myRefreshAsk', main.includes('const { preListing: p, bids, myBid, myVote, priceOpinions, isOwner, myOpinionTrail, myRefreshAsk } = data;'));
const segStart = main.indexOf('const ownerSegments = isOwner ? {');
const segEnd = main.indexOf('} : null;', segStart);
const segBlock = segStart >= 0 && segEnd > segStart ? main.slice(segStart, segEnd) : '';
const segKeys = [...segBlock.matchAll(/^ {6}([a-z_]+):/gm)].map(m => m[1]);
const WANT_KEYS = ['video', 'opinions', 'agent_view', 'address', 'edit', 'disclosures', 'listing_ready', 'timing', 'previews', 'interviews', 'showings', 'decision_night', 'proposals'];
check('main.js: ownerSegments has exactly the 13 keys', JSON.stringify(segKeys) === JSON.stringify(WANT_KEYS), JSON.stringify(segKeys));
check('main.js: Point Mortgage note appears once, outside ownerSegments', main.split('Point Mortgage Corporation').length === 2 && segBlock && !segBlock.includes('Point Mortgage'));
// The lender note stays inside the facts card, which closes before the owner tools render.
const lender = main.indexOf('Point Mortgage Corporation'), tools = main.indexOf('ownerToolsHtml(ownerSegments, p.readyMeter)');
check('main.js: lender note renders in the facts card, above the owner tools', lender > 0 && tools > lender && main.slice(lender, tools).includes('</div>'));
// The facts-card lines sit where the spec puts them.
const fx = s => main.indexOf(s);
check('main.js: timing facts right after the occupancy / showing notice row', fx('${timingFactsHtml(p, isOwner)}') > fx("'None required'}</div>") && fx('${timingFactsHtml(p, isOwner)}') < fx('${p.specialInstructions ?'));
check('main.js: agent view strip right after the ZIP coverage line', main.includes("${zipCoverageHtml(p, isOwner, myVote)}\n        ${!isOwner && p.agentView ? agentViewStripHtml(p.agentView) : ''}"));
check('main.js: timing demand (owner only) right after the buyer-demand line', main.includes(" at this price'}.</p>` : ''}\n        ${isOwner ? timingDemandHtml(p) : ''}"));
check('main.js: refresh panel right after the agent decision line', main.includes('${agentDecisionLineHtml(p)}${agentRefreshHtml(p, myRefreshAsk, myOpinionTrail, myVote)}'));
check('main.js: teaser cards and full cards get the Timing fits tag', main.includes('preListingTeaserCardHtml(p, isNew(p), fits.has(p.id))') && main.includes("${fits.has(p.id) ? timingFitsBadgeHtml() : ''}") && main.includes("${timingFits ? timingFitsBadgeHtml() : ''}"));
check('main.js: the opinion form keeps its price-basis hint byte for byte', main.includes('<p class="tiny field-hint composer-note" id="opinionPriceNote">${escapeHtml(PRICE_BASIS_NOTE)}</p></div>'));
check('main.js: owner opinion panel line, exact', main.includes("<p class=\"tiny\">Agents never see each other's suggested prices, comps or files, and can't see the vote totals until they've voted. Every number here is an agent price opinion, not an appraisal.</p>"));

// Rudy 2026-11-04: nothing worked out across agents in the owner's view, and the take-home starts from their own numbers.
check('no "Middle" / median / average across agents in main.js', !/Middle<|summary\.median|medianOf|averageOf|\bmedian\b/i.test(main), (main.match(/.{0,40}(Middle<|median|averageOf).{0,40}/i) || [''])[0]);
check('no median helper left in client.js', !/medianOf|\bmedian\b/i.test(client));
check('main.js: no "range and middle" copy', !/range and middle|middle of the agents/i.test(main));
check('whats-new.html: no "range and middle" copy', !/\bmiddle\b|\bmedian\b/i.test(read('whats-new.html')));

// ---- 3. Global collisions across every script app.html loads ----
const seen = new Map(); const dups = [];
for (const f of scripts) {
  const src = read(f);
  for (const m of src.matchAll(/^(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(m[1])) dups.push(`${m[1]} (${seen.get(m[1])} + ${f})`); else seen.set(m[1], f);
  }
}
check('no top-level name is declared twice across app.html scripts', dups.length === 0, dups.join(', '));

// ---- 4. styles.css ----
const NEW_CLASSES = ['timing-line', 'timing-fits', 'saved-timing', 'saved-timing-form', 'ready-checkin', 'ready-compact', 'ready-scale', 'ready-scale-ends',
  'ready-topics', 'ready-moved', 'agent-view-strip', 'agent-view-list', 'agent-view-tips', 'owner-tool', 'refresh-bar', 'refresh-ask-panel',
  'refresh-update-form', 'opinion-label', 'ask-status', 'opinion-trail', 'trail-list', 'trail-date', 'trail-spark'];
const lastPhones = css.lastIndexOf('@media (max-width: 720px)');
for (const cls of NEW_CLASSES) {
  const re = new RegExp(`\\.${cls}(?![\\w-])`, 'g');
  const hits = [...css.matchAll(re)].map(m => m.index);
  check(`styles.css has .${cls} before the final phones block`, hits.length > 0 && hits[0] < lastPhones);
}
check('styles.css: the R3-1b block is commented and before the final phones block', css.indexOf('/* ---- R3-1b: Timing Match, Ready Meter, price opinion history ---- */') > 0 && css.indexOf('/* ---- R3-1b: Timing Match, Ready Meter, price opinion history ---- */') < lastPhones);
check('styles.css: the phones block is still the last block', !/\n[^\s}][^\n]*\{/.test(css.slice(css.indexOf('\n}', lastPhones) + 2)));
check('styles.css: the Timing fits tag has no live dot', /\.timing-fits::before\s*\{[^}]*content:\s*none/.test(css) && !/\.timing-fits[^{]*\{[^}]*animation/.test(css));
check('styles.css: pressed check-in buttons use the primary fill', /\.ready-scale button\[aria-pressed="true"\][^{]*\{[^}]*background: var\(--gold\)/.test(css));
check('styles.css: "What agents see" list is one column on phones', /\.agent-view-list \{ grid-template-columns: 1fr; \}/.test(css.slice(lastPhones)));
check('styles.css: no gold text outside --gold-text', !/(^|[;{\s])color: var\(--gold\)/.test(css));

// ---- 5. Copy pages ----
const privacy = read('privacy.html');
const PRIVACY_SENTENCES = [
  " Also your ideal closing window and how long you'd like to stay after closing, your weekly check-in answers (how ready you feel and what's on your mind), and when you ask your agents for fresh price opinions.</li>",
  'the places, home types and price ranges you save, and any move-in window and stay-after days you add,',
  `<p><strong>Timing, check-ins and price opinion history.</strong> Approved agents who can open your pre-listing see your closing window and stay-after days, how many photos you added, whether there's a walkthrough video or an upcoming broker preview, and your Decision Night date. Other members never see your dates; a member whose saved search's move-in window and stay fit yours sees a "Timing fits" tag on your short preview. Your listing-ready checklist count, target list month and how ready you feel (Exploring, Getting close or Ready) are shown to agents only if you turn on "Share my progress with agents." The number you pick and what's on your mind in a weekly check-in are never shown to agents or other members. We use them to order the tools on your pre-listing and, only as totals across at least 20 homeowners (never per person, per home or per area), to see what homeowners want help with. Every version of an agent's price opinion on your home is kept while the pre-listing exists, and only you and that agent see it; agents never see each other's numbers.</p>`,
  ' A move-in window you add is used only to show you "Timing fits" tags and to count, never name, buyers whose timing fits a homeowner\'s (shown only once there are 3 or more).</p>',
];
PRIVACY_SENTENCES.forEach((sentence, i) => check(`privacy.html: R3-1b sentence ${i + 1} verbatim`, privacy.includes(sentence)));
const prePara = privacy.indexOf('<p><strong>Pre-listings are shared only with approved agents.</strong>');
check('privacy.html: the timing paragraph comes right after the pre-listings paragraph', prePara > 0 && privacy.indexOf('</p>', prePara) + 4 < privacy.indexOf('<strong>Timing, check-ins and price opinion history.</strong>') && privacy.slice(privacy.indexOf('</p>', prePara) + 4, privacy.indexOf('<strong>Timing, check-ins')).trim() === '<p>');
// L1.1 moved the date to November 5 (launch-test pins it); R3-1b leaves it alone.
check('privacy.html: still "Last updated November 5, 2026."', privacy.includes('Last updated November 5, 2026.'));
const whatsNew = read('whats-new.html');
const firstCard = whatsNew.indexOf('<div class="card about-card">');
check('whats-new.html: the new first card', firstCard > 0 && whatsNew.indexOf('<h2>Timing, a weekly check-in and fresh price opinions</h2>') > firstCard && whatsNew.indexOf('<h2>Timing, a weekly check-in and fresh price opinions</h2>') < whatsNew.indexOf('<div class="card about-card">', firstCard + 1));
check('whats-new.html: up to 29 days, the agents write the rent-back terms', whatsNew.includes("how long you'd like to stay after closing, up to 29 days. Your agents write the rent-back terms.") && !/30 days/.test(whatsNew));
check('whats-new.html: "agent price opinion, not an appraisal"', whatsNew.includes('Every number is an agent price opinion, not an appraisal.'));
const llms = read('llms.txt');
const LLMS_LINES = [
  '- **Timing Match**: a homeowner can pick an ideal closing window and a stay after closing of up to 29 days (their agents write any rent-back terms); buyers can add a move-in window to a saved search and see a "Timing fits" tag. Homeowners see only a count of buyers whose timing fits, and only once there are 3 or more.',
  "- **Weekly check-in**: a private two-tap check-in that moves a homeowner's matching tools to the top of their dashboard. Agents see a readiness band only if the homeowner chooses to share it.",
  '- **Price opinion history**: every 90 days a homeowner can ask the agents who gave a price opinion for a fresh look (Same or Update). Each agent\'s history is shown per agent only, to the homeowner and that agent. Every number is an agent price opinion, not an appraisal.',
];
const agentStrategy = llms.slice(llms.indexOf('## Key concepts (Agent Strategy)'), llms.indexOf('## Key concepts (home trading)'));
LLMS_LINES.forEach((line, i) => check(`llms.txt: R3-1b line ${i + 1} under Key concepts (Agent Strategy)`, agentStrategy.includes(line + '\n')));
check('llms.txt: the new lines never say verified, vetted or invest', LLMS_LINES.every(l => !/verified|vetted|invest/i.test(l)));
check('llms.txt: no 30-day stay', !/30 days/.test(llms));

// ---- 6. CSP over touched files client-ui-test doesn't scan (whole files) ----
const INLINE_HANDLER = /\son(click|change|input|submit|load|error|keydown|keyup|keypress|focus|blur|mouse\w+|touch\w+|pointer\w+)\s*=\s*["'`]/i;
for (const f of ['admin-seed.html', 'page-admin-seed.js', 'privacy.html']) {
  const src = read(f);
  check(`${f}: no inline style=""`, !/\sstyle\s*=\s*["'`]/i.test(src));
  check(`${f}: no inline on*= handler`, !INLINE_HANDLER.test(src));
  check(`${f}: no inline <script>`, !/<script(?![^>]*\bsrc=)[^>]*>/i.test(src.replace(/application\/ld\+json/g, '')));
}

// ---- 7. vm: the new client files load together, and main.js renders with them ----
const noop = () => {};
const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, insertBefore: noop, setAttribute: noop, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, parentNode: { insertBefore: noop } });
const makeSandbox = () => {
  const sb = {
    console, URLSearchParams, setTimeout, clearTimeout, atob, btoa, Notification: {}, Intl,
    navigator: { userAgent: 'node' },
    window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), readyState: 'complete', documentElement: el(), referrer: '' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sb.window.document = sb.document;
  return vm.createContext(sb);
};
let smokeErr = '';
try {
  const ctx = makeSandbox();
  for (const f of ['client.js', 'timing-match.js', 'ready-meter.js', 'opinion-refresh.js']) vm.runInContext(read(f), ctx, { filename: f });
} catch (e) { smokeErr = String(e && e.stack || e).slice(0, 300); }
check('vm: client.js + timing-match.js + ready-meter.js + opinion-refresh.js load in one context', !smokeErr, smokeErr);

const ctx = makeSandbox();
let loadErr = '';
try {
  for (const f of scripts) if (f !== 'agent-growth.js') vm.runInContext(read(f), ctx, { filename: f });
  vm.runInContext(`currentUser = { id: 1 }; this.__r = { renderPriceOpinionsPanel, renderPriceOpinionForm, renderTakeHomePanel, takeHomeStartPrice,
    preListingTeaserCardHtml, timingFitsBadgeHtml };`, ctx);
} catch (e) { loadErr = String(e && e.stack || e).slice(0, 300); }
check('vm: every app script but agent-growth.js loads, then main.js', !loadErr, loadErr);
const r = ctx.__r || {};
if (r.renderPriceOpinionForm) {
  check('opinion form: agents learn the homeowner keeps a private history', r.renderPriceOpinionForm(null).includes('<p class="tiny">The homeowner keeps a private history of each number you share here. Other agents never see it.</p>'));
  const form = r.renderPriceOpinionForm(null);
  check('opinion form: the history line comes right after the price-basis hint', form.indexOf('id="opinionPriceNote"') < form.indexOf('The homeowner keeps a private history'));

  // An older server payload that still carries a summary must not bring back a range or middle.
  const ops = { opinions: [
    { agentUserId: 7, agentName: 'First In', vote: 'just_right', priceOpinion: 900000, comps: [] },
    { agentUserId: 8, agentName: 'Second In', vote: 'too_high', priceOpinion: 700000, comps: [] },
    { agentUserId: 9, agentName: 'Third In', vote: 'too_low', priceOpinion: 800000, comps: [] },
  ], summary: { low: 700000, high: 900000, median: 812345, count: 3 } };
  const panel = r.renderPriceOpinionsPanel(ops, 9);
  check('owner opinions panel: the low-to-high range, never a Middle', panel.includes('<span class="label">Range</span>$700,000 to $900,000') && !/Middle|812,345|range and middle/i.test(panel), panel.slice(0, 400));
  check('owner opinions panel: under 3 prices, the range note (no middle)', r.renderPriceOpinionsPanel({ opinions: ops.opinions.slice(0, 2), summary: null }, 9).includes('The range shows up once 3 agents have suggested a price (2 so far).'));
  check('owner opinions panel: cards keep the server\'s arrival order', panel.indexOf('First In') < panel.indexOf('Second In') && panel.indexOf('Second In') < panel.indexOf('Third In'));
  check('owner opinions panel: "agent price opinion, not an appraisal"', panel.includes('Every number here is an agent price opinion, not an appraisal.'));

  // Take-home: the asking price, or blank for the owner's own guess. Never from the opinions.
  check('take-home start: the asking price', r.takeHomeStartPrice({ askingPrice: 750000, priceOpen: false }) === 750000);
  check('take-home start: open to price opinions -> blank (0)', r.takeHomeStartPrice({ askingPrice: 0, priceOpen: true }) === 0);
  check('take-home start: takes no opinions argument', r.takeHomeStartPrice.length === 1);
  const thAsk = r.renderTakeHomePanel({ id: 9, askingPrice: 750000, priceOpen: false }, [], ops);
  const thOpen = r.renderTakeHomePanel({ id: 9, askingPrice: 0, priceOpen: true }, [], ops);
  check('take-home panel: starts at the asking price', /id="thPrice"[^>]*value="750000"/.test(thAsk) && thAsk.includes('The sale price starts at your asking price'));
  check('take-home panel: no asking price -> blank "Your own guess"', /id="thPrice"[^>]*placeholder="Your own guess"[^>]*value=""/.test(thOpen) && thOpen.includes('Type your own guess for the sale price.') && !/812345|800000|900000|700000/.test(thOpen));
  check('take-home panel: never mentions the agents\' opinions', !/middle|median|agents' price opinions/i.test(thAsk + thOpen));

  const teaser = { id: 1, city: 'Chula Vista', state: 'CA', zip: '91913', propertyType: 'Condo', beds: 2, baths: 2, askingPrice: 0, priceOpen: true, createdAt: '2026-11-01 10:00:00', teaser: true };
  const one = r.preListingTeaserCardHtml(teaser);
  check('teaser card: 1-argument call still works, no Timing fits tag', one.includes('Condo in Chula Vista') && !one.includes('timing-fits'));
  const badge = r.timingFitsBadgeHtml();
  check('teaser card: the Timing fits tag only when it fits', r.preListingTeaserCardHtml(teaser, false, true).includes(badge) && (badge === '' || !one.includes(badge)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
