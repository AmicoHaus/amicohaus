/* Amico Haus — Timing Match on pre-listings and saved searches (loaded before main.js, which calls these renderers).
   The owner picks an ideal closing window and a stay after closing (days only, up to 29; the agents write any
   rent-back terms). A buyer can add a move-in window and a stay offer to a saved search. Owners see only a count of
   buyers whose timing fits (3 or more), buyers see only a "Timing fits" tag, and nobody else's dates are ever shown.
   Kept in sync by hand with functions/_lib/timingMatch.js. */

const TIMING_STAY_DAYS = [0, 7, 14, 29];
const TIMING_STAY_LABELS = { 0: 'No stay', 7: 'Up to 7 days', 14: 'Up to 14 days', 29: 'Up to 29 days' };

function timingPacificToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// 'YYYY-MM-DD' is read with Date.UTC and printed in UTC, so the day never shifts with the viewer's time zone.
function timingUtcDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

// "Mar 1 – May 31, 2027" in one year, "Dec 1, 2026 – Feb 15, 2027" across two; '' when either end is missing.
function timingWindowLabel(from, to) {
  const a = timingUtcDate(from), b = timingUtcDate(to);
  if (!a || !b) return '';
  const full = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  const left = a.getUTCFullYear() === b.getUTCFullYear()
    ? a.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : a.toLocaleDateString('en-US', full);
  return `${left} – ${b.toLocaleDateString('en-US', full)}`;
}

function timingStayOptionsHtml(selected) {
  const sel = TIMING_STAY_DAYS.includes(Number(selected)) ? Number(selected) : 0;
  return TIMING_STAY_DAYS.map(n => `<option value="${n}"${n === sel ? ' selected' : ''}>${TIMING_STAY_LABELS[n]}</option>`).join('');
}

function timingFieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function timingSetField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

// ---- The post form ("Post a pre-listing") ----
function timingFromPostForm() {
  return {
    closeFrom: timingFieldValue('plCloseFrom'),
    closeTo: timingFieldValue('plCloseTo'),
    stayAfterDays: Number(timingFieldValue('plStayAfterDays')) || 0,
  };
}

function resetPostFormTiming() {
  timingSetField('plCloseFrom', '');
  timingSetField('plCloseTo', '');
  timingSetField('plStayAfterDays', '0');
}

// ---- The pre-listing detail page ----
// One line in the facts card. The owner reads their own choice; an agent or admin reads it as the owner's preference.
function timingFactsHtml(p, isOwner) {
  const t = p && p.timing;
  if (!t || (!t.closeFrom && !t.stayAfterDays)) return '';
  const n = Number(t.stayAfterDays) || 0;
  const label = isOwner ? 'Your ideal closing' : "Ideal closing (owner's preference)";
  const when = timingWindowLabel(t.closeFrom, t.closeTo) || 'Not picked yet';
  const stay = isOwner
    ? (n ? `Stay up to ${n} days after closing` : 'No stay after closing')
    : (n ? `Would like to stay up to ${n} days after closing. The agents write any rent-back terms.` : 'No stay after closing.');
  return `<p class="tiny timing-line"><span class="label">${label}</span> ${escapeHtml(when)} · ${stay}</p>`;
}

// Owner only (the server sends timingDemand to nobody else, and only once 3 or more buyers fit).
function timingDemandHtml(p) {
  const n = p && Number(p.timingDemand);
  return n ? `<p class="demand-meter">🗓️ <strong>${n} interested buyers</strong> have a move-in window that fits yours.</p>` : '';
}

function timingMeterText(timing, timingDemand) {
  const n = Number(timingDemand) || 0;
  if (n) return `🗓️ ${n} interested buyers have a move-in window that fits yours.`;
  if (timing && timing.closeFrom) return "The count shows once 3 or more interested buyers' move-in windows fit yours.";
  return "Pick a window to see how many interested buyers' move-in windows fit yours (shown once there are 3 or more).";
}

function timingSummaryText(timing) {
  const label = timing ? timingWindowLabel(timing.closeFrom, timing.closeTo) : '';
  return `Timing: your ideal closing window${label ? ` (${label})` : ''}`;
}

// The owner's timing panel (one of the owner tools). A closed home shows its timing read-only.
function renderTimingPanel(p) {
  if (!p || !p.timing) return '';
  const t = p.timing;
  const closed = p.status === 'closed';
  const dis = closed ? ' disabled' : '';
  const today = timingPacificToday();
  const status = closed ? 'This pre-listing is closed.' : (t.windowPassed ? 'That window has passed. Pick a new one?' : '');
  const actions = closed ? '' : `<div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-tm-action="save-timing">Save timing</button><button type="button" class="btn btn-ghost btn-sm" data-tm-action="clear-timing">Clear</button></div>`;
  return `
    <details class="panel" id="timingPanel" data-pre-listing-id="${escapeHtml(String(p.id))}">
      <summary>${escapeHtml(timingSummaryText(t))}</summary>
      <p class="tiny">Pick when you'd ideally like to close and how long you'd like to stay after closing. Your agents write the rent-back terms. Stays are capped at 29 days.</p>
      <div class="form-row three-col">
        <div class="field"><label for="timingCloseFrom">Closing window starts</label><input type="date" id="timingCloseFrom" value="${escapeHtml(t.closeFrom || '')}" min="${today}"${dis}></div>
        <div class="field"><label for="timingCloseTo">Closing window ends</label><input type="date" id="timingCloseTo" value="${escapeHtml(t.closeTo || '')}" min="${today}"${dis}></div>
        <div class="field"><label for="timingStayAfterDays">Stay after closing</label><select id="timingStayAfterDays"${dis}>${timingStayOptionsHtml(t.stayAfterDays)}</select></div>
      </div>
      ${actions}
      <p class="tiny" id="timingStatus" role="status" aria-live="polite">${status}</p>
      <p class="tiny" id="timingMeter">${timingMeterText(t, p.timingDemand)}</p>
      <p class="tiny">Approved agents see your closing window and stay. Buyers never see your dates: a buyer whose saved search fits sees only a "Timing fits" tag.</p>
      <p class="tiny"><a href="/sell-or-buy-first">Selling and buying? Plan which to do first →</a></p>
    </details>`;
}

// ---- Browse ----
// A yes/no between two people's own entries, never a score. Not badge-active (that one pulses like a live listing).
function timingFitsBadgeHtml() {
  return `<span class="badge timing-fits" title="Your saved search's move-in window and stay line up with this owner's timing">Timing fits</span>`;
}

// ---- Saved searches ----
function savedSearchTimingFromForm() {
  return {
    moveFrom: timingFieldValue('savedMoveFrom'),
    moveTo: timingFieldValue('savedMoveTo'),
    stayOfferDays: Number(timingFieldValue('savedStayOffer')) || 0,
  };
}

function resetSavedSearchTimingForm() {
  timingSetField('savedMoveFrom', '');
  timingSetField('savedMoveTo', '');
  timingSetField('savedStayOffer', '0');
}

// Added after savedSearchLabel(s) on each row: the move-in window (if any) and a small form to add or change it.
function savedSearchTimingHtml(s) {
  if (!s) return '';
  const id = escapeHtml(String(s.id));
  const n = Number(s.stay_offer_days) || 0;
  const when = s.move_from ? timingWindowLabel(s.move_from, s.move_to) : '';
  const label = when ? ` · Move-in ${when} · ${n ? `seller can stay up to ${n} days` : 'no stay'}` : '';
  return `<span class="saved-timing">${escapeHtml(label)}</span>
    <button type="button" class="link-btn" data-tm-action="edit-search-timing" data-id="${id}">${s.move_from ? 'Edit timing' : 'Add move-in window'}</button>
    <div class="saved-timing-form hidden" id="savedTiming-${id}">
      <div class="form-row three-col">
        <div class="field"><label for="savedMoveFrom-${id}">Move-in window starts</label><input type="date" id="savedMoveFrom-${id}" value="${escapeHtml(s.move_from || '')}"></div>
        <div class="field"><label for="savedMoveTo-${id}">Move-in window ends</label><input type="date" id="savedMoveTo-${id}" value="${escapeHtml(s.move_to || '')}"></div>
        <div class="field"><label for="savedStayOffer-${id}">Seller could stay after closing</label><select id="savedStayOffer-${id}">${timingStayOptionsHtml(n)}</select></div>
      </div>
      <div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-tm-action="save-search-timing" data-id="${id}">Save</button><button type="button" class="btn btn-ghost btn-sm" data-tm-action="cancel-search-timing" data-id="${id}">Cancel</button></div>
    </div>`;
}

// ---- Actions (one delegated listener) ----
(function () {
  if (typeof document === 'undefined' || !document.addEventListener) return;

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // After a save: the panel's summary, status and meter, and the facts-card line, from what the server sent back.
  function showSaved(panel, res, message) {
    const summary = panel.querySelector('summary');
    if (summary) summary.textContent = timingSummaryText(res.timing);
    setText('timingStatus', message);
    setText('timingMeter', timingMeterText(res.timing, res.timingDemand));
    const line = document.querySelector('.timing-line');
    if (line) {
      const html = timingFactsHtml({ timing: res.timing }, true);
      if (html) line.outerHTML = html; else line.remove();
    }
  }

  async function saveTiming(btn, clear) {
    const panel = btn.closest('#timingPanel');
    if (!panel) return;
    const body = clear
      ? { closeFrom: '', closeTo: '', stayAfterDays: 0 }
      : { closeFrom: timingFieldValue('timingCloseFrom'), closeTo: timingFieldValue('timingCloseTo'), stayAfterDays: Number(timingFieldValue('timingStayAfterDays')) || 0 };
    btn.disabled = true;
    try {
      const res = await apiPut(`/api/pre-listings/${encodeURIComponent(panel.dataset.preListingId)}/timing`, body);
      if (clear) {
        timingSetField('timingCloseFrom', '');
        timingSetField('timingCloseTo', '');
        timingSetField('timingStayAfterDays', '0');
      }
      showSaved(panel, res, clear ? 'Timing cleared.' : 'Timing saved.');
    } catch (err) {
      setText('timingStatus', err.message);
      if (isRateLimitedError(err)) toastActionError(err);
    } finally {
      btn.disabled = false;
    }
  }

  async function saveSearchTiming(btn, id) {
    btn.disabled = true;
    try {
      await apiPut(`/api/saved-searches/${encodeURIComponent(id)}`, {
        moveFrom: timingFieldValue(`savedMoveFrom-${id}`),
        moveTo: timingFieldValue(`savedMoveTo-${id}`),
        stayOfferDays: Number(timingFieldValue(`savedStayOffer-${id}`)) || 0,
      });
      toast('Move-in window saved.');
      if (typeof loadSavedSearches === 'function') loadSavedSearches();
    } catch (err) {
      toastActionError(err);
      btn.disabled = false;
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-tm-action]') : null;
    if (!btn) return;
    const action = btn.dataset.tmAction;
    const id = btn.dataset.id;
    if (action === 'save-timing') saveTiming(btn, false);
    else if (action === 'clear-timing') saveTiming(btn, true);
    else if (action === 'edit-search-timing') {
      const form = document.getElementById(`savedTiming-${id}`);
      if (form) form.classList.toggle('hidden');
    } else if (action === 'save-search-timing') saveSearchTiming(btn, id);
    else if (action === 'cancel-search-timing') {
      const form = document.getElementById(`savedTiming-${id}`);
      if (form) form.classList.add('hidden');
    }
  });
})();
