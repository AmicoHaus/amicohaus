// Dynamic sitemap — replaces the old static sitemap.xml so real active
// listings get included automatically. Demo listings are deliberately
// excluded (@demo.amicohaus.local) since indexing fake "for sale" homes
// would be actively misleading, not just unhelpful. A suspended account's pages
// return 404, so they're left out too. FinderMine project pages (/project/:id)
// are sign-in only and noindex, so they're never listed here. Unlisted owners (unlistedOwnerSql in _lib/util.js:
// the @resend.dev authz test accounts and the Google Play reviewer's sample listing) are left out too; their
// pages still open by direct link but carry noindex.
import { withSecurityHeaders } from './_lib/withSecurityHeaders.js';
import { unlistedOwnerSql } from './_lib/util.js';
import { VIDEO_TWINS } from './_lib/videoTwins.js';

const STATIC_URLS = [
  { loc: 'https://amicohaus.com/', freq: 'weekly', priority: '1.0' },
  { loc: 'https://amicohaus.com/demo', freq: 'weekly', priority: '0.9' },
  { loc: 'https://amicohaus.com/calculator', freq: 'monthly', priority: '0.8' },
  { loc: 'https://amicohaus.com/about', freq: 'monthly', priority: '0.7' },
  { loc: 'https://amicohaus.com/assumable-loans', freq: 'monthly', priority: '0.7' },
  { loc: 'https://amicohaus.com/sell-or-buy-first', freq: 'monthly', priority: '0.7' },
  { loc: 'https://amicohaus.com/unlock-your-zip', freq: 'daily', priority: '0.8' },
  { loc: 'https://amicohaus.com/for-agents', freq: 'monthly', priority: '0.8' },
  { loc: 'https://amicohaus.com/whats-new', freq: 'weekly', priority: '0.5' },
  { loc: 'https://amicohaus.com/mystery-home', freq: 'weekly', priority: '0.5' },
  { loc: 'https://amicohaus.com/watch', freq: 'weekly', priority: '0.6' },
  { loc: 'https://amicohaus.com/contact', freq: 'monthly', priority: '0.6' },
  { loc: 'https://amicohaus.com/terms', freq: 'yearly', priority: '0.3' },
  { loc: 'https://amicohaus.com/privacy', freq: 'yearly', priority: '0.3' },
  { loc: 'https://amicohaus.com/accessibility', freq: 'yearly', priority: '0.3' },
];

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderSitemap(context));
}

async function renderSitemap(context) {
  const db = context.env.DB;

  const listings = await db.prepare(
    `SELECT listings.id FROM listings JOIN users ON users.id = listings.user_id
     WHERE listings.status = 'active' AND users.email NOT LIKE '%@demo.amicohaus.local' AND users.status = 'active'
       AND NOT ${unlistedOwnerSql('users.email')}
     ORDER BY listings.created_at DESC LIMIT 5000`
  ).all();

  const listingUrls = listings.results.map(l => ({
    loc: `https://amicohaus.com/listing/${l.id}`, freq: 'weekly', priority: '0.6',
  }));

  const augmentedHomes = await db.prepare(
    `SELECT augmented_homes.id FROM augmented_homes JOIN users ON users.id = augmented_homes.user_id
     WHERE augmented_homes.status = 'active' AND users.email NOT LIKE '%@demo.amicohaus.local' AND users.status = 'active'
       AND NOT ${unlistedOwnerSql('users.email')}
     ORDER BY augmented_homes.created_at DESC LIMIT 5000`
  ).all();
  const augmentedHomeUrls = augmentedHomes.results.map(h => ({
    loc: `https://amicohaus.com/augmented-home/${h.id}`, freq: 'weekly', priority: '0.6',
  }));

  const greenHomes = await db.prepare(
    `SELECT green_homes.id FROM green_homes JOIN users ON users.id = green_homes.user_id
     WHERE green_homes.status = 'active' AND users.email NOT LIKE '%@demo.amicohaus.local' AND users.status = 'active'
       AND NOT ${unlistedOwnerSql('users.email')}
     ORDER BY green_homes.created_at DESC LIMIT 5000`
  ).all();
  const greenHomeUrls = greenHomes.results.map(h => ({
    loc: `https://amicohaus.com/green-home/${h.id}`, freq: 'weekly', priority: '0.6',
  }));

  // Only approved agents, not every signed-up user — an agent's profile is a page they want found (it's their
  // brand, same reasoning a listing gets a public page); a homeowner's generic bio/listings profile isn't
  // actively promoted the same way, even though it stays crawlable if linked to from somewhere.
  const agents = await db.prepare(
    `SELECT agent_profiles.user_id FROM agent_profiles JOIN users ON users.id = agent_profiles.user_id
     WHERE agent_profiles.status = 'approved' AND users.email NOT LIKE '%@demo.amicohaus.local' AND users.status = 'active'
       AND NOT ${unlistedOwnerSql('users.email')}`
  ).all();
  const agentUrls = agents.results.map(a => ({
    loc: `https://amicohaus.com/profile/${a.user_id}`, freq: 'monthly', priority: '0.5',
  }));

  // Mystery Home Monday: homes that are live or revealed and not retired (ISO times, compared with an ISO now).
  // Drafts, homes not yet published and retired homes are left out (their pages are 404s).
  const nowIso = new Date().toISOString();
  const mysteryHomes = await db.prepare(
    `SELECT slug FROM mystery_homes WHERE status = 'scheduled' AND publish_at <= ?1 AND (retire_at IS NULL OR retire_at > ?1)
     ORDER BY publish_at DESC LIMIT 500`
  ).bind(nowIso).all();
  const mysteryUrls = mysteryHomes.results.map(m => ({
    loc: `https://amicohaus.com/mystery-home/${m.slug}`, freq: 'weekly', priority: '0.5',
  }));

  // Video pages (functions/_lib/videoTwins.js, a static list).
  const watchUrls = VIDEO_TWINS.map(t => ({ loc: `https://amicohaus.com/watch/${t.slug}`, freq: 'monthly', priority: '0.5' }));

  const all = [...STATIC_URLS, ...listingUrls, ...augmentedHomeUrls, ...greenHomeUrls, ...agentUrls, ...mysteryUrls, ...watchUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    all.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
