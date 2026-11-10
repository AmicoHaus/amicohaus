/* Amico Haus — the handoff binder on a pre-listing (loaded before main.js, which calls loadHandoffBinderInto from
   openPreListingDetail for the owner only). The homeowner's own house manual for the next owner, plus a short
   move-out checklist. Only the owner sees it; they print it or save it as a PDF from /pre-listing/<id>/binder.
   Owner notes, never a disclosure, and no codes (the server refuses them). Labels and limits are kept in sync by hand
   with functions/_lib/handoffBinder.js. Uses client.js helpers (apiGet, apiPut, escapeHtml, toast, toastActionError). */

const BINDER_NOT_DISCLOSURE = 'Owner notes, not a disclosure. Your seller disclosures (like the TDS and SPQ) are separate, and your agent handles those.';
const BINDER_CODES_NOTE = "Hand over gate, alarm, garage and lockbox codes in person. Don't write them here.";
const BINDER_SECTION_FIELDS = [
  ['water_yard', 'Water and yard', 'Sprinkler zones and timer, hose bibs, where the water shutoff is'],
  ['power_gas', 'Power and gas', 'Where the breaker panel is and what each breaker runs, where the gas shutoff is'],
  ['paint_finishes', 'Paint and finishes', 'Paint colors by room (brand and name), flooring and tile names'],
  ['trash', 'Trash and recycling', 'Pickup days and where the bins go'],
  ['hoa_amenities', 'HOA amenities', 'How the pool, gym or clubhouse access works (no codes), and how to reach the HOA'],
  ['next_owner_notes', 'Notes for the next owner', 'About the house: quirks, favorite features, where the manuals are'],
];
const BINDER_MOVE_OUT = [
  ['mail_forwarding', 'Forward your mail with USPS', 'https://www.usps.com/manage/forward.htm'],
  ['utilities', 'Set up or stop electric, gas, water and trash service (a recent bill shows who serves your home)', ''],
  ['dmv_address', 'Update your address with the DMV', 'https://www.dmv.ca.gov/'],
  ['insurance', 'Ask your insurance agent when to end your policy', ''],
  ['keys_remotes', 'Gather keys, garage remotes and manuals for closing', ''],
  ['own_photos', 'Take your own photos of each room before you hand over the keys', ''],
];
const BINDER_MAX_APPLIANCES = 20;
const BINDER_MAX_PHOTOS = 8;

// What the form was last drawn with (so "Add an appliance" can redraw it without losing typing).
const binderView = { preListingId: null, binder: null, photoIds: [], updatedAt: null };

function binderApplianceRowHtml(a, i) {
  const v = a || {};
  return `<div class="form-row two-col">
      <div class="field"><label for="binderApplianceItem-${i}">Appliance</label><input type="text" id="binderApplianceItem-${i}" maxlength="60" value="${escapeHtml(v.item || '')}" placeholder="e.g. Dishwasher"></div>
      <div class="field"><label for="binderApplianceBrand-${i}">Brand</label><input type="text" id="binderApplianceBrand-${i}" maxlength="40" value="${escapeHtml(v.brand || '')}"></div>
      <div class="field"><label for="binderApplianceYear-${i}">Year</label><input type="number" id="binderApplianceYear-${i}" min="1950" max="${new Date().getFullYear()}" value="${v.year ? Number(v.year) : ''}"></div>
      <div class="field"><label for="binderApplianceManual-${i}">Where the manual is</label><input type="text" id="binderApplianceManual-${i}" maxlength="80" value="${escapeHtml(v.manual || '')}"></div>
    </div>`;
}

function binderPanelHtml() {
  const b = binderView.binder || { sections: {}, appliances: [], photoIds: [], moveOut: [], printAddress: true };
  const id = binderView.preListingId;
  const sections = BINDER_SECTION_FIELDS.map(([key, label, placeholder]) => `
      <div class="field"><label for="binder_${key}">${escapeHtml(label)}</label><textarea id="binder_${key}" rows="3" maxlength="500" placeholder="${escapeHtml(placeholder)}">${escapeHtml((b.sections || {})[key] || '')}</textarea>
        ${key === 'next_owner_notes' ? '<p class="tiny field-hint">About the house, not the neighbors.</p>' : ''}
        <p class="tiny field-hint">${escapeHtml(BINDER_CODES_NOTE)}</p></div>`).join('');
  const rows = (b.appliances || []).length ? b.appliances : [{}];
  const appliances = rows.map(binderApplianceRowHtml).join('');
  const photos = (binderView.photoIds || []).length ? `
      <p class="label">Photos to include (up to ${BINDER_MAX_PHOTOS})</p>
      <div class="binder-photos">${binderView.photoIds.map(pid => `
        <label class="checkbox-row" for="binderPhoto-${pid}"><input type="checkbox" id="binderPhoto-${pid}" data-binder-photo="${pid}"${(b.photoIds || []).includes(pid) ? ' checked' : ''}><img src="/api/pre-listing-photos/${pid}" alt="Photo ${pid} of your home" loading="lazy"></label>`).join('')}</div>` : '';
  const moveOut = BINDER_MOVE_OUT.map(([key, label, link]) => `
      <label class="checkbox-row" for="binderMoveOut-${key}"><input type="checkbox" id="binderMoveOut-${key}" data-binder-move="${key}"${(b.moveOut || []).includes(key) ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>${link ? ` <a class="tiny" href="${link}" target="_blank" rel="noopener">${escapeHtml(link.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}`).join('');
  return `
    <div class="panel binder-panel">
      <h3>Handoff binder</h3>
      <p class="tiny">A house manual for the next owner: sprinklers, breakers, paint colors, appliances, trash day and how the HOA amenities work. Only you see it. Print it or save it as a PDF and hand it over at closing.</p>
      <p class="binder-banner">${escapeHtml(BINDER_NOT_DISCLOSURE)}</p>
      <p class="binder-banner">${escapeHtml(BINDER_CODES_NOTE)}</p>
      <div class="binder-form">
        ${sections}
        <p class="label">Appliances</p>
        <div id="binderAppliances">${appliances}</div>
        ${rows.length < BINDER_MAX_APPLIANCES ? '<button type="button" class="btn btn-ghost btn-sm" data-binder-action="add-appliance">Add an appliance</button>' : ''}
        ${photos}
        <p class="label">Move-out checklist</p>
        ${moveOut}
        <label class="checkbox-row" for="binderPrintAddress"><input type="checkbox" id="binderPrintAddress"${b.printAddress !== false ? ' checked' : ''}><span>Print my street address on the binder</span></label>
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-binder-action="save">Save binder</button>
          <a class="btn btn-ghost btn-sm" href="/pre-listing/${Number(id)}/binder" target="_blank" rel="noopener">Open printable binder</a>
        </div>
        ${binderView.updatedAt ? `<p class="tiny">Last saved ${escapeHtml(typeof shortDateLabel === 'function' ? shortDateLabel(binderView.updatedAt) : binderView.updatedAt)}.</p>` : ''}
      </div>
    </div>`;
}

// Everything typed into the form right now, in the shape the server takes.
function binderFromForm() {
  const val = (elId) => { const el = document.getElementById(elId); return el ? String(el.value || '').trim() : ''; };
  const sections = {};
  for (const [key] of BINDER_SECTION_FIELDS) sections[key] = val(`binder_${key}`);
  const appliances = [];
  const count = document.querySelectorAll('[id^="binderApplianceItem-"]').length;
  for (let i = 0; i < count; i++) {
    const a = { item: val(`binderApplianceItem-${i}`), brand: val(`binderApplianceBrand-${i}`), year: val(`binderApplianceYear-${i}`), manual: val(`binderApplianceManual-${i}`) };
    if (a.item || a.brand || a.year || a.manual) appliances.push({ ...a, year: a.year ? Number(a.year) : null });
  }
  const photoIds = [...document.querySelectorAll('[data-binder-photo]')].filter(el => el.checked).map(el => Number(el.dataset.binderPhoto));
  const moveOut = [...document.querySelectorAll('[data-binder-move]')].filter(el => el.checked).map(el => el.dataset.binderMove);
  const addr = document.getElementById('binderPrintAddress');
  return { sections, appliances, photoIds, moveOut, printAddress: addr ? !!addr.checked : true };
}

function binderRedraw() {
  const el = document.getElementById('binderPanel');
  if (el && String(binderView.preListingId) === el.dataset.binderPl) el.innerHTML = binderPanelHtml();
}

async function loadHandoffBinderInto(preListingId) {
  const el = document.getElementById('binderPanel');
  if (!el) return;
  try {
    const data = await apiGet(`/api/pre-listings/${preListingId}/binder`);
    Object.assign(binderView, { preListingId, binder: data.binder, photoIds: data.photoIds || [], updatedAt: data.updatedAt || null });
    el.dataset.binderPl = String(preListingId);
    el.innerHTML = binderPanelHtml();
  } catch { el.innerHTML = ''; /* non-critical: only the owner has a binder */ }
}

// ---- Clicks (delegated) ----
(function () {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-binder-action]');
    if (!btn || !btn.closest('#binderPanel')) return;
    const action = btn.dataset.binderAction;
    if (action === 'add-appliance') {
      const current = binderFromForm();
      binderView.binder = { ...current, appliances: [...current.appliances, {}].slice(0, BINDER_MAX_APPLIANCES) };
      binderRedraw();
      return;
    }
    if (action === 'save') {
      const body = binderFromForm();
      if (body.photoIds.length > BINDER_MAX_PHOTOS) { toast(`Pick up to ${BINDER_MAX_PHOTOS} photos.`); return; }
      btn.disabled = true;
      try {
        const res = await apiPut(`/api/pre-listings/${binderView.preListingId}/binder`, body);
        binderView.binder = body;
        binderView.updatedAt = res && res.updatedAt;
        toast('Binder saved.');
        binderRedraw();
      } catch (err) { toastActionError(err); } finally { btn.disabled = false; }
    }
  });
})();
