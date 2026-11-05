import { getSessionUser, phoneVisibleTo } from '../_lib/auth.js';
import { identityLine } from '../_lib/contactPolicy.js';
import { escapeHtml, DEMO_EMAIL_PATTERN } from '../_lib/util.js';
import { ASSET_VERSIONS } from '../_lib/assetVersions.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { PROJECT_TYPE_LABELS, PROJECT_STAGE_LABELS } from '../_lib/devProjects.js';
import { ADAPTATION_ITEMS } from '../_lib/adaptations.js';
import { GREEN_FEATURE_ITEMS } from '../_lib/greenFeatures.js';

// A FinderMine project page (Rudy 11.04): projects looking for a builder, partner or co-buyer. Sign-in only and
// never indexed (no sitemap entry, noindex), with no investment terms: no funding amount, minimum investment, target
// return, investor count or "Fully Funded". People reach the poster through Amico Haus messages.
const ADAPTATION_LABELS = Object.fromEntries(ADAPTATION_ITEMS.map(i => [i.key, i.label]));
const GREEN_FEATURE_LABELS = Object.fromEntries(GREEN_FEATURE_ITEMS.map(i => [i.key, i.label]));
const NOINDEX = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' };

function notFoundPage() {
  return new Response(renderShell('Project Not Found — Amico Haus', `
    <div class="empty-state">This project doesn't exist or is no longer open.</div>
    <div class="form-actions"><a class="btn btn-ghost" href="/app#findermine">← Back to FinderMine</a></div>
  `), { status: 404, headers: NOINDEX });
}

function signInPage() {
  return new Response(renderShell('FinderMine project — Amico Haus', `
    <h1>FinderMine project</h1>
    <p class="section-sub">FinderMine projects are open to Amico Haus members. Log in or create a free account to see this one and message the poster.</p>
    <div class="form-actions">
      <a class="btn btn-primary" href="/login">Log In</a>
      <a class="btn btn-ghost" href="/signup">Sign Up</a>
    </div>
  `), { status: 200, headers: NOINDEX });
}

function renderShell(title, bodyHtml, authCta) {
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
    <div class="auth-cta">${authCta || '<a class="btn btn-ghost btn-sm" href="/login">Log In</a> <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a>'}</div>
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
<!-- Cloudflare Web Analytics -->
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "91a193988b2d45e58aa1c27d5abf6bdb"}'></script>
<!-- End Cloudflare Web Analytics -->
</body>
</html>`;
}

// Other open projects in the same city or of the same type (never demo accounts, never this one). No amounts.
async function fetchOtherProjects(db, project) {
  const rows = await db.prepare(
    `SELECT dev_projects.id, dev_projects.title, dev_projects.project_type, dev_projects.city, dev_projects.state
     FROM dev_projects JOIN users ON users.id = dev_projects.user_id
     WHERE dev_projects.status = 'open' AND dev_projects.id != ?1 AND users.status = 'active' AND users.email NOT LIKE ?2
       AND (LOWER(dev_projects.city) = LOWER(?3) OR dev_projects.project_type = ?4)
     ORDER BY CASE WHEN LOWER(dev_projects.city) = LOWER(?3) THEN 0 ELSE 1 END, dev_projects.created_at DESC LIMIT 4`
  ).bind(project.id, DEMO_EMAIL_PATTERN, project.city || '', project.project_type || '').all();
  return rows.results;
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderPage(context));
}

async function renderPage(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFoundPage();

  const viewer = await getSessionUser(context);
  if (!viewer) return signInPage();

  const db = context.env.DB;
  const project = await db.prepare(
    `SELECT dev_projects.*, users.id AS owner_id, users.display_name AS owner_name, users.phone AS owner_phone,
            users.phone_public AS owner_phone_public,
            owner_agent.license_number AS owner_license, owner_agent.brokerage_name AS owner_brokerage,
            (SELECT id FROM dev_project_photos WHERE dev_project_photos.dev_project_id = dev_projects.id ORDER BY position ASC LIMIT 1) AS photo_id
     FROM dev_projects JOIN users ON users.id = dev_projects.user_id
     LEFT JOIN agent_profiles AS owner_agent ON owner_agent.user_id = users.id AND owner_agent.status = 'approved'
     WHERE dev_projects.id = ? AND dev_projects.status = 'open' AND users.status = 'active'`
  ).bind(id).first();
  if (!project) return notFoundPage();

  // The owner's phone is private unless they turned on "Show my phone number" (or shared their contact with this
  // agent); otherwise visitors reach them through Amico Haus messages.
  const ownerPhone = await phoneVisibleTo(db, viewer, { id: project.owner_id, phone: project.owner_phone, phone_public: project.owner_phone_public });
  // An approved agent who posted this (e.g. for a client) carries their DRE identity line at this point of contact
  // (California rule): "Name · DRE #01234567 · Brokerage". Homeowners and buyers keep the plain name.
  const ownerLicense = String(project.owner_license || '').trim();
  const ownerBrokerage = String(project.owner_brokerage || '').trim();
  const ownerIdentity = ownerLicense || ownerBrokerage ? identityLine({ name: project.owner_name, licenseNumber: ownerLicense, brokerageName: ownerBrokerage }, { onFile: true }) : '';
  const adaptations = JSON.parse(project.adaptations_json || '[]');
  const greenFeatures = JSON.parse(project.green_features_json || '[]');
  const others = await fetchOtherProjects(db, project);

  const typeLabel = PROJECT_TYPE_LABELS[project.project_type] || project.project_type;
  // "Fully Funded" is no longer a stage; an older project saved with it simply shows no stage.
  const stageLabel = project.stage === 'funded' ? '' : (PROJECT_STAGE_LABELS[project.stage] || project.stage);
  const loc = `${project.neighborhood ? escapeHtml(project.neighborhood) + ', ' : ''}${escapeHtml(project.city)}, ${escapeHtml(project.state)}`;
  const title = `${project.title} — FinderMine on Amico Haus`;
  const authCta = `<span class="tiny">Hi, ${escapeHtml(viewer.display_name)}</span> <a class="btn btn-primary btn-sm" href="/app#findermine">Go to App</a>`;

  const body = `
    <div id="entityMeta" class="hidden" data-kind="dev_project" data-id="${id}" data-title="${escapeHtml(project.title)}" data-amount="" data-city="${escapeHtml(project.city)}" data-state="${escapeHtml(project.state)}"></div>
    <div class="card">
      <img class="directory-thumb" src="${project.photo_id ? `/api/dev-project-photos/${project.photo_id}` : '/favicon.svg'}" alt="${project.photo_id ? `Photo of the ${escapeHtml(typeLabel)} project in ${escapeHtml(project.city)}` : ''}">
      <div class="card-head">
        <div>
          <h1>${escapeHtml(project.title)}</h1>
          <div class="card-agent">Posted by <a class="profile-link" href="/profile/${project.owner_id}">${escapeHtml(ownerIdentity || project.owner_name)}</a></div>
        </div>
        <span class="badge badge-gold">FinderMine</span>
      </div>

      <div class="mini-block">
        <span class="label">Project</span>
        ${escapeHtml(typeLabel)}${stageLabel ? ` · ${escapeHtml(stageLabel)}` : ''} in ${loc}
      </div>
      <div class="mini-block"><span class="label">Timeline (from the poster)</span>${project.timeline_months ? `${project.timeline_months} months` : 'Not stated'}</div>

      ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ''}
      ${adaptations.length ? `<h3>Built For</h3><p class="tiny">${adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(ADAPTATION_LABELS[k] || k)}</span>`).join(' ')}</p>` : ''}
      ${greenFeatures.length ? `<h3>Green Features</h3><p class="tiny">${greenFeatures.map(k => `<span class="badge badge-gold">${escapeHtml(GREEN_FEATURE_LABELS[k] || k)}</span>`).join(' ')}</p>` : ''}
      <p class="form-note">FinderMine is for projects looking for a builder, partner or co-buyer. Reach the poster through Amico Haus messages. No money moves through Amico Haus, Amico Haus doesn't review or take part in any project, and nothing posted here is an offer to sell securities or a solicitation to invest.</p>
    </div>

    ${others.length ? `
    <div class="card about-card">
      <h2>Other Projects Nearby</h2>
      <div class="similar-grid">
        ${others.map(o => `
          <a class="similar-card" href="/project/${o.id}">
            <strong>${escapeHtml(o.title || PROJECT_TYPE_LABELS[o.project_type] || o.project_type)}</strong>
            <span class="tiny">${escapeHtml(o.city)}, ${escapeHtml(o.state)}</span>
          </a>`).join('')}
      </div>
    </div>` : ''}

    <div class="card about-card">
      <h2>Contact ${escapeHtml(project.owner_name)}</h2>
      ${ownerIdentity ? `<p class="tiny">${escapeHtml(ownerIdentity)}</p>` : ''}
      ${ownerPhone
        ? `<p>Call or text: <a href="tel:${escapeHtml(ownerPhone.replace(/[^0-9+]/g, ''))}"><strong>${escapeHtml(ownerPhone)}</strong></a></p>`
        : `<p class="tiny">Message ${escapeHtml(project.owner_name)} directly through Amico Haus.</p>`}
      <div class="card-actions">
        <a class="btn btn-primary btn-sm" href="/profile/${project.owner_id}">View Full Profile</a>
      </div>
    </div>

    <div class="card about-card recently-viewed-strip hidden" id="recentlyViewedStrip"></div>

    <div class="form-actions">
      <a class="btn btn-ghost" href="/app#findermine">← Back to FinderMine</a>
    </div>
  `;

  return new Response(renderShell(title, body, authCta), { headers: NOINDEX });
}
