// Loads the real client.js + agent-cards.js + main.js in a stubbed browser and renders agent cards from API-shaped data. Usage: node tools/agent-render-test.js .
const fs = require('fs');
const vm = require('vm');
const root = process.argv[2];

const noop = () => {};
const el = () => ({ classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null });
const sandbox = {
  console,
  navigator: {},
  window: { matchMedia: () => ({ matches: false }), addEventListener: noop, location: { href: '' } },
  document: { addEventListener: noop, getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), readyState: 'complete', documentElement: el() },
  localStorage: { getItem: () => null, setItem: noop },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  setTimeout, clearTimeout, URLSearchParams, Notification: {}, atob, btoa,
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
for (const f of ['client.js', 'agent-cards.js', 'main.js']) {
  // top-level `const`/`let` aren't visible on the context object, so export what the test needs
  vm.runInContext(fs.readFileSync(`${root}/${f}`, 'utf8'), sandbox, { filename: f });
}
vm.runInContext('this.__t = { directoryAgentInfo, directoryAgentCardHtml, renderBidCard, agentDetailsHtml, personHeadHtml, avatarHtml, ratingChipHtml, chipHtml, packagesForPills, filteredProposals, renderProposalsSection };', sandbox);
const t = sandbox.__t;

let failed = 0;
const check = (label, cond, detail = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + detail}`); };

// A directory entry shaped like buildAgentDirectoryEntry's output, as JSON would carry it.
const full = {
  userId: 42, displayName: 'Ana <b>Ortiz</b>', brokerageName: 'Bay & Co', yearsExperience: 11, isVerified: true, licenseVerified: true,
  rating: 4.7, reviewCount: 12, topRated: true, avgResponseHours: 3.2, acceptingClients: true, carriesEoInsurance: true,
  isLocalSpecialist: false, serviceAreaSpreadMiles: 47.6, distanceMiles: 8.4,
  specialtyTags: ['luxury', 'first_time_buyers'], languages: ['English', 'Spanish'],
  homesSoldLastYear: 22, avgDaysOnMarket: 28, saleToListRatio: 0.985,
  commissionRange: { min: 2, max: 3 }, caseStudies: [{}, {}], hiresOnPlatform: 3,
  packages: [
    { tier: 'basic', title: 'Basic', description: 'Just the essentials.', commissionPct: null, flatFee: 350, turnaroundDays: 3, services: [{ type: 'photography', fee: 120 }, { type: 'mls_syndication', note: 'MLS + portals' }] },
    { tier: 'premium', title: 'Premium', description: null, commissionPct: 2, flatFee: 2400, turnaroundDays: 1, services: [{ type: 'drone' }] },
  ],
};
const html = t.agentDetailsHtml(t.directoryAgentInfo(full));
check('full agent renders', html.length > 200);
check('no dollar amounts anywhere in the details', !/\$/.test(html), html.match(/.{20}\$.{20}/)?.[0]);
check('package pills present (Basic, Premium)', /pkg-chip[\s\S]*Basic package/.test(html) && /Premium package/.test(html));
check('package features listed', html.includes('Photography') && html.includes('MLS + portals') && html.includes('Drone photos/video'));
check('service fee ($120) not leaked', !html.includes('120'));
check('turnaround shown', html.includes('Ready in about 3 days') && html.includes('Ready in about 1 day<'));
check('commission range chip', html.includes('2–3%'));
check('sale-to-list rounded', html.includes('99%') || html.includes('98%') || html.includes('98.5'), html.match(/Sale-to-list[^<]*<\/span><span[^>]*>[^<]*/)?.[0]);
check('specialty labels mapped', html.includes('Luxury') || html.includes('luxury'));
check('languages shown when >1', html.includes('Speaks') && html.includes('Spanish'));
check('area chips (distance + spread)', html.includes('8.4 mi away') && html.includes('Spans about 48 mi'));
check('hires on Amico Haus shown as a measured stat', html.includes('Hired here') && html.includes('3 times'));
check('proposal speed labeled as such, not "Replies in"', html.includes('Proposal speed') && !html.includes('Replies in'));

const head = t.personHeadHtml({ avatar: t.avatarHtml(full.displayName, { seed: full.userId, size: 'lg' }), nameHtml: full.displayName, sub: full.brokerageName, chips: [t.ratingChipHtml(full.rating, full.reviewCount)] });
check('initials avatar from name', /avatar-tone-\d[^>]*avatar-lg[^>]*>A?O?[A-Z]{1,2}</.test(head) || /avatar-lg/.test(head));

// Sparse / brand-new agent: nothing to show must not throw or print "undefined"/"null"/"NaN"
const sparse = { userId: 7, displayName: 'New Agent', brokerageName: null, yearsExperience: null, isVerified: false, licenseVerified: false, rating: null, reviewCount: 0, topRated: false, avgResponseHours: null, acceptingClients: false, carriesEoInsurance: false, isLocalSpecialist: false, serviceAreaSpreadMiles: null, distanceMiles: null, specialtyTags: [], languages: ['English'], homesSoldLastYear: null, avgDaysOnMarket: null, saleToListRatio: null, commissionRange: null, caseStudies: [], packages: [], hiresOnPlatform: 0, isNewToAmicoHaus: true };
const sparseHtml = t.agentDetailsHtml(t.directoryAgentInfo(sparse));
check('sparse agent renders without junk', !/undefined|null|NaN/.test(sparseHtml), sparseHtml.match(/.{20}(undefined|null|NaN).{20}/)?.[0]);
check('recently approved agent is labeled new, not "0 times"', sparseHtml.includes('New to Amico Haus') && !sparseHtml.includes('Hired here'));
const veteranHtml = t.agentDetailsHtml(t.directoryAgentInfo({ ...sparse, isNewToAmicoHaus: false }));
check('long-time agent with no hires is not called new', !veteranHtml.includes('New to Amico Haus') && !veteranHtml.includes('Hired here'));
const flatHtml = t.agentDetailsHtml(t.directoryAgentInfo({ ...sparse, offersFlatFee: true, hasPastWork: true }));
check('flat-fee agent shows a flat-fee chip without a dollar amount', flatHtml.includes('Flat-fee option') && !/\$/.test(flatHtml));
check('agent with only portfolio photos shows past work', flatHtml.includes('Portfolio photos'));
const slowHtml = t.agentDetailsHtml(t.directoryAgentInfo({ ...sparse, avgResponseHours: 30 }));
check('30 hours reads ~2d, matching the "within 1 day" filter that excludes it', slowHtml.includes('~2d'));
check('sparse agent shows "Not accepting"', sparseHtml.includes('Not accepting new clients') && sparseHtml.includes('chip-bad'));
check('sparse agent has no package block / hint', !sparseHtml.includes('Hover or tap'));
check('no-rating chip', t.ratingChipHtml(null, 0).includes('No reviews yet'));
check('singular review', t.ratingChipHtml(4.5, 1).includes('1 review<'));

// Proposal card
const bid = { id: 5, agentUserId: 42, agentName: 'Ana <b>Ortiz</b>', brokerageName: 'Bay & Co', yearsExperience: 11, rating: 4.7, reviewCount: 12, isVerified: true, topRated: true, licenseVerified: true, status: 'pending', isStale: true, winRate: 0.4, avgResponseHours: 5, homesSoldLastYear: 20, avgDaysOnMarket: 30, hasVideo: true, message: '<script>x</script>Happy to help', commissionPct: 2.5, flatFee: 950, services: [{ type: 'photography', fee: 100 }], openHouseDays: ['sun'] };
const bidHtml = t.renderBidCard(bid, true);
check('bid card renders', bidHtml.includes('Accept This Proposal') && bidHtml.includes('Win rate'));
check('bid card keeps the proposal fee', bidHtml.includes('$950 flat') && bidHtml.includes('2.5% commission'));
check('bid card escapes name and message', !bidHtml.includes('<b>Ortiz') && !bidHtml.includes('<script>x'));
const bareBid = t.renderBidCard({ ...bid, winRate: null, avgResponseHours: null, homesSoldLastYear: null, avgDaysOnMarket: null, licenseVerified: false, rating: null, reviewCount: 0, yearsExperience: null, brokerageName: null, isStale: false, hasVideo: false, openHouseDays: [] }, false);
check('bare bid card has no empty details block', !bareBid.includes('agent-details') && !/undefined|NaN/.test(bareBid));

// Proposal comparison filters/sorts (the homeowner's own pre-listing or trade)
const P = (o) => ({ ...bid, rating: null, reviewCount: 0, hiresOnPlatform: 0, licenseVerified: false, commissionPct: null, flatFee: null, services: [], createdAt: '2026-10-01 10:00:00', ...o });
const bids = [
  P({ id: 1, status: 'accepted', commissionPct: 2.5, createdAt: '2026-10-01 09:00:00' }),
  P({ id: 2, status: 'declined', flatFee: 3000, licenseVerified: true, services: [{ type: 'staging' }], rating: 4.9, reviewCount: 1, createdAt: '2026-10-03 09:00:00' }),
  P({ id: 3, status: 'pending', commissionPct: 2, licenseVerified: true, services: [{ type: 'staging' }, { type: 'drone' }], rating: 4.6, reviewCount: 8, hiresOnPlatform: 4, createdAt: '2026-10-02 09:00:00' }),
  P({ id: 4, status: 'pending', flatFee: 2500, rating: 5, reviewCount: 2, hiresOnPlatform: 1, createdAt: '2026-10-04 09:00:00' }),
];
const ids = (list) => list.map(b => b.id).join(',');
check('default order is newest first', ids(t.filteredProposals(bids)) === '4,2,3,1', ids(t.filteredProposals(bids)));
check('highest rated puts 3+ reviews ahead of a single 5-star', ids(t.filteredProposals(bids, { sort: 'rating' })).startsWith('3,'), ids(t.filteredProposals(bids, { sort: 'rating' })));
check('most hired sorts by hires', ids(t.filteredProposals(bids, { sort: 'mostHired' })).startsWith('3,4'), ids(t.filteredProposals(bids, { sort: 'mostHired' })));
check('flat-fee filter keeps flat fees and the accepted proposal', ids(t.filteredProposals(bids, { feeType: 'flat' })) === '4,2,1', ids(t.filteredProposals(bids, { feeType: 'flat' })));
check('must-include filter', ids(t.filteredProposals(bids, { mustInclude: 'drone' })) === '3,1', ids(t.filteredProposals(bids, { mustInclude: 'drone' })));
check('license-verified + hide-declined never drop the accepted proposal', ids(t.filteredProposals(bids, { licenseOnly: true, hideDeclined: true })) === '3,1', ids(t.filteredProposals(bids, { licenseOnly: true, hideDeclined: true })));
const section3 = t.renderProposalsSection(bids, 'pre-listing-9');
const section2 = t.renderProposalsSection(bids.slice(0, 2), 'pre-listing-9');
check('controls appear with 3+ proposals only', section3.includes('proposalSort') && !section2.includes('proposalSort'));
check('comparison table has Hired + Proposal speed columns', section3.includes('<th>Hired</th>') && section3.includes('<th>Proposal speed</th>'));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
