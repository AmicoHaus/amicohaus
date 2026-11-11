// Assembles ./dist — the only folder that gets published — so that source
// files which happen to live next to the site never end up downloadable.
// Before this existed the deploy uploaded the whole project folder, which put
// schema.sql, every migration, wrangler.toml and an old source zip on the
// public site.
//
// Deploy with:   node build-dist.js && npx wrangler pages deploy dist --project-name=amicohaus --branch=main --commit-dirty=true
// (run from this folder, so wrangler still finds ./functions and wrangler.toml)
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');

// Never published, by name or by extension.
const SKIP_NAMES = new Set([
  'dist', 'functions', 'tools', 'node_modules', '.wrangler', '.git', '.claude', 'property-art', 'Press',
  'wrangler.toml', 'build-dist.js', 'package.json', 'package-lock.json',
]);
const SKIP_EXTS = new Set(['.sql', '.zip', '.md', '.log']);

// Applies the same name/extension rules at every depth, not just the project root — a subdirectory that isn't
// itself skipped (e.g. a new folder someone drops in later) used to have its entire contents copied unfiltered,
// extension rules and all, because this recursion never re-checked them. That's how a non-public folder
// (`Press/`, full of outreach drafts) ended up in a build once; this closes that gap for good, not just for Press.
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const ext = path.extname(entry.name).toLowerCase();
    if (SKIP_NAMES.has(entry.name) || (!entry.isDirectory() && SKIP_EXTS.has(ext))) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const copied = [];
const skipped = [];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  const ext = path.extname(entry.name).toLowerCase();
  if (SKIP_NAMES.has(entry.name) || (!entry.isDirectory() && SKIP_EXTS.has(ext))) {
    skipped.push(entry.name);
    continue;
  }
  const from = path.join(ROOT, entry.name);
  const to = path.join(OUT, entry.name);
  if (entry.isDirectory()) copyTree(from, to);
  else fs.copyFileSync(from, to);
  copied.push(entry.name);
}

// Cloudflare's zone-level Browser Cache TTL stamps every JS/CSS file with a
// 4-hour max-age no matter what _headers says, so a visitor could load fresh
// HTML (never cached) but a stale script for hours after a deploy — the page
// then looks up element ids the old script has never heard of and crashes.
// Tagging each reference with a hash of the file's contents gives a changed
// file a new URL (fetched fresh) while an unchanged one keeps its cached copy.
// Every .html under dist/, at any depth (the Spanish pages live in es/). Their asset links start with "/", so they
// resolve from dist/ the same as the top-level pages' relative ones.
function htmlFilesUnder(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlFilesUnder(full));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

// Spanish hold (functions/_lib/spanishLive.js): while SPANISH_LIVE is false the Spanish pages are not published, and the
// English pages lose their Español tab, hreflang tags and "now in Spanish" lines. The source files keep all of it,
// so flipping the switch and rebuilding is the whole release.
const SPANISH_LIVE = /export const SPANISH_LIVE = true;/.test(fs.readFileSync(path.join(ROOT, 'functions', '_lib', 'spanishLive.js'), 'utf8'));
if (!SPANISH_LIVE) {
  fs.rmSync(path.join(OUT, 'es'), { recursive: true, force: true });
  let stripped = 0;
  for (const file of htmlFilesUnder(OUT)) {
    const html = fs.readFileSync(file, 'utf8');
    const next = html
      .replace(/^[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*">\r?\n/gm, '')
      .replace(/^[ \t]*<a class="tab tab-lang"[^>]*>Español<\/a>\r?\n/gm, '')
      .replace(/^[ \t]*<nav class="tabs">\s*<\/nav>\r?\n/gm, '')
      .replace(/^[ \t]*<li>Key pages are now in Spanish:.*<\/li>\r?\n/gm, '')
      .replace('<h2>Home facts, Spanish pages and your open-house plan</h2>', '<h2>Home facts and your open-house plan</h2>');
    if (next !== html) { fs.writeFileSync(file, next); stripped++; }
  }
  const llms = path.join(OUT, 'llms.txt');
  if (fs.existsSync(llms)) fs.writeFileSync(llms, fs.readFileSync(llms, 'utf8').replace(/^- Spanish pages:.*\r?\n/m, ''));
  const left = htmlFilesUnder(OUT).filter(file => /href="\/es\/|hreflang="es"/.test(fs.readFileSync(file, 'utf8')));
  if (left.length) { console.error('Spanish hold: these published pages still link to /es/: ' + left.map(x => path.relative(OUT, x)).join(', ')); process.exit(1); }
  console.log(`Spanish hold: es/ left out, Spanish links stripped from ${stripped} pages`);
}

const crypto = require('crypto');
let stamped = 0;
for (const file of htmlFilesUnder(OUT)) {
  const name = path.relative(OUT, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  const next = html.replace(/\b(src|href)="((?!https?:|\/\/)[^"?#]+\.(?:js|css))"/g, (match, attr, ref) => {
    const asset = path.join(OUT, ref.replace(/^\//, ''));
    if (!fs.existsSync(asset)) { console.warn(`  ! ${name}: ${ref} not found, left unversioned`); return match; }
    const hash = crypto.createHash('sha1').update(fs.readFileSync(asset)).digest('hex').slice(0, 8);
    stamped++;
    return `${attr}="${ref}?v=${hash}"`;
  });
  if (next !== html) fs.writeFileSync(file, next);
}

// Server-rendered pages (functions/listing/[id].js) never pass through the
// loop above, so give them the same hashes through a generated module — wrangler
// bundles ./functions after this script runs.
const SERVER_RENDERED_ASSETS = ['/styles.css', '/client.js', '/listing-actions.js', '/profile-actions.js', '/report-actions.js', '/mystery-home.js'];
const versionLines = SERVER_RENDERED_ASSETS.map(ref => {
  const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, ref.slice(1)))).digest('hex').slice(0, 8);
  return `  '${ref}': '${hash}',`;
});
fs.writeFileSync(path.join(ROOT, 'functions', '_lib', 'assetVersions.js'), [
  "// Generated by build-dist.js on every build — don't edit by hand.",
  "// Server-rendered pages use these to link the same content-hashed URLs the",
  "// static pages get, so a deploy never leaves them on a stale stylesheet.",
  'export const ASSET_VERSIONS = {',
  ...versionLines,
  '};',
  '',
].join('\n'));

// The _headers file only reaches static files, so pages and API answers that a
// Function builds get the same security headers from this generated module
// (see functions/_lib/withSecurityHeaders.js).
{
  const headerLines = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split(/\r?\n/);
  const headers = {};
  let inGlobalBlock = false;
  for (const line of headerLines) {
    if (/^\/\*\s*$/.test(line)) { inGlobalBlock = true; continue; }
    if (inGlobalBlock && /^\S/.test(line) && !line.startsWith('#')) break;       // next path block
    const m = inGlobalBlock && /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (m && m[1].toLowerCase() !== 'cache-control') headers[m[1]] = m[2].trim();
  }
  if (!headers['Content-Security-Policy']) { console.error('build-dist: no Content-Security-Policy found in the /* block of _headers'); process.exit(1); }
  fs.writeFileSync(path.join(ROOT, 'functions', '_lib', 'securityHeaders.js'), [
    "// Generated by build-dist.js from _headers on every build — don't edit by hand.",
    'export const SECURITY_HEADERS = ' + JSON.stringify(headers, null, 2) + ';',
    '',
  ].join('\n'));
}

console.log(`dist: ${copied.length} entries published, ${stamped} asset references versioned`);
console.log(`skipped (not public): ${skipped.join(', ')}`);
