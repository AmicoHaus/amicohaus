/* Illustrative sample data for the "Agent Strategy" section of /demo.

   The other demo sections read real seeded demo accounts. This one is a
   hand-written walkthrough with FICTIONAL agents instead of database rows on
   purpose: seeded demo agents and pre-listings would show up in the live
   agent directory, marketplace browse list and price estimates that real
   users see. Nothing here touches the database. */

const DEMO_AGENTS = [
  {
    id: 'a1', name: 'Marisol Vega', avatar: '/img/avatar/marisol-vega.svg', brokerage: 'Harbor & Pine Realty', years: 14,
    rating: 4.9, reviews: 23, topRated: true, licenseVerified: true, localSpecialist: true, accepting: true, eo: true,
    respondsHours: 2, winRate: 46, homesSold: 31, daysOnMarket: 21, saleToList: 99,
    specialties: ['Luxury', 'Condo / HOA'], languages: ['English', 'Spanish'], commission: 2.5,
    packages: [
      { tier: 'Basic', days: 3, services: ['Photography', 'MLS + Zillow/Redfin syndication'] },
      { tier: 'Standard', days: 5, services: ['Photography', 'Staging consult', '3D virtual tour'] },
      { tier: 'Premium', days: 2, services: ['Photography', 'Drone photos/video', 'Staging consult', '3D virtual tour', 'Social media ad campaign'] },
    ],
    caseStudies: 3, area: 'San Diego (92101, 92103)',
  },
  {
    id: 'a2', name: 'Devon Brooks', avatar: '/img/avatar/devon-brooks.svg', brokerage: 'Summit Row Homes', years: 6,
    rating: 4.4, reviews: 9, topRated: false, licenseVerified: false, localSpecialist: true, accepting: true, eo: false,
    respondsHours: 6, winRate: 33, homesSold: 12, daysOnMarket: 34, saleToList: 97,
    specialties: ['First-time buyers'], languages: ['English'], commission: 3,
    packages: [
      { tier: 'Basic', days: 4, services: ['Photography', 'MLS + Zillow/Redfin syndication'] },
      { tier: 'Standard', days: 4, services: ['Photography', 'Drone photos/video', 'Sunday open houses'] },
    ],
    caseStudies: 1, area: 'San Diego (92104)',
  },
  {
    id: 'a3', name: 'Priya Nair', avatar: '/img/avatar/priya-nair.svg', brokerage: 'Meridian Coastal Group', years: 9,
    rating: 4.8, reviews: 16, topRated: true, licenseVerified: true, localSpecialist: false, accepting: false, eo: true,
    respondsHours: 3, winRate: 41, homesSold: 24, daysOnMarket: 26, saleToList: 98,
    specialties: ['Relocation', 'Waterfront'], languages: ['English', 'French'], commission: 2,
    packages: [
      { tier: 'Standard', days: 4, services: ['Photography', 'Staging consult', 'Relocation buyer outreach'] },
      { tier: 'Premium', days: 2, services: ['Photography', 'Drone photos/video', '3D virtual tour', 'Social media ad campaign', 'Email blast to buyer list'] },
    ],
    caseStudies: 2, area: 'Coast-wide, about 48 miles across',
  },
  {
    id: 'a4', name: 'Tom Alvarez', avatar: '/img/avatar/tom-alvarez.svg', brokerage: 'Cedar Lane Realty', years: 3,
    rating: null, reviews: 0, topRated: false, licenseVerified: false, localSpecialist: true, accepting: true, eo: false,
    respondsHours: 1, winRate: null, homesSold: 5, daysOnMarket: 41, saleToList: 96,
    specialties: ['New construction'], languages: ['English', 'Vietnamese'], commission: null,
    packages: [
      { tier: 'Basic', days: 6, services: ['Photography'] },
    ],
    caseStudies: 0, area: 'Chula Vista (91910)',
  },
];

const DEMO_STORY = {
  home: {
    poster: 'The homeowner', posterAvatar: '/img/avatar/homeowner.svg',
    title: 'Charming 3bd Craftsman', type: 'Single Family Home', beds: 3, baths: 2, sqft: 1650,
    city: 'San Diego', state: 'CA', neighborhood: 'North Park', zip: '92104', asking: 875000,
    occupancy: 'Occupied', showingNoticeHours: 24,
    instructions: 'Lockbox on the front door — please ring twice, there is a dog.',
    preferences: [
      '8+ years of experience preferred',
      'prefers an agent who speaks Spanish',
      'prefers an agent who specializes in this area, not one covering a huge territory',
    ],
  },
  votes: { tooHigh: 1, justRight: 5, tooLow: 1, nearby: 6 },
  proposals: [
    {
      agent: 'a1', invited: true, status: 'accepted', flat: 950, pct: 2.5, days: 5,
      services: ['Photography', 'Staging consult', '3D virtual tour'],
      message: 'I work this exact pocket of North Park every week. My Standard package covers the photos, a staging walkthrough and a 3D tour in five days, and I will tell you straight if the price needs adjusting.',
    },
    {
      agent: 'a2', invited: false, status: 'declined', flat: 700, pct: 3, days: 4,
      services: ['Photography', 'Drone photos/video'],
      message: 'Happy to take this on. Photos and drone footage in four days, and I can hold open houses on Sundays.',
    },
    {
      agent: 'a4', invited: false, status: 'declined', flat: 199, pct: 3, days: 6,
      services: ['Photography'],
      message: 'Newer agent, so I keep my prep fee low. Photography only, and I will be your one point of contact the whole way.',
    },
  ],
  milestones: [
    { label: 'Deposit sent (off-platform)', done: true },
    { label: 'Work in progress', done: true },
    { label: 'Sign lockbox installed', done: true },
    { label: 'Work completed', done: false },
    { label: 'Final payment sent (off-platform)', done: false },
  ],
  reviews: [
    { from: 'The homeowner', fromAvatar: '/img/avatar/homeowner.svg', about: 'Marisol Vega', rating: 5, text: 'Clear about what she would do and when. The staging advice alone was worth it.' },
    { from: 'Marisol Vega', fromAvatar: '/img/avatar/marisol-vega.svg', about: 'the homeowner', rating: 5, text: 'Responsive, had the house ready on time, and easy to schedule showings around.' },
  ],
};

const DEMO_TRANSACTION = {
  a: { owner: 'Jordan', avatar: '/img/avatar/jordan.svg', type: 'Condo', city: 'San Diego', state: 'CA', value: 640000, seed: 'demo-tx-a' },
  b: { owner: 'Sam', avatar: '/img/avatar/sam.svg', type: 'Townhouse', city: 'Sacramento', state: 'CA', value: 615000, seed: 'demo-tx-b' },
  note: 'We both want this swap. Looking for one agent to coordinate the closing on both sides.',
  proposals: [
    {
      agent: 'a1', status: 'pending', flat: 1500, pct: 1.5, days: 7,
      services: ['Other: closing coordination', 'Photography'],
      message: 'I can coordinate both closings and keep the two of you on the same timeline.',
    },
    {
      agent: 'a2', status: 'pending', flat: 900, pct: 2, days: 10,
      services: ['Other: closing coordination'],
      message: 'Flat coordination fee, and I will check in with both of you weekly until closing.',
    },
  ],
};

/* ---------------- Rendering shared by /demo and the home page ---------------- */
// Needs client.js (escapeHtml, personHeadHtml, avatarHtml, agentDetailsHtml, …)
// loaded first. Kept next to the data so both pages draw a sample agent the
// same way — and the same way real agents are drawn in the app.
// The sample agents feed the same pill layout the live directory uses, so what
// you see here is what real agents look like in the app.
function agentHead(a, aside = '') {
  return personHeadHtml({
    avatar: avatarHtml(a.name, { src: a.avatar, size: 'lg' }),
    nameHtml: `${escapeHtml(a.name)}${a.topRated ? ' <span class="badge badge-gold">🏆 Top Rated</span>' : ''}`,
    sub: a.brokerage,
    chips: [ratingChipHtml(a.rating, a.reviews), chipHtml(`${a.years} yrs experience`, 'outline')],
    aside,
  });
}

function demoAgentInfo(a) {
  return {
    status: [
      { text: a.accepting ? 'Accepting new clients' : 'Not accepting new clients', tone: a.accepting ? 'good' : 'bad' },
      a.localSpecialist && { text: 'Local specialist', tone: 'gold' },
      a.licenseVerified && { text: 'License Verified', tone: 'good' },
      a.eo && { text: 'E&O insured (self-reported)', tone: 'good' },
    ].filter(Boolean),
    stats: [
      { k: 'Replies in', v: `~${a.respondsHours}h` },
      a.winRate !== null && { k: 'Win rate', v: `${a.winRate}%` },
      a.caseStudies > 0 && { k: 'Case studies', v: String(a.caseStudies) },
    ].filter(Boolean),
    selfReported: [
      a.homesSold && { k: 'Sold, last 12 mo', v: String(a.homesSold) },
      a.daysOnMarket && { k: 'On market', v: `~${a.daysOnMarket} days` },
      a.saleToList && { k: 'Sale-to-list', v: `${a.saleToList}%` },
    ].filter(Boolean),
    specialties: a.specialties,
    languages: a.languages.length > 1 ? a.languages : [],
    area: [a.area],
    commission: a.commission !== null ? `${a.commission}%` : 'Flat fee only',
    packages: a.packages.map(p => ({ label: p.tier, turnaroundDays: p.days, services: p.services })),
  };
}

function agentCard(a) {
  return `
    <div class="card demo-agent">
      ${agentHead(a)}
      ${agentDetailsHtml(demoAgentInfo(a))}
      <div class="card-actions"><span class="badge">Sample agent</span></div>
    </div>`;
}
