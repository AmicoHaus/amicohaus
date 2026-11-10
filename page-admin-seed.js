/* Amico Haus — admin demo-data generator. Loops the seed endpoint in small
   chunks (rather than one huge request) to stay well under Worker request
   time limits, and shows progress as it goes. */

const CHUNK_SIZE = 200;

const OPEN_HOUSE_DAY_LABELS = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

function log(msg) {
  const el = document.getElementById('progressLog');
  const line = document.createElement('div');
  line.className = 'side';
  line.textContent = msg;
  el.prepend(line);
}

function summaryLabel(s) {
  if (!s) return 'Unknown';
  const loc = `${s.neighborhood ? escapeHtml(s.neighborhood) + ', ' : ''}${escapeHtml(s.city)}, ${escapeHtml(s.state)}`;
  return `${escapeHtml(s.propertyType)} · ${s.beds}bd/${s.baths}ba in ${loc} (${money(s.estimatedValue)})`;
}

let activityChart = null;

async function loadActivityChart() {
  const canvas = document.getElementById('activityChart');
  if (!canvas || typeof Chart === 'undefined') return; // Chart.js loads from a CDN; stay quiet if it's blocked/offline
  try {
    const { days, signups, listings } = await apiGet('/api/admin/activity-timeseries');
    const labels = days.map(d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    if (activityChart) activityChart.destroy();
    activityChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Signups', data: signups, borderColor: '#182430', backgroundColor: 'rgba(24,36,48,0.08)', tension: 0.25, fill: true },
          { label: 'New Listings', data: listings, borderColor: '#a9793f', backgroundColor: 'rgba(169,121,63,0.12)', tension: 0.25, fill: true },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  } catch { /* chart just stays empty */ }
}

// Ready Meter totals: homeowners' latest weekly check-in (last 90 days), shown only once 20 have checked in. Labels are
// hand-copied from functions/_lib/readyMeter.js. Never per home, person or area.
const READY_TOTAL_TOPICS = { timing: 'Timing', money: 'Money', where_next: "Where we'd go next", house_ready: 'Getting the house ready', picking_agent: 'Picking an agent' };
const READY_TOTAL_BANDS = { exploring: 'Exploring', getting_close: 'Getting close', ready: 'Ready' };
async function loadReadyMeterTotals() {
  const el = document.getElementById('readyMeterTotals');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { owners, minShown, totals } = await apiGet('/api/admin/ready-meter');
    if (!totals) {
      el.innerHTML = `<div class="empty-state">Totals show once ${Number(minShown) || 20} homeowners have checked in (${Number(owners) || 0} so far).</div>`;
      return;
    }
    const tile = (label, value) => `<div class="stat-tile"><span class="stat-value">${Number(value) || 0}</span><span class="stat-label">${escapeHtml(label)}</span></div>`;
    el.innerHTML = [
      tile('Homeowners counted', owners),
      ...Object.entries(READY_TOTAL_BANDS).map(([k, label]) => tile(label, totals.band[k])),
      ...Object.entries(READY_TOTAL_TOPICS).map(([k, label]) => tile(`On their mind: ${label}`, totals.topic[k])),
    ].join('');
  } catch (err) { el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}

async function loadOverview() {
  const statsEl = document.getElementById('overviewStats');
  const matchesEl = document.getElementById('overviewMatches');
  const chainsEl = document.getElementById('overviewChains');
  const feedEl = document.getElementById('overviewFeed');
  statsEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { stats, matches, chains, feed } = await apiGet('/api/admin/overview');
    statsEl.innerHTML = [
      ['Total Users', stats.users], ['Active Listings', stats.activeListings],
      ['Mutual Matches', stats.matches], ['Daisy Chains', stats.chains], ['Posts', stats.posts],
      ['AugmentedHomes', stats.augmentedHomes], ['GreenHomes', stats.greenHomes], ['FinderMine Projects', stats.devProjects],
    ].map(([label, value]) => `<div class="stat-tile"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`).join('');

    matchesEl.innerHTML = matches.length ? matches.map(m => `
      <div class="match-card">
        <div class="match-top"><span class="score-pill">${Math.round((m.scoreAWantsB + m.scoreBWantsA) / 2)}% match</span></div>
        <div class="match-pair">
          <div class="side"><h4>${escapeHtml(m.a.owner)}</h4><p class="tiny">${summaryLabel(m.a)}</p></div>
          <div class="swap-icon">⇄</div>
          <div class="side"><h4>${escapeHtml(m.b.owner)}</h4><p class="tiny">${summaryLabel(m.b)}</p></div>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No mutual matches found yet — generate some demo data first.</div>';

    chainsEl.innerHTML = chains.length ? chains.map(c => `
      <div class="chain-card">
        <div class="match-top"><span class="score-pill">${c.avg}% avg match</span><span class="badge badge-gold">${c.path.length}-party chain</span></div>
        <div class="chain-flow">
          ${c.path.map((n, i) => `<div class="chain-node"><strong>${escapeHtml(n.owner)}</strong><span>${escapeHtml(n.propertyType)} in ${escapeHtml(n.city)}, ${escapeHtml(n.state)}</span></div>${i < c.path.length - 1 ? '<span class="chain-arrow">→</span>' : ''}`).join('')}
          <span class="chain-arrow">↩</span>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No daisy chains found yet — generate some demo data first.</div>';

    feedEl.innerHTML = feed.length ? feed.map(p => `
      <div class="match-card">
        <div class="card-agent">${escapeHtml(p.author_name)} · ${p.group_label ? `in <strong>${escapeHtml(p.group_label)}</strong>` : 'Global feed'} · ${timeAgo(p.created_at)}</div>
        <p>${escapeHtml(p.body)}</p>
        <p class="tiny">👍 ${p.like_count} · 💬 ${p.comment_count}</p>
      </div>
    `).join('') : '<div class="empty-state">No posts yet.</div>';
  } catch (err) {
    statsEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

async function loadReports() {
  const el = document.getElementById('reportsList');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { reports } = await apiGet('/api/admin/reports');
    const open = reports.filter(r => r.status === 'open');
    el.innerHTML = open.length ? open.map(r => `
      <div class="card" data-id="${r.id}">
        <div class="card-head">
          <h3>${escapeHtml(r.target_type)} #${r.target_id}</h3>
          <span class="badge badge-gold">Reported by ${escapeHtml(r.reporter_name)}</span>
        </div>
        <p class="tiny">${escapeHtml(r.reason)}${r.target_hidden ? ' <span class="badge badge-paused">Already hidden</span>' : ''}</p>
        <div class="card-actions">
          ${r.target_type === 'user'
            ? `<a class="btn btn-ghost btn-sm" href="/profile/${Number(r.target_id)}" target="_blank" rel="noopener">Open profile</a>
          <button class="btn btn-danger btn-sm" data-action="suspend-user" data-user-id="${Number(r.target_id)}">Suspend account</button>`
            : r.target_type === 'past_client_review'
              ? '<span class="tiny">If it breaks the rules, remove it under Past-client reviews below.</span>'
              : r.target_hidden && (r.target_type === 'post' || r.target_type === 'comment')
                ? `<button class="btn btn-ghost btn-sm" data-action="unhide-target" data-kind="${r.target_type}" data-target-id="${Number(r.target_id)}">Unhide</button>`
                : '<button class="btn btn-danger btn-sm" data-action="hide_target">Hide content</button>'}
          <button class="btn btn-ghost btn-sm" data-action="resolve">Resolve (no action)</button>
          <button class="btn btn-ghost btn-sm" data-action="dismiss">Dismiss</button>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No open reports.</div>';
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

// The DRE's public lookup takes the 8-digit license ID; older free-text numbers are passed through as typed.
function dreRecordUrl(licenseNumber) {
  const raw = String(licenseNumber || '');
  const digits = raw.replace(/\D/g, '');
  const id = digits.length >= 5 && digits.length <= 8 ? digits.padStart(8, '0') : raw;
  return `https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=${encodeURIComponent(id)}`;
}

// The fixed rejection reasons (functions/_lib/agents.js REJECTION_REASONS), sent with the application list.
let rejectionReasons = [];
function rejectFieldsHtml(userId, label) {
  const id = Number(userId);
  return `
        <div class="field"><label for="rejReason-${id}">${escapeHtml(label)}</label>
          <select id="rejReason-${id}" class="reject-reason">${rejectionReasons.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></div>
        <div class="field"><label for="rejNote-${id}">Note to the agent (optional; needed for "Other")</label>
          <input type="text" id="rejNote-${id}" class="reject-note" maxlength="300"></div>`;
}
function rejectionFrom(card) {
  const reason = card.querySelector('.reject-reason');
  const note = card.querySelector('.reject-note');
  return { rejectionReason: reason ? reason.value : '', rejectionNote: note ? note.value.trim() : '' };
}

async function loadLicenseRechecks() {
  const el = document.getElementById('licenseRecheckList');
  if (!el) return;
  try {
    const { applications, rejectionReasons: reasons } = await apiGet('/api/admin/agent-applications?status=approved');
    if (Array.isArray(reasons)) rejectionReasons = reasons;
    // Never-checked (or check removed) first, then the oldest check.
    const sorted = applications.slice().sort((a, b) => ((a.licenseVerified && a.licenseCheckedAt) || '').localeCompare((b.licenseVerified && b.licenseCheckedAt) || ''));
    el.innerHTML = sorted.length ? sorted.map(a => {
      const checked = a.licenseVerified && a.licenseCheckedAt;
      return `
      <div class="card" data-id="${a.userId}" data-license="${escapeHtml(a.licenseNumber)}" data-brokerage="${escapeHtml(a.brokerageName || '')}">
        <div class="card-head"><h3>${escapeHtml(a.displayName)}</h3><span class="badge ${checked ? 'badge-gold' : 'badge-paused'}">${checked ? `Checked ${escapeHtml(new Date(a.licenseCheckedAt + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}` : 'Not checked'}</span></div>
        <p class="tiny">DRE #${escapeHtml(a.licenseNumber)} · ${escapeHtml(a.brokerageName)} · <a href="${escapeHtml(dreRecordUrl(a.licenseNumber))}" target="_blank" rel="noopener noreferrer">Open the DRE record →</a></p>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-action="recheck-license">Checked on the DRE today</button>
          <button class="btn btn-ghost btn-sm" data-action="unverify-license">License not active — remove check</button>
          <button class="btn btn-danger btn-sm" data-action="remove-approval">Remove approval</button>
          <button class="btn btn-danger btn-sm" data-action="suspend-user" data-user-id="${Number(a.userId)}">Suspend account</button>
        </div>
        ${rejectFieldsHtml(a.userId, 'Reason if removing the approval (shown to the agent)')}
      </div>`;
    }).join('') : '<div class="empty-state">No approved agents yet.</div>';
  } catch (err) { el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}

const PAST_SIDE_LABELS = { sold: 'Sold', bought: 'Bought', both: 'Sold and bought' };
async function loadPastClientReviews(before = 0) {
  const el = document.getElementById('pastClientReviewList');
  if (!el) return;
  try {
    const { reviews, more } = await apiGet(`/api/admin/past-client-reviews${before ? `?before=${before}` : ''}`);
    const html = reviews.map(r => `
      <div class="card" data-id="${r.id}">
        <div class="card-head"><h3>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} for ${escapeHtml(r.agentName)}</h3><span class="badge ${r.status === 'published' ? 'badge-active' : 'badge-paused'}">${escapeHtml(r.status)}</span></div>
        <p class="tiny">${escapeHtml(r.reviewerName)}${r.reported ? ` (${escapeHtml(r.reviewerEmail || '')})` : ''} · ${escapeHtml(PAST_SIDE_LABELS[r.clientSide] || '')} in ${r.saleYear}, ${escapeHtml(r.saleCity)}${r.reported ? ` · address given: ${escapeHtml(r.saleAddress || 'none')} <span class="badge badge-paused">Review reported</span>` : ''}</p>
        ${r.comment ? `<p>${escapeHtml(r.comment)}</p>` : '<p class="tiny">(no comment)</p>'}
        ${r.removedReason ? `<p class="tiny">Removed: ${escapeHtml(r.removedReason)}</p>` : ''}
        <div class="card-actions">${r.status === 'published'
          ? '<button class="btn btn-danger btn-sm" data-action="remove-past-review">Remove</button>'
          : '<button class="btn btn-ghost btn-sm" data-action="restore-past-review">Restore</button>'}</div>
      </div>`).join('');
    const older = more ? `<p><button class="btn btn-ghost btn-sm" data-action="older-past-reviews" data-before="${reviews[reviews.length - 1].id}">Show older reviews</button></p>` : '';
    if (before) {
      const btn = el.querySelector('[data-action="older-past-reviews"]');
      if (btn) btn.parentElement.remove();
      el.insertAdjacentHTML('beforeend', html + older);
    } else {
      el.innerHTML = reviews.length ? html + older : '<div class="empty-state">No past-client reviews yet.</div>';
    }
  } catch (err) { el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}

function agentReviewCardHtml(r) {
  const actions = r.recused
    ? '<span class="badge badge-paused">Recused</span> <span class="tiny">An Amico Haus admin account sent a proposal on this home, so admins don&#39;t remove or restore this review.</span>'
    : r.status === 'published'
      ? '<button class="btn btn-danger btn-sm" data-action="remove-agent-review">Remove</button>'
      : '<button class="btn btn-ghost btn-sm" data-action="restore-agent-review">Restore</button>';
  return `
      <div class="card" data-id="${Number(r.id)}">
        <div class="card-head"><h3>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} for ${escapeHtml(r.agentName)}</h3><span class="badge ${r.status === 'published' ? 'badge-active' : 'badge-paused'}">${escapeHtml(r.status)}</span></div>
        <p class="tiny">By ${escapeHtml(r.reviewerName)} · ${r.requestType === 'pre_listing' ? 'Pre-listing' : 'Trade'} #${Number(r.requestId)}</p>
        ${r.comment ? `<p>${escapeHtml(r.comment)}</p>` : '<p class="tiny">(no comment)</p>'}
        ${r.reason ? `<p class="tiny">Removed: ${escapeHtml(r.reason)}</p>` : ''}
        <div class="card-actions">${actions}</div>
      </div>`;
}

async function loadAgentReviews(before = 0) {
  const el = document.getElementById('agentReviewList');
  if (!el) return;
  try {
    const { reviews, removed, more } = await apiGet(`/api/admin/agent-reviews${before ? `?before=${before}` : ''}`);
    const html = reviews.map(agentReviewCardHtml).join('');
    const older = more ? `<p><button class="btn btn-ghost btn-sm" data-action="older-agent-reviews" data-before="${Number(reviews[reviews.length - 1].id)}">Show older reviews</button></p>` : '';
    if (before) {
      const btn = el.querySelector('[data-action="older-agent-reviews"]');
      if (btn) btn.parentElement.remove();
      el.insertAdjacentHTML('beforeend', html + older);
      return;
    }
    const removedHtml = removed.length ? `<h4>Removed</h4>${removed.map(agentReviewCardHtml).join('')}` : '';
    el.innerHTML = reviews.length || removed.length ? html + older + removedHtml : '<div class="empty-state">No reviews of agents hired here yet.</div>';
  } catch (err) { el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}

// Suspend or reinstate an account (functions/api/admin/users/[id].js). True when it went through.
async function suspendAccount(userId, action) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) { toast('Enter an account ID.'); return false; }
  const ask = action === 'suspend'
    ? `Suspend account #${id}? They're signed out everywhere, can't log in, and drop out of every list. An agent gives up their founding spots.`
    : `Reinstate account #${id}? A founding spot comes back only if one is open.`;
  if (!confirm(ask)) return false;
  try {
    const result = await apiPost(`/api/admin/users/${id}`, { action });
    toast(action === 'suspend' ? 'Account suspended.' : `Account reinstated.${result.foundingZips && result.foundingZips.length ? ` Founding spot: ${result.foundingZips.join(', ')}.` : ''}`);
    loadAuditLog();
    return true;
  } catch (err) { toast(err.message); return false; }
}

async function loadAgentApplications() {
  const el = document.getElementById('agentApplicationsList');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { applications, rejectionReasons: reasons } = await apiGet('/api/admin/agent-applications?status=pending');
    if (Array.isArray(reasons)) rejectionReasons = reasons;
    el.innerHTML = applications.length ? applications.map(a => `
      <div class="card" data-id="${a.userId}" data-license="${escapeHtml(a.licenseNumber)}" data-brokerage="${escapeHtml(a.brokerageName || '')}">
        <div class="card-head">
          <h3>${escapeHtml(a.displayName)}</h3>
          <span class="badge badge-gold">${escapeHtml(a.email)}</span>
        </div>
        <div class="mini-block">
          <span class="label">Brokerage</span>${escapeHtml(a.brokerageName)}<br>
          <span class="label">DRE license #</span>${escapeHtml(a.licenseNumber)} · <a href="${escapeHtml(dreRecordUrl(a.licenseNumber))}" target="_blank" rel="noopener noreferrer">Open the DRE record →</a><br>
          <span class="tiny">Check: status LICENSED, the name matches, not expired, and the responsible broker matches the brokerage.</span><br>
          <span class="label">Experience</span>${a.yearsExperience ? `${a.yearsExperience} years` : 'Not given yet'}
        </div>
        ${a.bio ? `<p class="tiny">${escapeHtml(a.bio)}</p>` : ''}
        <p class="tiny">Default fee: ${a.defaultCommissionPct || a.defaultFlatFee ? `${a.defaultCommissionPct ? `${a.defaultCommissionPct}% commission` : ''}${a.defaultCommissionPct && a.defaultFlatFee ? ' + ' : ''}${a.defaultFlatFee ? `${money(a.defaultFlatFee)} flat` : ''}` : 'Not set yet (optional)'}</p>
        <p class="tiny">Services: ${a.services.length ? a.services.map(s => escapeHtml(s.type)).join(', ') : 'None listed'}</p>
        <p class="tiny">Service area: ${a.serviceZips.length ? `${a.serviceZips.join(', ')} (+20mi radius)` : 'None listed'}</p>
        <p class="tiny">Open houses: ${a.openHouseDays.length ? a.openHouseDays.map(d => OPEN_HOUSE_DAY_LABELS[d] || d).join(', ') : 'None listed'}</p>
        <p class="tiny">Track record: ${a.homesSoldLastYear ? `${a.homesSoldLastYear} homes sold last 12mo` : ''}${a.homesSoldLastYear && a.avgDaysOnMarket ? ' · ' : ''}${a.avgDaysOnMarket ? `~${a.avgDaysOnMarket} days on market avg` : ''}${(a.homesSoldLastYear || a.avgDaysOnMarket) ? ' (self-reported)' : 'None listed'}</p>
        ${a.hasVideo ? `<video controls preload="none" class="media-video media-video-sm" src="/api/agent-video/${a.userId}"></video>` : ''}
        ${a.hasLicensePhoto ? `
          <img src="/api/license-photos/${a.userId}" alt="License photo" class="media-photo media-photo-sm">
          <p class="tiny">License photo uploaded (optional). Approve only after checking the number on the DRE.</p>
        ` : '<p class="tiny">No license photo (optional). Approve only after checking the number on the DRE.</p>'}
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" data-action="approve-agent">Checked on the DRE — Approve</button>
          <button class="btn btn-danger btn-sm" data-action="reject-agent">Reject</button>
        </div>
        ${rejectFieldsHtml(a.userId, 'Reason if rejecting (shown to the applicant)')}
      </div>
    `).join('') : '<div class="empty-state">No pending agent applications.</div>';
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

async function loadDisputes() {
  const el = document.getElementById('disputesList');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { disputes } = await apiGet('/api/admin/disputes');
    el.innerHTML = disputes.length ? disputes.map(d => `
      <div class="card" data-id="${Number(d.id)}">
        <div class="card-head">
          <h3>${escapeHtml(d.reasonLabel || 'Other')}</h3>
          <span class="badge badge-paused">${d.requestType === 'pre_listing' ? 'Pre-listing' : 'Transaction'} #${Number(d.requestId)}</span>
        </div>
        <p class="tiny">Filed by ${escapeHtml(d.raisedByName)} about ${escapeHtml(d.againstName)} · ${escapeHtml(timeAgo(d.createdAt))} · ${escapeHtml(d.status || '')}</p>
        <p>${escapeHtml(d.description)}</p>
        ${d.adminNotes ? `<p class="tiny">Old admin note: ${escapeHtml(d.adminNotes)}</p>` : ''}
      </div>
    `).join('') : '<div class="empty-state">No dispute history.</div>';
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

async function loadAuditLog() {
  const el = document.getElementById('auditLogList');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { log: entries } = await apiGet('/api/admin/audit-log');
    el.innerHTML = entries.length ? entries.map(e => `
      <div class="side">
        <strong>${escapeHtml(e.admin_name)}</strong> <span class="tiny">${timeAgo(e.created_at)}</span>
        <p class="tiny">${escapeHtml(e.action)}${e.target_type ? ` — ${escapeHtml(e.target_type)} #${e.target_id}` : ''}</p>
      </div>
    `).join('') : '<div class="empty-state">No admin actions logged yet.</div>';
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

(async function () {
  const user = await fetchCurrentUser();
  const statusLine = document.getElementById('statusLine');

  if (!user) {
    statusLine.textContent = 'You need to log in as the admin account to use this page.';
    return;
  }
  if (user.role !== 'admin') {
    statusLine.textContent = "This page is admin-only, and your account isn't an admin.";
    return;
  }

  statusLine.textContent = `Signed in as ${user.displayName} (admin).`;
  document.getElementById('controls').classList.remove('hidden');
  document.getElementById('refreshOverviewBtn').addEventListener('click', loadOverview);
  document.getElementById('refreshReportsBtn').addEventListener('click', loadReports);
  document.getElementById('refreshAgentAppsBtn').addEventListener('click', () => { loadAgentApplications(); loadLicenseRechecks(); });
  document.getElementById('refreshDisputesBtn').addEventListener('click', loadDisputes);
  document.getElementById('sendDigestPreviewBtn').addEventListener('click', async () => {
    const out = document.getElementById('digestPreviewResult');
    out.textContent = 'Sending…';
    try {
      const { sent, reason } = await apiPost('/api/admin/send-digest-preview', {});
      out.textContent = sent ? `Sent to ${user.email ? escapeHtml(user.email) : 'your inbox'}. Check it (or the dev log if EMAIL_DEV_LOG is set).` : (reason || 'Nothing to report this week.');
    } catch (err) { out.textContent = err.message; }
  });
  document.getElementById('sendOpenHouseReminderPreviewBtn').addEventListener('click', async () => {
    const out = document.getElementById('openHouseReminderPreviewResult');
    out.textContent = 'Sending…';
    try {
      const { sent, reason } = await apiPost('/api/admin/send-open-house-reminder-preview', {});
      out.textContent = sent ? `Sent to ${user.email ? escapeHtml(user.email) : 'your inbox'}. Check it (or the dev log if EMAIL_DEV_LOG is set).` : (reason || 'No upcoming open houses to preview.');
    } catch (err) { out.textContent = err.message; }
  });
  loadOverview();
  loadReports();
  loadAgentApplications();
  loadLicenseRechecks();
  loadPastClientReviews();
  loadAgentReviews();
  loadDisputes();
  loadAuditLog();
  loadActivityChart();
  loadReadyMeterTotals();
  mysteryAdminInit();
  mysteryLoadRepostOks();

  document.getElementById('agentApplicationsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const userId = card.dataset.id;
    const licenseNumber = card.dataset.license;
    const brokerageName = card.dataset.brokerage;
    try {
      if (btn.dataset.action === 'approve-agent') {
        if (!confirm(`Did you open the DRE record for #${licenseNumber} and see LICENSED, a matching name, no expiration and the right broker?`)) return;
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: true, licenseNumber, brokerageName });
        await apiPut(`/api/admin/agent-applications/${userId}`, { decision: 'approve', licenseNumber });
        toast('Agent approved.');
      } else if (btn.dataset.action === 'reject-agent') {
        await apiPut(`/api/admin/agent-applications/${userId}`, { decision: 'reject', ...rejectionFrom(card) });
        toast('Agent application rejected.');
      } else if (btn.dataset.action === 'verify-license') {
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: true, licenseNumber, brokerageName });
        toast('License marked checked.');
      } else if (btn.dataset.action === 'unverify-license') {
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: false });
        toast('License check removed.');
      }
      loadAgentApplications();
      loadLicenseRechecks();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('licenseRecheckList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const userId = card.dataset.id;
    const licenseNumber = card.dataset.license;
    try {
      if (btn.dataset.action === 'recheck-license') {
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: true, licenseNumber, brokerageName });
        toast('License marked as checked today.');
      } else if (btn.dataset.action === 'unverify-license') {
        if (!confirm('Remove the DRE check from this agent? Their profile will stop saying the license was checked.')) return;
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: false });
        toast('DRE check removed.');
      } else if (btn.dataset.action === 'remove-approval') {
        if (!confirm('Remove this approval? The reason you picked is shown to the agent.')) return;
        await apiPut(`/api/admin/agent-applications/${userId}`, { decision: 'reject', ...rejectionFrom(card) });
        toast('Approval removed.');
      } else if (btn.dataset.action === 'suspend-user') {
        if (await suspendAccount(btn.dataset.userId, 'suspend')) loadAgentApplications();
      }
      loadLicenseRechecks();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('pastClientReviewList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    // One page at a time: a double-click would otherwise append the same reviews twice.
    if (btn.dataset.action === 'older-past-reviews') { btn.disabled = true; loadPastClientReviews(Number(btn.dataset.before)); return; }
    const id = btn.closest('[data-id]').dataset.id;
    try {
      if (btn.dataset.action === 'remove-past-review') {
        const reason = prompt('Why is this review being removed? (kept on the activity log)');
        if (!reason) return;
        await apiPut(`/api/admin/past-client-reviews/${id}`, { action: 'remove', reason });
        toast('Review removed.');
      } else if (btn.dataset.action === 'restore-past-review') {
        await apiPut(`/api/admin/past-client-reviews/${id}`, { action: 'restore' });
        toast('Review restored.');
      }
      loadPastClientReviews();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('agentReviewList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'older-agent-reviews') { btn.disabled = true; loadAgentReviews(Number(btn.dataset.before)); return; }
    const id = btn.closest('[data-id]').dataset.id;
    const action = btn.dataset.action === 'remove-agent-review' ? 'remove' : btn.dataset.action === 'restore-agent-review' ? 'restore' : '';
    if (!action) return;
    const reason = prompt(action === 'remove' ? 'Why is this review being removed? (kept on the activity log; the reviewer is told)' : 'Why is this review being restored? (kept on the activity log)');
    if (!reason || !reason.trim()) return;
    try {
      await apiPut(`/api/admin/agent-reviews/${id}`, { action, reason: reason.trim() });
      toast(action === 'remove' ? 'Review removed.' : 'Review restored.');
      loadAgentReviews();
      loadAuditLog();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('suspendUserBtn').addEventListener('click', () => suspendAccount(document.getElementById('suspendUserId').value, 'suspend'));
  document.getElementById('unsuspendUserBtn').addEventListener('click', () => suspendAccount(document.getElementById('suspendUserId').value, 'unsuspend'));
  // A listing paused by moderation (hidden_at) comes back only through an admin: PUT /api/listings/:id { status: 'active' }.
  document.getElementById('reactivateListingBtn').addEventListener('click', async () => {
    const id = Number(document.getElementById('reactivateListingId').value);
    if (!Number.isInteger(id) || id <= 0) { toast('Enter a listing ID.'); return; }
    if (!confirm(`Reactivate listing #${id}? It shows in the directory and matches again.`)) return;
    try {
      await apiPut(`/api/listings/${id}`, { status: 'active' });
      toast('Listing reactivated.');
      loadAuditLog();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('reportsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const id = card.dataset.id;
    if (btn.dataset.action === 'suspend-user') { if (await suspendAccount(btn.dataset.userId, 'suspend')) loadReports(); return; }
    if (btn.dataset.action === 'unhide-target') {
      // A mistaken hide can be undone here (the author and everyone else see it again).
      if (await unhideContentById(btn.dataset.kind, btn.dataset.targetId)) { loadReports(); loadAuditLog(); }
      return;
    }
    let reason = '';
    if (btn.dataset.action === 'hide_target') {
      reason = (prompt('Why is this being hidden? (the author is told; kept on the activity log)') || '').trim();
      if (!reason) return;
    }
    btn.disabled = true;
    try {
      await apiPost(`/api/admin/reports/${id}`, { action: btn.dataset.action, ...(reason ? { reason } : {}) });
      toast('Report updated.');
      loadReports();
      loadAuditLog();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });

  document.getElementById('startBtn').addEventListener('click', async () => {
    const btn = document.getElementById('startBtn');
    const target = Math.max(1, Number(document.getElementById('targetCount').value) || 4000);
    btn.disabled = true;
    btn.textContent = 'Generating…';
    document.getElementById('progressLog').innerHTML = '';

    let created = 0;
    try {
      while (created < target) {
        const count = Math.min(CHUNK_SIZE, target - created);
        const result = await apiPost('/api/admin/seed', { count });
        created += result.created;
        log(`+${result.created} users (${result.posts} posts) — ${created}/${target} total.`);
      }
      log(`Done. Created ${created} demo users.`);
      toast('Demo data generation complete.');
      loadOverview();
    } catch (err) {
      log(`Stopped early: ${err.message}`);
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate';
    }
  });
})();

/* ---------------- Mystery Home Monday (admin) + Repost OKs ---------------- */
// Labels hand-copied from functions/_lib/mysteryHomes.js and functions/_lib/listings.js (PROPERTY_TYPES).
const MYSTERY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];
const MYSTERY_STATE_LABELS = { draft: 'Draft', scheduled: 'Scheduled', live: 'Live now', revealed: 'Revealed', retired: 'Retired' };
const MYSTERY_MISSING_LABELS = {
  publish_at: 'a publish time', reveal_at: 'a reveal time', reveal_order: 'a reveal at least 24 hours after it publishes',
  seller_ok: "the date of the seller's written OK", broker_ok: "the date of Coldwell Banker West's OK",
  photos: 'at least 3 photos', sweep: 'Privacy Sweep checked on every photo', rights: 'who owns the photos',
  sold_month: 'a sale that closed at least 30 days ago',
};
const MYSTERY_TZ = 'America/Los_Angeles';
const MYSTERY_MOMENT_LABELS = { reveal: 'Reveal Mode', hired: 'Hired! story' };
let mysteryHomes = [];
let mysteryEditingId = null;

// Pacific wall-clock parts of a moment.
function mysteryPacificParts(ms) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: MYSTERY_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return parts;
}
// A datetime-local value read as Pacific time -> ISO (UTC). '' -> ''.
function mysteryPacificToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return '';
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = wall + 8 * 3600000;
  for (let i = 0; i < 2; i++) {
    const p = mysteryPacificParts(guess);
    guess += wall - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return new Date(guess).toISOString();
}
// ISO -> a datetime-local value in Pacific time.
function mysteryIsoToPacific(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const p = mysteryPacificParts(ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Next Monday 07:00 and the Thursday after it, 07:00 (Pacific).
function mysteryDefaultTimes() {
  const p = mysteryPacificParts(Date.now());
  const today = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const toMonday = ((8 - today.getUTCDay()) % 7) || 7;
  const day = (offset) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
  return { publish: `${day(toMonday)}T07:00`, reveal: `${day(toMonday + 3)}T07:00` };
}
function mysteryWhen(iso) {
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-US', { timeZone: MYSTERY_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not set';
}
function mysteryStatus(msg) { const el = document.getElementById('mhStatus'); if (el) el.textContent = msg || ''; }
function mysteryErrorText(err) {
  const missing = err && err.data && Array.isArray(err.data.missing) ? err.data.missing : null;
  return missing && missing.length ? `${err.message} Still needed: ${missing.map(k => MYSTERY_MISSING_LABELS[k] || k).join(', ')}.` : (err && err.message) || 'Something went wrong.';
}

function mysteryFormBody() {
  const v = (id) => document.getElementById(id).value.trim();
  const num = (id) => (v(id) === '' ? null : Number(v(id)));
  return {
    source: v('mhSource'), city: v('mhCity'), state: v('mhState') || 'CA', propertyType: v('mhType'),
    beds: num('mhBeds'), baths: num('mhBaths'), sqft: num('mhSqft'), lotSqft: num('mhLotSqft'), yearBuilt: num('mhYearBuilt'),
    highlights: v('mhHighlights'), soldPrice: num('mhSoldPrice'), soldMonth: v('mhSoldMonth'),
    sellerOkOn: document.getElementById('mhSellerOk').checked ? v('mhSellerOkOn') || null : null,
    brokerOkOn: document.getElementById('mhBrokerOk').checked ? v('mhBrokerOkOn') || null : null,
    photoRights: v('mhPhotoRights'),
    publishAt: mysteryPacificToIso(v('mhPublishAt')) || null, revealAt: mysteryPacificToIso(v('mhRevealAt')) || null,
  };
}

function mysteryFillForm(home) {
  const set = (id, value) => { document.getElementById(id).value = value === null || value === undefined ? '' : String(value); };
  const defaults = mysteryDefaultTimes();
  mysteryEditingId = home ? home.id : null;
  document.getElementById('mhFormTitle').textContent = home ? `Edit: ${home.city}, ${home.stateCode} (${MYSTERY_STATE_LABELS[home.state] || home.state})` : 'Add a Mystery Home';
  set('mhSource', home ? home.source : 'own_sale');
  set('mhCity', home ? home.city : '');
  set('mhState', home ? home.stateCode : 'CA');
  set('mhType', home ? home.propertyType : MYSTERY_TYPES[0]);
  set('mhBeds', home && home.beds); set('mhBaths', home && home.baths); set('mhSqft', home && home.sqft);
  set('mhLotSqft', home && home.lotSqft); set('mhYearBuilt', home && home.yearBuilt);
  set('mhHighlights', home ? home.highlights : '');
  set('mhSoldPrice', home && home.soldPrice); set('mhSoldMonth', home && home.soldMonth);
  document.getElementById('mhSellerOk').checked = !!(home && home.sellerOkOn);
  set('mhSellerOkOn', home && home.sellerOkOn);
  document.getElementById('mhBrokerOk').checked = !!(home && home.brokerOkOn);
  set('mhBrokerOkOn', home && home.brokerOkOn);
  set('mhPhotoRights', home ? home.photoRights : 'own');
  set('mhPublishAt', home && home.publishAt ? mysteryIsoToPacific(home.publishAt) : defaults.publish);
  set('mhRevealAt', home && home.revealAt ? mysteryIsoToPacific(home.revealAt) : defaults.reveal);
  document.getElementById('mhPhotoList').innerHTML = home && home.photos.length
    ? home.photos.map((ph, i) => `<div><img src="/api/mystery-home-photos/${Number(ph.id)}" alt="Mystery Home photo ${i + 1}" loading="lazy">
        <p class="tiny">${ph.swept ? '✓ Sweep done' : 'Not swept yet'} <button type="button" class="btn btn-ghost btn-sm" data-mh-photo="${Number(ph.id)}">Remove</button></p></div>`).join('')
    : '<p class="tiny">No photos yet. Save the home first, then add photos.</p>';
  mysteryStatus('');
}

async function mysteryLoadHomes(keepEditing = true) {
  const el = document.getElementById('mysteryList');
  if (!el) return;
  try {
    const { homes } = await apiGet('/api/admin/mystery-homes');
    mysteryHomes = homes || [];
    el.innerHTML = mysteryHomes.length ? mysteryHomes.map(h => `
      <div class="card side">
        <strong>${escapeHtml(h.city)}, ${escapeHtml(h.stateCode)}</strong> <span class="badge">${escapeHtml(MYSTERY_STATE_LABELS[h.state] || h.state)}</span>
        <p class="tiny">${escapeHtml(h.propertyType)} · ${h.photos.length} photo${h.photos.length === 1 ? '' : 's'} (${h.photos.filter(p => p.swept).length} swept) · publishes ${escapeHtml(mysteryWhen(h.publishAt))} · reveal ${escapeHtml(mysteryWhen(h.revealAt))}</p>
        <p class="tiny">${h.state === 'live' || h.state === 'revealed' ? `<a href="/mystery-home/${escapeHtml(h.slug)}" target="_blank" rel="noopener">Open the page</a> · ` : ''}<button type="button" class="btn btn-ghost btn-sm" data-mh-edit="${Number(h.id)}">Open</button></p>
      </div>`).join('') : '<div class="empty-state">No Mystery Homes yet.</div>';
    const current = keepEditing && mysteryEditingId ? mysteryHomes.find(h => h.id === mysteryEditingId) : null;
    mysteryFillForm(current || null);
  } catch (err) { el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}

async function mysteryUploadPicked(files) {
  if (!mysteryEditingId) { toast('Save the home first, then add photos.'); return; }
  const id = mysteryEditingId;
  const upload = async (results) => {
    let done = 0;
    for (const { file, swept } of results) {
      const fd = new FormData();
      fd.append('photo', file);
      fd.append('swept', swept ? '1' : '0');
      try { await apiUpload(`/api/admin/mystery-homes/${id}/photos`, fd); done++; } catch (err) { toast(mysteryErrorText(err)); break; }
    }
    if (done) toast(`${done} photo${done === 1 ? '' : 's'} added.`);
    mysteryLoadHomes();
  };
  // Privacy Sweep (privacy-sweep.js) hands back the swept copies in pick order; without it, they upload unswept.
  if (typeof openPrivacySweep === 'function') openPrivacySweep(files, { onDone: (results) => { upload(results); } });
  else upload(files.map(file => ({ file, swept: false })));
}

async function mysteryAction(action) {
  if (!mysteryEditingId) { toast('Open a Mystery Home first.'); return; }
  const id = mysteryEditingId;
  try {
    if (action === 'delete') {
      if (!confirm('Delete this Mystery Home and its photos for good?')) return;
      await apiDelete(`/api/admin/mystery-homes/${id}`);
      mysteryEditingId = null;
      toast('Deleted.');
    } else {
      if (action === 'retire' && !confirm('Retire this Mystery Home? Its page comes down and it stays retired.')) return;
      const { state } = await apiPut(`/api/admin/mystery-homes/${id}`, { action });
      toast(`Now: ${MYSTERY_STATE_LABELS[state] || state}.`);
    }
    mysteryLoadHomes();
  } catch (err) { mysteryStatus(mysteryErrorText(err)); }
}

async function mysterySave() {
  const body = mysteryFormBody();
  try {
    if (mysteryEditingId) {
      await apiPut(`/api/admin/mystery-homes/${mysteryEditingId}`, body);
      toast('Saved.');
    } else {
      const { id } = await apiPost('/api/admin/mystery-homes', body);
      mysteryEditingId = id;
      toast('Saved as a draft. Add photos next.');
    }
    mysteryLoadHomes();
  } catch (err) { mysteryStatus(mysteryErrorText(err)); }
}

function mysteryAdminInit() {
  const form = document.getElementById('mysteryForm');
  if (!form) return;
  document.getElementById('mhType').innerHTML = MYSTERY_TYPES.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  document.getElementById('mhSaveBtn').addEventListener('click', mysterySave);
  document.getElementById('mhNewBtn').addEventListener('click', () => mysteryFillForm(null));
  document.getElementById('mhPhotos').addEventListener('change', (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) mysteryUploadPicked(files);
  });
  form.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('button[data-mh-action]');
    if (actionBtn) { mysteryAction(actionBtn.dataset.mhAction); return; }
    const photoBtn = e.target.closest('button[data-mh-photo]');
    if (photoBtn && mysteryEditingId) {
      try { await apiDelete(`/api/admin/mystery-homes/${mysteryEditingId}/photos/${photoBtn.dataset.mhPhoto}`); mysteryLoadHomes(); } catch (err) { mysteryStatus(mysteryErrorText(err)); }
    }
  });
  document.getElementById('mysteryList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mh-edit]');
    if (!btn) return;
    const home = mysteryHomes.find(h => h.id === Number(btn.dataset.mhEdit));
    if (home) { mysteryFillForm(home); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  mysteryLoadHomes(false);
}

// Repost OKs (functions/api/admin/repost-oks.js): who OK'd a repost of which Decision Night moment.
function mysteryDay(s) {
  if (!s) return '';
  const text = String(s);
  const ms = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: MYSTERY_TZ }) : '';
}
async function mysteryLoadRepostOks() {
  const el = document.getElementById('repostOkList');
  if (!el) return;
  try {
    const { consents } = await apiGet('/api/admin/repost-oks');
    el.innerHTML = consents && consents.length ? `<div class="repost-table-wrap"><table class="comparison-table repost-table">
      <thead><tr><th scope="col">Owner</th><th scope="col">City</th><th scope="col">Moment</th><th scope="col">Agreed on</th><th scope="col">Withdrawn on</th><th scope="col">Home</th></tr></thead>
      <tbody>${consents.map(c => `<tr>
        <td>${escapeHtml(c.ownerName || '')}</td>
        <td>${escapeHtml(c.city || '')}${c.state ? `, ${escapeHtml(c.state)}` : ''}</td>
        <td>${escapeHtml(MYSTERY_MOMENT_LABELS[c.moment] || c.moment)}</td>
        <td>${escapeHtml(mysteryDay(c.consentedAt))}</td>
        <td>${c.withdrawnAt ? `${escapeHtml(mysteryDay(c.withdrawnAt))} <strong>Taken back: remove reposts</strong>` : ''}</td>
        <td><a href="/app#pre-listing-${Number(c.preListingId)}">Open</a></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No repost OKs in the last 180 days.</div>';
  } catch (err) { el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}
