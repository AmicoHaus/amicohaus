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
        <p class="tiny">${escapeHtml(r.reason)}</p>
        <div class="card-actions">
          <button class="btn btn-danger btn-sm" data-action="delete_target">Delete Content</button>
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

async function loadLicenseRechecks() {
  const el = document.getElementById('licenseRecheckList');
  if (!el) return;
  try {
    const { applications } = await apiGet('/api/admin/agent-applications?status=approved');
    // Never-checked (or check removed) first, then the oldest check.
    const sorted = applications.slice().sort((a, b) => ((a.licenseVerified && a.licenseCheckedAt) || '').localeCompare((b.licenseVerified && b.licenseCheckedAt) || ''));
    el.innerHTML = sorted.length ? sorted.map(a => {
      const checked = a.licenseVerified && a.licenseCheckedAt;
      return `
      <div class="card" data-id="${a.userId}" data-license="${escapeHtml(a.licenseNumber)}">
        <div class="card-head"><h3>${escapeHtml(a.displayName)}</h3><span class="badge ${checked ? 'badge-gold' : 'badge-paused'}">${checked ? `Checked ${escapeHtml(new Date(a.licenseCheckedAt + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}` : 'Not checked'}</span></div>
        <p class="tiny">DRE #${escapeHtml(a.licenseNumber)} · ${escapeHtml(a.brokerageName)} · <a href="${escapeHtml(dreRecordUrl(a.licenseNumber))}" target="_blank" rel="noopener noreferrer">Open the DRE record →</a></p>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-action="recheck-license">Checked on the DRE today</button>
          <button class="btn btn-ghost btn-sm" data-action="unverify-license">License not active — remove check</button>
          <button class="btn btn-danger btn-sm" data-action="remove-approval">Remove approval</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty-state">No approved agents yet.</div>';
  } catch (err) { el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}

async function loadAgentApplications() {
  const el = document.getElementById('agentApplicationsList');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { applications } = await apiGet('/api/admin/agent-applications?status=pending');
    el.innerHTML = applications.length ? applications.map(a => `
      <div class="card" data-id="${a.userId}" data-license="${escapeHtml(a.licenseNumber)}">
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
      </div>
    `).join('') : '<div class="empty-state">No pending agent applications.</div>';
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

const DISPUTE_REASON_LABELS = { work_not_done: 'Work not done', quality_issue: 'Quality issue', communication: 'Communication problem', payment_dispute: 'Payment dispute', other: 'Other' };

async function loadDisputes() {
  const el = document.getElementById('disputesList');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { disputes } = await apiGet('/api/admin/disputes?status=open');
    el.innerHTML = disputes.length ? disputes.map(d => `
      <div class="card" data-id="${d.id}">
        <div class="card-head">
          <h3>${escapeHtml(DISPUTE_REASON_LABELS[d.reason] || d.reason)}</h3>
          <span class="badge badge-gold">${d.requestType === 'pre_listing' ? 'Pre-listing' : 'Transaction'} #${d.requestId}</span>
        </div>
        <p class="tiny">${escapeHtml(d.raisedByName)} (raised) vs. ${escapeHtml(d.againstName)}</p>
        <p>${escapeHtml(d.description)}</p>
        <div class="field"><label>Admin notes</label><textarea class="dispute-notes" maxlength="2000"></textarea></div>
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" data-action="resolve-dispute">Mark Resolved</button>
          <button class="btn btn-danger btn-sm" data-action="dismiss-dispute">Dismiss</button>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No open disputes.</div>';
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
  loadDisputes();
  loadAuditLog();
  loadActivityChart();

  document.getElementById('agentApplicationsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const userId = card.dataset.id;
    const licenseNumber = card.dataset.license;
    try {
      if (btn.dataset.action === 'approve-agent') {
        if (!confirm(`Did you open the DRE record for #${licenseNumber} and see LICENSED, a matching name, no expiration and the right broker?`)) return;
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: true, licenseNumber });
        await apiPut(`/api/admin/agent-applications/${userId}`, { decision: 'approve', licenseNumber });
        toast('Agent approved.');
      } else if (btn.dataset.action === 'reject-agent') {
        const reason = prompt('Optional reason (shown to the applicant):') || '';
        await apiPut(`/api/admin/agent-applications/${userId}`, { decision: 'reject', rejectionReason: reason });
        toast('Agent application rejected.');
      } else if (btn.dataset.action === 'verify-license') {
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: true, licenseNumber });
        toast('License marked verified.');
      } else if (btn.dataset.action === 'unverify-license') {
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: false });
        toast('License verification removed.');
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
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: true, licenseNumber });
        toast('License marked as checked today.');
      } else if (btn.dataset.action === 'unverify-license') {
        if (!confirm('Remove the DRE check from this agent? Their profile will stop saying the license was checked.')) return;
        await apiPut(`/api/admin/agent-applications/${userId}/verify-license`, { verified: false });
        toast('DRE check removed.');
      } else if (btn.dataset.action === 'remove-approval') {
        const reason = prompt('Remove this approval? Optional reason (shown to the agent):');
        if (reason === null) return;
        await apiPut(`/api/admin/agent-applications/${userId}`, { decision: 'reject', rejectionReason: reason });
        toast('Approval removed.');
      }
      loadLicenseRechecks();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('disputesList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const disputeId = card.dataset.id;
    const adminNotes = card.querySelector('.dispute-notes').value.trim();
    try {
      if (btn.dataset.action === 'resolve-dispute') {
        await apiPut(`/api/admin/disputes/${disputeId}`, { status: 'resolved', adminNotes });
        toast('Dispute marked resolved.');
      } else if (btn.dataset.action === 'dismiss-dispute') {
        await apiPut(`/api/admin/disputes/${disputeId}`, { status: 'dismissed', adminNotes });
        toast('Dispute dismissed.');
      }
      loadDisputes();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('reportsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const id = card.dataset.id;
    if (btn.dataset.action === 'delete_target' && !confirm('Delete the reported content? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      await apiPost(`/api/admin/reports/${id}`, { action: btn.dataset.action });
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
