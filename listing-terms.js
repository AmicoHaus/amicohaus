/* Amico Haus — Terms Wishlist, Owner Will Carry, Sell and Stay and Step-Down Price in the app (loaded before main.js).
   Needs client.js first (api/apiPut/apiDelete, escapeHtml, toast). Globals: the 11 functions main.js and the other
   scripts call (ltFieldsHtml ... ltPreListingFilterParams); every other name starts with LT_/lt or lives in the IIFE
   at the end. The strings and the schedule math mirror functions/_lib/listingTerms.js and functions/_lib/stepDown.js:
   keep them in sync by hand (tools/listing-terms-test.mjs and tools/step-down-test.mjs compare them).
   Each tool shows only when it is live for this person (window.NUANCED, from GET /api/nuanced-tools). */

// ---- Terms Wishlist: home and sale terms only, ranked by the order the owner taps them. Never free text. ----
const LT_WISHLIST_ITEMS = {
  quick_close: 'A quick closing (about 30 days or less)',
  flexible_close: 'A flexible closing date',
  stay_after: 'Time to stay after closing (a short rent-back)',
  as_is: 'An as-is sale',
  few_contingencies: 'Fewer contingencies',
  home_sale_ok: 'Open to a buyer who needs to sell a home first',
  items_stay: 'Leaving appliances or furniture with the home',
  simple_handoff: 'A simple handoff (keys, manuals and warranties ready)',
};
const LT_WISHLIST_MAX = 5;
const LT_WISHLIST_HEADING = 'What matters to this seller besides price (from the owner)';
const LT_WISHLIST_LINE = "A wish list, not a requirement or an offer. It's about the sale, never about the buyer. Terms are agreed in writing, with your agents.";
const LT_WISHLIST_BUYER_LINE = 'Inspections and contingencies protect buyers. Talk with your agent before giving any up.';
const LT_WISHLIST_FORM_LABEL = 'What matters to you besides price (optional)';
const LT_WISHLIST_FORM_HELP = "Pick the sale terms that matter to you besides price. It's about the sale, never about the buyer.";
const LT_WISHLIST_FORM_TAP = 'Tap in order of importance, up to 5';
// ---- Owner Will Carry: two yes/no flags as the owner states them. No rate, amount, term or payment anywhere. ----
const LT_FINANCING_HEADING = 'Financing ideas (from the owner)';
const LT_OWNER_CARRY_LINE = "The owner says they're open to seller financing. No terms are offered here: they're between you, your agents and a licensed loan professional. Federal and state lending rules apply.";
const LT_ASSUMABLE_LINE = 'The owner says their loan may be assumable. The loan servicer decides; ask them what applies.';
const LT_FINANCING_FORM_LABEL = 'Financing ideas (optional)';
const LT_OWNER_CARRY_LABEL = "I'm open to carrying a note (seller financing)";
const LT_OWNER_CARRY_HELP = 'Just a yes or no. Leave out any rate, amount, down payment, term or payment; those are worked out later with your agents and a licensed loan professional.';
const LT_ASSUMABLE_LABEL = 'My loan may be assumable (many FHA, VA and USDA loans are)';
const LT_ASSUMABLE_HELP = 'Your loan servicer decides. Leave the rate and balance out.';
// ---- Sell and Stay: reads the stay the owner set in Timing Match (days only, up to 29). No new field. ----
const LT_SELL_STAY_NOTE = 'Your agents write the rent-back terms. No rent amounts are set on Amico Haus.';
const LT_STAY_FILTER_LABEL = 'Seller would like to stay after closing';
// ---- Step-Down Price: the owner publishes every step and date; there is no private floor. ----
const LT_STEP_DAYS = [7, 14, 30];
const LT_STEP_MAX_STEPS = 8;
const LT_STEP_MIN_AMOUNT = 1000;
const LT_STEP_HEADING = 'Price schedule (from the owner)';
const LT_STEP_DOWN_LINE = "The owner published this schedule and can change or stop it at any time. It isn't an auction: there is no bidding, no deadline and no winner, and nothing sells by itself. An offer made on this page is a private note to the owner, who can say yes or no at any price. Each price is the owner's own number, not an appraisal.";
const LT_STEP_CONFIRM = "I understand my listing's price changes by itself on these dates until I stop the schedule.";
const LT_STEP_AGENT_ERROR = 'Price schedules are for owners posting their own home without an agent. With a listing agreement, price changes go through that agreement and the MLS.';
const LT_STEP_HALF_ERROR = 'Keep the last step at or above half of your starting price.';
const LT_STEP_PANEL_LABEL = 'Price schedule (optional)';
const LT_STEP_PANEL_HELP = 'Buyers see every step and date. There is no hidden lowest price: the last step you publish is the lowest price on the schedule.';
const LT_STEP_STOPPED_LINE = 'Your price schedule was stopped because you changed the price.';
const LT_STEP_STOPPED_CLIENT_LINE = 'Your price schedule was stopped because this home is now posted for a client.';

// The agent browse filter's tick survives a re-render of the filter row; the owner's listings by id, for the panel.
let ltStayFilterOn = false;
const LT_STEP_LISTINGS = new Map();

function ltLive(name) {
  const tools = (typeof window !== 'undefined' && window.NUANCED) || {};
  return !!tools[name];
}
function ltEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function ltDollars(n) { return '$' + Number(n).toLocaleString('en-US'); }

// The known keys, in the order given, each once, at most 5 (the same rule as the server).
function ltCleanWishlist(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    if (typeof k === 'string' && Object.hasOwn(LT_WISHLIST_ITEMS, k) && !out.includes(k)) out.push(k);
    if (out.length >= LT_WISHLIST_MAX) break;
  }
  return out;
}
// A home's terms from either shape: a listings row (terms_wishlist_json, owner_carry, assumable) or a pre-listing
// from the API (terms: { termsWishlist, ownerCarry, assumable }).
function ltTermsOf(row) {
  const r = row || {};
  if (r.terms && typeof r.terms === 'object') {
    return { termsWishlist: ltCleanWishlist(r.terms.termsWishlist), ownerCarry: Number(r.terms.ownerCarry) === 1 ? 1 : 0, assumable: Number(r.terms.assumable) === 1 ? 1 : 0 };
  }
  let list = [];
  try { list = typeof r.terms_wishlist_json === 'string' ? JSON.parse(r.terms_wishlist_json || '[]') : (r.terms_wishlist_json || []); } catch { list = []; }
  return { termsWishlist: ltCleanWishlist(list), ownerCarry: Number(r.owner_carry) === 1 ? 1 : 0, assumable: Number(r.assumable) === 1 ? 1 : 0 };
}
// The stay the owner set in Timing Match, from a pre-listing detail (timing.stayAfterDays), a full card
// (stayAfterDays) or a row (stay_after_days).
function ltStayDays(p) {
  const r = p || {};
  const n = r.timing && r.timing.stayAfterDays !== undefined ? r.timing.stayAfterDays : (r.stayAfterDays !== undefined ? r.stayAfterDays : r.stay_after_days);
  return Math.floor(Number(n)) || 0;
}
function ltWishlistLabels(keys, kind, stayAfterDays) {
  const n = Math.floor(Number(stayAfterDays)) || 0;
  return ltCleanWishlist(keys).map(k => (k === 'stay_after' && kind === 'pre_listing' && n > 0 ? `Time to stay after closing (up to ${n} days)` : LT_WISHLIST_ITEMS[k]));
}

// ---- The form ----
function ltWishChipsHtml(picked) {
  return Object.keys(LT_WISHLIST_ITEMS).map(k => {
    const rank = picked.indexOf(k) + 1;
    return `<button type="button" class="vf-tap" data-action="lt-wish-toggle" data-key="${k}" aria-pressed="${rank ? 'true' : 'false'}">${rank ? `${rank}. ` : ''}${ltEsc(LT_WISHLIST_ITEMS[k])}</button>`;
  }).join('');
}
// The form fields for a home's terms (prefix = the form's id prefix; row = the saved home, or null). Nothing for a
// rental. opts = { kind, isRental, agentPosted }.
function ltFieldsHtml(prefix, row, opts) {
  const o = opts || {};
  if (o.isRental) return '';
  const p = ltEsc(prefix || '');
  const t = ltTermsOf(row);
  let html = '';
  if (ltLive('termsWishlist')) {
    html += `<fieldset class="facts-group" id="${p}LtWishlist" data-lt-wishlist data-picked="${t.termsWishlist.join(',')}">
      <legend class="label">${ltEsc(LT_WISHLIST_FORM_LABEL)}</legend>
      <p class="tiny field-hint">${ltEsc(LT_WISHLIST_FORM_HELP)}</p>
      <p class="tiny">${ltEsc(LT_WISHLIST_FORM_TAP)} <button type="button" class="link-btn" data-action="lt-wish-clear">Clear</button></p>
      <div class="vf-taps">${ltWishChipsHtml(t.termsWishlist)}</div>
    </fieldset>`;
  }
  if (ltLive('ownerCarry')) {
    html += `<fieldset class="facts-group" id="${p}LtFinancing">
      <legend class="label">${ltEsc(LT_FINANCING_FORM_LABEL)}</legend>
      <label class="checkbox-row" for="${p}LtOwnerCarry"><input type="checkbox" id="${p}LtOwnerCarry"${t.ownerCarry ? ' checked' : ''}><span>${ltEsc(LT_OWNER_CARRY_LABEL)}</span></label>
      <p class="tiny field-hint">${ltEsc(LT_OWNER_CARRY_HELP)}</p>
      <label class="checkbox-row" for="${p}LtAssumable"><input type="checkbox" id="${p}LtAssumable"${t.assumable ? ' checked' : ''}><span>${ltEsc(LT_ASSUMABLE_LABEL)}</span></label>
      <p class="tiny field-hint">${ltEsc(LT_ASSUMABLE_HELP)}</p>
    </fieldset>`;
  }
  return html;
}
// What the form holds now, as the body the server checks. Only the fields that are on the page are sent, so a
// form without them never clears what is stored.
function ltRead(prefix) {
  const out = {};
  if (typeof document === 'undefined') return out;
  const wish = document.getElementById(`${prefix}LtWishlist`);
  if (wish) out.termsWishlist = ltCleanWishlist(String(wish.dataset.picked || '').split(',').filter(Boolean));
  const carry = document.getElementById(`${prefix}LtOwnerCarry`);
  const assumable = document.getElementById(`${prefix}LtAssumable`);
  if (carry && assumable) { out.ownerCarry = !!carry.checked; out.assumable = !!assumable.checked; }
  return out;
}
// Saves a home's terms (kind 'listing' or 'pre_listing'). Resolves to false when nothing was saved.
async function ltSave(kind, id, terms) {
  if (!terms || !Object.keys(terms).length || !id) return false;
  if (!ltLive('termsWishlist') && !ltLive('ownerCarry')) return false;
  await apiPut(`/api/listing-terms/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, terms);
  return true;
}

// ---- Detail views (the same HTML the server prints on the listing page) ----
function ltFinancingHtml(t) {
  if (!ltLive('ownerCarry') || (!t.ownerCarry && !t.assumable)) return '';
  const lines = [];
  if (t.ownerCarry) lines.push(LT_OWNER_CARRY_LINE);
  if (t.assumable) lines.push(LT_ASSUMABLE_LINE);
  return `<p class="tiny financing-flags"><span class="label">${ltEsc(LT_FINANCING_HEADING)}</span> ${ltEsc(lines.join(' '))}${t.assumable ? ' <a href="/assumable-loans">About assumable loans</a>' : ''}</p>`;
}
function ltWishlistHtml(t, kind, stayAfterDays) {
  if (!ltLive('termsWishlist') || !t.termsWishlist.length) return '';
  const items = ltWishlistLabels(t.termsWishlist, kind, stayAfterDays);
  return `<div class="card about-card terms-wishlist"><h2>${ltEsc(LT_WISHLIST_HEADING)}</h2><ol>${items.map(i => `<li>${ltEsc(i)}</li>`).join('')}</ol><p class="tiny">${ltEsc(LT_WISHLIST_LINE)}</p><p class="tiny">${ltEsc(LT_WISHLIST_BUYER_LINE)}</p></div>`;
}
// The terms blocks on a home's detail view: the financing line, then the wish list. opts = { kind }.
function ltDetailHtml(row, opts) {
  const r = row || {};
  if (r.is_rental || r.is_buyer_only || r.is_portfolio) return '';
  const kind = (opts && opts.kind) || 'listing';
  const t = ltTermsOf(r);
  return ltFinancingHtml(t) + ltWishlistHtml(t, kind, kind === 'pre_listing' ? ltStayDays(r) : 0);
}

// ---- Sell and Stay ----
function ltSellStayText(days) {
  const n = Math.floor(Number(days)) || 0;
  return n > 0 ? `Seller would like to stay up to ${n} days after closing` : '';
}
// The "Sell and stay" badge on a pre-listing: on a full card just the badge; on the detail (which carries timing)
// the badge and the note that the agents write the terms. Only the people the server sends the stay to see it.
function ltSellStayBadgeHtml(p) {
  if (!ltLive('sellAndStay')) return '';
  const text = ltSellStayText(ltStayDays(p));
  if (!text) return '';
  const detail = !!(p && p.timing);
  return `<span class="badge sell-stay-badge">${ltEsc(text)}</span>${detail ? `<p class="tiny">${ltEsc(LT_SELL_STAY_NOTE)}</p>` : ''}`;
}
// The agent browse filter (approved agents and admins) and its query parameters.
function ltPreListingFilterHtml() {
  if (!ltLive('sellAndStay')) return '';
  return `<label class="checkbox-row" for="ltStayFilter"><input type="checkbox" id="ltStayFilter" data-action="lt-stay-filter"${ltStayFilterOn ? ' checked' : ''}><span>${ltEsc(LT_STAY_FILTER_LABEL)}</span></label>`;
}
function ltPreListingFilterParams() {
  // The tick box is the truth while it is on the page (main.js reloads the browse on its change).
  const box = typeof document !== 'undefined' ? document.getElementById('ltStayFilter') : null;
  if (box) ltStayFilterOn = !!box.checked;
  return ltLive('sellAndStay') && ltStayFilterOn ? { stay: '1' } : {};
}

// ---- Saved searches ----
function ltSavedSearchFieldsHtml() {
  if (!ltLive('ownerCarry')) return '';
  return `<fieldset class="facts-group saved-toy">
    <legend class="label">${ltEsc(LT_FINANCING_HEADING)}</legend>
    <div class="form-row two-col">
      <label class="checkbox-row" for="ssOwnerCarry"><input type="checkbox" id="ssOwnerCarry"><span>Owner open to seller financing</span></label>
      <label class="checkbox-row" for="ssAssumable"><input type="checkbox" id="ssAssumable"><span>Loan may be assumable</span></label>
    </div>
    <p class="tiny field-hint">Only homes whose owner shared these details can match.</p>
  </fieldset>`;
}
function ltReadSavedSearch() {
  if (typeof document === 'undefined') return {};
  const carry = document.getElementById('ssOwnerCarry');
  const assumable = document.getElementById('ssAssumable');
  if (!carry || !assumable) return {};
  return { ownerCarry: !!carry.checked, assumable: !!assumable.checked };
}
// What a saved search's label gains (plain text: escape it where it's used).
function ltSavedSearchLabel(s) {
  const flags = Number(s && (s.deal_flags ?? s.dealFlags)) || 0;
  return `${flags & 1 ? ' · seller financing' : ''}${flags & 2 ? ' · assumable loan' : ''}`;
}

// ---- Step-Down Price (the same math as stepDown.js) ----
function ltPacificToday(nowMs) {
  return new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
function ltAddDays(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(n || 0))).toISOString().slice(0, 10);
}
// 9:00 AM Pacific on a calendar date: 16:00 UTC in daylight time, 17:00 UTC in standard time.
function ltNineAmPacificMs(year, month, day) {
  const guess = Date.UTC(year, month - 1, day, 16, 0);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(guess));
  return hour === 9 ? guess : guess + 3600000;
}
// A schedule that holds together ({ startPrice, stepAmount, stepDays, steps, startDate }), or null.
function ltCleanSchedule(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const { startPrice, stepAmount, stepDays, steps, startDate } = s;
  if (!Number.isInteger(startPrice) || startPrice <= 0) return null;
  if (!Number.isInteger(stepAmount) || stepAmount < LT_STEP_MIN_AMOUNT) return null;
  if (!LT_STEP_DAYS.includes(stepDays)) return null;
  if (!Number.isInteger(steps) || steps < 1 || steps > LT_STEP_MAX_STEPS) return null;
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || ltAddDays(startDate, 0) !== startDate) return null;
  if ((startPrice - steps * stepAmount) * 2 < startPrice) return null;
  return { startPrice, stepAmount, stepDays, steps, startDate };
}
function ltStepSchedule(listing) {
  const raw = listing && listing.step_down_json;
  if (!raw || raw === '{}') return null;
  try { return ltCleanSchedule(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return null; }
}
// Step k takes effect at 9:00 AM Pacific on startDate + k x stepDays.
function ltStepAtMs(s, k) {
  const [y, m, d] = ltAddDays(s.startDate, k * s.stepDays).split('-').map(Number);
  return ltNineAmPacificMs(y, m, d);
}
function ltStepDayLabel(s, k) {
  const [y, m, d] = ltAddDays(s.startDate, k * s.stepDays).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d)).replace(/ /g, ' ');
}
// Now and the steps still to come (past prices are never listed).
function ltStepState(schedule, nowMs) {
  const s = ltCleanSchedule(schedule);
  if (!s) return null;
  let done = 0;
  while (done < s.steps && ltStepAtMs(s, done + 1) <= nowMs) done++;
  const currentPrice = s.startPrice - done * s.stepAmount;
  const rows = [{ label: 'Now', price: currentPrice }];
  for (let k = done + 1; k <= s.steps; k++) rows.push({ label: ltStepDayLabel(s, k), price: s.startPrice - k * s.stepAmount });
  return { currentPrice, done, rows, lastPrice: s.startPrice - s.steps * s.stepAmount, nextAtMs: done < s.steps ? ltStepAtMs(s, done + 1) : null };
}
// The schedule block, the same HTML as the listing page's (stepDownBlockHtml).
function ltStepBlockHtml(schedule, nowMs) {
  const state = ltStepState(schedule, nowMs);
  if (!state || state.rows.length < 2) return '';
  const items = state.rows.map((r, i) => `<li${i === 0 ? ' class="step-now"' : ''}>${ltEsc(r.label)}: ${ltDollars(r.price)}</li>`).join('');
  return `<div class="mini-block step-schedule"><span class="label">${ltEsc(LT_STEP_HEADING)}</span><ol>${items}</ol><p class="tiny">No further steps are scheduled after ${ltDollars(state.lastPrice)}.</p><p class="tiny">${ltEsc(LT_STEP_DOWN_LINE)}</p></div>`;
}
// The form's preview, from what is typed so far (the listing's price today as the start).
function ltStepPreviewHtml(listing, stepAmount, stepDays, steps, nowMs) {
  const startPrice = Math.round(Number(listing && listing.estimated_value) || 0);
  if (!Number.isInteger(stepAmount) || stepAmount < LT_STEP_MIN_AMOUNT || !LT_STEP_DAYS.includes(stepDays) || !Number.isInteger(steps) || steps < 1 || steps > LT_STEP_MAX_STEPS) return '';
  if (startPrice <= 0 || (startPrice - steps * stepAmount) * 2 < startPrice) return `<p class="tiny">${ltEsc(LT_STEP_HALF_ERROR)}</p>`;
  return ltStepBlockHtml({ startPrice, stepAmount, stepDays, steps, startDate: ltPacificToday(nowMs) }, nowMs);
}
function ltStepPanelInnerHtml(listing, nowMs) {
  const id = ltEsc(listing.id);
  // A home posted for a client, or by an approved agent (the panel is the owner's own, so main.js
  // isApprovedAgentNow() is about them): price changes go through the listing agreement and the MLS.
  if (listing.client_name || (typeof isApprovedAgentNow === 'function' && isApprovedAgentNow())) return `<p class="tiny">${ltEsc(LT_STEP_AGENT_ERROR)}</p>`;
  const running = ltStepBlockHtml(ltStepSchedule(listing), nowMs);
  if (running) {
    return `${running}<div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="lt-step-stop" data-id="${id}">Stop the schedule</button></div>`;
  }
  return `<div class="mini-block">
    <span class="label">${ltEsc(LT_STEP_PANEL_LABEL)}</span>
    <div class="form-row three-col">
      <div class="field"><label for="ltStepAmount${id}">Step my price down by ($)</label><input type="number" id="ltStepAmount${id}" data-lt-step-input min="${LT_STEP_MIN_AMOUNT}" step="1000" inputmode="numeric"></div>
      <div class="field"><label for="ltStepDays${id}">Every</label><select id="ltStepDays${id}" data-lt-step-input>${LT_STEP_DAYS.map(n => `<option value="${n}">${n} days</option>`).join('')}</select></div>
      <div class="field"><label for="ltStepCount${id}">How many steps</label><select id="ltStepCount${id}" data-lt-step-input>${Array.from({ length: LT_STEP_MAX_STEPS }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></div>
    </div>
    <p class="tiny field-hint">${ltEsc(LT_STEP_PANEL_HELP)}</p>
    <div id="ltStepPreview${id}"></div>
    <label class="checkbox-row" for="ltStepConfirm${id}"><input type="checkbox" id="ltStepConfirm${id}"><span>${ltEsc(LT_STEP_CONFIRM)}</span></label>
    <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="lt-step-publish" data-id="${id}">Publish schedule</button></div>
  </div>`;
}
// The owner's price-schedule panel in My Listing: the form, or the running schedule with "Stop the schedule".
// Nothing for a rental, a buyer profile, a portfolio or a home bundled into one, or while the tool isn't live.
function ltStepDownPanelHtml(listing) {
  if (!ltLive('stepDown') || !listing || !listing.id) return '';
  if (listing.is_rental || listing.is_buyer_only || listing.is_portfolio || listing.bundled_into) return '';
  LT_STEP_LISTINGS.set(String(listing.id), listing);
  return `<div data-lt-step="${ltEsc(listing.id)}">${ltStepPanelInnerHtml(listing, Date.now())}</div>`;
}

// ---- Delegated listeners (data-action="lt-...") ----
(function () {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  const say = (err) => { if (typeof toastActionError === 'function') toastActionError(err); else if (typeof toast === 'function') toast((err && err.message) || 'Something went wrong.'); };
  const stepInputs = (id) => ({
    stepAmount: Number(document.getElementById(`ltStepAmount${id}`)?.value || 0),
    stepDays: Number(document.getElementById(`ltStepDays${id}`)?.value || 0),
    steps: Number(document.getElementById(`ltStepCount${id}`)?.value || 0),
    confirm: !!document.getElementById(`ltStepConfirm${id}`)?.checked,
  });
  const rerenderStep = (id) => {
    const box = document.querySelector(`[data-lt-step="${id}"]`);
    const listing = LT_STEP_LISTINGS.get(String(id));
    if (box && listing) box.innerHTML = ltStepPanelInnerHtml(listing, Date.now());
  };

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('[data-action^="lt-"]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'lt-wish-toggle' || action === 'lt-wish-clear') {
      const box = btn.closest('[data-lt-wishlist]');
      if (!box) return;
      let picked = ltCleanWishlist(String(box.dataset.picked || '').split(',').filter(Boolean));
      if (action === 'lt-wish-clear') picked = [];
      else if (picked.includes(btn.dataset.key)) picked = picked.filter(k => k !== btn.dataset.key);
      else if (picked.length < LT_WISHLIST_MAX) picked.push(btn.dataset.key);
      box.dataset.picked = picked.join(',');
      const taps = box.querySelector('.vf-taps');
      if (taps) taps.innerHTML = ltWishChipsHtml(picked);
      return;
    }
    if (action === 'lt-step-publish') {
      const id = btn.dataset.id;
      const listing = LT_STEP_LISTINGS.get(String(id));
      btn.disabled = true;
      try {
        const res = await apiPut(`/api/listings/${encodeURIComponent(id)}/step-down`, stepInputs(id));
        if (listing) listing.step_down_json = JSON.stringify(res.stepDown || {});
        rerenderStep(id);
      } catch (err) { say(err); btn.disabled = false; }
      return;
    }
    if (action === 'lt-step-stop') {
      const id = btn.dataset.id;
      const listing = LT_STEP_LISTINGS.get(String(id));
      btn.disabled = true;
      try {
        await apiDelete(`/api/listings/${encodeURIComponent(id)}/step-down`);
        if (listing) listing.step_down_json = '{}';
        rerenderStep(id);
      } catch (err) { say(err); btn.disabled = false; }
    }
  });

  // The step form's preview follows what is typed; the agent browse filter's tick is remembered (main.js reloads
  // the browse when it changes).
  const onChange = (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.matches && t.matches('[data-action="lt-stay-filter"]')) {
      ltStayFilterOn = !!t.checked;
      return;
    }
    if (!t.hasAttribute || !t.hasAttribute('data-lt-step-input')) return;
    const box = t.closest('[data-lt-step]');
    const id = box && box.getAttribute('data-lt-step');
    const listing = id && LT_STEP_LISTINGS.get(String(id));
    const preview = id && document.getElementById(`ltStepPreview${id}`);
    if (!listing || !preview) return;
    const v = stepInputs(id);
    preview.innerHTML = ltStepPreviewHtml(listing, v.stepAmount, v.stepDays, v.steps, Date.now());
  };
  document.addEventListener('input', onChange);
  document.addEventListener('change', onChange);
})();
