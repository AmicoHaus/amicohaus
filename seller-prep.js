/* Amico Haus — seller prep tools on a pre-listing (loaded before main.js, which calls these renderers from
   openPreListingDetail): what agents would fix before listing, the video walkthrough, the "get listing-ready"
   checklist, broker preview windows, and interviewing the top agents. Item lists are kept in sync by hand with
   functions/_lib/sellerPrep.js. */

const PREP_ITEM_LABELS = {
  paint_inside: 'Fresh paint inside',
  paint_outside: 'Touch up the outside paint',
  curb_appeal: 'Curb appeal (landscaping, front door)',
  declutter: 'Declutter and depersonalize',
  staging: 'Professional staging',
  deep_clean: 'Deep clean (carpets, windows)',
  small_repairs: 'Small repairs (leaks, doors, fixtures)',
  flooring: 'Update worn flooring',
  lighting: 'Brighter lighting and fixtures',
  pre_inspection: 'A pre-listing inspection',
  termite: 'Termite inspection and report',
  roof_hvac: 'Roof or HVAC check-up',
};
const LISTING_READY_LABELS = {
  payoff: 'Ask your lender for a loan payoff estimate',
  hoa_docs: 'Gather HOA documents (CC&Rs, budget, recent minutes)',
  permits: 'Find permits and final sign-offs for any remodels',
  solar: 'Find solar lease or loan papers (if any)',
  warranties: 'Collect appliance, roof and system warranties',
  utilities: 'Note average utility bills',
  keys: 'Collect all keys, garage remotes and gate codes',
  repairs: 'Finish the repairs your agent recommends',
  photos: 'Schedule professional photos',
};
const INTERVIEW_FORMAT_LABELS = { phone: 'Phone call', video: 'Video call', in_person: 'In person' };
const SCORE_QUESTION_LABELS = {
  pricing: 'Explained their price clearly',
  marketing: 'Marketing plan',
  communication: 'Communication and responsiveness',
  local: 'Knows the neighborhood',
  terms: 'Fees and terms were clear',
  fit: 'Felt like a good fit',
};
const PRE_LISTING_VIDEO_MAX_SECONDS = 120;

// What the panels were last drawn with, so an action can redraw just its own panel (no jump back to the top).
const sellerPrepView = { p: null, bids: [], status: 'open' };

function rerenderVideoPanel(preListingId, changes) {
  const panel = document.getElementById('videoTourPanel');
  if (!panel || !sellerPrepView.p) return;
  // The owner may have moved on to another pre-listing while a slow upload finished.
  if (String(sellerPrepView.p.id) !== String(preListingId) || panel.dataset.preListingId !== String(preListingId)) return;
  Object.assign(sellerPrepView.p, changes);
  panel.outerHTML = renderVideoTourPanel(sellerPrepView.p, true) || '';
}
// Cloudflare refuses request bodies over 100MB on this plan.
const PRE_LISTING_VIDEO_MAX_BYTES = 95 * 1024 * 1024;

function whenLabel(iso) {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---- "Before listing, I'd…" (inside the agent's sealed opinion form) ----
function prepCheckboxesHtml(selected) {
  const on = new Set(selected || []);
  return `
    <details class="score-breakdown"${on.size ? ' open' : ''}>
      <summary>Before listing, I'd… (optional)</summary>
      <div class="prep-grid">
        ${Object.entries(PREP_ITEM_LABELS).map(([k, label]) => `<label class="checkbox-row"><input type="checkbox" data-prep-item value="${k}"${on.has(k) ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('')}
      </div>
    </details>`;
}

function selectedPrepItems() {
  return [...document.querySelectorAll('#priceOpinionPanel [data-prep-item]:checked')].map(i => i.value);
}

// The owner's "Fix before you list": each item with how many agents recommended it.
function prepSummaryHtml(prepSummary, agentCount) {
  if (!prepSummary || !prepSummary.length) return '';
  return `
    <div class="prep-summary">
      <span class="label">Fix before you list</span>
      <ul class="comp-list">${prepSummary.map(p => `<li><strong>${escapeHtml(p.label)}</strong> · ${p.count} of ${agentCount} agent${agentCount === 1 ? '' : 's'}</li>`).join('')}</ul>
    </div>`;
}

function prepListHtml(keys) {
  const labels = (keys || []).map(k => PREP_ITEM_LABELS[k]).filter(Boolean);
  return labels.length ? `<p class="tiny"><strong>Before listing, they'd:</strong> ${escapeHtml(labels.join(' · '))}</p>` : '';
}

// ---- Video walkthrough ----
function renderVideoTourPanel(p, isOwner) {
  sellerPrepView.p = p;
  const player = p.hasVideo ? `<video controls preload="metadata" playsinline class="media-video" src="/api/pre-listings/${p.id}/video?v=${encodeURIComponent(p.videoVersion || '')}"></video>` : '';
  if (!isOwner) return p.hasVideo ? `<div class="panel"><h3>Video walkthrough</h3>${player}</div>` : '';
  if (p.status !== 'open' && !p.hasVideo) return '';
  return `
    <div class="panel" id="videoTourPanel" data-pre-listing-id="${p.id}">
      <h3>Video walkthrough</h3>
      <p class="tiny">A short phone video (up to 2 minutes) lets agents weigh in on your price without a visit. Only you and approved agents can watch it.</p>
      ${player}
      ${p.status === 'open' ? `<div class="field"><label for="preListingVideoInput">${p.hasVideo ? 'Replace the video' : 'Add a video'} (MP4 or MOV, under 95MB)</label><input type="file" id="preListingVideoInput" accept="video/mp4,video/quicktime,video/webm"></div>` : ''}
      ${p.hasVideo ? '<button type="button" class="btn btn-ghost btn-sm" data-sp-action="remove-video">Remove video</button>' : ''}
      <p class="tiny" id="videoTourStatus" role="status" aria-live="polite"></p>
    </div>`;
}

// ---- Get listing-ready (owner only) ----
function renderListingReadyPanel(p) {
  const checked = new Set(p.listingReady || []);
  const total = Object.keys(LISTING_READY_LABELS).length;
  return `
    <details class="panel" id="listingReadyPanel" data-pre-listing-id="${p.id}">
      <summary>Get listing-ready (<span id="listingReadyCount">${checked.size}</span>/${total})</summary>
      <div class="field"><label for="targetListDate">I'd like to list by</label><input type="date" id="targetListDate" value="${escapeHtml(p.targetListDate || '')}" min="${new Date().toLocaleDateString('en-CA')}"></div>
      <p class="tiny" id="listingReadyCountdown">${countdownText(p.targetListDate)}</p>
      ${Object.entries(LISTING_READY_LABELS).map(([k, label]) => `<label class="checkbox-row"><input type="checkbox" class="listing-ready-check" value="${k}"${checked.has(k) ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('')}
    </details>`;
}

function countdownText(date) {
  if (!date) return 'Pick a date and this list becomes your countdown.';
  const [y, m, d] = date.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);
  if (days < 0) return 'That date has passed. Pick a new one?';
  if (days === 0) return 'Listing day is today. You\'ve got this!';
  return `${days} day${days === 1 ? '' : 's'} to go.`;
}

async function saveListingReady(changedBox) {
  const panel = document.getElementById('listingReadyPanel');
  if (!panel) return;
  const checked = [...panel.querySelectorAll('.listing-ready-check:checked')].map(c => c.value);
  const targetListDate = document.getElementById('targetListDate').value;
  try {
    await apiPut(`/api/pre-listings/${panel.dataset.preListingId}/listing-ready`, { checked, targetListDate });
    document.getElementById('listingReadyCount').textContent = String(checked.length);
    document.getElementById('listingReadyCountdown').textContent = countdownText(targetListDate);
  } catch (err) {
    // Undo the tick that didn't save, and show the reason by the date.
    if (changedBox) changedBox.checked = !changedBox.checked;
    document.getElementById('listingReadyCountdown').textContent = err.message;
  }
}

// ---- Broker preview windows ----
async function loadPreviewsInto(preListingId, isOwner, status) {
  const el = document.getElementById('previewsPanel');
  if (!el) return;
  if (status) sellerPrepView.status = status;
  const open = sellerPrepView.status === 'open';
  try {
    const { previews, address } = await apiGet(`/api/pre-listings/${preListingId}/previews`);
    // Agents only see open pre-listings' windows; an owner with nothing scheduled on a closed one sees nothing.
    if (!previews.length && (!isOwner || !open)) { el.innerHTML = ''; return; }
    const going = previews.some(pv => pv.imGoing);
    const rows = previews.map(pv => `
      <div class="mini-block preview-row">
        <strong>${escapeHtml(whenLabel(pv.startsAt))}</strong> to ${escapeHtml(new Date(pv.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}
        ${pv.note ? `<br><span class="tiny">${escapeHtml(pv.note)}</span>` : ''}
        <br><span class="tiny">${pv.rsvpCount} agent${pv.rsvpCount === 1 ? '' : 's'} coming${isOwner && pv.agents.length ? `: ${escapeHtml(pv.agents.map(a => a.agentName).join(', '))}` : ''}${!isOwner && pv.imGoing ? ', including you' : ''}</span>
        ${open ? `<div class="card-actions">
          ${isOwner
            ? `<button type="button" class="btn btn-ghost btn-sm" data-sp-action="cancel-preview" data-id="${pv.id}">Cancel this window</button>`
            : `<button type="button" class="btn ${pv.imGoing ? 'btn-ghost' : 'btn-primary'} btn-sm" data-sp-action="rsvp-preview" data-id="${pv.id}" data-going="${pv.imGoing ? '0' : '1'}">${pv.imGoing ? "I can't make it" : "I'll be there"}</button>`}
        </div>` : ''}
      </div>`).join('');
    const form = isOwner && open ? `
      <div class="form-row two-col">
        <div class="field"><label for="previewStart">Starts</label><input type="datetime-local" id="previewStart"></div>
        <div class="field"><label for="previewEnd">Ends</label><input type="datetime-local" id="previewEnd"></div>
      </div>
      <div class="field"><label for="previewNote">Note for agents (optional)</label><input type="text" id="previewNote" maxlength="300" placeholder="e.g. Park on the street; the dog will be out."></div>
      <button type="button" class="btn btn-primary btn-sm" data-sp-action="add-preview">Open a preview window</button>` : '';
    const intro = isOwner
      ? 'Open a window when agents can walk through, so they can give you their price after seeing it in person. Agents who RSVP get your street address, and you get a notice each time one does.'
      : going ? (address ? "You're on the list. Here's the address:" : "You're on the list. Message the homeowner for directions.") : 'The homeowner opened these times to walk through. RSVP to get the street address.';
    el.innerHTML = `
      <div class="panel">
        <h3>Broker preview${isOwner ? 's' : ''}</h3>
        <p class="tiny">${intro}</p>
        ${address && !isOwner ? `<p class="tiny"><span class="label">Address</span> ${escapeHtml(address)}</p>` : ''}
        ${rows || '<p class="tiny">No upcoming windows.</p>'}
        ${form}
      </div>`;
  } catch { /* non-critical */ }
}

// ---- Interviews ----
const INTERVIEW_FORMAT_PHRASES = { phone: 'a phone call', video: 'a video call', in_person: 'to meet in person' };

async function loadInterviewsInto(preListingId, isOwner, bids, status) {
  const el = document.getElementById('interviewsPanel');
  if (!el) return;
  if (bids) sellerPrepView.bids = bids;
  if (status) sellerPrepView.status = status;
  try {
    const { interviews } = await apiGet(`/api/pre-listings/${preListingId}/interviews`);
    el.innerHTML = isOwner ? ownerInterviewsHtml(interviews, sellerPrepView.bids, sellerPrepView.status) : agentInterviewHtml(interviews[0], sellerPrepView.status);
  } catch { /* non-critical */ }
}

// A request whose offered times have all gone by: the owner can offer new ones.
function timesPassed(i) {
  return i.status === 'requested' && !i.slots.some(s => new Date(s).getTime() > Date.now());
}

function ownerInterviewsHtml(interviews, bids, status) {
  const open = status === 'open';
  const live = interviews.filter(i => i.status === 'scheduled' || (i.status === 'requested' && !timesPassed(i)));
  const askable = bids.filter(b => (b.status === 'pending' || b.status === 'accepted')
    && !interviews.some(i => i.agentUserId === b.agentUserId && i.status !== 'canceled' && !timesPassed(i)))
    // The agents shortlisted from the pitch reels come first.
    .sort((a, b) => (a.ownerPick === 'shortlist' ? 0 : 1) - (b.ownerPick === 'shortlist' ? 0 : 1));
  const badge = i => (i.status === 'scheduled' ? ['badge-active', 'Scheduled'] : i.status === 'done' ? ['badge-paused', 'Done'] : timesPassed(i) ? ['badge-paused', 'Times passed'] : ['badge-gold', 'Awaiting their pick']);
  const cards = interviews.filter(i => i.status !== 'canceled').map(i => {
    const [tone, label] = badge(i);
    return `
    <div class="card interview-card" data-agent-id="${i.agentUserId}">
      <div class="card-head"><h4>${escapeHtml(i.agentName)}</h4><span class="badge ${tone}">${label}</span></div>
      <p class="tiny">${escapeHtml(INTERVIEW_FORMAT_LABELS[i.format] || '')} · ${i.chosenSlot ? `<strong>${escapeHtml(whenLabel(i.chosenSlot))}</strong>` : timesPassed(i) ? (open ? 'The times you offered have passed. Offer new ones below.' : 'The times you offered have passed.') : `Times offered: ${escapeHtml(i.slots.map(s => whenLabel(s)).join(' · '))}`}</p>
      <div class="card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="message-user" data-id="${i.agentUserId}" data-name="${escapeHtml(i.agentName)}">Message ${escapeHtml(i.agentName)}</button>
        ${i.status === 'scheduled' ? `<button type="button" class="btn btn-ghost btn-sm" data-sp-action="finish-interview" data-agent-id="${i.agentUserId}">Mark interview done</button>` : ''}
        ${i.status === 'requested' || i.status === 'scheduled' ? `<button type="button" class="btn btn-ghost btn-sm" data-sp-action="cancel-interview" data-agent-id="${i.agentUserId}">Cancel</button>` : ''}
      </div>
      <details class="score-breakdown"${Object.keys(i.scores || {}).length || i.ownerNotes ? ' open' : ''}>
        <summary>Your scorecard (only you see it; 1 = poor, 5 = great)</summary>
        ${Object.entries(SCORE_QUESTION_LABELS).map(([k, qLabel]) => `
          <div class="field score-field"><label for="score-${i.agentUserId}-${k}">${escapeHtml(qLabel)}</label>
            <select id="score-${i.agentUserId}-${k}" data-score="${k}"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${i.scores && i.scores[k] === n ? ' selected' : ''}>${n}</option>`).join('')}</select>
          </div>`).join('')}
        <div class="field"><label for="interviewNotes-${i.agentUserId}">Notes</label><textarea id="interviewNotes-${i.agentUserId}" maxlength="1000">${escapeHtml(i.ownerNotes || '')}</textarea></div>
        <button type="button" class="btn btn-primary btn-sm" data-sp-action="save-scorecard" data-agent-id="${i.agentUserId}">Save scorecard</button>
      </details>
    </div>`;
  }).join('');
  const form = open && askable.length && live.length < 3 ? `
    <div class="interview-request">
      <div class="form-row two-col">
        <div class="field"><label for="interviewAgent">Agent</label><select id="interviewAgent">${askable.map(b => `<option value="${b.agentUserId}">${b.ownerPick === 'shortlist' ? '★ ' : ''}${escapeHtml(b.agentName)}</option>`).join('')}</select></div>
        <div class="field"><label for="interviewFormat">How</label><select id="interviewFormat">${Object.entries(INTERVIEW_FORMAT_LABELS).map(([k, v]) => `<option value="${k}"${k === 'video' ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="form-row three-col">
        ${[1, 2, 3].map(n => `<div class="field"><label for="interviewSlot${n}">Time ${n}${n > 1 ? ' (optional)' : ''}</label><input type="datetime-local" id="interviewSlot${n}"></div>`).join('')}
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-sp-action="request-interview">Ask for an interview</button>
    </div>` : open && live.length >= 3 ? '<p class="tiny">You have 3 interviews going. Finish or cancel one to ask someone else.</p>' : '';
  if (!cards && !form) return '';
  return `
    <div class="panel">
      <h3>Interview your top agents</h3>
      <p class="tiny">Ask up to 3 agents who sent you a proposal for a short interview. They pick one of your times; use messages to share a call link, number or meeting place. Your scorecard keeps the answers comparable.</p>
      ${cards}
      ${form}
    </div>`;
}

// After a shortlist / pass: the "who to interview" options re-sorted in place (shortlisted first), so nothing typed
// in the interviews panel is lost to a reload.
function reorderInterviewAgents(bids) {
  const select = document.getElementById('interviewAgent');
  if (!select) return;
  const pickOf = new Map((bids || []).map(b => [String(b.agentUserId), b.ownerPick]));
  const chosen = select.value;
  const options = [...select.options];
  for (const o of options) {
    const name = o.textContent.replace(/^★ /, '');
    o.textContent = pickOf.get(o.value) === 'shortlist' ? `★ ${name}` : name;
  }
  options.sort((a, b) => (pickOf.get(a.value) === 'shortlist' ? 0 : 1) - (pickOf.get(b.value) === 'shortlist' ? 0 : 1));
  options.forEach(o => select.appendChild(o));
  select.value = chosen;
}

function agentInterviewHtml(i, status) {
  if (!i || status !== 'open' || i.status === 'canceled' || i.status === 'done') return '';
  const owner = sellerPrepView.p;
  const future = i.slots.filter(s => new Date(s).getTime() > Date.now());
  return `
    <div class="panel">
      <h3>Interview request</h3>
      <p class="tiny">The homeowner would like ${escapeHtml(INTERVIEW_FORMAT_PHRASES[i.format] || 'to talk')}. ${i.chosenSlot ? `You picked <strong>${escapeHtml(whenLabel(i.chosenSlot))}</strong>. You can switch to another time below.` : 'Pick a time that works:'}</p>
      <div class="card-actions">
        ${future.map(s => `<button type="button" class="btn ${s === i.chosenSlot ? 'btn-primary' : 'btn-ghost'} btn-sm" data-sp-action="pick-interview-slot" data-slot="${escapeHtml(s)}" aria-pressed="${s === i.chosenSlot}">${escapeHtml(whenLabel(s))}</button>`).join('') || '<span class="tiny">All the offered times have passed. Message the homeowner for new ones.</span>'}
      </div>
      ${owner ? `<div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="message-user" data-id="${owner.userId}" data-name="${escapeHtml(owner.owner)}">Message the homeowner</button></div>` : ''}
    </div>`;
}

// ---- Event handling for all of the above (delegated, so it works for whichever pre-listing is open) ----
(function wireSellerPrep() {
  const preListingId = () => (typeof marketplaceDetail !== 'undefined' && marketplaceDetail && marketplaceDetail.kind === 'pre_listing' ? marketplaceDetail.id : null);

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-sp-action]');
    if (!btn) return;
    const id = preListingId();
    if (!id) return;
    const action = btn.dataset.spAction;
    btn.disabled = true;
    try {
      if (action === 'remove-video') {
        if (!confirm('Remove the video walkthrough?')) return;
        await apiDelete(`/api/pre-listings/${id}/video`);
        toast('Video removed.');
        rerenderVideoPanel(id, { hasVideo: false, videoVersion: null });
      } else if (action === 'add-preview') {
        const start = document.getElementById('previewStart').value;
        const end = document.getElementById('previewEnd').value;
        if (!start || !end) { toast('Pick a start and end time.'); return; }
        await apiPost(`/api/pre-listings/${id}/previews`, { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), note: document.getElementById('previewNote').value.trim() });
        toast('Preview window opened. Agents who weighed in will get a heads-up.');
        loadPreviewsInto(id, true);
      } else if (action === 'cancel-preview') {
        if (!confirm('Cancel this preview window? Agents who RSVP\'d will be told.')) return;
        await apiDelete(`/api/pre-listings/${id}/previews/${btn.dataset.id}`);
        loadPreviewsInto(id, true);
      } else if (action === 'rsvp-preview') {
        await apiPut(`/api/pre-listings/${id}/previews/${btn.dataset.id}`, { going: btn.dataset.going === '1' });
        toast(btn.dataset.going === '1' ? "You're on the list." : 'RSVP removed.');
        loadPreviewsInto(id, false);
      } else if (action === 'request-interview') {
        const slots = [1, 2, 3].map(n => document.getElementById(`interviewSlot${n}`).value).filter(Boolean).map(v => new Date(v).toISOString());
        if (!slots.length) { toast('Offer at least one time.'); return; }
        await apiPost(`/api/pre-listings/${id}/interviews`, { agentUserId: Number(document.getElementById('interviewAgent').value), format: document.getElementById('interviewFormat').value, slots });
        toast('Interview request sent.');
        loadInterviewsInto(id, true);
      } else if (action === 'pick-interview-slot') {
        await apiPut(`/api/pre-listings/${id}/interviews/${currentUser ? currentUser.id : ''}`, { chosenSlot: btn.dataset.slot });
        toast('Time picked. The homeowner has been told.');
        loadInterviewsInto(id, false);
      } else if (action === 'cancel-interview') {
        if (!confirm('Cancel this interview request?')) return;
        await apiPut(`/api/pre-listings/${id}/interviews/${btn.dataset.agentId}`, { action: 'cancel' });
        loadInterviewsInto(id, true);
      } else if (action === 'save-scorecard' || action === 'finish-interview') {
        const card = btn.closest('.interview-card');
        const notes = document.getElementById(`interviewNotes-${btn.dataset.agentId}`);
        const scores = {};
        card.querySelectorAll('[data-score]').forEach(s => { if (s.value) scores[s.dataset.score] = Number(s.value); });
        await apiPut(`/api/pre-listings/${id}/interviews/${btn.dataset.agentId}`, { scores, ownerNotes: notes ? notes.value : '', done: action === 'finish-interview' });
        toast(action === 'finish-interview' ? 'Marked done. Your scorecard is saved.' : 'Scorecard saved.');
        if (action === 'finish-interview') loadInterviewsInto(id, true);
      }
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.addEventListener('change', async (e) => {
    if (e.target.id === 'targetListDate') { saveListingReady(null); return; }
    if (e.target.classList.contains('listing-ready-check')) { saveListingReady(e.target); return; }
    if (e.target.id !== 'preListingVideoInput') return;
    const id = preListingId();
    const input = e.target;
    const file = input.files[0];
    if (!id || !file) return;
    const statusEl = document.getElementById('videoTourStatus');
    try {
      if (file.size > PRE_LISTING_VIDEO_MAX_BYTES) throw new Error(`That video is ${formatFileSize(file.size)}; the limit is 95 MB. Exporting at 1080p usually brings it under.`);
      await checkVideoDuration(file, PRE_LISTING_VIDEO_MAX_SECONDS);
      input.disabled = true;
      statusEl.textContent = 'Uploading… this can take a minute on a phone connection.';
      const res = await fetch(`/api/pre-listings/${id}/video`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': file.type }, body: file });
      const data = await res.json().catch(() => ({}));
      if (res.status === 413) throw new Error('That video is too large to upload. Exporting at 1080p or trimming it usually fixes this.');
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      toast('Video added. Agents can watch it now.');
      rerenderVideoPanel(id, { hasVideo: true, videoVersion: data.videoVersion });
    } catch (err) {
      // Looked up again: the panel may have been redrawn (or the owner moved on) while the upload ran.
      const current = document.getElementById('videoTourStatus');
      if (current && preListingId() === id) current.textContent = err.message;
      else toast(err.message);
      if (document.body.contains(input)) { input.disabled = false; input.value = ''; }
    }
  });
})();
