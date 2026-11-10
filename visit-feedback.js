/* Amico Haus — 3-tap visit feedback on a pre-listing (loaded before main.js, which calls loadVisitFeedbackInto from
   openPreListingDetail). After an accepted showing or a broker preview they RSVP'd to, the visiting agent answers three
   preset taps about the home: the asking price now that they've seen it, the condition, and the one thing that would
   help most. Only the homeowner sees the answers, with the agent's name and DRE number. No free text, never a count
   or an average across agents. Labels are kept in sync by hand with functions/_lib/visitFeedback.js; prep labels
   come from seller-prep.js (PREP_ITEM_LABELS). Uses client.js helpers (apiGet, apiPut, escapeHtml, toast,
   toastActionError). */

const VISIT_PRICE_LABELS = { high: 'Feels high', about_right: 'About right', low: 'Feels low' };
const VISIT_CONDITION_LABELS = { ready: 'Ready to list', touch_ups: 'A few touch-ups', needs_work: 'Needs work first' };
const VISIT_SENT_LINE = 'Sent. You can change your answers for 48 hours.';

function visitPrepLabel(key) {
  if (key === 'none') return 'Nothing needed';
  const labels = typeof PREP_ITEM_LABELS !== 'undefined' ? PREP_ITEM_LABELS : {};
  return labels[key] || '';
}

// "Nov 4" for a visit time (ISO), in Pacific time like everything else on the platform.
function visitDateLabel(isoText) {
  const d = new Date(isoText);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

function visitKindLabel(kind) {
  return kind === 'preview' ? 'broker preview' : 'showing';
}

// "Name · DRE #01234567 · Brokerage", plus the operator line for the account that runs Amico Haus.
function visitAgentLine(agent) {
  const a = agent || {};
  const line = [a.name, a.licenseNumber ? `DRE #${a.licenseNumber}` : '', a.brokerageName].filter(Boolean).join(' · ');
  return a.isOperator ? `${line} (platform operator: runs Amico Haus)` : line;
}

// ---- The homeowner's cards ----
function visitOwnerPanelHtml(data) {
  const rows = Array.isArray(data.feedback) ? data.feedback : [];
  if (!rows.length && !data.open) return '';
  const cards = rows.map(f => `
    <div class="vf-card">
      <p><strong>${escapeHtml(visitAgentLine(f.agent))}</strong></p>
      <p class="tiny">After the ${escapeHtml(visitDateLabel(f.visitAt))} ${visitKindLabel(f.visitKind)}</p>
      ${f.price ? `<p>Asking price: ${escapeHtml(VISIT_PRICE_LABELS[f.price] || '')}${f.aboutEarlierPrice ? ' (about your earlier price)' : ''}</p>` : ''}
      <p>Condition: ${escapeHtml(VISIT_CONDITION_LABELS[f.condition] || '')}</p>
      <p>Would help most: ${escapeHtml(visitPrepLabel(f.topPrep))}</p>
    </div>`).join('');
  return `
    <div class="panel visit-feedback-panel">
      <h3>Visit feedback</h3>
      <p class="tiny">Quick answers from agents after their visits, on Amico Haus only. Opinions about the home, not an appraisal.</p>
      ${cards || '<p class="tiny">No visit feedback yet. After an accepted showing or a broker preview, visiting agents can leave three quick taps here.</p>'}
    </div>`;
}

// ---- The visiting agent's cards (one per visit they can answer) ----
function visitTapsHtml(group, labels, chosen, locked) {
  return `<div class="vf-taps" role="group" aria-label="${group === 'price' ? 'The asking price' : 'Condition'}">${Object.entries(labels).map(([key, label]) =>
    `<button type="button" class="btn btn-ghost btn-sm vf-tap" data-vf-action="tap" data-group="${group}" data-value="${key}" aria-pressed="${chosen === key ? 'true' : 'false'}"${locked ? ' disabled' : ''}>${escapeHtml(label)}</button>`).join('')}</div>`;
}

function visitAgentCardHtml(visit, mine, priceOpen) {
  const key = `${visit.visitKind}-${visit.visitId}`;
  const editable = !mine || (mine.editableUntil && Date.parse(mine.editableUntil) > Date.now());
  const answers = mine && !mine.skipped ? mine : {};
  const prepKeys = typeof PREP_ITEM_LABELS !== 'undefined' ? Object.keys(PREP_ITEM_LABELS) : [];
  const options = ['<option value="">Pick one</option>', ...prepKeys.map(k => `<option value="${k}"${answers.topPrep === k ? ' selected' : ''}>${escapeHtml(visitPrepLabel(k))}</option>`),
    `<option value="none"${answers.topPrep === 'none' ? ' selected' : ''}>Nothing needed</option>`].join('');
  let status = '';
  if (mine && editable) status = `<p class="tiny">${mine.skipped ? "You marked this one as \"I didn't make it.\" You can change that for 48 hours." : VISIT_SENT_LINE}</p>`;
  else if (mine) status = `<p class="tiny">${mine.skipped ? "You marked this one as \"I didn't make it.\"" : 'Thanks, your answers were sent to the homeowner.'}</p>`;
  const selectId = `vfTopPrep-${escapeHtml(key)}`;
  return `
    <div class="vf-card" data-vf-kind="${escapeHtml(visit.visitKind)}" data-vf-id="${Number(visit.visitId)}">
      <p class="tiny">About the home, from your visit on ${escapeHtml(visitDateLabel(visit.visitAt))}. The homeowner sees your answers with your name and DRE number. Nothing here is public.</p>
      <p class="label">The asking price, now that you've seen it</p>
      ${priceOpen ? '<p class="tiny">This home was posted without a price. You can share a price opinion instead.</p>' : visitTapsHtml('price', VISIT_PRICE_LABELS, answers.price, !editable)}
      <p class="label">Condition</p>
      ${visitTapsHtml('condition', VISIT_CONDITION_LABELS, answers.condition, !editable)}
      <div class="field"><label for="${selectId}">One thing that would help most</label><select id="${selectId}"${editable ? '' : ' disabled'}>${options}</select></div>
      ${editable ? `<div class="card-actions">
        <button type="button" class="btn btn-primary btn-sm" data-vf-action="send">Send to the homeowner</button>
        <button type="button" class="btn btn-ghost btn-sm" data-vf-action="skip">I didn't make it</button>
      </div>` : ''}
      ${status}
    </div>`;
}

function visitAgentPanelHtml(data) {
  const eligible = Array.isArray(data.eligible) ? data.eligible : [];
  if (!eligible.length) return '';
  const mine = Array.isArray(data.mine) ? data.mine : [];
  const cards = eligible.map(v => visitAgentCardHtml(v, mine.find(m => m.visitKind === v.visitKind && m.visitId === v.visitId), !!data.priceOpen)).join('');
  return `
    <div class="panel visit-feedback-panel">
      <h3>Quick feedback for the homeowner</h3>
      ${cards}
    </div>`;
}

async function loadVisitFeedbackInto(preListingId, isOwner) {
  const el = document.getElementById(isOwner ? 'visitFeedbackPanel' : 'visitFeedbackAgentPanel');
  if (!el) return;
  try {
    const data = await apiGet(`/api/pre-listings/${preListingId}/visit-feedback`);
    el.dataset.vfPl = String(preListingId);
    el.innerHTML = isOwner ? visitOwnerPanelHtml(data || {}) : visitAgentPanelHtml(data || {});
  } catch { el.innerHTML = ''; /* non-critical: not an agent, or the home is gone */ }
}

// ---- Clicks (delegated, so it works for whichever pre-listing is open) ----
(function () {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-vf-action]');
    if (!btn) return;
    const card = btn.closest('.vf-card');
    const mount = btn.closest('[data-vf-pl]');
    if (!card || !mount) return;
    const action = btn.dataset.vfAction;
    if (action === 'tap') {
      card.querySelectorAll(`.vf-tap[data-group="${btn.dataset.group}"]`).forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      return;
    }
    const preListingId = mount.dataset.vfPl;
    const body = { visitKind: card.dataset.vfKind, visitId: Number(card.dataset.vfId) };
    if (action === 'skip') body.skipped = true;
    else {
      const pressed = (group) => { const b = card.querySelector(`.vf-tap[data-group="${group}"][aria-pressed="true"]`); return b ? b.dataset.value : ''; };
      const select = card.querySelector('select');
      body.price = pressed('price') || null;
      body.condition = pressed('condition');
      body.topPrep = select ? select.value : '';
      const needsPrice = !!card.querySelector('.vf-tap[data-group="price"]');
      if ((needsPrice && !body.price) || !body.condition || !body.topPrep) { toast('Pick an answer for each question.'); return; }
    }
    btn.disabled = true;
    try {
      await apiPut(`/api/pre-listings/${preListingId}/visit-feedback`, body);
      toast(action === 'skip' ? "Got it. Nothing was sent to the homeowner." : VISIT_SENT_LINE);
      loadVisitFeedbackInto(preListingId, false);
    } catch (err) { toastActionError(err); } finally { btn.disabled = false; }
  });
})();
