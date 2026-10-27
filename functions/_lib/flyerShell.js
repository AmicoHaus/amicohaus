// Minimal page shell for a printable one-page listing flyer -- deliberately not the full site chrome
// (nav tabs, auth CTA, footer links) since none of that belongs on a printed handout. The topbar and the
// print button itself are hidden by styles.css's @media print rules when the owner actually prints it.
import { escapeHtml } from './util.js';
import { ASSET_VERSIONS } from './assetVersions.js';

export function renderFlyerShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSIONS['/styles.css']}">
</head>
<body>
<div id="app">
  <header class="topbar flyer-noprint">
    <a class="brand" href="/app">
      <svg viewBox="0 0 48 48" class="logo" aria-hidden="true">
        <path d="M24 4 L44 20 V42 H30 V28 H18 V42 H4 V20 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
      </svg>
      <span class="brand-text">AMICO <span class="accent">HAUS</span></span>
    </a>
    <div class="flyer-actions">
      <button type="button" class="btn btn-primary btn-sm" data-action="print-page">🖨️ Print Flyer</button>
      <a class="btn btn-ghost btn-sm" href="/app">← Back to App</a>
    </div>
  </header>
  <main class="prose flyer-page">
    ${bodyHtml}
  </main>
</div>
<script src="/client.js?v=${ASSET_VERSIONS['/client.js']}"></script>
<!-- Cloudflare Web Analytics -->
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "91a193988b2d45e58aa1c27d5abf6bdb"}'></script>
<!-- End Cloudflare Web Analytics -->
</body>
</html>`;
}
