// Owner tools batch (role M): the app shell wiring (script order, the photo hint, main.js calls and mounts, the owner
// tool keys), global names across every page's scripts, the new CSS classes, the copy pages (privacy, what's new,
// llms.txt), CSP over every file the batch touched or created, the repost OK wording, and no team names anywhere in
// the batch. Source scans only; no network, no database.
// Usage: node --disable-warning=ExperimentalWarning tools/owner-tools-ui-test.mjs <projectRoot>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.argv[2] || '.';
const exists = f => fs.existsSync(path.join(root, f));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let failed = 0;
let passed = 0;
const check = (label, cond, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  ${detail}`}`);
};

// ---- Every file the batch adds (spec §1.2) is there ----
const NEW_FILES = [
  // M
  'share-moment.js', 'functions/_lib/moment.js', 'functions/api/pre-listings/[id]/repost-ok.js', 'functions/api/admin/repost-oks.js',
  'tools/share-moment-test.mjs', 'tools/owner-tools-ui-test.mjs',
  // P
  'privacy-sweep.js', 'then-now.js', 'functions/_lib/thenNow.js', 'functions/api/pre-listings/[id]/then-now/index.js',
  'functions/api/pre-listings/[id]/then-now/[pairId].js', 'functions/api/pre-listings/[id]/upgrades/index.js',
  'functions/api/pre-listings/[id]/upgrades/[upgradeId].js', 'functions/api/then-now-photos/[id]/then.js', 'functions/api/then-now-photos/[id]/now.js',
  // S
  'visit-feedback.js', 'handoff-binder.js', 'functions/_lib/visitFeedback.js', 'functions/_lib/sellerReport.js', 'functions/_lib/handoffBinder.js',
  'functions/api/pre-listings/[id]/visit-feedback.js', 'functions/api/pre-listings/[id]/binder.js', 'functions/pre-listing/[id]/binder.js',
  'functions/api/account/seller-report.js', 'functions/api/account/seller-report-unsubscribe.js',
  // C
  'functions/_lib/publicShell.js', 'functions/_lib/mysteryHomes.js', 'functions/mystery-home/index.js', 'functions/mystery-home/[slug].js',
  'functions/api/mystery-home-photos/[id].js', 'functions/api/admin/mystery-homes/index.js', 'functions/api/admin/mystery-homes/[id].js',
  'functions/api/admin/mystery-homes/[id]/photos/index.js', 'functions/api/admin/mystery-homes/[id]/photos/[photoId].js', 'mystery-home.js',
  'functions/_lib/videoTwins.js', 'functions/watch/index.js', 'functions/watch/[slug].js',
  // I
  'migration_v45.sql', 'functions/_lib/homeText.js',
];
const missing = NEW_FILES.filter(f => !exists(f));
check('every new file in the batch is in the tree', missing.length === 0, missing.join(', '));

// ---- app.html: script order and the photo hint ----
const app = read('app.html');
const localScripts = html => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
const WANT_ORDER = ['client.js', 'agent-cards.js', 'seller-prep.js', 'decision-night.js', 'share-moment.js', 'timing-match.js', 'ready-meter.js', 'opinion-refresh.js',
  'privacy-sweep.js', 'then-now.js', 'visit-feedback.js', 'handoff-binder.js', 'agent-growth.js', 'open-house-plan.js', 'main.js'];
check('app.html: script order exact', JSON.stringify(localScripts(app)) === JSON.stringify(WANT_ORDER), JSON.stringify(localScripts(app)));
const PHOTO_RIGHTS_NOTE = (read('client.js').match(/const PHOTO_RIGHTS_NOTE = '([^']+)';/) || [])[1];
const HINT = '<p class="tiny field-hint">By adding photos you confirm: I took these photos or have permission to use them. When you pick photos, Privacy Sweep opens so you can blur or cover anything private first.</p>';
const plPhotosLine = app.split('\n').find(l => l.includes('id="plPhotos"')) || '';
check('app.html: the plPhotos hint exact, and it still starts with PHOTO_RIGHTS_NOTE', plPhotosLine.includes(HINT) && !!PHOTO_RIGHTS_NOTE && HINT.includes(`field-hint">${PHOTO_RIGHTS_NOTE} When`), plPhotosLine);
const demoHtml = read('demo.html');
check('demo.html: share-moment.js after demo-sample-data.js, before page-demo.js', JSON.stringify(localScripts(demoHtml)) === JSON.stringify(['client.js', 'demo-sample-data.js', 'share-moment.js', 'page-demo.js']), JSON.stringify(localScripts(demoHtml)));
const agentsEnd = demoHtml.indexOf('</section>', demoHtml.indexOf('id="agents"'));
const reveal = demoHtml.indexOf('<section class="demo-section" id="reveal">');
check('demo.html: the Reveal Mode (sample) section right after #agents', reveal > agentsEnd && demoHtml.slice(agentsEnd, reveal).trim() === '</section>'
  && demoHtml.includes('<h2>Reveal Mode (sample)</h2>') && demoHtml.includes('What a homeowner sees when their proposals open together on Decision Night. Sample data only.')
  && demoHtml.includes('data-demo-action="reveal">Try Reveal Mode (sample)</button>'));
const pageDemo = read('page-demo.js');
check('page-demo.js: the button opens the sample with DEMO_REVEAL_CARDS, and the pills list the section in page order', pageDemo.includes("openRevealMode(DEMO_REVEAL_CARDS, { city: 'Chula Vista', state: 'CA', sample: true })")
  && /\{ id: 'agents'[^\n]*\n\s*\{ id: 'reveal'/.test(pageDemo) && !/apiGet|fetch\(/.test(pageDemo.slice(pageDemo.indexOf('function setupRevealDemo'), pageDemo.indexOf('(async function init')))) ;
const sampleBox = {};
vm.createContext(sampleBox);
vm.runInContext(`${read('demo-sample-data.js')}\nthis.__cards = DEMO_REVEAL_CARDS;`, sampleBox);
check('demo-sample-data.js: 5 fictional cards, 2 with reels, letters only', sampleBox.__cards.length === 5 && sampleBox.__cards.filter(c => c.reel).length === 2 && sampleBox.__cards.every(c => Object.keys(c).sort().join() === 'letter,reel'));

// ---- main.js wiring ----
const main = read('main.js');
for (const call of ['sweepIsDone(file)', "sweepPickedFiles('plPhotos')", "sweepPickedFiles('plePhotos')", 'privacySweepPhotoControlsHtml(p.id, pid,',
  'loadThenNowInto(id, isOwner)', 'loadVisitFeedbackInto(id, isOwner)', 'loadHandoffBinderInto(id)',
  '<div id="thenNowPanel"></div>', '<div id="visitFeedbackPanel"></div>', '<div id="binderPanel"></div>', '<div id="thenNowAgentPanel"></div>', '<div id="visitFeedbackAgentPanel"></div>']) {
  check(`main.js has ${call}`, main.includes(call));
}
check("main.js: the swept mark rides with the photo", main.includes("if (typeof sweepIsDone === 'function' && sweepIsDone(file)) formData.append('swept', '1');"));
check('main.js: the agent Then & Now mount sits right after the photos', main.includes("${photosHtml}\n        ${!isOwner ? '<div id=\"thenNowAgentPanel\"></div>' : ''}"));
check('main.js: the agent visit-feedback mount sits after the showing request form', main.includes("${p.status === 'open' ? renderRequestShowingForm() : ''}<div id=\"visitFeedbackAgentPanel\"></div>"));
check('main.js: the binder loads for the owner only', main.includes("if (isOwner && typeof loadHandoffBinderInto === 'function') loadHandoffBinderInto(id);"));
const sellerPrep = read('seller-prep.js');
check('seller-prep.js: the pre-filming tip, owner branch, above the upload control', sellerPrep.includes('<p class="tiny">Before you film: turn family photos face down, put mail away, and keep the house number out of the shot.</p><div class="field"><label for="preListingVideoInput">'));
const segStart = main.indexOf('const ownerSegments = isOwner ? {');
const segEnd = main.indexOf('} : null;', segStart);
const segKeys = [...main.slice(segStart, segEnd).matchAll(/^ {6}([a-z_]+):/gm)].map(m => m[1]);
const readyBox = {};
vm.createContext(readyBox);
vm.runInContext(`${read('ready-meter.js').replace(/\(function wireReadyMeter\(\)[\s\S]*$/, '')}\nthis.__order = READY_DEFAULT_ORDER;`, readyBox);
const order = [...readyBox.__order];
check('ownerSegments: exactly 16 keys', segKeys.length === 16 && new Set(segKeys).size === 16, JSON.stringify(segKeys));
check('ownerSegments: the same keys as READY_DEFAULT_ORDER', JSON.stringify([...segKeys].sort()) === JSON.stringify([...order].sort()), `${segKeys} vs ${order}`);
check('READY_DEFAULT_ORDER exact (16)', order.join() === 'video,opinions,agent_view,address,edit,then_now,disclosures,listing_ready,timing,previews,interviews,showings,visit_feedback,decision_night,proposals,binder');
check('new tool keys are never promoted by a topic', !/READY_PROMOTED = \{[\s\S]*?(then_now|visit_feedback|binder)[\s\S]*?\};/.test(read('ready-meter.js')));

// ---- Global names: no top-level name declared twice across a page's scripts ----
// Top-level declarations start at column 0 in this codebase (function, async function, const, let, var, class).
function topNames(src) {
  const names = [];
  for (const m of src.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1] || m[2]);
  for (const m of src.matchAll(/^(?:const|let|var)\s+\{([^}]*)\}\s*=/gm)) names.push(...m[1].split(',').map(s => s.split(':').pop().trim()).filter(Boolean));
  return names;
}
for (const page of ['app.html', 'demo.html', 'admin-seed.html']) {
  const scripts = localScripts(read(page)).filter(exists);
  const seen = new Map();
  const dupes = [];
  for (const s of scripts) for (const n of topNames(read(s))) { if (seen.has(n) && seen.get(n) !== s) dupes.push(`${n} (${seen.get(n)} + ${s})`); else seen.set(n, s); }
  check(`${page}: no top-level name declared in two of its scripts`, dupes.length === 0, dupes.join('; '));
  // And they really run together in one global scope (catches a duplicate const/let the scan missed).
  const box = { console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, clearTimeout() {}, URLSearchParams, navigator: { userAgent: 'node' } };
  const stubEl = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stubEl()), apply: () => stubEl(), construct: () => stubEl() });
  box.window = box; box.document = stubEl(); box.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; box.location = { href: '', search: '', pathname: '/', hash: '', origin: 'https://amicohaus.com' };
  box.fetch = async () => ({ ok: true, json: async () => ({}) }); box.matchMedia = () => ({ matches: false, addEventListener() {} }); box.addEventListener = () => {};
  vm.createContext(box);
  let err = '';
  for (const s of scripts) { try { vm.runInContext(read(s), box, { filename: s }); } catch (e) { if (e instanceof SyntaxError || /already been declared/.test(e.message)) { err = `${s}: ${e.message}`; break; } } }
  check(`${page}: its scripts load together with no redeclaration`, !err, err);
}

// ---- styles.css: every §4.10 class, all before the last phone block ----
const css = read('styles.css');
const CLASSES = ['moment-actions', 'moment-story', 'moment-slide-toggles', 'moment-consent', 'moment-overlay', 'moment-stage', 'moment-card', 'moment-card-flipped', 'moment-letter',
  'moment-caption', 'moment-final', 'moment-controls', 'moment-sample',
  'sweep-overlay', 'sweep-canvas', 'sweep-tools', 'sweep-tool-active', 'sweep-thumbs', 'sweep-thumb', 'sweep-check', 'sweep-chip', 'sweep-note', 'then-now-panel',
  'tn-pair', 'tn-slider', 'tn-img', 'tn-now', 'tn-range', 'upgrade-list', 'upgrade-row', 'permit-note', 'owner-reported',
  'visit-feedback-panel', 'vf-card', 'vf-taps', 'vf-tap', 'binder-panel', 'binder-form', 'binder-banner', 'binder-print', 'binder-section', 'binder-photos',
  'mystery-page', 'mystery-photos', 'mystery-facts', 'mystery-guess', 'mystery-reveal', 'mystery-game-note', 'mystery-archive', 'watch-page', 'watch-cover',
  'watch-links', 'watch-transcript', 'watch-cta', 'watch-nav', 'watch-hub', 'admin-mystery'];
const lastPhone = css.lastIndexOf('@media (max-width: 720px)');
const blockStart = css.indexOf('/* ---- Owner tools batch: Share Your Moment, Privacy Sweep, Then & Now, visit feedback, binder, Mystery Home, watch pages ---- */');
check('styles.css: the owner tools block comment, before the last phone block', blockStart > 0 && blockStart < lastPhone);
for (const cls of CLASSES) {
  const re = new RegExp(`\\.${cls}(?![\\w-])`);
  const at = css.search(re);
  check(`styles.css has .${cls} before the last phone block`, at > 0 && at < lastPhone);
}
check('styles.css: the last block is the phone block (nothing after it)', /\n\}\s*$/.test(css.slice(lastPhone)) && css.slice(lastPhone).split('@media').length === 2);
check('styles.css: Then & Now split + canvas touch rules', css.includes('.tn-now { clip-path: inset(0 0 0 var(--split, 50%)); }') && /\.sweep-canvas \{[^}]*touch-action: none;[^}]*max-width: 100%;[^}]*height: auto;/.test(css));
check('styles.css: the card flip has a reduced-motion fallback', css.includes('@media (prefers-reduced-motion: reduce) { .moment-card { transition: none; } }') && /\.moment-card-flipped \{ transform: rotateY\(180deg\); \}/.test(css));
check('styles.css: overlays sit at z-index 1000', ['moment-overlay', 'sweep-overlay'].every(c => new RegExp(`\\.${c} \\{[^}]*position: fixed;[^}]*z-index: 1000;`).test(css)));

// ---- Copy pages ----
const privacy = read('privacy.html');
const PRIVACY = [
  ' Also, if you use them: your Then &amp; Now upgrade list (with any permit answers) and photo pairs, your handoff binder notes, and which photos you marked "Sweep done."</li>',
  ' If you have a pre-listing, we send one short email on Mondays about activity on your home on Amico Haus; stop it with one click from the email or in your account settings.</p>',
  '<p><strong>Privacy Sweep, Then &amp; Now, visit feedback and your handoff binder.</strong> Privacy Sweep blurs or covers parts of a photo on your device before it uploads, and the swept copy is the only one we receive. Where your browser offers face suggestions, they are worked out on your device and never sent to us. The "Sweep done" mark is shown only to you. Approved agents who can open your pre-listing see your Then &amp; Now list and photo pairs; your permit answers are shown only to you, the agent you hire and agents you shared your contact info with. Agents who visit through an accepted showing or a broker preview can leave three quick answers about the home; only you see them, with the agent\'s name and DRE number, and they are never public or added up across homes. Your handoff binder is saved privately for you to print or save as a PDF; we never send it to anyone or show it to agents. If you tick "Rudy Flores may repost" on a Decision Night moment, we keep the date and the wording you agreed to and Rudy gets a short note; you can take it back anytime.</p>',
  " Your Mystery Home Monday guesses are kept only in your browser's local storage; we never receive them.</p>",
];
PRIVACY.forEach((s, i) => check(`privacy.html: addition ${i + 1} verbatim, once`, privacy.split(s).length === 2));
const sec = (n) => privacy.slice(privacy.indexOf(`<h2>${n}.`), privacy.indexOf(`<h2>${n + 1}.`));
check('privacy.html: each addition in its section (1, 2, 3 after "Timing, check-ins", 8)', sec(1).includes(PRIVACY[0]) && sec(1).includes('<li><strong>Pre-listing information:</strong>') && sec(2).includes(PRIVACY[1])
  && sec(3).includes(PRIVACY[2]) && sec(3).indexOf('<strong>Timing, check-ins and price opinion history.</strong>') < sec(3).indexOf(PRIVACY[2])
  && /price opinion history\.<\/strong>[^\n]*<\/p>\n\s*<p><strong>Privacy Sweep, Then/.test(sec(3)) && sec(8).includes(PRIVACY[3]));
check('privacy.html: date line unchanged', privacy.includes('<p class="section-sub">Last updated November 11, 2026.</p>'));
const whatsNew = read('whats-new.html');
// The home facts batch put its card first; the owner tools card is now the second one (firstCard below).
const firstCard = whatsNew.indexOf('<div class="card about-card">', whatsNew.indexOf('<div class="card about-card">') + 1);
check("whats-new.html: the owner tools card, right after the home facts card", firstCard > 0 && whatsNew.indexOf('<h2>Privacy Sweep, Then &amp; Now, and tools for after you hire</h2>') > firstCard
  && whatsNew.indexOf('<h2>Privacy Sweep, Then &amp; Now, and tools for after you hire</h2>') < whatsNew.indexOf('<div class="card about-card">', firstCard + 10));
check('whats-new.html: the card copy', whatsNew.includes("Show agents what you've done to your home with Then &amp; Now: an old photo next to today's, and a dated list of your upgrades (owner-reported, not a disclosure).")
  && whatsNew.includes('New every Monday: Mystery Home Monday, a guessing game about a home that already sold. Just for fun.') && whatsNew.includes('<p class="tiny"><a href="/signup?as=homeowner">Post a pre-listing →</a></p>'));
const llms = read('llms.txt');
const LLMS = [
  '- **Privacy Sweep**: homeowners can blur or cover private things (faces, family photos, mail, house numbers) on their own device before photos upload; only the swept copy is uploaded.',
  "- **Then & Now**: a homeowner's own before-and-after photos and dated upgrade list, shown to approved agents and labeled owner-reported, not a disclosure.",
  "- **Mystery Home Monday**: a weekly guessing game about a home that already sold, shown with the seller's permission. Guesses stay in the visitor's browser; it is a game, not a price opinion or an appraisal.",
  '- **Video pages**: Amico Haus videos have pages at amicohaus.com/watch with transcripts and links to watch them.',
];
const agentConcepts = llms.slice(llms.indexOf('## Key concepts (Agent Strategy)'), llms.indexOf('## Key concepts (home trading)'));
LLMS.forEach((l, i) => check(`llms.txt: line ${i + 1} under Key concepts (Agent Strategy)`, agentConcepts.split('\n').includes(l)));
check('llms.txt: no verified / vetted / invest / accurate / best / worth', !/verified|vetted|invest|accura|best|worth/i.test(llms), (llms.match(/verified|vetted|invest|accura|best|worth/i) || [])[0]);
check('whats-new + llms: no value / ROI / guarantee wording', !/\bvalue\b|\bROI\b|guarantee|adds value/i.test(LLMS.join(' ') + whatsNew.slice(firstCard, whatsNew.indexOf('</div>', firstCard))));

// ---- CSP over every file the batch touched or created (client-ui-test covers the main client files) ----
const BATCH_FILES = [...new Set([...NEW_FILES.filter(f => !f.startsWith('tools/') && !f.endsWith('.sql')),
  'decision-night.js', 'ready-meter.js', 'seller-prep.js', 'main.js', 'app.html', 'demo.html', 'page-demo.js', 'demo-sample-data.js', 'privacy.html', 'whats-new.html',
  'admin-seed.html', 'page-admin-seed.js', 'account-security.html', 'page-account-security.js', 'functions/_lib/flyerShell.js', 'functions/_lib/shortLinks.js',
  'functions/sitemap.xml.js', 'functions/_lib/marketplace.js', 'functions/_lib/agentDuty.js', 'functions/_lib/marketplaceNotify.js',
  'functions/api/pre-listings/[id]/photos/index.js', 'functions/api/pre-listings/[id]/photos/[photoId].js', 'functions/api/account/delete.js',
  'functions/api/account/export.js', 'functions/api/pre-listings/[id].js', 'functions/api/_middleware.js', 'functions/_lib/preListings.js', 'functions/_lib/rateLimits.js'])].filter(exists);
const INLINE_STYLE = /\sstyle\s*=\s*["'`]/i;
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["'`]/i;
// A <script> tag with a body: anything but src= scripts and the JSON-LD block.
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/i;
for (const f of BATCH_FILES) {
  const src = read(f);
  // Comment lines are prose (e.g. "inline style attributes are not allowed"), not markup.
  const lines = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l));
  check(`${f}: no inline style=""`, !lines.some(l => INLINE_STYLE.test(l)), lines.find(l => INLINE_STYLE.test(l)));
  check(`${f}: no inline on*= handler`, !lines.some(l => INLINE_HANDLER.test(l)), lines.find(l => INLINE_HANDLER.test(l)));
  check(`${f}: no inline <script> body (JSON-LD excepted)`, !lines.some(l => INLINE_SCRIPT.test(l)), lines.find(l => INLINE_SCRIPT.test(l)));
  check(`${f}: no <iframe>`, !/<iframe/i.test(src));
}
const PAGES = ['functions/mystery-home/index.js', 'functions/mystery-home/[slug].js', 'functions/watch/index.js', 'functions/watch/[slug].js',
  'functions/pre-listing/[id]/binder.js', 'functions/api/account/seller-report-unsubscribe.js'];
for (const f of PAGES) check(`${f}: HTML goes out through withSecurityHeaders`, exists(f) && /withSecurityHeaders\(/.test(read(f)), exists(f) ? '' : 'missing');

// ---- The repost OK wording ----
const sm = read('share-moment.js');
const consent = [...sm.matchAll(/^\s+(reveal|hired): '(Rudy Flores may repost[^\n]*)',$/gm)].map(m => [m[1], m[2]]);
check('share-moment.js: both repost OK labels say everyone in the recording is OK with it', consent.length === 2 && consent.every(([, t]) => t.includes('Everyone shown or heard in my recording is OK with that.')), JSON.stringify(consent));
check('share-moment.js: OK labels name the moment and promise removal', consent.some(([k, t]) => k === 'reveal' && t.includes('this Reveal Mode')) && consent.some(([k, t]) => k === 'hired' && t.includes('this Hired! story'))
  && consent.every(([, t]) => t.includes("I can take this back anytime here, and he\\'ll remove his reposts.")));
check('share-moment.js: the repost note says Amico Haus never records the screen', sm.includes('You send him your recording yourself. Amico Haus never records your screen.'));

// ---- No team names in any file the batch touched ----
const NAMES = /McKelvey|Patti|\bJeff\b/i;
const touched = [...new Set([...BATCH_FILES, 'llms.txt', 'styles.css', 'migration_v45.sql', 'schema.sql', 'tools/share-moment-test.mjs'].filter(exists))];
const named = touched.filter(f => NAMES.test(read(f).replace(/tools\/owner-tools-ui-test\.mjs/g, '')));
check('no McKelvey / Patti / Jeff in any file the batch touched', named.length === 0, named.join(', '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
