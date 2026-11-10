// The page shell for public content pages a Function builds (Mystery Home Monday, the /watch video pages). A copy of
// renderShell in functions/listing/[id].js with a static Log In / Sign Up box: these pages never read the session, so
// one cached copy fits every visitor. Rudy's name, DRE # and Coldwell Banker West are on every page (agent strip,
// B&P 10140.6 / 10 CCR 2773), with the tagline and the Equal Housing line in the footer. Scripts: client.js, then each
// `scripts` entry (same-origin files listed in build-dist.js SERVER_RENDERED_ASSETS). No third-party script.
// jsonLd is a ready-made `<script type="application/ld+json">` block (see jsonLdScript), the only inline script allowed.
import { escapeHtml } from './util.js';
import { ASSET_VERSIONS } from './assetVersions.js';

// One JSON-LD block, with every '<' escaped so text inside it can never close the script tag.
export function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function renderPublicShell(title, description, bodyHtml, { jsonLd = '', image = '', url = '', noindex = false, scripts = [] } = {}) {
  const scriptTags = (scripts || []).map(src => `<script src="${escapeHtml(src)}?v=${escapeHtml(ASSET_VERSIONS[src] || 'dev')}"></script>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${noindex ? '<meta name="robots" content="noindex">' : ''}
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
${url ? `<link rel="canonical" href="${escapeHtml(url)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Amico Haus">
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ''}
${url ? `<meta property="og:url" content="${escapeHtml(url)}">` : ''}
${image ? `<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSIONS['/styles.css']}">
${jsonLd}
</head>
<body>
<div id="app">
  <a class="agent-strip" href="/about">Presented by <strong>Rudy Flores</strong> &middot; Coldwell Banker West &middot; DRE #02257808</a>
  <header class="topbar">
    <a class="brand" href="/">
      <svg viewBox="0 0 48 48" class="logo" aria-hidden="true">
        <path d="M24 4 L44 20 V42 H30 V28 H18 V42 H4 V20 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
      </svg>
      <span class="brand-text">AMICO <span class="accent">HAUS</span></span>
    </a>
    <nav class="tabs">
      <a class="tab tab-demo" href="/demo">Demo - Start Here!</a>
      <a class="tab tab-cta tab-cta-post" href="/signup?as=homeowner">Post a Pre-Listing</a>
      <a class="tab tab-cta tab-cta-agent" href="/signup?as=agent">I'm an Agent</a>
      <a class="tab" href="/#how">How it works</a>
      <a class="tab" href="/about">About</a>
    </nav>
    <div class="auth-cta"><a class="btn btn-ghost btn-sm" href="/login">Log In</a> <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a></div>
  </header>
  <main class="prose">
    ${bodyHtml}
  </main>
  <footer class="site-footer">
    <span class="footer-tagline">Amico Haus: the real estate marketplace of tomorrow! Everything that's missing from the real estate market for the homeowner!</span> <a href="/about">About</a> · <a href="/whats-new">What's New</a> · <a href="/calculator">Calculator</a> · <a href="/assumable-loans">Assumable loans</a> · <a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="https://www.instagram.com/amicohaus" target="_blank" rel="noopener noreferrer">Instagram</a> · <a href="https://www.tiktok.com/@amicohaus" target="_blank" rel="noopener noreferrer">TikTok</a> · <a href="https://www.youtube.com/@amicohaus" target="_blank" rel="noopener noreferrer">YouTube</a>
    <p class="footer-legal">Equal Housing Opportunity · <a href="/accessibility">Accessibility</a></p>
  </footer>
</div>
<script src="/client.js?v=${ASSET_VERSIONS['/client.js']}"></script>
${scriptTags}
</body>
</html>`;
}

// The HTML response every public content page sends: never per-viewer, so it may be cached at the edge.
export function publicHtmlResponse(html, { status = 200, maxAge = 60, noindex = false } = {}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
      ...(noindex ? { 'X-Robots-Tag': 'noindex' } : {}),
    },
  });
}
