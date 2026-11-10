/* Amico Haus — Then & Now (loaded before main.js, after privacy-sweep.js).
   The owner's own dated list of work done on their home, and up to 4 photo pairs (an old photo next to today's, with
   a drag slider). Approved agents who can open the pre-listing see the list and the pairs; permit answers come from
   the server only for the owner, the agent they hired and agents they shared their contact info with. Every view
   carries the owner-reported label. Jury test: no money fields and no claims about the work, only the owner's own
   words, under a fixed list of categories. Mounts: owner #thenNowPanel, agent #thenNowAgentPanel (main.js).
   Uses client.js helpers (escapeHtml, apiGet, apiPost, apiPut, apiDelete, apiUpload, toast, toastActionError) and
   privacy-sweep.js (openPrivacySweep, sweepIsDone). */

// Same keys and labels as functions/_lib/thenNow.js (kept in sync by hand; then-now-test checks it).
const TN_CATEGORIES = { roof: 'Roof', solar: 'Solar', heating_cooling: 'Heating and cooling', water_heater: 'Water heater',
  windows_doors: 'Windows and doors', kitchen: 'Kitchen', bathroom: 'Bathroom', flooring: 'Flooring', paint: 'Paint',
  electrical: 'Electrical', plumbing: 'Plumbing', insulation: 'Insulation', yard: 'Yard and landscaping',
  patio_fence_driveway: 'Patio, fence or driveway', pool_spa: 'Pool or spa', garage: 'Garage', added_space: 'Added space', other: 'Other' };
const TN_PERMITS = { yes: 'Yes', no: 'No', not_sure: 'Not sure' };
const TN_OWNER_LABEL = "Owner-reported, not a disclosure. It doesn't replace your seller disclosures (like the TDS and SPQ).";
const TN_AGENT_LABEL = "Owner-reported, not a disclosure. It doesn't replace the seller's disclosures (like the TDS and SPQ).";
const TN_PERMIT_NOTE = 'Ask your agent how this gets disclosed.';
const TN_AGENT_PHOTO_NOTE = "Agents may not use these photos in ads or the MLS without the homeowner's OK.";
const TN_RIGHTS_ERROR = 'Please confirm you took these photos or have permission to use them.';
const TN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TN_MAX_PAIRS = 4;
const TN_PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

// The open home and what's on screen. picks: the Privacy Sweep result for each pair photo ({ original, file, swept }).
const TN_STATE = { preListingId: null, isOwner: false, data: null, editingId: null, picks: {} };

function tnWhenLabel(u) {
  return u.doneMonth ? `${TN_MONTHS[u.doneMonth - 1] || ''} ${u.doneYear}` : String(u.doneYear);
}

function tnUpgradeRowHtml(u, isOwner, canEdit) {
  const hasPermit = Object.prototype.hasOwnProperty.call(u, 'permit') && u.permit;
  const permit = hasPermit ? ` · Permit: ${escapeHtml(TN_PERMITS[u.permit] || '')}` : '';
  const askAgent = isOwner && (u.permit === 'no' || u.permit === 'not_sure') ? ` <span class="permit-note">${escapeHtml(TN_PERMIT_NOTE)}</span>` : '';
  // Edit while the home is open or awarded; Remove any time (taking something down is always allowed).
  const edit = isOwner && canEdit ? ` <button type="button" class="link-btn" data-tn-action="edit-upgrade" data-id="${Number(u.id)}">Edit</button>` : '';
  const remove = isOwner ? ` <button type="button" class="link-btn" data-tn-action="delete-upgrade" data-id="${Number(u.id)}">Remove</button>` : '';
  const buttons = edit + remove;
  return `<li class="upgrade-row"><strong>${escapeHtml(u.label || TN_CATEGORIES[u.category] || '')}</strong> · ${escapeHtml(tnWhenLabel(u))}${u.note ? ` · ${escapeHtml(u.note)}` : ''}${permit}${askAgent}${buttons}</li>`;
}

function tnPairHtml(pair, upgrades, isOwner) {
  const linked = upgrades.find(u => u.id === pair.upgradeId);
  const name = pair.caption || (linked ? linked.label : '') || 'photo pair';
  const id = Number(pair.id);
  const bits = [pair.caption ? escapeHtml(pair.caption) : '', pair.thenYear ? `Then: ${Number(pair.thenYear)}` : '',
    linked ? `${escapeHtml(linked.label)}, ${escapeHtml(tnWhenLabel(linked))}` : ''].filter(Boolean);
  return `<div class="tn-pair">
      <div class="tn-slider">
        <img class="tn-img" src="/api/then-now-photos/${id}/then" alt="Then: ${escapeHtml(name)}" loading="lazy">
        <img class="tn-img tn-now" src="/api/then-now-photos/${id}/now" alt="Now: ${escapeHtml(name)}" loading="lazy">
      </div>
      <input type="range" class="tn-range" min="0" max="100" value="50" aria-label="Drag to compare then and now">
      ${bits.length ? `<p class="tiny">${bits.join(' · ')}</p>` : ''}
      ${isOwner ? `<p class="tiny">${pair.sweptDone ? '<span class="sweep-chip">✓ Sweep done</span> ' : ''}<button type="button" class="link-btn" data-tn-action="delete-pair" data-id="${id}">Remove this pair</button></p>` : ''}
    </div>`;
}

function tnUpgradeFormHtml() {
  const year = new Date().getFullYear();
  const cats = Object.entries(TN_CATEGORIES).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
  const months = TN_MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  return `
      <div class="form-row two-col">
        <div class="field"><label for="tnCategory">What was done</label><select id="tnCategory"><option value="">Pick a category</option>${cats}</select></div>
        <div class="field"><label for="tnYear">Year</label><input type="number" id="tnYear" min="1900" max="${year}" step="1" inputmode="numeric"></div>
      </div>
      <div class="form-row two-col">
        <div class="field"><label for="tnMonth">Month (optional)</label><select id="tnMonth"><option value="">No month</option>${months}</select></div>
        <div class="field"><label for="tnPermit">Permit for this work?</label><select id="tnPermit"><option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option><option value="not_sure">Not sure</option></select>
          <p class="tiny field-hint">Only you, the agent you hire and agents you share your contact info with see permit answers.</p></div>
      </div>
      <div class="field"><label for="tnNote">Note (optional)</label><input type="text" id="tnNote" maxlength="120" placeholder="e.g. Quartz counters and new cabinets">
        <p class="tiny field-hint">Describe the work, not who lives here.</p></div>
      <div class="card-actions"><button type="button" class="btn btn-primary btn-sm" id="tnSaveUpgrade" data-tn-action="save-upgrade">Add upgrade</button><button type="button" class="btn btn-ghost btn-sm hidden" id="tnCancelEdit" data-tn-action="cancel-edit">Cancel</button></div>`;
}

function tnPairFormHtml(upgrades) {
  const year = new Date().getFullYear();
  const opts = upgrades.map(u => `<option value="${Number(u.id)}">${escapeHtml(u.label)}, ${escapeHtml(tnWhenLabel(u))}</option>`).join('');
  return `
      <h4>Add a photo pair</h4>
      <div class="form-row two-col">
        <div class="field"><label for="tnThen">Then (an older photo)</label><input type="file" id="tnThen" accept="${TN_PHOTO_TYPES}"></div>
        <div class="field"><label for="tnNow">Now (a photo from today)</label><input type="file" id="tnNow" accept="${TN_PHOTO_TYPES}"></div>
      </div>
      <p class="tiny" id="tnSweepStatus" role="status" aria-live="polite"></p>
      <div class="form-row two-col">
        <div class="field"><label for="tnCaption">Caption (optional)</label><input type="text" id="tnCaption" maxlength="80" placeholder="e.g. The kitchen"></div>
        <div class="field"><label for="tnThenYear">Year of the older photo (optional)</label><input type="number" id="tnThenYear" min="1900" max="${year}" step="1" inputmode="numeric"></div>
      </div>
      <div class="field"><label for="tnUpgrade">Goes with (optional)</label><select id="tnUpgrade"><option value="">No upgrade</option>${opts}</select></div>
      <label class="checkbox-row" for="tnRights"><input type="checkbox" id="tnRights"><span>I took these photos or have permission to use them.</span></label>
      <p class="tiny">Don't use photos from an old listing website unless you have permission.</p>
      <div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-tn-action="add-pair">Add photo pair</button></div>`;
}

function tnPanelHtml(data, isOwner) {
  const upgrades = data.upgrades || [];
  const pairs = data.pairs || [];
  const canEdit = isOwner && data.canEdit !== false;
  const label = data.label || (isOwner ? TN_OWNER_LABEL : TN_AGENT_LABEL);
  const list = upgrades.length
    ? `<ul class="upgrade-list">${upgrades.map(u => tnUpgradeRowHtml(u, isOwner, canEdit)).join('')}</ul>`
    : (isOwner ? '<p class="tiny">No upgrades listed yet.</p>' : '');
  const pairsHtml = pairs.map(p => tnPairHtml(p, upgrades, isOwner)).join('');
  if (!isOwner) {
    return `<div class="panel then-now-panel">
      <h3>Then &amp; Now</h3>
      <p class="tiny owner-reported">${escapeHtml(label)}</p>
      ${list}
      ${pairsHtml}
      ${pairs.length ? `<p class="tiny">${escapeHtml(TN_AGENT_PHOTO_NOTE)}</p>` : ''}
    </div>`;
  }
  return `<div class="panel then-now-panel">
      <h3>Then &amp; Now</h3>
      <p class="tiny">Show agents what you've done to your home: an old photo next to today's, and a dated list of your upgrades.</p>
      <p class="tiny owner-reported">${escapeHtml(label)}</p>
      ${list}
      ${canEdit ? tnUpgradeFormHtml() : ''}
      ${pairsHtml}
      ${canEdit && pairs.length < TN_MAX_PAIRS ? tnPairFormHtml(upgrades) : ''}
    </div>`;
}

async function loadThenNowInto(preListingId, isOwner) {
  const el = document.getElementById(isOwner ? 'thenNowPanel' : 'thenNowAgentPanel');
  if (!el) return;
  TN_STATE.preListingId = preListingId;
  TN_STATE.isOwner = !!isOwner;
  TN_STATE.editingId = null;
  TN_STATE.picks = {};
  try {
    const data = await apiGet(`/api/pre-listings/${encodeURIComponent(preListingId)}/then-now`);
    TN_STATE.data = data;
    // Agents see nothing at all until the owner adds something.
    if (!isOwner && !(data.upgrades || []).length && !(data.pairs || []).length) { el.innerHTML = ''; return; }
    el.innerHTML = tnPanelHtml(data, !!isOwner);
  } catch { el.innerHTML = ''; /* non-critical */ }
}

// ---- Owner actions (delegated, so it works for whichever pre-listing is open) ----
(function wireThenNow() {
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const reload = () => loadThenNowInto(TN_STATE.preListingId, true);
  const base = () => `/api/pre-listings/${encodeURIComponent(TN_STATE.preListingId)}`;

  const startEdit = (upgradeId) => {
    const u = ((TN_STATE.data && TN_STATE.data.upgrades) || []).find(x => x.id === upgradeId);
    if (!u) return;
    TN_STATE.editingId = u.id;
    set('tnCategory', u.category);
    set('tnYear', String(u.doneYear));
    set('tnMonth', u.doneMonth ? String(u.doneMonth) : '');
    set('tnNote', u.note || '');
    set('tnPermit', u.permit || '');
    const save = document.getElementById('tnSaveUpgrade');
    const cancel = document.getElementById('tnCancelEdit');
    if (save) save.textContent = 'Save changes';
    if (cancel) cancel.classList.remove('hidden');
    const first = document.getElementById('tnCategory');
    if (first) first.focus();
  };
  const stopEdit = () => {
    TN_STATE.editingId = null;
    ['tnCategory', 'tnYear', 'tnMonth', 'tnNote', 'tnPermit'].forEach(id => set(id, ''));
    const save = document.getElementById('tnSaveUpgrade');
    const cancel = document.getElementById('tnCancelEdit');
    if (save) save.textContent = 'Add upgrade';
    if (cancel) cancel.classList.add('hidden');
  };

  // The swept copy when the owner swept this exact pick, else the file as picked.
  const pickedFor = (which, input) => {
    const raw = input && input.files ? input.files[0] : null;
    const p = TN_STATE.picks[which];
    if (raw && p && p.original === raw) return { file: p.file, swept: p.swept && sweepIsDone(p.file) };
    return { file: raw, swept: false };
  };
  const showSweepStatus = () => {
    const el = document.getElementById('tnSweepStatus');
    if (!el) return;
    const line = (which, name) => {
      const p = TN_STATE.picks[which];
      if (!p) return '';
      return p.swept ? `${name} photo: ✓ Sweep done.` : (p.file !== p.original ? `${name} photo: swept.` : '');
    };
    el.textContent = [line('then', 'Then'), line('now', 'Now')].filter(Boolean).join(' ');
  };

  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!input || (input.id !== 'tnThen' && input.id !== 'tnNow')) return;
    const which = input.id === 'tnThen' ? 'then' : 'now';
    const file = input.files && input.files[0];
    delete TN_STATE.picks[which];
    showSweepStatus();
    if (!file || typeof openPrivacySweep !== 'function') return;
    openPrivacySweep([file], {
      onDone: (results) => {
        const r = results && results[0];
        if (r) TN_STATE.picks[which] = { original: file, file: r.file, swept: !!r.swept };
        showSweepStatus();
      },
    });
  });

  // The drag slider: how much of the "now" photo shows (CSSOM, so no inline style attribute).
  document.addEventListener('input', (e) => {
    const range = e.target;
    if (!range || !range.classList || !range.classList.contains('tn-range')) return;
    const pair = range.closest('.tn-pair');
    const slider = pair && pair.querySelector('.tn-slider');
    if (slider) slider.style.setProperty('--split', `${Math.max(0, Math.min(100, Number(range.value) || 0))}%`);
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-tn-action]') : null;
    if (!btn || !TN_STATE.preListingId) return;
    const action = btn.dataset.tnAction;
    const id = Number(btn.dataset.id);
    if (action === 'edit-upgrade') { startEdit(id); return; }
    if (action === 'cancel-edit') { stopEdit(); return; }
    btn.disabled = true;
    try {
      if (action === 'save-upgrade') {
        const body = { category: val('tnCategory'), doneYear: val('tnYear'), doneMonth: val('tnMonth'), note: val('tnNote'), permit: val('tnPermit') };
        if (!body.category) { toast('Pick a category.'); return; }
        if (!body.doneYear) { toast('Add the year the work was done.'); return; }
        if (TN_STATE.editingId) {
          await apiPut(`${base()}/upgrades/${TN_STATE.editingId}`, body);
          toast('Upgrade saved.');
        } else {
          await apiPost(`${base()}/upgrades`, body);
          toast('Upgrade added to your Then & Now list.');
        }
        await reload();
      } else if (action === 'delete-upgrade') {
        if (!confirm('Remove this upgrade from your list?')) return;
        await apiDelete(`${base()}/upgrades/${id}`);
        toast('Upgrade removed.');
        await reload();
      } else if (action === 'delete-pair') {
        if (!confirm('Remove this photo pair? Both photos are removed for good.')) return;
        await apiDelete(`${base()}/then-now/${id}`);
        toast('Photo pair removed.');
        await reload();
      } else if (action === 'add-pair') {
        const thenPick = pickedFor('then', document.getElementById('tnThen'));
        const nowPick = pickedFor('now', document.getElementById('tnNow'));
        if (!thenPick.file || !nowPick.file) { toast('Add a then photo and a now photo.'); return; }
        const rights = document.getElementById('tnRights');
        if (!rights || !rights.checked) { toast(TN_RIGHTS_ERROR); return; }
        const formData = new FormData();
        formData.append('then', thenPick.file);
        formData.append('now', nowPick.file);
        formData.append('caption', val('tnCaption'));
        formData.append('thenYear', val('tnThenYear'));
        formData.append('upgradeId', val('tnUpgrade'));
        formData.append('rights', '1');
        if (thenPick.swept && nowPick.swept) formData.append('swept', '1');
        await apiUpload(`${base()}/then-now`, formData);
        toast('Photo pair added.');
        await reload();
      }
    } catch (err) {
      if (typeof toastActionError === 'function') toastActionError(err); else toast(err.message);
    } finally { btn.disabled = false; }
  });
})();
