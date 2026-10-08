import { getSessionUser } from '../_lib/auth.js';
import { escapeHtml } from '../_lib/util.js';
import { ASSET_VERSIONS } from '../_lib/assetVersions.js';
import { withSecurityHeaders } from '../_lib/withSecurityHeaders.js';
import { PROJECT_TYPE_LABELS, PROJECT_STAGE_LABELS } from '../_lib/devProjects.js';
import { ADAPTATION_ITEMS } from '../_lib/adaptations.js';
import { GREEN_FEATURE_ITEMS } from '../_lib/greenFeatures.js';

const ADAPTATION_LABELS = Object.fromEntries(ADAPTATION_ITEMS.map(i => [i.key, i.label]));
const GREEN_FEATURE_LABELS = Object.fromEntries(GREEN_FEATURE_ITEMS.map(i => [i.key, i.label]));

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

function notFoundPage() {
  return new Response(renderShell('Project Not Found — Amico Haus', '', `
    <div class="empty-state">This project doesn't exist or is no longer open.</div>
    <div class="form-actions"><a class="btn btn-primary" href="/signup">Create Your Own Profile</a></div>
  `), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function renderShell(title, description, bodyHtml, authCta) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ''}
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
      <a class="tab" href="/#how">How it works</a>
      <a class="tab" href="/#directory">Live listings</a>
      <a class="tab" href="/about">About</a>
    </nav>
    <div class="auth-cta">${authCta || '<a class="btn btn-ghost btn-sm" href="/login">Log In</a> <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a>'}</div>
  </header>
  <main class="prose">
    ${bodyHtml}
  </main>
  <footer class="site-footer">
    Amico Haus — where homeowners and vetted agents find each other. <a href="/about">About</a> · <a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
  </footer>
</div>
<script src="/client.js?v=${ASSET_VERSIONS['/client.js']}"></script>
</body>
</html>`;
}

export async function onRequestGet(context) {
  return withSecurityHeaders(await renderPage(context));
}

async function renderPage(context) {
  const id = Number(context.params.id);
  if (!Number.isFinite(id)) return notFoundPage();

  const db = context.env.DB;
  const project = await db.prepare(
    `SELECT dev_projects.*, users.id AS owner_id, users.display_name AS owner_name, users.phone AS owner_phone,
            users.is_verified AS owner_verified,
            (SELECT id FROM dev_project_photos WHERE dev_project_photos.dev_project_id = dev_projects.id ORDER BY position ASC LIMIT 1) AS photo_id,
            (SELECT COUNT(*) FROM dev_project_interests WHERE dev_project_interests.dev_project_id = dev_projects.id) AS interest_count
     FROM dev_projects JOIN users ON users.id = dev_projects.user_id
     WHERE dev_projects.id = ? AND dev_projects.status = 'open'`
  ).bind(id).first();
  if (!project) return notFoundPage();

  const viewer = await getSessionUser(context);
  const adaptations = JSON.parse(project.adaptations_json || '[]');
  const greenFeatures = JSON.parse(project.green_features_json || '[]');

  const loc = `${project.neighborhood ? escapeHtml(project.neighborhood) + ', ' : ''}${escapeHtml(project.city)}, ${escapeHtml(project.state)}`;
  const title = `${project.title} — FinderMine on Amico Haus`;
  const description = `${PROJECT_TYPE_LABELS[project.project_type] || project.project_type} · ${PROJECT_STAGE_LABELS[project.stage] || project.stage} in ${project.city}, ${project.state}.${project.funding_goal ? ` ${money(project.funding_goal)} funding sought.` : ''} Posted on FinderMine.`;

  const authCta = viewer
    ? `<span class="tiny">Hi, ${escapeHtml(viewer.display_name)}</span> <a class="btn btn-primary btn-sm" href="/app#findermine">Go to App</a>`
    : null;

  const body = `
    <div class="card">
      <img class="directory-thumb" src="${project.photo_id ? `/api/dev-project-photos/${project.photo_id}` : '/favicon.svg'}" alt="">
      <div class="card-head">
        <div>
          <h1>${escapeHtml(project.title)}</h1>
          <div class="card-agent">Posted by <a class="profile-link" href="/profile/${project.owner_id}">${escapeHtml(project.owner_name)}</a>${project.owner_verified ? ' <span class="badge badge-verified" title="Verified by Amico Haus">✓ Verified</span>' : ''}</div>
        </div>
        <span class="badge badge-gold">FinderMine</span>
      </div>

      <div class="mini-block">
        <span class="label">Project</span>
        ${escapeHtml(PROJECT_TYPE_LABELS[project.project_type] || project.project_type)} · ${escapeHtml(PROJECT_STAGE_LABELS[project.stage] || project.stage)} in ${loc}
      </div>
      <div class="mini-two">
        <div class="mini-block"><span class="label">Funding sought</span>${project.funding_goal ? money(project.funding_goal) : 'Not set'}</div>
        <div class="mini-block"><span class="label">Min. investment</span>${project.min_investment ? money(project.min_investment) : 'Not set'}</div>
      </div>
      <div class="mini-two">
        <div class="mini-block"><span class="label">Target return</span>${escapeHtml(project.target_return) || 'Not stated'}</div>
        <div class="mini-block"><span class="label">Timeline</span>${project.timeline_months ? `${project.timeline_months} months` : 'Not stated'}</div>
      </div>

      ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ''}
      ${adaptations.length ? `<h3>Built For</h3><p class="tiny">${adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(ADAPTATION_LABELS[k] || k)}</span>`).join(' ')}</p>` : ''}
      ${greenFeatures.length ? `<h3>Green Features</h3><p class="tiny">${greenFeatures.map(k => `<span class="badge badge-gold">${escapeHtml(GREEN_FEATURE_LABELS[k] || k)}</span>`).join(' ')}</p>` : ''}
      <p class="tiny">${project.interest_count} investor${project.interest_count === 1 ? '' : 's'} interested</p>
      <p class="form-note">FinderMine is for discovering and discussing projects only. No funds, equity, or investments are tracked or transacted through Amico Haus. Nothing posted here is an offer to sell securities or a solicitation to invest.</p>
    </div>

    <div class="card about-card">
      <h2>Contact ${escapeHtml(project.owner_name)}</h2>
      ${project.owner_phone
        ? `<p>Call or text: <a href="tel:${escapeHtml(project.owner_phone.replace(/[^0-9+]/g, ''))}"><strong>${escapeHtml(project.owner_phone)}</strong></a></p>`
        : `<p class="tiny">No phone on file — sign up to message ${escapeHtml(project.owner_name)} directly through Amico Haus.</p>`}
      <div class="card-actions">
        <a class="btn btn-primary btn-sm" href="/profile/${project.owner_id}">View Full Profile</a>
      </div>
    </div>

    <div class="form-actions">
      <a class="btn btn-primary" href="/signup">Create Your Own Profile to Connect</a>
      <a class="btn btn-ghost" href="/app#findermine">← Back to FinderMine</a>
    </div>
  `;

  return new Response(renderShell(title, description, body, authCta), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
