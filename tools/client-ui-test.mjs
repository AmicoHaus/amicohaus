// Client UI checks for the L1 "launch kit + safety fixes" batch (role B4): syntax, CSP-safe markup in what changed,
// the pure helpers in client.js / page-home.js / page-calculator.js, wording that must never come back (badges,
// win rates, homeowner ratings, investment terms, the reveal box), and that the client stays in sync with the
// server's report presets and life-event keys.
// Usage: node --disable-warning=ExperimentalWarning tools/client-ui-test.mjs "<project root>"
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.argv[2] || '.';
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let failed = 0;
let passed = 0;
const check = (label, cond, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  ${detail}`}`);
};

const JS_FILES = ['main.js', 'client.js', 'seller-prep.js', 'decision-night.js', 'agent-cards.js', 'page-account-security.js',
  'page-sell-buy.js', 'page-calculator.js', 'page-home.js', 'page-profile.js'];
const HTML_FILES = ['app.html', 'account-security.html', 'sell-or-buy-first.html', 'calculator.html', 'whats-new.html'];

// ---- 1. Syntax ----
for (const f of JS_FILES) {
  let ok = true; let msg = '';
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr || e.message).slice(0, 300); }
  check(`node --check ${f}`, ok, msg);
}

// ---- 2. CSP: nothing added uses inline styles, inline handlers or inline scripts ----
function addedLines(file) {
  try {
    const diff = execFileSync('git', ['-C', root, 'diff', '--unified=0', 'HEAD', '--', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1));
  } catch { return read(file).split('\n'); } // no git: check the whole file
}
const INLINE_HANDLER = /\son(click|change|input|submit|load|error|keydown|keyup|keypress|focus|blur|mouse\w+|touch\w+|pointer\w+)\s*=\s*["'`]/i;
for (const f of [...JS_FILES, ...HTML_FILES, 'styles.css']) {
  const lines = addedLines(f);
  check(`${f}: no inline style="" added`, !lines.some(l => /\sstyle\s*=\s*["'`]/i.test(l)), lines.find(l => /\sstyle\s*=/.test(l)));
  check(`${f}: no inline on*= handler added`, !lines.some(l => INLINE_HANDLER.test(l)), lines.find(l => INLINE_HANDLER.test(l)));
  if (f.endsWith('.html')) check(`${f}: no inline <script> added`, !lines.some(l => /<script(?![^>]*\bsrc=)[^>]*>/i.test(l) && !/application\/ld\+json/.test(l)), lines.find(l => /<script/i.test(l)));
}

// ---- 3. Pure helpers, run in a stubbed browser ----
const noop = () => {};
const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, insertBefore: noop, setAttribute: noop, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null, parentNode: { insertBefore: noop } });
const toasts = [];
const sandbox = {
  console, URLSearchParams, setTimeout, clearTimeout, atob, btoa, Notification: {},
  navigator: { userAgent: 'node' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '', search: '', pathname: '/app', host: 'amicohaus.com' } },
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), readyState: 'complete', documentElement: el(), referrer: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
for (const f of ['client.js', 'agent-cards.js', 'page-calculator.js']) vm.runInContext(read(f), sandbox, { filename: f });
// page-home.js runs its page setup at load, so only its small helpers are lifted out here.
function liftFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  let i = src.indexOf('{', start); let depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
vm.runInContext(liftFunction(read('page-home.js'), 'agentStripOrder'), sandbox);
vm.runInContext(`this.__t = { licenseOnFileLabel, agentLicenseOnFileLine, dreLookupUrl, foundingCaption, foundingCaptionHtml, priceRangeLabel,
  savedSearchLabel, homePhotoAlt, blockedOnLabel, blockConfirmText, reportPayload, inlineReportFormHtml, feeHelpHtml, offerToolsNoteHtml,
  isRateLimitedError, actionErrorMessage, contactErrorMessage, currentLifeEventKey, lifeEventLabel, renderLifeEventTags,
  lifeEventCheckboxesHtml, homeCostChipsHtml, homeCostsDetailHtml, momentumBannerHtml, ratingChipHtml, agentDetailsHtml,
  directoryAgentInfo, directoryAgentCardHtml, teamDisplayName, rentMath, agentStripOrder, hiddenContentNoteHtml,
  LIFE_EVENT_ITEMS, LIFE_EVENT_LEGACY_KEYS, REPORT_REASON_PRESETS, OFFER_TOOLS_NOTE, FEE_NOTE, MONEY_TOOL_NOTE, ESTIMATE_LABEL,
  UNBLOCK_NOTE, RATE_LIMITED_COPY };`, sandbox);
const t = sandbox.__t;

// License wording: "on file", never "verified" or "checked".
check('license reads "DRE #… on file"', t.licenseOnFileLabel('01234567') === 'DRE #01234567 on file');
check('no license number -> nothing', t.licenseOnFileLabel('') === '' && t.licenseOnFileLabel(null) === '');
check('license + brokerage line', t.agentLicenseOnFileLine('01234567', 'Bay Realty') === 'DRE #01234567 on file · Bay Realty');
check('DRE lookup link matches the server helper', t.dreLookupUrl('01234567') === 'https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=01234567');
check('founding caption is recognition only', t.foundingCaption(['91913']) === 'Among the first 3 approved agents in 91913; recognition only.');
check('no founding ZIPs -> no caption', t.foundingCaptionHtml([]) === '' && t.foundingCaptionHtml(undefined) === '');

// A hidden post or comment: the author sees why; an admin (the only other viewer) gets an Unhide button.
const hiddenAdmin = t.hiddenContentNoteHtml({ id: 5, hidden: true, hiddenReason: 'Spam' }, false, 'post');
const hiddenMine = t.hiddenContentNoteHtml({ id: 6, hidden: true, hiddenReason: 'Spam' }, true, 'comment');
check('hidden note: admins get an Unhide button for that post', hiddenAdmin.includes('data-action="unhide-content" data-kind="post" data-id="5"') && hiddenAdmin.includes('Spam'), hiddenAdmin);
check('hidden note: the author sees the reason, no Unhide', hiddenMine.includes('Only you can see this') && !hiddenMine.includes('unhide-content'));
check('hidden note: nothing for a shown item', t.hiddenContentNoteHtml({ id: 7 }, false, 'comment') === '');

// Saved searches: range display.
check('range: both ends', t.priceRangeLabel(500000, 800000) === '$500,000–$800,000');
check('range: max only', t.priceRangeLabel(0, 800000) === 'under $800,000');
check('range: min only', t.priceRangeLabel(500000, 0) === 'over $500,000');
check('range: neither', t.priceRangeLabel(0, 0) === '' && t.priceRangeLabel(null, undefined) === '');
check('saved search label', t.savedSearchLabel({ property_type: 'Condo', locations: 'EastLake', price_min: 500000, price_max: 800000 }) === 'Condo in EastLake $500,000–$800,000');
check('saved search label, any type', t.savedSearchLabel({ property_type: 'Any', locations: 'Bonita, CA', price_min: 0, price_max: 0 }) === 'Any type in Bonita, CA');

// Alt text on a home's own photo.
check('photo alt names type and city', t.homePhotoAlt({ propertyType: 'Condo', city: 'Chula Vista' }) === 'Photo of this condo in Chula Vista');
check('photo alt falls back to "home"', t.homePhotoAlt({}) === 'Photo of this home');

// Blocks.
check('"Blocked on {date}" in Pacific time', t.blockedOnLabel('2026-11-04 07:30:00') === 'Blocked on Nov 3, 2026' || t.blockedOnLabel('2026-11-04 07:30:00') === 'Blocked on Nov 4, 2026', t.blockedOnLabel('2026-11-04 07:30:00'));
check('"Blocked on" uses the LA day', t.blockedOnLabel('2026-11-05 03:00:00') === 'Blocked on Nov 4, 2026', t.blockedOnLabel('2026-11-05 03:00:00'));
check('no date -> no label', t.blockedOnLabel('') === '');
const confirmText = t.blockConfirmText('Ana Agent');
check('block confirm copy, word for word', confirmText === "Block Ana Agent? They won't be able to send you proposals, price opinions, showing or interview requests, or messages, and won't see your homes. You can unblock anytime in Account › Blocked Users.");
check('unblock note, word for word', t.UNBLOCK_NOTE === "Unblocking lets them reach you again. Shared contact info, broker preview RSVPs, showing requests and interviews that ended with the block don't come back.");

// Reports: presets match what the server accepts (functions/api/reports/index.js).
const reportsSrc = read('functions/api/reports/index.js');
const serverPresets = (reportsSrc.match(/REPORT_PRESETS\s*=\s*\[([^\]]*)\]/) || [])[1];
const serverList = serverPresets ? [...serverPresets.matchAll(/'([^']+)'/g)].map(m => m[1]) : null;
check('client report presets = the server\'s', serverList && JSON.stringify(serverList) === JSON.stringify([...t.REPORT_REASON_PRESETS]), JSON.stringify(serverList));
const fairHousing = t.reportPayload('comment', '12', 'Fair housing concern', '  says who should live here ');
check('preset report sends preset + details', fairHousing.preset === 'Fair housing concern' && fairHousing.reason === 'says who should live here' && fairHousing.targetId === 12 && fairHousing.targetType === 'comment');
const other = t.reportPayload('user', 7, '', 'spam');
check('"something else" sends free text only (no preset)', other.preset === undefined && other.reason === 'spam');
check('report details are capped at 500', t.reportPayload('post', 1, 'Rules problem', 'x'.repeat(900)).reason.length === 500);
const reportForm = t.inlineReportFormHtml('user', 42, { other: false, cancel: false });
check('rules report form: both presets, no free-text-only option, no cancel', reportForm.includes('Rules problem') && reportForm.includes('Fair housing concern') && !reportForm.includes('Something else') && !reportForm.includes('cancel-report'));
check('report form labels are tied to their fields', /<label for="rpt-user-42-reason">/.test(reportForm) && /id="rpt-user-42-reason"/.test(reportForm));
const help = t.feeHelpHtml({ name: 'Ana <b>', brokerageName: 'Bay & Co', licenseNumber: '01234567' });
check('fee help box: broker, DRE #, DRE complaint + small claims links', help.includes("Ana &lt;b&gt;&#39;s managing broker at Bay &amp; Co (DRE #01234567)") && help.includes('https://www.dre.ca.gov/consumers/filecomplaint.html') && help.includes('https://selfhelp.courts.ca.gov/small-claims-california') && help.includes("Amico Haus doesn&#39;t decide disputes between homeowners and agents."), help);

// Offer tools line.
check('offer tools line, word for word', t.OFFER_TOOLS_NOTE === "Not a purchase agreement. A California home sale needs a written contract signed by both sides, usually prepared by your agents. Accepting here only tells the other side you'd like to move forward." && t.offerToolsNoteHtml().includes('Not a purchase agreement.'));

// 429: the server's own words.
const limited = Object.assign(new Error("You're doing that a lot right now. Please take a short break and try again later."), { status: 429, data: { code: 'rate_limited' } });
check('rate-limited error is recognized', t.isRateLimitedError(limited) && t.isRateLimitedError({ status: 429 }) && !t.isRateLimitedError(new Error('x')));
check('rate-limited toast shows the server message', t.actionErrorMessage(limited) === limited.message);
check('a bare 429 still gets the friendly copy', t.actionErrorMessage({ status: 429, message: '' }) === t.RATE_LIMITED_COPY);
check('other errors keep the contact copy', t.actionErrorMessage(Object.assign(new Error('x'), { data: { code: 'weekly_limit' } })).startsWith('Your message for this week'));

// Life events: in sync with functions/_lib/lifeEvents.js (keys, labels, old keys), labels only, never a raw key.
const lifeEvents = await import(pathToFileURL(path.join(root, 'functions/_lib/lifeEvents.js')).href);
check('life-event choices = the server\'s', JSON.stringify([...t.LIFE_EVENT_ITEMS].map(i => [i.key, i.label])) === JSON.stringify(lifeEvents.LIFE_EVENT_ITEMS.map(i => [i.key, i.label])));
check('old life-event keys map the same way', JSON.stringify(Object.entries(t.LIFE_EVENT_LEGACY_KEYS).sort()) === JSON.stringify(Object.entries(lifeEvents.LIFE_EVENT_LEGACY_KEYS || {}).sort()));
check('an old key reads as its new label', t.lifeEventLabel('divorce_separation') === 'Life change' && t.lifeEventLabel('upsizing_growing_family') === 'Need more space');
const tagHtml = t.renderLifeEventTags(['divorce_separation', 'retirement', 'mystery_key', 'relocation']);
check('tags: labels once each, unknown keys dropped', tagHtml.includes('Life change') && tagHtml.split('Life change').length === 2 && tagHtml.includes('Relocating') && !tagHtml.includes('mystery_key') && !tagHtml.includes('divorce'), tagHtml);
check('tags: only unknown keys -> nothing', t.renderLifeEventTags(['nope']) === '');
const boxes = t.lifeEventCheckboxesHtml('life-event-check', ['inheritance']);
check('checkboxes: 7 choices, old key ticks its new one', (boxes.match(/type="checkbox"/g) || []).length === 7 && /value="estate" checked/.test(boxes) && !boxes.includes('Divorce'));

// Owner-entered numbers.
const chips = t.homeCostChipsHtml(0, 250);
check('cost chips say "Owner says" in a neutral color', chips.includes('Owner says: no Mello-Roos') && chips.includes('Owner says: HOA $250/mo') && !chips.includes('chip-good'), chips);
const costs = t.homeCostsDetailHtml({ melloRoosAnnual: 1200, hoaMonthly: null, hoaDetails: {} });
check('costs heading + confirm line', costs.includes('Costs (from the owner)') && costs.includes("Confirm on the property tax bill and in the seller&#39;s Mello-Roos and HOA disclosures."));
check('momentum banner says offers accepted, not deals closed', t.momentumBannerHtml({ eventCounts7d: { offer_accepted: 2 } }).includes('2 offers accepted') && !t.momentumBannerHtml({ eventCounts7d: { offer_accepted: 2 } }).includes('closed'));

// Agent cards: no verified / Top Rated / license-checked chip; license "on file"; fee line; founding caption; team name.
const card = t.directoryAgentCardHtml({ userId: 9, displayName: 'Ana', brokerageName: 'Bay Realty', licenseNumber: '01234567', isVerified: true, topRated: true, licenseVerified: true,
  rating: 4.8, reviewCount: 3, acceptingClients: true, focusedServiceArea: true, foundingZips: ['91913'], teamName: 'Ortiz Group', commissionRange: { min: 2, max: 2 } });
check('agent card: no verified badge, no Top Rated, no "License checked"', !card.includes('badge-verified') && !card.includes('Top Rated') && !/License checked/i.test(card), card);
check('agent card: "DRE #… on file" with brokerage', card.includes('DRE #01234567 on file · Bay Realty'));
check('agent card: "Focused service area", never "Local specialist"', card.includes('Focused service area') && !card.includes('Local specialist'));
check('agent card: fee line beside fees', card.includes(t.FEE_NOTE));
check('agent card: founding caption', card.includes('Among the first 3 approved agents in 91913; recognition only.'));
check('agent card: "Group" team name gets no extra "Team"', card.includes('Ortiz Group') && !card.includes('Ortiz Group Team'));
check('team name: plain name gets "Team"', t.teamDisplayName('Flores') === 'Flores Team' && t.teamDisplayName('The Flores Team') === 'The Flores Team' && t.teamDisplayName('') === '');
check('rating chip: plain fact, from hires here', t.ratingChipHtml(4.8, 3).includes('3 reviews') && t.ratingChipHtml(4.8, 3).includes('who hired them here'));

// Home page agent strip: the server's newest-approved order (GET /api/agents/directory?sort=newest, which never sends
// approval dates), operator accounts last (never a ranking).
const strip = t.agentStripOrder([
  { userId: 3 },
  { userId: 1, isPlatformOperator: true, rating: 5, reviewCount: 30 },
  { userId: 4, rating: 5, reviewCount: 9 },
  { userId: 2, rating: 3, reviewCount: 1 },
]).map(a => a.userId).join(',');
check('home strip: server order kept, operator last, ratings ignored', strip === '3,4,2,1', strip);
check('home strip: operator still last when newest', t.agentStripOrder([{ userId: 1, isPlatformOperator: true }, { userId: 2 }]).map(a => a.userId).join(',') === '2,1');
check('home strip: approval order kept even when it differs from account order', t.agentStripOrder([{ userId: 5 }, { userId: 6 }, { userId: 2 }]).map(a => a.userId).join(',') === '5,6,2');

// Rent calculator: the owner's own numbers, loan payoff subtracted, no lump-sum bonus.
const rent = t.rentMath({ homeValue: 1000000, sellingCostsPct: 7, loanPayoff: 600000, monthlyRent: 10000 });
check('rent math subtracts the loan payoff', Math.round(rent.left) === 330000 && Math.abs(rent.years - 2.75) < 0.001, JSON.stringify(rent));
check('rent math: nothing left -> 0 years', t.rentMath({ homeValue: 500000, sellingCostsPct: 7, loanPayoff: 600000, monthlyRent: 3000 }).years === 0);
check('rent math: no rent -> 0 years', t.rentMath({ homeValue: 500000, sellingCostsPct: 7, loanPayoff: 0, monthlyRent: 0 }).years === 0);

// ---- 3b. The app's own renderers, with API-shaped data (catches a name used before it exists, too) ----
const app2 = { ...sandbox, document: { ...sandbox.document } };
vm.createContext(app2);
for (const f of ['client.js', 'agent-cards.js', 'seller-prep.js', 'decision-night.js', 'main.js']) vm.runInContext(read(f), app2, { filename: f });
vm.runInContext(`currentUser = { id: 1 }; this.__r = { renderBidCard, renderBidComparisonTable, renderPriceOpinionsPanel, renderShowingRow,
  renderRulesReportPanel, hiredAgentOf, preListingTeaserCardHtml, preListingTeaserNoteHtml, renderMatchCard, projectCardHtml,
  renderTakeHomePanel, renderPriceOpinionForm, renderBidFormAndVote, renderAgentStatsPanel, renderTeamPanel, ownerInterviewsHtml,
  marketEventFigure, leaderboardCardHtml, blockButtonHtml, renderProposalsSection, renderMilestonesHtml, renderPostCard };`, app2);
const r = app2.__r;
const bidA = { id: 5, agentUserId: 42, agentName: 'Ana <b>', brokerageName: 'Bay Realty', licenseNumber: '01234567', licenseVerified: true, isVerified: true,
  topRated: true, winRate: 0.4, rating: 4.7, reviewCount: 3, status: 'pending', foundingZips: ['91913'], message: 'Hi', commissionPct: 2.5, services: [] };
const bidB = { ...bidA, id: 6, agentUserId: 43, agentName: 'Bo', status: 'accepted', foundingZips: [] };
let html = r.renderBidCard(bidA, true);
check('proposal card: Block button for the owner', html.includes('data-action="block-agent" data-id="42" data-name="Ana &lt;b&gt;"'));
check('proposal card: "DRE #… on file", founding caption, no badges or win rate', html.includes('DRE #01234567 on file · Bay Realty') && html.includes('recognition only') && !/Win rate|Top Rated|badge-verified|License checked/.test(html));
check('proposal card: no Block for a non-owner view', !r.renderBidCard(bidA, false).includes('block-agent'));
html = r.renderBidComparisonTable([bidA, bidB], true);
check('comparison table: no win rate column', !/Win rate|🏆/.test(html));
html = r.renderProposalsSection([bidA, bidB], 'pre-listing-9');
check('proposals: fee line + operator line', html.includes('Each agent sets their own fees') && html.includes('Amico Haus is run by Rudy Flores, a Coldwell Banker West agent who may compete for the same homes.'));
html = r.renderPriceOpinionsPanel({ opinions: [{ agentUserId: 42, agentName: 'Ana', licenseNumber: '01234567', brokerageName: 'Bay Realty', vote: 'too_high', priceOpinion: 800000, comps: [] }], summary: null }, 9);
check('price-opinion card: Block button + "on file" line', html.includes('data-action="block-agent" data-id="42"') && html.includes('DRE #01234567 on file'));
html = r.renderShowingRow({ id: 3, proposedAt: '2026-11-10T18:00:00Z', status: 'pending', agentUserId: 42, agentName: 'Ana', agentLicenseNumber: '01234567', agentBrokerageName: 'Bay' }, true);
check('showing row: Block button for the owner', html.includes('data-action="block-agent" data-id="42"'));
check('showing row: no Block for the agent', !r.renderShowingRow({ id: 3, proposedAt: '2026-11-10T18:00:00Z', status: 'pending', agentUserId: 42 }, false).includes('block-agent'));
html = r.ownerInterviewsHtml([{ agentUserId: 42, agentName: 'Ana', status: 'scheduled', format: 'video', slots: [], chosenSlot: '2026-11-10T18:00:00Z', scores: {} }], [bidA], 'open');
check('interview card: Block button', html.includes('data-action="block-agent" data-id="42"'));
html = r.renderRulesReportPanel(r.hiredAgentOf([bidA, bidB]));
check('rules report: aimed at the hired agent, with the help box', html.includes('Report a rules problem') && html.includes('data-target-id="43"') && html.includes("Bo&#39;s managing broker at Bay Realty (DRE #01234567)") && html.includes('filecomplaint.html'));
check('rules report: nothing without a hired agent', r.renderRulesReportPanel(r.hiredAgentOf([bidA])) === '');
html = r.renderRulesReportPanel({ userId: 7, name: 'Owner', isHomeowner: true });
check('rules report (agent side): no broker box, the no-disputes line', !html.includes('managing broker') && html.includes('doesn&#39;t decide disputes'));
html = r.preListingTeaserCardHtml({ id: 1, city: 'Chula Vista', state: 'CA', zip: '91913', propertyType: 'Condo', beds: 2, baths: 2, askingPrice: 0, priceOpen: true, createdAt: '2026-11-01 10:00:00', teaser: true });
check('teaser card: place, type, size, "Open to price opinions", no View & Propose', html.includes('Condo in Chula Vista') && html.includes('91913') && html.includes('Open to price opinions') && !html.includes('open-pre-listing') && !html.includes('<img'));
check('teaser note copy + post link', r.preListingTeaserNoteHtml().includes('Pre-listings open to approved local agents. Thinking of selling?') && r.preListingTeaserNoteHtml().includes('data-action="goto-post-home">Post yours free.</a>'));
html = r.renderMatchCard({ a: { userId: 1, owner: 'Me', listingId: 10, propertyType: 'Condo', city: 'X', state: 'CA', estimatedValue: 1, lifeEventTags: ['inheritance'] },
  b: { userId: 2, owner: 'You', listingId: 11, propertyType: 'Condo', city: 'Y', state: 'CA', isRental: true, rentAmount: 5000, minLeaseMonths: 12 },
  isRentalMatch: true, scoreAWantsB: 80, scoreBWantsA: 80, yearsLow: 3, yearsHigh: 3 });
check('rental match card: no "yrs covered" pill, points to the rent calculator', !html.includes('yrs covered') && html.includes('href="/calculator"'));
check('match card: life-event label (never a key) for matches', html.includes('Estate / inherited') && !html.includes('inheritance'));
html = r.projectCardHtml({ id: 1, title: 'Rebuild', status: 'funded', projectType: 'flip', stage: 'funded', city: 'X', state: 'CA', fundingGoal: 500000, interestCount: 4, timelineMonths: 12 }, { mine: true });
check('FinderMine card: no funding, investors or Mark Funded', !/funding|investor|Mark Funded|Fully Funded/i.test(html) && html.includes('About 12 months'), html);
html = r.renderTakeHomePanel({ id: 9, askingPrice: 800000, priceOpen: false }, [bidA], null);
check('take-home: estimate label, fixed line, "your guess" defaults', html.includes('Your estimate, from the numbers you entered') && html.includes(t.MONEY_TOOL_NOTE) && html.includes('your guess') && !/You'd keep/.test(html));
check('price-opinion form: price-basis line', r.renderPriceOpinionForm(null).includes('Base your price on the home and comparable sales only.'));
check('proposal form: price-basis line', r.renderBidFormAndVote(null, null, false).includes('Base your price on the home and comparable sales only.'));
check('agent stats: counts only, no win rate or Top Rated', !/win rate|Top Rated/i.test(r.renderAgentStatsPanel({ totalBids: 4, acceptedBids: 2, winRate: 0.5, topRated: true, avgResponseHours: 5, finalistCount: 0 })));
check('team panel: no win rate', !/win rate/i.test(r.renderTeamPanel({ team: { name: 'Flores Team', teamStats: { totalBids: 3, acceptedBids: 1, winRate: 0.33 }, members: [] }, myStatus: 'active', myRole: 'member' }, 1)));
check('market events: an accepted offer never shows its price', r.marketEventFigure({ eventType: 'offer_accepted', amount: 750000 }) === '' && r.marketEventFigure({ eventType: 'new_listing', amount: 750000 }) === '$750,000');
check('milestones: never pay an agent personally or in advance', r.renderMilestonesHtml([]).includes('Never pay an agent personally or in advance.'));
html = r.renderPostCard({ id: 3, user_id: 2, author_name: 'Sam', body: 'Hi', like_count: 0, comment_count: 0, created_at: '2026-11-01 10:00:00' });
check('feed post: comment composer line', html.includes('Describe the home, not who should live there or who lives nearby.'));

// ---- 4. Wording that must not come back, and wording that must be there ----
const app = read('app.html');
const main = read('main.js');
const calc = read('calculator.html') + read('page-calculator.js');
const sellBuy = read('sell-or-buy-first.html') + read('page-sell-buy.js');
const owned = [...JS_FILES, ...HTML_FILES].map(f => [f, read(f)]);
const banned = [
  [/badge-verified/, 'verified badge'], [/Top Rated/, 'Top Rated'], [/win rate|winRate/i, 'win rate'], [/License checked/i, 'license-checked chip'],
  [/homeownerRating|review-homeowner|Rate the Homeowner/, 'homeowner ratings'], [/showExactAddress|Reveal exact address/, 'reveal box'],
  [/Min\. investment|Target return|investors? interested|Express Interest|Interested Investors|Fully Funded/, 'FinderMine investment terms'],
  [/Mark Funded/, 'Mark Funded'], [/\bvetted\b/i, '"vetted"'], [/Local specialist/, 'Local specialist'], [/deals? closed/i, '"deal closed"'],
  [/Hottest listing|Biggest price drop/, 'leaderboard superlatives'], [/raise-dispute|Report Issue/, 'dispute UI'],
  [/RENTAL_LUMP_SUM|LUMP_SUM_BONUS|15% (longer|more time)/, 'lump-sum bonus'], [/Amico Haus agent rules/, '"agent rules" phrase'],
];
for (const [re, what] of banned) {
  const hit = owned.find(([, src]) => re.test(src.replace(/toggleVerifiedBtn|user\.isVerified/g, '')));
  check(`no ${what} in B4 files`, !hit, hit && hit[0]);
}
check('app.html: street address label', app.includes('Street address (private — only you can see it)</label><input type="text" id="address"'));
check('app.html: saved search min price field', app.includes('id="savedPriceMin"'));
check('app.html: Terms of Use link on the agent application', app.includes('agreeing to <a href="/terms">the Amico Haus Terms of Use</a>'));
check('app.html: required agent-rules checkbox links /terms#agent-rules', /id="agentAcceptRules" required/.test(app) && app.includes('href="/terms#agent-rules"'));
check("main.js: application sends acceptRules", main.includes("acceptRules: rules.checked"));
check('app.html: special instructions relabeled', app.includes("Notes for agents (pets, sign preference, best showing times). Don't put lockbox, gate or alarm codes here."));
check('app.html: accepted offers (not closed sales)', app.includes('accepted offers (not closed sales)'));
check('app.html: no platform-calculator 15% sentence', !/platform's calculator suggests/.test(app));
check('app.html: life-event hint', app.includes("Why you're moving (optional, shown only to your matches)"));
check('app.html: photo-permission line under every photo upload', (app.match(/I took these photos or have permission to use them/g) || []).length >= 7);
check('app.html: composer lines', (app.match(/Describe the home, not who should live there or who lives nearby\./g) || []).length >= 5);
check('main.js: price-basis line on the proposal and opinion forms', main.includes('id="bidMessageNote">Base your price on the home and comparable sales only.</p>') && main.includes('${escapeHtml(PRICE_BASIS_NOTE)}'));
check('main.js: offer tools line beside every Accept / Counter / Submit offer', (main.match(/\$\{offerToolsNoteHtml\(\)\}/g) || []).length >= 10);
check('main.js: Block on proposals, opinions, showings; seller-prep on interviews', (main.match(/blockButtonHtml\(/g) || []).length >= 4 && read('seller-prep.js').includes('blockButtonHtml(i.agentUserId'));
check('app.html: thread Block link; main.js: composer off when blockedByMe', app.includes('id="threadBlockBtn"') && main.includes("other && other.blockedByMe ? 'blocked'") && main.includes('data-action="thread-unblock"'));
check('main.js: "Blocked" label in the conversation list', main.includes("c.blockedByMe ? ' <span class=\"badge badge-paused\">Blocked</span>'"));
check('main.js: teaser cards and the agents_only note', main.includes('preListingTeaserCardHtml(p') && main.includes("apiErrorCode(e) === 'agents_only'"));
check('main.js: trade partner confirm button', main.includes('data-action="confirm-trade"') && main.includes('${basePath}/confirm'));
check('inbox and group rows open from the keyboard', main.includes('role="button" tabindex="0" data-action="open-conversation"') && main.includes('role="button" tabindex="0" data-action="open-group"') && main.includes('openCardOnKey'));
check('every app.html label is tied to a field or a group', !/<label>/.test(app));
check('app.html + every owned static page has the footer line', ['app.html', 'account-security.html', 'sell-or-buy-first.html', 'calculator.html', 'whats-new.html']
  .every(f => read(f).includes('<p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>')));
check('calculator: loan payoff input, your-own-numbers wording, caution line', calc.includes('id="loanPayoff"') && calc.includes('Rough math from your own numbers') && calc.includes('A large rent prepayment can be lost if the landlord sells, refinances or loses the home. Use escrow and a real estate attorney; California rules on advance rent may apply.') && !/bonusTimeOut|lump sum upfront/.test(calc));
check('calculator + planner + take-home: estimate label and fixed advice line', calc.includes('Your estimate, from the numbers you entered') && sellBuy.includes('ESTIMATE_LABEL')
  && main.includes('ESTIMATE_LABEL') && t.MONEY_TOOL_NOTE === 'An estimate only, not tax, legal or financial advice. Confirm the numbers with your agent, your lender and a tax professional.'
  && calc.includes(t.MONEY_TOOL_NOTE) && sellBuy.includes(t.MONEY_TOOL_NOTE) && main.includes('MONEY_TOOL_NOTE'));
check('defaults are labeled "your guess"', calc.includes('(% of price, your guess)') && sellBuy.includes('(%, your guess)') && main.includes('(% of price, your guess)') && main.includes('($ per $1,000, your guess)'));
check('take-home: no "you\'d keep" / "most take-home"', !/You'd keep|Most take-home|what you'd keep/.test(main));
check('account page: referral copy', read('account-security.html').includes('Share Amico Haus. No rewards or payments for invites.'));
check('whats-new: owner\'s price changes + the new entry', read('whats-new.html').includes("the owner's price changes") && read('whats-new.html').includes('Block any agent in one tap'));
check('profile page: no verified badge shown', !read('page-profile.js').includes('✓ Verified'));

// ---- 5. Every element main.js looks up by a fixed id exists (in app.html or a template that draws it) ----
const templates = owned.map(([, src]) => src).join('\n');
const missingIds = [...new Set([...main.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]))]
  .filter(id => !templates.includes(`id="${id}"`) && !templates.includes(`id = '${id}'`) && !templates.includes(`el.id = '${id}'`));
check('main.js only looks up ids that exist', missingIds.length === 0, missingIds.join(', '));

// ---- 6. Every new class used in the markup has a style, and gold text is the darker shade ----
const css = read('styles.css');
for (const cls of ['footer-legal', 'composer-note', 'offer-tools-note', 'teaser-card', 'teaser-note', 'inline-report', 'help-box', 'rules-report',
  'founding-caption', 'operator-note', 'estimate-label', 'money-tool-note', 'home-costs-heading', 'thread-tools', 'app-footer', 'agents-strip-note', 'dual-agency-note']) {
  check(`styles.css has .${cls}`, new RegExp(`\\.${cls}\\b`).test(css));
}
check('gold text uses --gold-text (#8a5f2c), fills keep --gold', css.includes('--gold-text: #8a5f2c') && !/(^|[;{\s])color: var\(--gold\)/.test(css) && css.includes('background: var(--gold)'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
