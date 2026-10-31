/* Amico Haus — Decision Night, Pitch Reels and finalist feedback on a pre-listing (loaded before main.js, which
   calls these renderers from openPreListingDetail). Reason labels are kept in sync by hand with
   functions/_lib/decisionNight.js. */

const DEBRIEF_REASON_LABELS = {
  pricing: 'Their pricing plan',
  marketing: 'Their marketing plan',
  local: 'Knowledge of the neighborhood',
  communication: 'Communication and responsiveness',
  experience: 'Experience and track record',
  fees_terms: 'Fees or terms',
  timing: 'Timing and availability',
  fit: 'Personal fit',
};
const DEBRIEF_MAX = 3;
const PITCH_MIN_SECONDS = 15;
const PITCH_MAX_SECONDS = 60;
const PITCH_MAX_BYTES = 95 * 1024 * 1024;

// What the Decision Night panels were last drawn with, for the handlers below.
const decisionView = { p: null, bids: [] };

function dnWhen(iso) {
  return new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The datetime-local value for a time, in the viewer's own time zone.
function localInputValue(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function liveBids(bids) {
  return (bids || []).filter(b => b.status !== 'withdrawn');
}

function openedTogether(bids) {
  return liveBids(bids).filter(b => !b.afterDecisionNight);
}

// ---- Homeowner ----
function decisionNightOwnerHtml(p, bids) {
  decisionView.p = p;
  decisionView.bids = bids || [];
  const dn = p.decisionNight;
  const parts = [];
  if (p.status === 'open') {
    if (!dn && liveBids(bids).length) {
      parts.push('<p class="tiny">A Decision Night is set before the first proposal arrives, so this time your proposals are open to you as they come in. On your next pre-listing you can set one right after posting.</p>');
    } else if (!dn) {
      // Suggest 3 days out at 7pm as a starting point.
      const suggest = new Date(Date.now() + 3 * 86400000);
      suggest.setHours(19, 0, 0, 0);
      parts.push(`
        <p class="tiny">Pick a time and every proposal opens to you at once, so the first one in doesn't set the bar for the rest. Until then you'll see how many came in, and agents can keep sending and improving theirs.</p>
        <div class="form-row two-col">
          <div class="field"><label for="decisionNightAt">Open all proposals on</label><input type="datetime-local" id="decisionNightAt" value="${localInputValue(suggest.getTime())}"></div>
          <div class="field dn-button-field"><button type="button" class="btn btn-primary btn-sm" data-dn-action="set">Set my Decision Night</button></div>
        </div>`);
    } else if (dn.sealed) {
      parts.push(`
        <p class="dn-sealed">🔒 <strong>${dn.sealedCount || 0} proposal${dn.sealedCount === 1 ? '' : 's'}</strong> sealed until <strong>${escapeHtml(dnWhen(dn.dueAt))}</strong>. Agents can still send and update proposals until then, and you'll get a message when they open.</p>
        <div class="form-row two-col">
          <div class="field"><label for="decisionNightAt">Move it later</label><input type="datetime-local" id="decisionNightAt" value="${localInputValue(Date.parse(dn.dueAt))}"></div>
          <div class="field dn-button-field"><button type="button" class="btn btn-ghost btn-sm" data-dn-action="set">Save new time</button> <button type="button" class="btn btn-ghost btn-sm" data-dn-action="open">Open them now</button></div>
        </div>`);
    } else {
      const late = liveBids(bids).filter(b => b.afterDecisionNight).length;
      parts.push(`<p class="tiny">Your Decision Night was ${escapeHtml(dnWhen(dn.dueAt))}: every proposal is open below.${late ? ` ${late} came in after it and ${late === 1 ? 'is' : 'are'} marked.` : ''}</p>`);
    }
  }
  const reels = liveBids(bids).filter(b => b.hasPitchVideo).length;
  const sealed = dn && dn.sealed;
  if (!sealed && reels && p.status === 'open') {
    parts.push(`<p><button type="button" class="btn btn-primary btn-sm" data-dn-action="reels">▶ Watch ${reels} pitch reel${reels === 1 ? '' : 's'}</button> <span class="tiny">Swipe right to shortlist, left to pass. Your picks stay private while you decide.</span></p>`);
  }
  if (p.status === 'awarded' && p.debrief) {
    const d = debriefHtml(p.debrief);
    if (d) parts.push(d);
  }
  // The card says the proposals opened together, so it's only offered after a Decision Night and counts only the
  // proposals that were in by then.
  const together = openedTogether(bids).length;
  if (dn && !sealed && together >= 2) {
    parts.push(`<p class="tiny"><button type="button" class="link-btn" data-dn-action="share-card">Make a share card</button>: "${together} agents competed for my home" (no names or fees), sized for stories and reels.</p>`);
  }
  if (!parts.length) return '';
  return `<div class="panel dn-panel" id="decisionNightPanel"><h3>Decision Night</h3>${parts.join('')}</div>`;
}

function debriefHtml(debrief) {
  if (!debrief.finalists.length) return '';
  if (debrief.sent) return '<p class="tiny">✅ Your finalists got your feedback. Thank you for helping them improve.</p>';
  return `
    <div class="debrief-form">
      <p><strong>Tell your finalists what tipped it</strong> <span class="tiny">(optional, private)</span></p>
      <p class="tiny">${debrief.finalists.map(f => escapeHtml(f.agentName)).join(', ')} ${debrief.finalists.length === 1 ? 'was a finalist' : 'were finalists'}. Pick up to ${DEBRIEF_MAX} reasons. They won't learn who you hired or any fee, just what mattered most.</p>
      <div class="debrief-reasons">
        ${Object.entries(DEBRIEF_REASON_LABELS).map(([k, label]) => `<label class="checkbox-row"><input type="checkbox" class="debrief-reason" value="${k}"><span>${escapeHtml(label)}</span></label>`).join('')}
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-dn-action="send-debrief">Send to ${debrief.finalists.length} finalist${debrief.finalists.length === 1 ? '' : 's'}</button>
    </div>`;
}

// The proposals section while Decision Night is sealed: just the count.
function sealedProposalsHtml(dn) {
  return `<h3>Proposals (${dn.sealedCount || 0})</h3><div class="empty-state">They open together on ${escapeHtml(dnWhen(dn.dueAt))}.</div>`;
}

// ---- Agent ----
function agentDecisionLineHtml(p) {
  const dn = p.decisionNight;
  if (!dn || p.status !== 'open') return '';
  return dn.sealed
    ? `<p class="inline-note">This homeowner opens every proposal together on <strong>${escapeHtml(dnWhen(dn.dueAt))}</strong>, unless they choose to open them sooner. Until then nobody sees yours, so take the time to make it your best; you can update it until then.</p>`
    : '';
}

function agentPitchHtml(p, myBid) {
  if (!myBid || myBid.status !== 'pending' || p.status !== 'open') return '';
  return `
    <div class="panel" id="pitchPanel" data-pre-listing-id="${p.id}">
      <h3>Pitch reel <span class="tiny">(optional)</span></h3>
      <p class="tiny">A ${PITCH_MIN_SECONDS}-${PITCH_MAX_SECONDS} second vertical video, just for this home: how you'd price it, market it and time it. Only this homeowner sees it, alongside your proposal. Keep it to the home and your plan: no talk about schools, crime or who lives in the area, and no promises about the sale price.</p>
      ${myBid.hasPitchVideo ? `
        <video controls preload="metadata" playsinline class="media-video media-video-sm" src="/api/pre-listings/${p.id}/pitch-video?v=${escapeHtml(myBid.pitchVersion || '')}"></video>
        <p><button type="button" class="btn btn-danger btn-sm" data-dn-action="remove-pitch">Remove pitch reel</button></p>` : ''}
      <div class="field"><label for="pitchVideoInput">${myBid.hasPitchVideo ? 'Replace it' : 'Record or choose a video'}</label><input type="file" id="pitchVideoInput" accept="video/mp4,video/quicktime,video/webm"></div>
      <p class="tiny" id="pitchVideoStatus" role="status" aria-live="polite"></p>
    </div>`;
}

// Best effort, like checkVideoDuration in main.js: a file whose length can't be read is let through.
function checkPitchDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = (fn) => { URL.revokeObjectURL(url); fn(); };
    v.onloadedmetadata = () => {
      const d = v.duration;
      if (!Number.isFinite(d)) return done(resolve);
      if (d < PITCH_MIN_SECONDS) return done(() => reject(new Error(`That video is ${Math.floor(d)} seconds; a pitch reel needs at least ${PITCH_MIN_SECONDS}.`)));
      if (d > PITCH_MAX_SECONDS + 1) return done(() => reject(new Error(`That video is ${Math.ceil(d)} seconds; keep a pitch reel to ${PITCH_MAX_SECONDS} seconds or less.`)));
      done(resolve);
    };
    v.onerror = () => done(resolve);
    v.src = url;
  });
}

// ---- Pitch reels viewer (homeowner): one agent at a time, full screen ----
function openPitchReels(preListingId, trigger) {
  const reels = liveBids(decisionView.bids).filter(b => b.hasPitchVideo);
  if (!reels.length || document.body.classList.contains('reel-open')) return;
  // Not yet picked first, so a second pass starts where there's still something to decide.
  reels.sort((a, b) => (a.ownerPick ? 1 : 0) - (b.ownerPick ? 1 : 0));
  let index = 0;
  let busy = false;
  let drawn = false;
  const overlay = document.createElement('div');
  overlay.className = 'reel-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Pitch reels');
  overlay.setAttribute('aria-modal', 'true');
  document.body.appendChild(overlay);
  document.body.classList.add('reel-open');

  const close = () => {
    overlay.remove();
    document.body.classList.remove('reel-open');
    document.removeEventListener('keydown', onKey, true);
    if (typeof rerenderProposalResults === 'function') rerenderProposalResults();
    if (typeof reorderInterviewAgents === 'function') reorderInterviewAgents(decisionView.bids);
    if (trigger && document.body.contains(trigger)) trigger.focus();
  };
  // One pick at a time: a second tap or swipe while the first is saving is ignored, so no reel gets skipped.
  const pick = async (choice) => {
    if (busy) return;
    busy = true;
    const b = reels[index];
    try {
      const { ownerPick } = await apiPut(`/api/pre-listings/${preListingId}/bids/${b.id}`, { action: b.ownerPick === choice ? 'clear' : choice });
      b.ownerPick = ownerPick;
      if (ownerPick && reels[index] === b && index < reels.length - 1) { index++; }
      draw();
    } catch (err) { toast(err.message); } finally { busy = false; }
  };
  // Captured before main.js's own Escape handler, which would otherwise also leave the pre-listing.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.repeat || (e.target && e.target.closest && e.target.closest('video, input, textarea, select'))) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); pick('shortlist'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); pick('pass'); }
  };
  document.addEventListener('keydown', onKey, true);

  function draw() {
    const focusedControl = document.activeElement && overlay.contains(document.activeElement) ? document.activeElement.dataset.reel : null;
    const b = reels[index];
    const lic = b.licenseNumber ? `DRE #${escapeHtml(b.licenseNumber)}` : '';
    overlay.innerHTML = `
      <div class="reel-stage">
        <div class="reel-top"><span class="reel-counter">${index + 1} of ${reels.length}</span><button type="button" class="btn btn-ghost btn-sm" data-reel="close">Close</button></div>
        <video class="reel-video" playsinline controls src="/api/pre-listings/${preListingId}/pitch-video?agent=${b.agentUserId}&v=${escapeHtml(b.pitchVersion || '')}"></video>
        <div class="reel-caption">
          <strong>${escapeHtml(b.agentName)}</strong>${b.isPlatformOperator ? ' · Platform operator' : ''}<br>
          <span>${[lic, escapeHtml(b.brokerageName || '')].filter(Boolean).join(' · ')}</span>
          ${b.ownerPick ? `<span class="reel-pick reel-pick-${b.ownerPick}">${b.ownerPick === 'shortlist' ? '★ Shortlisted' : 'Passed'}</span>` : ''}
        </div>
        <div class="reel-actions">
          <button type="button" class="btn btn-ghost" data-reel="pass">${b.ownerPick === 'pass' ? 'Undo pass' : '← Pass'}</button>
          <button type="button" class="btn btn-ghost" data-reel="prev"${index === 0 ? ' disabled' : ''}>Back</button>
          <button type="button" class="btn btn-ghost" data-reel="next"${index === reels.length - 1 ? ' disabled' : ''}>Next</button>
          <button type="button" class="btn btn-primary" data-reel="shortlist">${b.ownerPick === 'shortlist' ? 'Undo shortlist' : 'Shortlist →'}</button>
        </div>
        <p class="reel-report"><button type="button" class="link-btn" data-reel="report">Report this video</button></p>
      </div>`;
    const video = overlay.querySelector('.reel-video');
    video.play().catch(() => { /* the controls are there if autoplay is blocked */ });
    // Keep keyboard focus where it was (a redraw replaces the buttons); the first time, start on Close.
    const again = focusedControl && overlay.querySelector(`[data-reel="${focusedControl}"]:not([disabled])`);
    (again || (!drawn || focusedControl ? overlay.querySelector('[data-reel="close"]') : null) || { focus() {} }).focus();
    drawn = true;
  }

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reel]');
    if (!btn) return;
    const what = btn.dataset.reel;
    if (what === 'close') close();
    else if (what === 'pass' || what === 'shortlist') pick(what);
    else if (what === 'next' && index < reels.length - 1) { index++; draw(); }
    else if (what === 'prev' && index > 0) { index--; draw(); }
    else if (what === 'report' && typeof submitReport === 'function') submitReport('user', reels[index].agentUserId);
  });
  // Swipe (touch or pen only): right shortlists, left passes. Not from the video's own controls bar at the bottom
  // (dragging the seek bar is not a swipe), and a scroll the browser takes over cancels it.
  let startX = null;
  let startY = null;
  overlay.addEventListener('pointerdown', (e) => {
    startX = null;
    if (e.pointerType === 'mouse' || !e.target.closest('.reel-video, .reel-caption')) return;
    const video = overlay.querySelector('.reel-video');
    if (video && e.target.closest('.reel-video') && e.clientY > video.getBoundingClientRect().bottom - 64) return;
    startX = e.clientX;
    startY = e.clientY;
  });
  overlay.addEventListener('pointercancel', () => { startX = null; });
  overlay.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    const dy = Math.abs(e.clientY - startY);
    startX = null;
    if (Math.abs(dx) > 80 && dy < 60) pick(dx > 0 ? 'shortlist' : 'pass');
  });
  draw();
}

// ---- Share card: "N agents competed for my home" (9:16, no names, no fees) ----
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function makeShareCard(p, count) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#182430');
  bg.addColorStop(1, '#22303d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Everything stays inside the area TikTok/Reels/Stories leave uncovered (x 60-960, y 220-1480).
  const cx = 510;
  const maxW = 840;
  const font = (size, weight = 600) => `${weight} ${size}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#cf9f5e';
  ctx.font = font(44, 600);
  ctx.fillText('DECISION NIGHT', cx, 330);
  // Each block starts below the one before it, so a headline that wraps to 3 lines never runs into the brand.
  ctx.fillStyle = '#ffffff';
  ctx.font = font(112, 700);
  let y = 500;
  for (const l of wrapText(ctx, `${count} agents competed for my home`, maxW)) { ctx.fillText(l, cx, y); y += 126; }
  ctx.fillStyle = '#cf9f5e';
  ctx.font = font(60, 600);
  y += 20;
  ctx.fillText(`${p.city}${p.state ? `, ${p.state}` : ''}`, cx, y, maxW);
  ctx.fillStyle = '#e9e7e0';
  ctx.font = font(40, 400);
  y += 90;
  for (const l of wrapText(ctx, 'Their proposals and strategies, all opened together on Decision Night.', maxW)) { ctx.fillText(l, cx, y); y += 54; }
  const brandY = Math.max(y + 110, 1210);
  ctx.fillStyle = '#cf9f5e';
  ctx.font = font(76, 700);
  ctx.fillText('AMICO HAUS', cx, brandY);
  ctx.fillStyle = '#e9e7e0';
  ctx.font = font(36, 400);
  ctx.fillText('The real estate marketplace of tomorrow!', cx, brandY + 58);
  ctx.font = font(30, 400);
  ctx.fillText('Presented by Rudy Flores, Realtor® · DRE #02257808', cx, 1400);
  ctx.fillText('Coldwell Banker West', cx, 1444);

  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error("Your browser couldn't make the image.");
  const file = new File([blob], 'amico-haus-decision-night.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Decision Night on Amico Haus' }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Share card saved to your downloads.');
}

// ---- Event handling (delegated, so it works for whichever pre-listing is open) ----
(function wireDecisionNight() {
  const preListingId = () => (typeof marketplaceDetail !== 'undefined' && marketplaceDetail && marketplaceDetail.kind === 'pre_listing' ? marketplaceDetail.id : null);

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-dn-action]');
    if (!btn) return;
    const id = preListingId();
    if (!id) return;
    const action = btn.dataset.dnAction;
    btn.disabled = true;
    try {
      if (action === 'set') {
        const value = document.getElementById('decisionNightAt').value;
        if (!value) { toast('Pick a date and time.'); return; }
        await apiPut(`/api/pre-listings/${id}/decision-night`, { dueAt: new Date(value).toISOString() });
        toast('Decision Night is set. Agents will see the time.');
        openPreListingDetail(id);
      } else if (action === 'open') {
        if (!confirm('Open every proposal now? Agents planned around your Decision Night, but this is your call.')) return;
        await apiPut(`/api/pre-listings/${id}/decision-night`, { action: 'open' });
        openPreListingDetail(id);
      } else if (action === 'reels') {
        openPitchReels(id, btn);
      } else if (action === 'send-debrief') {
        const reasons = [...document.querySelectorAll('.debrief-reason:checked')].map(c => c.value);
        if (!reasons.length) { toast('Pick at least one reason.'); return; }
        if (reasons.length > DEBRIEF_MAX) { toast(`Pick up to ${DEBRIEF_MAX} reasons.`); return; }
        const { sent } = await apiPost(`/api/pre-listings/${id}/debrief`, { reasons });
        toast(sent ? `Sent to ${sent} finalist${sent === 1 ? '' : 's'}. Thank you!` : 'Your finalists already have your feedback.');
        openPreListingDetail(id);
      } else if (action === 'share-card') {
        await makeShareCard(decisionView.p, openedTogether(decisionView.bids).length);
      } else if (action === 'remove-pitch') {
        if (!confirm('Remove your pitch reel from this proposal?')) return;
        await apiDelete(`/api/pre-listings/${id}/pitch-video`);
        toast('Pitch reel removed.');
        openPreListingDetail(id);
      }
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  // At most 3 finalist reasons: the rest disable once 3 are ticked.
  document.addEventListener('change', async (e) => {
    if (e.target.classList.contains('debrief-reason')) {
      const boxes = [...document.querySelectorAll('.debrief-reason')];
      const n = boxes.filter(b => b.checked).length;
      boxes.forEach(b => { b.disabled = !b.checked && n >= DEBRIEF_MAX; });
      return;
    }
    if (e.target.id !== 'pitchVideoInput') return;
    const id = preListingId();
    const input = e.target;
    const file = input.files[0];
    if (!id || !file) return;
    const statusEl = document.getElementById('pitchVideoStatus');
    try {
      if (!statusEl) return;
      if (file.size > PITCH_MAX_BYTES) throw new Error(`That video is ${formatFileSize(file.size)}; the limit is 95 MB. Recording at 1080p usually keeps a 60-second clip under.`);
      await checkPitchDuration(file);
      input.disabled = true;
      statusEl.textContent = 'Uploading… this can take a minute.';
      const res = await fetch(`/api/pre-listings/${id}/pitch-video`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': file.type || 'video/mp4' }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 413 ? 'That video is too large to upload. Try recording at 1080p.' : data.error || 'Upload failed.');
      toast('Pitch reel added. The homeowner will see it with your proposal.');
      // The agent may have moved on to another pre-listing while a long upload ran.
      if (String(preListingId()) === String(id)) openPreListingDetail(id);
    } catch (err) {
      const status = document.getElementById('pitchVideoStatus');
      if (status && document.getElementById('pitchPanel') && document.getElementById('pitchPanel').dataset.preListingId === String(id)) {
        status.textContent = err.message;
        const again = document.getElementById('pitchVideoInput');
        if (again) { again.value = ''; again.disabled = false; }
      } else toast(err.message);
    }
  });
})();
