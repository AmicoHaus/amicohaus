// Dynamic sitemap — replaces the old static sitemap.xml so real active
// listings get included automatically. Demo listings are deliberately
// excluded (@demo.amicohaus.local) since indexing fake "for sale" homes
// would be actively misleading, not just unhelpful.
import { withSecurityHeaders } from './_lib/withSecurityHeaders.js';

const STATIC_URLS = [
  { loc: 'https://amicohaus.com/', freq: 'weekly', priority: '1.0' },
  { loc: 'https://amicohaus.com/demo', freq: 'weekly', priority: '0.9' },
  { loc: 'https://amicohaus.com/calculator', freq: 'monthly', priority: '0.8' },
  { loc: 'https://amicohaus.com/about', freq: 'monthly', priority: '0.7' },
  { loc: 'https://amicohaus.com/whats-new', freq: 'weekly', priority: '0.5' },
  { loc: 'https://amicohaus.com/contact', freq: 'monthly', priority: '0.6' },
  { loc: 'https://amicohaus.com/terms', freq: 'yearly', priority: '0.3' },
  { loc: 'https://amicohaus.com/privacy', freq: 'yearly', priority: '0.3' },
];

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderSitemap(context));
}

async function renderSitemap(context) {
  const db = context.env.DB;

  const listings = await db.prepare(
    `SELECT listings.id FROM listings JOIN users ON users.id = listings.user_id
     WHERE listings.status = 'active' AND users.email NOT LIKE '%@demo.amicohaus.local'
     ORDER BY listings.created_at DESC LIMIT 5000`
  ).all();

  const listingUrls = listings.results.map(l => ({
    loc: `https://amicohaus.com/listing/${l.id}`, freq: 'weekly', priority: '0.6',
  }));

  const augmentedHomes = await db.prepare(
    `SELECT augmented_homes.id FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id
     WHERE augmented_homes.status = 'active' AND users.email NOT LIKE '%@demo.amicohaus.local'
     ORDER BY augmented_homes.created_at DESC LIMIT 5000`
  ).all();
  const augmentedHomeUrls = augmentedHomes.results.map(h => ({
    loc: `https://amicohaus.com/augmented-home/${h.id}`, freq: 'weekly', priority: '0.6',
  }));

  const greenHomes = await db.prepare(
    `SELECT green_homes.id FROM green_homes JOIN users ON users.id = green_homes.user_id
     WHERE green_homes.status = 'active' AND users.email NOT LIKE '%@demo.amicohaus.local'
     ORDER BY green_homes.created_at DESC LIMIT 5000`
  ).all();
  const greenHomeUrls = greenHomes.results.map(h => ({
    loc: `https://amicohaus.com/green-home/${h.id}`, freq: 'weekly', priority: '0.6',
  }));

  const projects = await db.prepare(
    `SELECT dev_projects.id FROM dev_projects JOIN users ON users.id = dev_projects.user_id
     WHERE dev_projects.status = 'open' AND users.email NOT LIKE '%@demo.amicohaus.local'
     ORDER BY dev_projects.created_at DESC LIMIT 5000`
  ).all();
  const projectUrls = projects.results.map(p => ({
    loc: `https://amicohaus.com/project/${p.id}`, freq: 'weekly', priority: '0.5',
  }));

  // Only approved agents, not every signed-up user — an agent's profile is a page they want found (it's their
  // brand, same reasoning a listing gets a public page); a homeowner's generic bio/listings profile isn't
  // actively promoted the same way, even though it stays crawlable if linked to from somewhere.
  const agents = await db.prepare(
    `SELECT agent_profiles.user_id FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = 'approved' AND users.email NOT LIKE '%@demo.amicohaus.local'`
  ).all();
  const agentUrls = agents.results.map(a => ({
    loc: `https://amicohaus.com/profile/${a.user_id}`, freq: 'monthly', priority: '0.5',
  }));

  const all = [...STATIC_URLS, ...listingUrls, ...augmentedHomeUrls, ...greenHomeUrls, ...projectUrls, ...agentUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    all.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
