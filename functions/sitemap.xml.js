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

  const all = [...STATIC_URLS, ...listingUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    all.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
