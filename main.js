/* Amico Haus — authenticated app shell (feed, listing, groups, matches). */

const PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];

// Kept in sync by hand with functions/_lib/disclosures.js, the same way PROPERTY_TYPES and the service/specialty
// lists elsewhere in this file mirror their server-side counterparts — only which keys are checked is per
// pre-listing data from the API; the labels/notes themselves are static enough not to need a round trip.
const DISCLOSURE_ITEMS = [
  { key: 'tds', label: 'Transfer Disclosure Statement (TDS)', note: "The seller's own statement of the property's condition and known defects — required on almost every residential sale in California." },
  { key: 'nhd', label: 'Natural Hazard Disclosure (NHD) report', note: 'Whether the property sits in a flood, fire, earthquake fault, or other state-mapped hazard zone. Usually ordered through a disclosure company, not filled out by hand.' },
  { key: 'spq', label: 'Seller Property Questionnaire (SPQ)', note: "A more detailed companion to the TDS — permits, neighborhood issues, past repairs." },
  { key: 'lead_paint', label: 'Lead-based paint disclosure', note: 'Federally required for any home built before 1978, regardless of state.' },
  { key: 'smoke_co', label: 'Smoke & carbon monoxide detector compliance', note: 'California requires working detectors in the right locations before a sale closes.' },
  { key: 'water_heater', label: 'Water heater bracing statement', note: 'A signed statement that the water heater is braced/strapped against earthquake movement, as state law requires.' },
  { key: 'hoa_docs', label: 'HOA documents (if applicable)', note: 'CC&Rs, bylaws, financials, and any pending special assessments, if the property belongs to a homeowners association.' },
  { key: 'megan_law', label: "Megan's Law database disclosure", note: 'A standard notice directing buyers to the state database — required language, not something to look up yourself.' },
];

// Kept in sync by hand with functions/_lib/adaptations.js. Deliberately broad
// — mobility, vision, hearing, cognitive/sensory, height and stature,
// respiratory/chemical sensitivity, safety, and caregiving.
const ADAPTATION_ITEMS = [
  { key: 'zero_step_entry', label: 'Zero-step or ramped entry', note: 'No steps at the main entrance — a ramp or level approach instead.' },
  { key: 'wide_doorways_hallways', label: 'Widened doorways & hallways', note: 'Clearances built for a wheelchair, walker, or scooter to pass through comfortably.' },
  { key: 'wheelchair_turning_clearance', label: 'Wheelchair turning clearance', note: 'Rooms and bathrooms with enough open floor space for a wheelchair to turn around.' },
  { key: 'roll_in_shower', label: 'Roll-in / curbless shower', note: 'No curb to cross, often with a fold-down seat and handheld showerhead.' },
  { key: 'accessible_bathtub', label: 'Accessible / walk-in bathtub', note: 'A low-threshold or walk-in tub instead of a standard high-sided tub.' },
  { key: 'raised_toilet_or_bidet', label: 'Raised toilet or bidet seat', note: 'A comfort-height toilet or bidet attachment for easier transfers and hygiene.' },
  { key: 'grab_bars_handrails', label: 'Grab bars & handrails', note: 'Reinforced grab bars in bathrooms and handrails along steps or ramps.' },
  { key: 'stair_lift_or_elevator', label: 'Stair lift or elevator', note: 'An installed lift or elevator connecting multiple floors.' },
  { key: 'porch_or_platform_lift', label: 'Porch lift / vertical platform lift', note: 'A lift bridging a porch, deck, or short level change outside the home.' },
  { key: 'accessible_parking', label: 'Accessible parking', note: 'A dedicated accessible parking spot or a wide, level path from parking to the entry.' },
  { key: 'main_floor_primary_suite', label: 'Main-floor primary suite / single-story living', note: 'A full bedroom and bathroom on the entry level — no stairs required to live day to day.' },
  { key: 'automatic_door_openers', label: 'Automatic / power door openers', note: 'Push-button or sensor-activated doors at the entry or interior rooms.' },
  { key: 'lever_door_handles', label: 'Lever-style door & faucet handles', note: 'Lever handles instead of round knobs — easier to operate with limited grip or dexterity.' },
  { key: 'adjustable_height_counters', label: 'Height-adjustable counters & cabinets', note: 'Kitchen counters, sinks, and cabinets set or adjustable to a reachable height.' },
  { key: 'lowered_switches_outlets', label: 'Lowered light switches & outlets', note: 'Switches, thermostats, and outlets mounted at a reachable height.' },
  { key: 'lowered_closets_storage', label: 'Lowered closet rods & storage', note: 'Closet rods, shelving, and cabinetry brought down to a reachable height.' },
  { key: 'visual_impairment_features', label: 'Visual-impairment features', note: 'High-contrast or tactile markings, braille labeling, and similar features.' },
  { key: 'enhanced_lighting', label: 'Enhanced, glare-free lighting', note: 'Brighter, evenly-distributed, low-glare lighting throughout the home.' },
  { key: 'hearing_impairment_features', label: 'Hearing-impairment features', note: 'Visual/vibrating alerts for doorbells, smoke alarms, and phones; induction loop systems.' },
  { key: 'sensory_friendly_design', label: 'Sensory-friendly design', note: 'Reduced noise, soundproofing, and adjustable or non-flickering lighting to limit sensory overload.' },
  { key: 'cognitive_safety_features', label: 'Cognitive / memory-support safety features', note: 'Secured exits, door and window alarms, or similar features that support safe wandering prevention.' },
  { key: 'air_filtration_allergy_friendly', label: 'Air filtration & allergy-friendly materials', note: 'HEPA or similar filtration, low-VOC finishes, and materials chosen to reduce allergens and irritants.' },
  { key: 'smart_home_assistive_tech', label: 'Smart-home / voice-controlled assistive tech', note: 'Voice- or app-controlled lighting, locks, thermostats, and blinds for limited mobility or dexterity.' },
  { key: 'emergency_alert_system', label: 'Built-in emergency alert system', note: 'A wired medical alert, panic button, or monitored emergency response system already in place.' },
  { key: 'caregiver_or_in_law_suite', label: 'Caregiver suite / in-law quarters', note: 'A separate living space for a live-in caregiver, aide, or family member.' },
  { key: 'service_animal_friendly', label: 'Service-animal-friendly features', note: 'Durable, easy-clean flooring and secure, accessible yard access for a service animal.' },
];

function adaptationCheckboxesHtml(checkedKeys, checkClass) {
  const checked = new Set(checkedKeys || []);
  return ADAPTATION_ITEMS.map(item => `
    <label class="checkbox-row">
      <input type="checkbox" class="${checkClass}" value="${item.key}" ${checked.has(item.key) ? 'checked' : ''}>
      <span>${escapeHtml(item.label)}<br><span class="tiny">${escapeHtml(item.note)}</span></span>
    </label>
  `).join('');
}

// Kept in sync by hand with functions/_lib/devProjects.js.
const PROJECT_TYPE_LABELS = {
  flip: 'Fix & Flip', new_construction: 'New Construction', multifamily: 'Multi-Family',
  commercial: 'Commercial', land: 'Land / Entitlement', other: 'Other',
};
const PROJECT_STAGE_LABELS = {
  concept: 'Concept', permitting: 'Permitting', under_construction: 'Under Construction',
  funded: 'Fully Funded', completed: 'Completed',
};
function fillSelectFromLabels(select, labels, includeAny) {
  select.innerHTML = '';
  if (includeAny) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = 'Any';
    select.appendChild(opt);
  }
  Object.entries(labels).forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    select.appendChild(opt);
  });
}

function fillTypeSelect(select, includeAny) {
  select.innerHTML = '';
  if (includeAny) {
    const opt = document.createElement('option');
    opt.value = 'Any'; opt.textContent = 'Any type';
    select.appendChild(opt);
  }
  PROPERTY_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    select.appendChild(opt);
  });
}

function goToTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Per-device convenience only (never read back by the server) — so a plain /app visit lands wherever this
  // browser was last, instead of always defaulting back to Agent Strategy. Wrapped since storage can throw
  // (private browsing, blocked site data) and losing this is never worth breaking navigation over.
  try { localStorage.setItem('ah_last_tab', name); } catch {}
  if (name === 'feed') { loadFeed(); checkOnboarding(); }
  if (name === 'listing') { loadMyListing(); if (!editingListingId) checkForListingDraft(); }
  if (name === 'groups') loadGroups();
  if (name === 'matches') loadMatches();
  if (name === 'saved') { loadFavorites(); loadHidden(); loadTrash(); }
  if (name === 'messages') loadConversations();
  if (name === 'marketplace') loadMarketplaceTab();
  if (name === 'augmented') loadAugmentedTab();
  if (name === 'findermine') loadFinderMineTab();
}

function listingLabel(l) {
  if (l.isBuyerOnly || l.is_buyer_only) return 'First-time buyer — no home to trade';
  if (l.isPortfolio || l.is_portfolio) return `Portfolio of ${(l.portfolioMembers || l.portfolio_members || []).length} properties`;
  const loc = `${l.neighborhood ? escapeHtml(l.neighborhood) + ', ' : ''}${escapeHtml(l.city)}, ${escapeHtml(l.state)}`;
  const base = `${escapeHtml(l.propertyType || l.property_type)} · ${l.beds}bd/${l.baths}ba in ${loc}`;
  return (l.isRental || l.is_rental) ? `${base} · For rent` : base;
}

// Buyer-only mode hides the "what you have" fieldset and lifts its required
// attributes, since a first-time buyer has no home to describe.
function setBuyerOnlyFieldsetState(isBuyerOnly) {
  document.getElementById('whatYouHaveFieldset').classList.toggle('hidden', isBuyerOnly);
  for (const field of ['city', 'state', 'propertyType', 'estimatedValue', 'beds', 'baths']) {
    document.getElementById(field).required = !isBuyerOnly;
  }
}

// Rental mode swaps the "what would make you move" fieldset for a "rental
// terms" fieldset — a landlord isn't looking for anything back, they're
// leasing the home described in "what you have".
function setRentalFieldsetState(isRental) {
  document.getElementById('whatYouWantFieldset').classList.toggle('hidden', isRental);
  document.getElementById('rentalFieldset').classList.toggle('hidden', !isRental);
  for (const field of ['locations', 'priceMin', 'priceMax', 'minBeds', 'minBaths']) {
    document.getElementById(field).required = !isRental;
  }
  document.getElementById('rentAmount').required = isRental;
}

// Tracks which existing listing/portfolio the create-forms are currently
// editing (null means "creating new") — the same forms are reused for both,
// since duplicating every field for a separate edit UI would just be a second
// place for the two to drift apart.
let editingListingId = null;
let editingPortfolioId = null;
let myListings = [];

function resetListingFormToCreateMode() {
  editingListingId = null;
  document.getElementById('listingSubmitBtn').textContent = 'Create Listing';
  document.getElementById('isBuyerOnly').disabled = false;
  document.getElementById('isRental').disabled = false;
}

// Shared by edit (same listing, kind locked) and clone (a fresh listing
// pre-filled from an existing one) — the field list is the same either way,
// only what happens with the kind toggle and identity-specific fields differs.
function fillListingFormFields(l, { forClone } = {}) {
  document.getElementById('isBuyerOnly').checked = !!l.is_buyer_only;
  document.getElementById('isRental').checked = !!l.is_rental;
  setBuyerOnlyFieldsetState(!!l.is_buyer_only);
  setRentalFieldsetState(!!l.is_rental);

  document.getElementById('title').value = forClone && l.title ? `${l.title} (Copy)` : (l.title || '');
  document.getElementById('clientName').value = l.client_name || '';
  document.getElementById('city').value = l.city || '';
  document.getElementById('state').value = l.state || '';
  document.getElementById('neighborhood').value = l.neighborhood || '';
  // A clone is a different property — don't imply it shares the same street
  // address, exact-address preference, or listing photos/links.
  document.getElementById('address').value = forClone ? '' : (l.address || '');
  document.getElementById('propertyType').value = l.property_type || '';
  document.getElementById('estimatedValue').value = l.estimated_value || '';
  document.getElementById('beds').value = l.beds || '';
  document.getElementById('baths').value = l.baths || '';
  document.getElementById('sqft').value = l.sqft || '';
  const links = forClone ? [] : (l.external_links || []);
  document.getElementById('virtualTourUrl').value = links.find(link => link.label === 'Virtual Tour')?.url || '';
  document.getElementById('externalLinks').value = links.filter(link => link.label !== 'Virtual Tour').map(link => link.url).join('\n');
  const checkedLifeEvents = new Set(forClone ? [] : (l.life_event_tags || []));
  document.querySelectorAll('.life-event-check').forEach(c => { c.checked = checkedLifeEvents.has(c.value); });
  document.getElementById('showExactAddress').checked = forClone ? false : !!l.show_exact_address;
  document.getElementById('rentAmount').value = l.rent_amount || '';
  document.getElementById('minLeaseMonths').value = l.min_lease_months || 12;
  document.getElementById('locations').value = l.locations || '';
  document.getElementById('desiredType').value = l.desired_type || '';
  document.getElementById('priceMin').value = l.price_min || '';
  document.getElementById('priceMax').value = l.price_max || '';
  document.getElementById('minBeds').value = l.min_beds || '';
  document.getElementById('minBaths').value = l.min_baths || '';
  document.getElementById('mustHaves').value = l.must_haves || '';
  document.getElementById('cashMode').value = l.cash_mode || 'none';
  document.getElementById('cashAmountField').style.display = (l.cash_mode && l.cash_mode !== 'none') ? 'block' : 'none';
  document.getElementById('cashAmount').value = l.cash_amount || '';
}

function populateListingFormForEdit(l) {
  editingListingId = l.id;
  document.getElementById('listingFormWrap').style.display = 'block';
  document.getElementById('listingSubmitBtn').textContent = 'Save Changes';
  // The listing's kind is fixed once created — editing only the data within
  // it avoids the tangle of re-deriving desired_criteria vs. home fields that
  // switching kinds mid-edit would require.
  document.getElementById('isBuyerOnly').disabled = true;
  document.getElementById('isRental').disabled = true;
  fillListingFormFields(l);
  document.getElementById('listingFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateListingFormForClone(l) {
  resetListingFormToCreateMode();
  document.getElementById('listingFormWrap').style.display = 'block';
  fillListingFormFields(l, { forClone: true });
  document.getElementById('listingFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Autosaves the create-listing form to localStorage as the user types, so an
// accidental tab close or navigation away doesn't lose a half-filled listing.
// Deliberately per-device only (not synced anywhere) — it's a convenience
// against a slip, not durable storage.
const LISTING_DRAFT_KEY = 'amicohaus_listing_draft_v1';
const LISTING_DRAFT_FIELD_IDS = [
  'isBuyerOnly', 'isRental', 'title', 'clientName', 'city', 'state', 'neighborhood', 'address',
  'propertyType', 'estimatedValue', 'beds', 'baths', 'sqft', 'virtualTourUrl', 'externalLinks', 'showExactAddress',
  'rentAmount', 'minLeaseMonths', 'locations', 'desiredType', 'priceMin', 'priceMax', 'minBeds', 'minBaths',
  'mustHaves', 'cashMode', 'cashAmount',
];

function collectListingDraft() {
  const draft = {};
  for (const id of LISTING_DRAFT_FIELD_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    draft[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return draft;
}

function isListingDraftEmpty(draft) {
  return Object.values(draft).every(v => (typeof v === 'boolean' ? !v : !String(v || '').trim()));
}

function applyListingDraft(draft) {
  for (const id of LISTING_DRAFT_FIELD_IDS) {
    if (!(id in draft)) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = draft[id];
    else el.value = draft[id];
  }
  setBuyerOnlyFieldsetState(document.getElementById('isBuyerOnly').checked);
  setRentalFieldsetState(document.getElementById('isRental').checked);
  document.getElementById('cashAmountField').style.display = document.getElementById('cashMode').value === 'none' ? 'none' : 'block';
}

function clearListingDraft() {
  try { localStorage.removeItem(LISTING_DRAFT_KEY); } catch { /* private-mode storage can throw — non-critical */ }
}

let listingDraftSaveTimer = null;
function scheduleListingDraftSave() {
  if (editingListingId) return; // never let a draft clobber an in-progress edit of an existing listing
  clearTimeout(listingDraftSaveTimer);
  listingDraftSaveTimer = setTimeout(() => {
    try {
      const draft = collectListingDraft();
      if (isListingDraftEmpty(draft)) localStorage.removeItem(LISTING_DRAFT_KEY);
      else localStorage.setItem(LISTING_DRAFT_KEY, JSON.stringify(draft));
    } catch { /* ignore */ }
  }, 400);
}

function checkForListingDraft() {
  try {
    const raw = localStorage.getItem(LISTING_DRAFT_KEY);
    const draft = raw ? JSON.parse(raw) : null;
    if (draft && !isListingDraftEmpty(draft)) document.getElementById('listingDraftBanner').classList.remove('hidden');
  } catch { /* ignore */ }
}

function resetPortfolioFormToCreateMode() {
  editingPortfolioId = null;
  document.getElementById('createPortfolioBtn').textContent = 'Create Portfolio';
  document.getElementById('portfolioMembersField').classList.remove('hidden');
}

function populatePortfolioFormForEdit(l) {
  editingPortfolioId = l.id;
  document.getElementById('portfolioWrap').open = true;
  document.getElementById('portfolioWrap').classList.remove('hidden');
  document.getElementById('createPortfolioBtn').textContent = 'Save Changes';
  // Membership isn't editable — dissolve and re-bundle to change what's
  // included — so the member picker is hidden entirely while editing.
  document.getElementById('portfolioMembersField').classList.add('hidden');
  document.getElementById('portfolioWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('portfolioTitle').value = l.title || '';
  document.getElementById('portfolioLocations').value = l.locations || '';
  document.getElementById('portfolioDesiredType').value = l.desired_type || '';
  document.getElementById('portfolioPriceMin').value = l.price_min || '';
  document.getElementById('portfolioPriceMax').value = l.price_max || '';
  document.getElementById('portfolioMinBeds').value = l.min_beds || '';
  document.getElementById('portfolioMinBaths').value = l.min_baths || '';
  document.getElementById('portfolioMustHaves').value = l.must_haves || '';
  document.getElementById('portfolioCashMode').value = l.cash_mode || 'none';
  document.getElementById('portfolioCashAmountField').style.display = (l.cash_mode && l.cash_mode !== 'none') ? 'block' : 'none';
  document.getElementById('portfolioCashAmount').value = l.cash_amount || '';
}

/* ---------------- Feed ---------------- */
// Shows a one-time nudge to create a first listing — otherwise a brand-new
// user lands on an empty Feed with no obvious next step, and "post what you
// have and want to trade" isn't a familiar pattern like a normal listing
// site. Keyed off having zero listings rather than a dismissible flag, so it
// naturally disappears the moment it's no longer true and never needs its
// own "don't show again" state to track.
async function checkOnboarding() {
  try {
    const { listings } = await apiGet('/api/listings');
    document.getElementById('onboardingBanner').classList.toggle('hidden', listings.length > 0);
  } catch { /* non-critical */ }
}

async function loadFeed() {
  const list = document.getElementById('feedList');
  try {
    const { posts } = await apiGet('/api/posts');
    if (posts.length === 0) { list.innerHTML = '<div class="empty-state">No posts yet — be the first to share what you\'re looking to trade.</div>'; return; }
    list.innerHTML = posts.map(renderPostCard).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function renderPostCard(p) {
  const isMine = currentUser && currentUser.id === p.user_id;
  return `
    <div class="match-card" data-post-id="${p.id}" data-user-id="${p.user_id}">
      <div class="card-agent"><a class="profile-link" href="/profile/${p.user_id}">${escapeHtml(p.author_name)}</a> · ${timeAgo(p.created_at)}</div>
      <p>${escapeHtml(p.body)}</p>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-action="like" data-id="${p.id}">👍 ${p.like_count}</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-comments" data-id="${p.id}">💬 ${p.comment_count}</button>
        ${isMine
          ? `<button class="btn btn-danger btn-sm" data-action="delete-post" data-id="${p.id}">Delete</button>`
          : `<button class="btn btn-ghost btn-sm" data-action="report-post" data-id="${p.id}">Report</button>
             <button class="btn btn-ghost btn-sm" data-action="block-user" data-id="${p.user_id}" data-name="${escapeHtml(p.author_name)}">Block</button>`}
      </div>
      <div class="comments-block hidden" id="comments-${p.id}">
        <div class="comments-list" id="comments-list-${p.id}"></div>
        <form class="comment-form" data-post-id="${p.id}">
          <input type="text" maxlength="1000" placeholder="Write a comment…" required>
          <button type="submit" class="btn btn-ghost btn-sm">Send</button>
        </form>
      </div>
    </div>
  `;
}

function renderComment(c) {
  const isMine = currentUser && currentUser.id === c.user_id;
  return `
    <div class="side" data-comment-id="${c.id}">
      <strong><a class="profile-link" href="/profile/${c.user_id}">${escapeHtml(c.author_name)}</a></strong> <span class="tiny">${timeAgo(c.created_at)}</span>
      <p class="tiny">${escapeHtml(c.body)}</p>
      ${isMine
        ? `<button class="link-btn danger" data-action="delete-comment" data-id="${c.id}">Delete</button>`
        : `<button class="link-btn" data-action="report-comment" data-id="${c.id}">Report</button>`}
    </div>
  `;
}

async function renderComments(postId) {
  const { comments } = await apiGet(`/api/posts/${postId}/comments`);
  document.getElementById(`comments-list-${postId}`).innerHTML = comments.map(renderComment).join('') || '<p class="tiny">No comments yet.</p>';
  document.getElementById(`comments-${postId}`).dataset.loaded = '1';
}

async function submitReport(targetType, targetId) {
  const reason = prompt(`Why are you reporting this ${targetType}?`);
  if (!reason || !reason.trim()) return;
  try {
    await apiPost('/api/reports', { targetType, targetId: Number(targetId), reason: reason.trim() });
    toast('Report submitted. Thank you.');
  } catch (err) {
    toast(err.message);
  }
}

async function toggleComments(postId) {
  const block = document.getElementById(`comments-${postId}`);
  const isHidden = block.classList.contains('hidden');
  block.classList.toggle('hidden', !isHidden);
  if (isHidden && !block.dataset.loaded) await renderComments(postId);
}

function wireFeedEvents(container) {
  container.addEventListener('click', async (e) => {
    const likeBtn = e.target.closest('[data-action="like"]');
    if (likeBtn) {
      const { likeCount } = await apiPost(`/api/posts/${likeBtn.dataset.id}/like`);
      likeBtn.textContent = `👍 ${likeCount}`;
      return;
    }
    const toggleBtn = e.target.closest('[data-action="toggle-comments"]');
    if (toggleBtn) { toggleComments(toggleBtn.dataset.id); return; }

    const reportPostBtn = e.target.closest('[data-action="report-post"]');
    if (reportPostBtn) { submitReport('post', reportPostBtn.dataset.id); return; }

    const blockBtn = e.target.closest('[data-action="block-user"]');
    if (blockBtn) {
      if (!confirm(`Block ${blockBtn.dataset.name}? You won't see their posts or be able to message each other.`)) return;
      try {
        await apiPost('/api/blocks', { userId: Number(blockBtn.dataset.id) });
        toast(`Blocked ${blockBtn.dataset.name}.`);
        container.querySelectorAll(`[data-user-id="${blockBtn.dataset.id}"]`).forEach(el => el.remove());
      } catch (err) { toast(err.message); }
      return;
    }

    const deletePostBtn = e.target.closest('[data-action="delete-post"]');
    if (deletePostBtn) {
      if (!confirm('Delete this post?')) return;
      const postId = deletePostBtn.dataset.id;
      try {
        await apiDelete(`/api/posts/${postId}`);
        deletePostBtn.closest('[data-post-id]').remove();
      } catch (err) { toast(err.message); }
      return;
    }

    const reportCommentBtn = e.target.closest('[data-action="report-comment"]');
    if (reportCommentBtn) { submitReport('comment', reportCommentBtn.dataset.id); return; }

    const deleteCommentBtn = e.target.closest('[data-action="delete-comment"]');
    if (deleteCommentBtn) {
      if (!confirm('Delete this comment?')) return;
      const commentId = deleteCommentBtn.dataset.id;
      try {
        await apiDelete(`/api/comments/${commentId}`);
        deleteCommentBtn.closest('[data-comment-id]').remove();
      } catch (err) { toast(err.message); }
      return;
    }
  });

  container.addEventListener('submit', async (e) => {
    const form = e.target.closest('.comment-form');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input');
    const postId = form.dataset.postId;
    try {
      await apiPost(`/api/posts/${postId}/comments`, { body: input.value.trim() });
      input.value = '';
      await renderComments(postId);
      const countBtn = document.querySelector(`[data-action="toggle-comments"][data-id="${postId}"]`);
      if (countBtn) countBtn.textContent = `💬 ${(document.querySelectorAll(`#comments-list-${postId} .side`).length)}`;
    } catch (err) { toast(err.message); }
  });
}

/* ---------------- My Listings ---------------- */
async function loadBrokerStats() {
  const el = document.getElementById('brokerStats');
  try {
    const stats = await apiGet('/api/broker/stats');
    if (stats.totalListings === 0) { el.classList.add('hidden'); return null; }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="stat-item"><span class="stat-num">${stats.totalListings}</span><span class="stat-label">Listings</span></div>
      <div class="stat-item"><span class="stat-num">${stats.activeListings}</span><span class="stat-label">Active</span></div>
      <div class="stat-item"><span class="stat-num">${stats.totalViews}</span><span class="stat-label">Total Views</span></div>
      <div class="stat-item"><span class="stat-num">${stats.totalMatches}</span><span class="stat-label">Total Matches</span></div>
      <div class="stat-item stat-export"><a class="btn btn-ghost btn-sm" href="/api/listings/export" download>Export CSV</a></div>
    `;
    return new Map(stats.listings.map(l => [l.id, l.matches]));
  } catch {
    el.classList.add('hidden');
    return null;
  }
}

async function loadMyListing() {
  const summaryEl = document.getElementById('myListingSummary');
  const formWrap = document.getElementById('listingFormWrap');
  const addAnotherWrap = document.getElementById('addAnotherWrap');
  const cancelBtn = document.getElementById('cancelListingBtn');
  try {
    const [{ listings }, matchCountById] = await Promise.all([apiGet('/api/listings'), loadBrokerStats()]);
    myListings = listings;

    const portfolioSelect = document.getElementById('portfolioMembers');
    const eligible = listings.filter(l => l.status === 'active' && !l.is_buyer_only && !l.is_rental && !l.is_portfolio && !l.bundled_into);
    portfolioSelect.innerHTML = eligible.map(l =>
      `<option value="${l.id}">${escapeHtml(l.title || l.property_type)} — ${escapeHtml(l.city)}, ${escapeHtml(l.state)} — ${money(l.estimated_value)}</option>`
    ).join('');
    document.getElementById('portfolioWrap').classList.toggle('hidden', eligible.length < 2);

    if (listings.length === 0) {
      summaryEl.innerHTML = '';
      addAnotherWrap.classList.add('hidden');
      formWrap.style.display = 'block';
      cancelBtn.classList.add('hidden');
      return;
    }
    addAnotherWrap.classList.remove('hidden');
    formWrap.style.display = 'none';
    cancelBtn.classList.remove('hidden');
    summaryEl.innerHTML = listings.map(l => `
      <div class="card">
        <div class="card-head">
          <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
          <span class="badge ${l.status === 'active' ? 'badge-active' : 'badge-paused'}">${l.status}</span>
          ${l.is_buyer_only ? '<span class="badge badge-gold">Buyer</span>' : ''}
          ${l.is_rental ? '<span class="badge badge-gold">For Rent</span>' : ''}
          ${l.is_portfolio ? `<span class="badge badge-gold">Portfolio · ${(l.portfolio_members || []).length}</span>` : ''}
          ${l.bundled_into ? '<span class="badge badge-gold">🔗 Bundled</span>' : ''}
        </div>
        <div class="card-agent">${l.client_name ? `Listed for <strong>${escapeHtml(l.client_name)}</strong> · ` : ''}${l.views || 0} view${l.views === 1 ? '' : 's'}${matchCountById ? ` · ${matchCountById.get(l.id) || 0} match${(matchCountById.get(l.id) || 0) === 1 ? '' : 'es'}` : ''}</div>
        ${(l.is_buyer_only || l.is_portfolio) ? '' : `<div class="photo-gallery" id="gallery-${l.id}"><span class="tiny">Loading photos…</span></div>
        <div class="field">
          <input type="file" id="addPhotos-${l.id}" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
        </div>`}
        <div class="mini-two">
          <div class="mini-block"><span class="label">Has</span>${l.is_portfolio ? `${(l.portfolio_members || []).length} properties` : listingLabel(l)}${l.is_buyer_only ? '' : `<br>${money(l.estimated_value)}${l.is_portfolio ? ' combined' : ''}`}</div>
          ${l.is_rental
            ? `<div class="mini-block"><span class="label">Rent</span>${money(l.rent_amount)}/mo<br>${l.min_lease_months}-month minimum lease</div>`
            : `<div class="mini-block"><span class="label">Wants</span>${escapeHtml(l.desired_type)} in ${escapeHtml(l.locations)}<br>${money(l.price_min)}–${money(l.price_max)}</div>`}
        </div>
        ${l.is_portfolio ? `<div class="mini-block"><span class="label">Includes</span>${(l.portfolio_members || []).map(m => `${escapeHtml(m.title || m.propertyType)} in ${escapeHtml(m.city)}, ${escapeHtml(m.state)} (${money(m.estimatedValue)})`).join('<br>')}</div>` : ''}
        ${l.bundled_into ? '<p class="tiny">This property is bundled into a portfolio — manage it from that portfolio\'s card.</p>' : ''}
        ${(l.is_buyer_only || l.is_portfolio) ? '' : renderLifeEventTags(l.life_event_tags)}
        ${(l.is_buyer_only || l.is_portfolio) ? '' : renderExternalLinks(l.external_links)}
        ${(l.is_buyer_only || l.is_portfolio || l.is_rental) ? '' : `
        <details class="panel">
          <summary>Open Houses</summary>
          <div id="openHouses-${l.id}"><span class="tiny">Loading…</span></div>
          <div class="form-row two-col">
            <input type="datetime-local" id="ohStart-${l.id}">
            <input type="datetime-local" id="ohEnd-${l.id}">
          </div>
          <div class="field"><input type="text" id="ohNote-${l.id}" maxlength="300" placeholder="Note (optional)"></div>
          <div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="add-open-house" data-id="${l.id}">Schedule</button></div>
        </details>
        <details class="panel">
          <summary>Offers</summary>
          <div id="listingOffers-${l.id}"><span class="tiny">Loading…</span></div>
        </details>
        `}
        <div class="card-actions">
          ${l.bundled_into ? '' : `
          <button class="btn btn-ghost btn-sm" data-action="edit-listing" data-id="${l.id}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="toggle-status" data-id="${l.id}" data-status="${l.status}">${l.status === 'active' ? 'Pause' : 'Reactivate'}</button>
          <button class="btn btn-danger btn-sm" data-action="delete-listing" data-id="${l.id}">${l.is_portfolio ? 'Dissolve Portfolio' : 'Delete'}</button>
          `}
          ${l.is_portfolio ? '' : `<button class="btn btn-ghost btn-sm" data-action="clone-listing" data-id="${l.id}">Duplicate</button>`}
        </div>
      </div>
    `).join('');

    for (const l of listings) {
      if (l.is_buyer_only || l.is_portfolio) continue;
      renderPhotoGallery(l.id);
      document.getElementById(`addPhotos-${l.id}`).addEventListener('change', async (e) => {
        for (const file of [...e.target.files]) {
          const formData = new FormData();
          formData.append('photo', file);
          try { await apiUpload(`/api/listings/${l.id}/photos`, formData); }
          catch (err) { toast(`Photo upload failed: ${err.message}`); }
        }
        e.target.value = '';
        renderPhotoGallery(l.id);
      });
      if (!l.is_rental) {
        loadOpenHousesInto(l.id);
        loadListingOffersInto(l.id);
      }
    }
  } catch (e) {
    summaryEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function renderPhotoGallery(listingId) {
  const el = document.getElementById(`gallery-${listingId}`);
  try {
    const { photos } = await apiGet(`/api/listings/${listingId}/photos`);
    el.innerHTML = photos.length ? photos.map(p => `
      <div class="photo-thumb">
        <img src="/api/photos/${p.id}" alt="Listing photo" loading="lazy">
        <button type="button" class="photo-delete" data-action="delete-photo" data-listing-id="${listingId}" data-photo-id="${p.id}">✕</button>
      </div>
    `).join('') : '<span class="tiny">No photos yet.</span>';
  } catch {
    el.innerHTML = '<span class="tiny">Could not load photos.</span>';
  }
}

async function loadOpenHousesInto(listingId) {
  const el = document.getElementById(`openHouses-${listingId}`);
  if (!el) return;
  try {
    const { openHouses } = await apiGet(`/api/listings/${listingId}/open-houses`);
    el.innerHTML = openHouses.length ? openHouses.map(oh => `
      <div class="side">
        <strong>${new Date(oh.startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
        <span class="tiny">${oh.rsvpCount} RSVP${oh.rsvpCount === 1 ? '' : 's'}${oh.note ? ` — ${escapeHtml(oh.note)}` : ''}</span>
        <button type="button" class="link-btn" data-action="delete-open-house" data-listing-id="${listingId}" data-id="${oh.id}">Cancel</button>
      </div>
    `).join('') : '<span class="tiny">None scheduled.</span>';
  } catch { el.innerHTML = '<span class="tiny">Could not load open houses.</span>'; }
}

async function loadListingOffersInto(listingId) {
  const el = document.getElementById(`listingOffers-${listingId}`);
  if (!el) return;
  try {
    const { offers } = await apiGet(`/api/listings/${listingId}/offers`);
    el.innerHTML = offers.length ? offers.map(o => `
      <div class="side">
        <strong>${money(o.offerPrice)} — ${o.financingType === 'cash' ? 'Cash' : 'Financed'}</strong>
        <span class="tiny">From <a class="profile-link" href="/profile/${o.buyerUserId}">${escapeHtml(o.buyerName)}</a> · <span class="badge ${o.status === 'accepted' ? 'badge-active' : o.status === 'declined' || o.status === 'withdrawn' ? 'badge-paused' : ''}">${o.status}</span></span>
        ${o.closingTimeline ? `<p class="tiny"><span class="label">Timeline</span> ${escapeHtml(o.closingTimeline)}</p>` : ''}
        ${o.contingencies ? `<p class="tiny"><span class="label">Contingencies</span> ${escapeHtml(o.contingencies)}</p>` : ''}
        ${o.message ? `<p class="tiny">"${escapeHtml(o.message)}"</p>` : ''}
        ${o.status === 'pending' ? `
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="decide-offer" data-listing-id="${listingId}" data-id="${o.id}" data-decision="accept">Accept</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="decide-offer" data-listing-id="${listingId}" data-id="${o.id}" data-decision="decline">Decline</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="message-user" data-id="${o.buyerUserId}" data-name="${escapeHtml(o.buyerName)}">Message</button>
          </div>` : ''}
      </div>
    `).join('') : '<span class="tiny">No offers yet.</span>';
  } catch { el.innerHTML = '<span class="tiny">Could not load offers.</span>'; }
}

// Minimal CSV parser — handles quoted fields (with embedded commas/newlines
// and escaped "" quotes) since brokers exporting from Excel/Sheets often
// produce those. Lines starting with # (the template's instructional
// comments) are skipped.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const headers = parseLine(lines[0]).map(h => h.trim());
  return { headers, rows: lines.slice(1).map(parseLine) };
}

const CSV_FIELD_MAP = {
  'Client Name': 'clientName', 'City': 'city', 'State': 'state', 'Neighborhood': 'neighborhood',
  'Property Type': 'propertyType', 'Estimated Value': 'estimatedValue', 'Beds': 'beds', 'Baths': 'baths', 'Sqft': 'sqft',
  'Is Rental': 'isRental', 'Rent Amount': 'rentAmount', 'Min Lease Months': 'minLeaseMonths',
  'Desired Locations': 'locations', 'Desired Type': 'desiredType', 'Price Min': 'priceMin', 'Price Max': 'priceMax',
  'Min Beds': 'minBeds', 'Min Baths': 'minBaths', 'Must Haves': 'mustHaves',
};
const CSV_BOOLEAN_FIELDS = ['isRental'];

function csvToListings(text) {
  const { headers, rows } = parseCsv(text);
  const fieldKeys = headers.map(h => CSV_FIELD_MAP[h.trim()] || null);
  return rows.filter(r => r.some(c => c.trim())).map(row => {
    const obj = {};
    fieldKeys.forEach((key, i) => { if (key) obj[key] = (row[i] || '').trim(); });
    // Every other field is left as a trimmed string (validateListingInput's
    // num()/clampString() coerce those server-side) — a boolean column needs
    // converting here instead, since a non-empty string like "no" or "false"
    // is still truthy in JS.
    for (const key of CSV_BOOLEAN_FIELDS) {
      obj[key] = /^(1|true|yes|y)$/i.test(obj[key] || '');
    }
    return obj;
  });
}

/* ---------------- Groups ---------------- */
async function loadGroups() {
  document.getElementById('groupDetail').style.display = 'none';
  const grid = document.getElementById('groupsGrid');
  grid.style.display = 'grid';
  try {
    const { groups } = await apiGet('/api/groups');
    if (groups.length === 0) { grid.innerHTML = '<div class="empty-state">No groups yet — create a listing to get auto-grouped.</div>'; return; }
    grid.innerHTML = groups.map(g => `
      <div class="card clickable" data-action="open-group" data-id="${g.id}" data-label="${escapeHtml(g.label)}">
        <h3>${escapeHtml(g.label)}</h3>
        <span class="badge badge-gold">${g.type === 'price_tier' ? 'Price tier' : 'Area'}</span>
        <p class="tiny">${g.member_count} member${g.member_count === 1 ? '' : 's'}</p>
      </div>
    `).join('');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function openGroup(id, label) {
  document.getElementById('groupsGrid').style.display = 'none';
  const detail = document.getElementById('groupDetail');
  detail.style.display = 'block';
  detail.dataset.groupId = id;
  document.getElementById('groupDetailTitle').textContent = label;

  const { members, posts } = await apiGet(`/api/groups/${id}`);
  document.getElementById('groupMembers').innerHTML = members.filter(m => m.listing_id).map(m => `
    <div class="side"><strong><a class="profile-link" href="/profile/${m.owner_id}">${escapeHtml(m.owner_name)}</a></strong><p class="tiny">${listingLabel(m)}</p></div>
  `).join('') || '<p class="tiny">No active listings in this group yet.</p>';

  document.getElementById('groupPosts').innerHTML = posts.map(renderPostCard).join('') || '<div class="empty-state">No posts in this group yet.</div>';
}

/* ---------------- Matches ---------------- */
function matchSides(m) {
  const other = currentUser && m.a.userId === currentUser.id ? m.b : m.a;
  const mine = currentUser && m.a.userId === currentUser.id ? m.a : m.b;
  return { mine, other };
}

function matchLine(side) {
  if (side.isBuyerOnly) return `First-time buyer looking in ${escapeHtml(side.city)}${side.state ? ', ' + escapeHtml(side.state) : ''}`;
  if (side.isRental) return `For rent: ${money(side.rentAmount)}/mo · ${side.minLeaseMonths}-month min · ${escapeHtml(side.city)}, ${escapeHtml(side.state)}`;
  return `${listingLabel(side)} · ${money(side.estimatedValue)}`;
}

function breakdownChip(ok, label) {
  return `<span class="breakdown-chip ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${label}</span>`;
}

// A % score alone doesn't say whether it's location dragging things down or
// just a slightly tight price band — this spells out each factor so someone
// can tell at a glance whether it's worth a conversation or a pass.
function renderBreakdownRow(label, b) {
  if (!b) return '';
  let priceLabel = 'Price';
  if (!b.price.ok) priceLabel = b.price.overPriced ? 'Price (over budget)' : b.price.underPriced ? 'Price (under ask)' : 'Price';
  return `
    <div class="breakdown-row">
      <span class="breakdown-label">${escapeHtml(label)}</span>
      <span class="breakdown-chips">
        ${breakdownChip(b.location.ok, 'Location')}
        ${breakdownChip(b.type.ok, 'Type')}
        ${breakdownChip(b.price.ok, priceLabel)}
        ${breakdownChip(b.beds.ok, 'Beds')}
        ${breakdownChip(b.baths.ok, 'Baths')}
      </span>
    </div>
  `;
}

function renderBreakdownSection(m) {
  const rows = [renderBreakdownRow(`${m.a.owner}'s search`, m.breakdownAWantsB), renderBreakdownRow(`${m.b.owner}'s search`, m.breakdownBWantsA)]
    .filter(Boolean).join('');
  if (!rows) return '';
  return `<details class="score-breakdown"><summary>Why this score?</summary>${rows}</details>`;
}

function renderMatchCard(m) {
  const { mine, other } = matchSides(m);
  const scoreTitle = m.isBuyerMatch
    ? 'How well this home fits what the buyer is looking for — a one-directional interest, not a reciprocal trade.'
    : m.isRentalMatch
    ? "How well this rental fits what the seller said would make them move — property type, price bracket, beds/baths, and location. One-directional, not a reciprocal trade."
    : 'How well this trade works for both sides — the average of what each of you wants against what the other has to offer.';
  const yearsTitle = "The range of time the seller's net sale proceeds could cover this rent — from the exact math up to 15% more time in exchange for paying it as a lump sum. An illustrative estimate for discussion, not a guaranteed or negotiated term.";
  const otherLine = matchLine(other);
  const mineLine = matchLine(mine);
  const topBadge = m.isBuyerMatch
    ? '<span class="badge badge-gold">Buyer</span>'
    : (m.isRentalMatch
      ? '<span class="badge badge-gold">Rental</span>'
      : ((mine.isPortfolio || other.isPortfolio) ? '<span class="badge badge-gold">Portfolio</span>' : ''));
  const scorePill = `<span class="score-pill" title="${scoreTitle}">${Math.round((m.scoreAWantsB + m.scoreBWantsA) / 2)}% match</span>`;
  const yearsPill = m.isRentalMatch ? `<span class="score-pill" title="${yearsTitle}">${m.yearsLow.toFixed(1)}–${m.yearsHigh.toFixed(1)} yrs covered</span>` : '';
  const goneQuietNote = m.goneQuiet
    ? `<p class="tiny gone-quiet-nudge">👋 Nobody's reached out yet — say hello to ${escapeHtml(other.owner)}?</p>`
    : '';
  return `
    <div class="match-card">
      <div class="match-top">
        ${scorePill}
        ${yearsPill}
        ${topBadge}
      </div>
      <div class="match-pair">
        <div class="side"><img class="side-thumb" src="${propertyArtUrl(mine.propertyType, mine.listingId)}" alt=""><h4><a class="profile-link" href="/profile/${mine.userId}">${escapeHtml(mine.owner)}</a></h4><p class="tiny">${mineLine}</p></div>
        <div class="swap-icon">${(m.isBuyerMatch || m.isRentalMatch) ? '→' : '⇄'}</div>
        <div class="side"><img class="side-thumb" src="${propertyArtUrl(other.propertyType, other.listingId)}" alt=""><h4><a class="profile-link" href="/profile/${other.userId}">${escapeHtml(other.owner)}</a></h4><p class="tiny">${otherLine}</p></div>
      </div>
      ${m.isRentalMatch ? '<p class="tiny match-disclaimer">Illustrative estimate from rough sale-proceeds math only — not a promise, appraisal, or lease offer. Actual lease terms are negotiated directly between the two of you.</p>' : ''}
      ${goneQuietNote}
      ${renderBreakdownSection(m)}
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="message-user" data-id="${other.userId}" data-name="${escapeHtml(other.owner)}">Message ${escapeHtml(other.owner)}</button>
        ${(!m.isBuyerMatch && !m.isRentalMatch) ? `<button type="button" class="btn btn-ghost btn-sm" data-action="open-to-bids" data-a="${mine.listingId}" data-b="${other.listingId}" title="Bring in vetted agents to bid on finalizing this trade">Open to Agent Bids</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm thumb-btn" data-action="match-thumb-up" data-a="${mine.listingId}" data-b="${other.listingId}" title="Interested — archive this match">👍</button>
        <button type="button" class="btn btn-ghost btn-sm thumb-btn" data-action="match-thumb-down" data-a="${mine.listingId}" data-b="${other.listingId}" title="Not interested — archive this match">👎</button>
      </div>
    </div>
  `;
}

function renderArchivedMatch(m) {
  const { mine, other } = matchSides(m);
  return `
    <div class="side">
      <strong>${escapeHtml(mine.owner)} ⇄ ${escapeHtml(other.owner)}</strong>
      <span class="tiny">${m.feedback === 'up' ? '👍 Interested' : '👎 Not interested'} · ${listingLabel(other)}</span>
      <button class="link-btn" data-action="restore-match" data-a="${mine.listingId}" data-b="${other.listingId}">Restore to feed</button>
    </div>
  `;
}

async function loadMatches() {
  const matchesEl = document.getElementById('matchesList');
  const chainsEl = document.getElementById('chainsList');
  const archivedEl = document.getElementById('archivedMatchesList');
  try {
    const { matches, archived, chains, guidance } = await apiGet('/api/matches');
    matchesEl.innerHTML = matches.length
      ? matches.map(renderMatchCard).join('')
      : `<div class="empty-state">No mutual matches yet.${guidance ? `<p class="tiny">${escapeHtml(guidance)}</p>` : ''}</div>`;
    archivedEl.innerHTML = archived.length ? archived.map(renderArchivedMatch).join('') : '<span class="tiny">No archived matches.</span>';

    chainsEl.innerHTML = chains.length ? chains.map(c => `
      <div class="chain-card">
        <div class="match-top"><span class="score-pill" title="Average match quality across every leg of this multi-party trade chain.">${c.avg}% avg match</span><span class="badge badge-gold">${c.path.length}-party chain</span></div>
        <div class="chain-flow">
          ${c.path.map((n, i) => `<div class="chain-node"><img class="chain-thumb" src="${propertyArtUrl(n.propertyType, n.owner)}" alt=""><strong><a class="profile-link" href="/profile/${n.userId}">${escapeHtml(n.owner)}</a></strong><span>${listingLabel(n)}</span></div>${i < c.path.length - 1 ? '<span class="chain-arrow">→</span>' : ''}`).join('')}
          <span class="chain-arrow">↩</span>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No daisy chains yet.</div>';
  } catch (e) {
    matchesEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }

  await loadSavedSearches();
}

async function submitMatchFeedback(a, b, feedback) {
  try {
    await apiPut(`/api/match-feedback/${a}/${b}`, { feedback });
    toast(feedback === 'up' ? 'Marked interested — archived.' : 'Marked not interested — archived.');
    loadMatches();
  } catch (err) { toast(err.message); }
}

/* ---------------- Saved (favorites + hidden listings) ---------------- */
function renderSavedListingCard(l, action, label) {
  return `
    <div class="card" data-listing-id="${l.id}">
      <img class="directory-thumb" src="${l.photo_id ? `/api/photos/${l.photo_id}` : propertyArtUrl(l.property_type, l.id)}" alt="" loading="lazy">
      <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
      <div class="card-agent">${escapeHtml(l.owner_name)}</div>
      <div class="mini-block">${listingLabel(l)} · ${money(l.estimated_value)}</div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-action="${action}" data-id="${l.id}">${label}</button>
      </div>
    </div>
  `;
}

async function loadFavorites() {
  const el = document.getElementById('favoritesList');
  try {
    const { listings } = await apiGet('/api/favorites');
    el.innerHTML = listings.length
      ? listings.map(l => renderSavedListingCard(l, 'remove-favorite', 'Remove from Saved')).join('')
      : '<div class="empty-state">No saved listings yet — thumbs-up a listing in the directory to save it here.</div>';
  } catch (e) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function loadHidden() {
  const el = document.getElementById('hiddenList');
  try {
    const { listings } = await apiGet('/api/hidden-listings');
    el.innerHTML = listings.length
      ? listings.map(l => `
        <div class="side">
          <strong>${escapeHtml(l.title || l.property_type)}</strong> · ${escapeHtml(l.city)}, ${escapeHtml(l.state)}
          <button class="link-btn" data-action="unhide-listing" data-id="${l.id}">Unhide</button>
        </div>
      `).join('')
      : '<span class="tiny">Nothing hidden.</span>';
  } catch (e) {
    el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`;
  }
}

async function loadTrash() {
  const el = document.getElementById('trashList');
  try {
    const { trash } = await apiGet('/api/listings/trash');
    el.innerHTML = trash.length
      ? trash.map(t => `
        <div class="side">
          <strong>${escapeHtml(t.title || t.propertyType)}</strong>${t.isBuyerOnly ? ' (buyer profile)' : t.isRental ? ' (rental)' : ` · ${escapeHtml(t.city)}, ${escapeHtml(t.state)}`}
          <span class="tiny">Deleted ${timeAgo(t.deletedAt)}${t.photoCount ? ` · ${t.photoCount} photo${t.photoCount === 1 ? '' : 's'} will come back too` : ''}</span>
          <button class="link-btn" data-action="restore-trash" data-id="${t.trashId}">Restore</button>
          <button class="link-btn" data-action="purge-trash" data-id="${t.trashId}">Delete forever</button>
        </div>
      `).join('')
      : '<span class="tiny">Nothing in the trash.</span>';
  } catch (e) {
    el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`;
  }
}

async function loadSavedSearches() {
  const el = document.getElementById('savedSearchList');
  try {
    const { searches } = await apiGet('/api/saved-searches');
    el.innerHTML = searches.length ? searches.map(s => `
      <div class="side">
        ${escapeHtml(s.property_type)} in ${escapeHtml(s.locations)}${s.price_max ? ` under ${money(s.price_max)}` : ''}
        <button class="link-btn danger" data-action="delete-saved-search" data-id="${s.id}">Remove</button>
      </div>
    `).join('') : '<span class="tiny">No saved searches yet.</span>';
  } catch (e) {
    el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`;
  }
}

/* ---------------- Messages ---------------- */
// A conversation's own unread_count (tracked separately from the general notification bell, which has no idea
// when you've actually read a conversation vs. just dismissed its notification) is the authoritative source for
// how many messages are genuinely unread — summed here rather than trusting the bell's mixed-event count.
function updateMessagesTabBadge(conversations) {
  const badge = document.getElementById('messagesTabBadge');
  if (!badge) return;
  const unread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);
}
async function refreshMessagesTabBadge() {
  try { updateMessagesTabBadge((await apiGet('/api/conversations')).conversations); } catch { /* non-critical */ }
}

async function loadConversations() {
  document.getElementById('messageThread').classList.add('hidden');
  const list = document.getElementById('conversationList');
  list.classList.remove('hidden');
  list.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const { conversations } = await apiGet('/api/conversations');
    updateMessagesTabBadge(conversations);
    list.innerHTML = conversations.length ? conversations.map(c => `
      <div class="card conversation-item" data-action="open-conversation" data-id="${c.id}" data-name="${escapeHtml(c.other_name)}" data-user-id="${c.other_user_id}">
        <h3><a class="profile-link" href="/profile/${c.other_user_id}">${escapeHtml(c.other_name)}</a>${c.unread_count > 0 ? '<span class="unread-dot"></span>' : ''}</h3>
        <p class="tiny">${c.last_message ? escapeHtml(c.last_message) : 'No messages yet.'}</p>
      </div>
    `).join('') : '<div class="empty-state">No conversations yet — message someone from your Matches tab.</div>';
  } catch (e) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function openConversation(id, name, otherUserId) {
  document.getElementById('conversationList').classList.add('hidden');
  const thread = document.getElementById('messageThread');
  thread.classList.remove('hidden');
  thread.dataset.conversationId = id;
  document.getElementById('threadTitle').textContent = name;
  await renderMessages(id); // marks this conversation's messages read server-side
  refreshMessagesTabBadge();
  if (otherUserId) checkThreadOpenToBids(otherUserId);
}

// Surfaces "Open Trade to Agent Bids" right in the conversation too (not
// just the match card) when the two people messaging happen to have a
// mutual trade match — reuses the Matches tab's own computation rather than
// building a second "do these two match" lookup server-side.
async function checkThreadOpenToBids(otherUserId) {
  const wrap = document.getElementById('threadOpenToBidsWrap');
  wrap.classList.add('hidden');
  try {
    const { matches } = await apiGet('/api/matches');
    const found = matches.find(m => !m.isBuyerMatch && !m.isRentalMatch &&
      (m.a.userId === Number(otherUserId) || m.b.userId === Number(otherUserId)));
    if (!found) return;
    const mine = found.a.userId === currentUser.id ? found.a : found.b;
    const other = found.a.userId === currentUser.id ? found.b : found.a;
    wrap.classList.remove('hidden');
    wrap.dataset.listingA = mine.listingId;
    wrap.dataset.listingB = other.listingId;
  } catch { /* non-critical */ }
}

async function renderMessages(conversationId) {
  const { messages } = await apiGet(`/api/conversations/${conversationId}/messages`);
  document.getElementById('messageList').innerHTML = messages.map(m => `
    <div class="side ${m.sender_id === currentUser.id ? 'mine' : ''}">
      <p class="tiny">${escapeHtml(m.body)}</p>
      <span class="tiny">${timeAgo(m.created_at)}</span>
    </div>
  `).join('') || '<p class="tiny">No messages yet — say hello.</p>';
}

async function startConversationWith(userId, name) {
  try {
    const { id } = await apiPost('/api/conversations', { userId: Number(userId) });
    goToTab('messages');
    await openConversation(id, name, userId);
  } catch (err) { toast(err.message); }
}

/* ---------------- Notifications ---------------- */
async function loadNotifications() {
  try {
    const { notifications, unreadCount } = await apiGet('/api/notifications');
    const badge = document.getElementById('notifBadge');
    if (unreadCount > 0) { badge.textContent = unreadCount; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }

    document.getElementById('notifList').innerHTML = notifications.length ? notifications.map(n => {
      // A message notification's link is always /app#messages-N (see notifyNewMessage in marketplaceNotify.js) —
      // that's the one case worth a reply box right here, instead of a click-through just to type one line back.
      const convoMatch = /#messages-(\d+)$/.exec(n.link || '');
      return `
      <div class="notif-item ${n.read_at ? '' : 'unread'}" role="button" tabindex="0" data-action="open-notification" data-type="${escapeHtml(n.type)}" data-link="${escapeHtml(n.link || '')}">${escapeHtml(n.body)}<br><span class="tiny">${timeAgo(n.created_at)}</span>
        ${convoMatch ? `
          <div class="quick-reply" data-conversation-id="${convoMatch[1]}">
            <input type="text" class="quick-reply-input" placeholder="Quick reply…" maxlength="2000">
            <button type="button" class="btn btn-primary btn-sm" data-action="quick-reply-send">Send</button>
          </div>` : ''}
      </div>
    `;
    }).join('') : '<div class="empty-state">No notifications yet.</div>';
  } catch { /* non-critical, ignore */ }
}

// Sections of the Agents tab that a button or a link like /app#post-home can jump to.
const AGENT_TAB_SECTIONS = {
  'goto-post-home': 'postHomeWrap',
  'goto-agent-directory': 'agentDirectoryWrap',
  'goto-become-agent': 'becomeAgentWrap',
  'goto-open-requests': 'browseOpenRequests',
};
const AGENT_TAB_HASHES = { '#post-home': 'postHomeWrap', '#become-agent': 'becomeAgentWrap' };

function openAgentTabSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  // after the tab switch has painted, so the panel has a real position to scroll to
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// The specific thing a link like "/app#pre-listing-12" points at, or null for
// a plain "/app" (or anything else) that has no more precise destination.
function parseAppLink(link) {
  const m = /#(pre-listing|transaction|messages|agent|augmented-home|dev-project)-(\d+)$/.exec(link || '');
  return m ? { kind: m[1], id: Number(m[2]) } : null;
}

// Opens whatever a notification or a /app#… URL points at. Returns false when
// the link isn't one of the deep-link forms, so the caller can fall back.
async function openAppLink(link) {
  const hash = link && link.includes('#') ? link.slice(link.indexOf('#')) : '';
  if (AGENT_TAB_HASHES[hash]) {
    goToTab('marketplace');
    openAgentTabSection(AGENT_TAB_HASHES[hash]);
    return true;
  }

  const target = parseAppLink(link);
  if (!target) return false;

  if (target.kind === 'agent') {
    window.location.href = `/profile/${target.id}`;
    return true;
  }
  if (target.kind === 'messages') {
    goToTab('messages');
    try {
      const { conversations } = await apiGet('/api/conversations');
      const convo = conversations.find(c => c.id === target.id);
      if (convo) await openConversation(convo.id, convo.other_name, convo.other_user_id);
      else toast('That conversation is no longer available.');
    } catch (err) { toast(err.message); }
    return true;
  }
  if (target.kind === 'augmented-home') { goToTab('augmented'); openAugmentedHomeDetail(target.id); return true; }
  if (target.kind === 'dev-project') { goToTab('findermine'); openProjectDetail(target.id); return true; }
  goToTab('marketplace');
  if (target.kind === 'pre-listing') openPreListingDetail(target.id);
  else openTransactionDetail(target.id);
  return true;
}

async function openNotification(type, link) {
  document.getElementById('notifPanel').classList.add('hidden');
  if (await openAppLink(link)) return;
  // Plain "/app" links carry no target, so route by what kind of event it was.
  if (type === 'match') goToTab('matches');
  else if (type === 'like' || type === 'comment') goToTab('feed');
  else if (link && link !== '/app' && link.startsWith('/')) window.location.href = link;
}

/* ---------------- Marketplace ---------------- */
// Which item is currently open in the detail view — set by openPreListingDetail
// / openTransactionDetail, read by every bid/vote/accept/review action so
// they don't each need the kind+id threaded through as arguments.
let marketplaceDetail = null; // { kind: 'pre_listing' | 'transaction', id }

// Fed by loadMyPreListings() (proposal/showing counts) and loadMyTeam() (a pending team invite) — whichever
// loads last renders the strip, so each setter just updates its own slice and re-renders rather than assuming
// it owns the whole picture.
const attentionState = { bids: 0, showings: 0, teamInvite: false };
function renderAttentionStrip() {
  const el = document.getElementById('attentionStrip');
  if (!el) return;
  const parts = [
    attentionState.bids > 0 && `<a href="#" data-action="goto-my-pre-listings">${attentionState.bids} proposal${attentionState.bids === 1 ? '' : 's'} waiting on you</a>`,
    attentionState.showings > 0 && `<a href="#" data-action="goto-my-pre-listings">${attentionState.showings} showing request${attentionState.showings === 1 ? '' : 's'} waiting on you</a>`,
    attentionState.teamInvite && `<a href="#" data-action="goto-team-invite">a team invite waiting on you</a>`,
  ].filter(Boolean);
  if (parts.length === 0) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="card attention-strip">👋 You have ${parts.join(', ')}.</div>`;
}
let currentAgentProfile = null;
let currentAgentPackages = [];

const SERVICE_TYPES = [
  'photography', 'drone', 'staging', 'cleaning', 'landscaping', 'virtual_tour',
  'social_media_ads', 'email_campaign', 'print_marketing', 'mls_syndication', 'other',
];
const OPEN_HOUSE_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const OPEN_HOUSE_DAY_LABELS = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

function renderOpenHouseDaysEditor(containerId, existing) {
  const container = document.getElementById(containerId);
  const selected = new Set(existing || []);
  container.innerHTML = OPEN_HOUSE_DAYS.map(day =>
    `<label class="checkbox-row checkbox-inline"><input type="checkbox" class="ohd-check" data-day="${day}" ${selected.has(day) ? 'checked' : ''}><span>${OPEN_HOUSE_DAY_LABELS[day]}</span></label>`
  ).join('');
}

function collectOpenHouseDaysFromEditor(containerId) {
  return [...document.getElementById(containerId).querySelectorAll('.ohd-check:checked')].map(cb => cb.dataset.day);
}

const SPECIALTY_TAGS = [
  'luxury', 'first_time_buyer', 'relocation', 'military_va', 'investment',
  'new_construction', 'senior_downsizing', 'condo_hoa', 'waterfront', 'other',
];
const LANGUAGES = ['English', 'Spanish', 'Mandarin', 'Cantonese', 'Vietnamese', 'Tagalog', 'Korean', 'Russian', 'Arabic', 'French', 'Portuguese', 'Other'];

// Generic checkbox-tag editor reused for both specialty tags and languages —
// same shape as the open-house-days editor above, just parametrized.
function renderTagCheckboxes(containerId, className, options, labels, existing) {
  const container = document.getElementById(containerId);
  const selected = new Set(existing || []);
  container.innerHTML = options.map(opt =>
    `<label class="checkbox-row checkbox-inline"><input type="checkbox" class="${className}" data-value="${opt}" ${selected.has(opt) ? 'checked' : ''}><span>${labels ? labels[opt] : opt}</span></label>`
  ).join('');
}

function collectTagCheckboxes(containerId, className) {
  return [...document.getElementById(containerId).querySelectorAll(`.${className}:checked`)].map(cb => cb.dataset.value);
}

function renderServicesEditor(containerId, existing) {
  const container = document.getElementById(containerId);
  const byType = new Map((existing || []).map(s => [s.type, s]));
  container.innerHTML = SERVICE_TYPES.map(type => {
    const s = byType.get(type);
    return `
      <label class="checkbox-row"><input type="checkbox" class="svc-check" data-type="${type}" ${s ? 'checked' : ''}><span>${SERVICE_TYPE_LABELS[type]}</span></label>
      <div class="form-row two-col svc-fee-row ${s ? '' : 'hidden'}" data-type="${type}">
        <div class="field"><label>Fee ($)</label><input type="number" class="svc-fee" min="0" max="100000" value="${s ? s.fee : ''}"></div>
        <div class="field"><label>Note (optional)</label><input type="text" class="svc-note" maxlength="200" value="${escapeHtml(s ? s.note : '')}"></div>
      </div>
    `;
  }).join('');
  container.querySelectorAll('.svc-check').forEach(cb => {
    cb.addEventListener('change', () => {
      container.querySelector(`.svc-fee-row[data-type="${cb.dataset.type}"]`).classList.toggle('hidden', !cb.checked);
    });
  });
}

function collectServicesFromEditor(containerId) {
  const container = document.getElementById(containerId);
  const services = [];
  container.querySelectorAll('.svc-check').forEach(cb => {
    if (!cb.checked) return;
    const row = container.querySelector(`.svc-fee-row[data-type="${cb.dataset.type}"]`);
    services.push({ type: cb.dataset.type, fee: row.querySelector('.svc-fee').value || 0, note: row.querySelector('.svc-note').value.trim() });
  });
  return services;
}

function renderServicesSummary(services) {
  if (!services || services.length === 0) return '<span class="tiny">No services listed.</span>';
  return services.map(s => `${escapeHtml(SERVICE_TYPE_LABELS[s.type] || s.type)}${s.fee ? ` (${money(s.fee)})` : ''}${s.note ? ` — ${escapeHtml(s.note)}` : ''}`).join('<br>');
}

const AGENT_VIDEO_MAX_SECONDS = 240; // 4 minutes

// Best-effort only — Workers has no way to decode video and check duration
// server-side, so the real (loose) guard is the file-size cap on the
// upload endpoint. This just stops an obviously-too-long file before
// spending the time uploading it.
function checkVideoDuration(file, maxSeconds) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      if (video.duration > maxSeconds) {
        reject(new Error(`Video must be ${Math.round(maxSeconds / 60)} minutes or under (this one is about ${Math.round(video.duration)}s).`));
      } else {
        resolve();
      }
    };
    video.onerror = () => reject(new Error('Could not read this video file.'));
    video.src = URL.createObjectURL(file);
  });
}

async function loadAgentStatus() {
  const statusEl = document.getElementById('agentApplicationStatus');
  const toolsSection = document.getElementById('agentToolsSection');
  const summaryEl = document.getElementById('becomeAgentSummary');
  try {
    const { profile, photos, stats, packages, caseStudies } = await apiGet('/api/agents/me');
    currentAgentProfile = profile;
    currentAgentPackages = packages || [];

    if (!profile) {
      statusEl.innerHTML = '';
      toolsSection.classList.add('hidden');
      renderServicesEditor('agentServicesEditor', []);
      renderOpenHouseDaysEditor('agentOpenHouseDays', []);
      renderTagCheckboxes('agentSpecialtyTags', 'specialty-check', SPECIALTY_TAGS, SPECIALTY_TAG_LABELS, []);
      renderTagCheckboxes('agentLanguages', 'language-check', LANGUAGES, null, ['English']);
      return;
    }

    document.getElementById('agentBrokerage').value = profile.brokerageName;
    document.getElementById('agentLicense').value = profile.licenseNumber;
    document.getElementById('agentYears').value = profile.yearsExperience;
    document.getElementById('agentHomesSold').value = profile.homesSoldLastYear || '';
    document.getElementById('agentAvgDom').value = profile.avgDaysOnMarket || '';
    document.getElementById('agentSaleToList').value = profile.saleToListRatio || '';
    document.getElementById('agentBio').value = profile.bio;
    document.getElementById('agentCertifications').value = profile.certifications || '';
    document.getElementById('agentCommissionPct').value = profile.defaultCommissionPct || '';
    document.getElementById('agentFlatFee').value = profile.defaultFlatFee || '';
    document.getElementById('agentSoloAgent').checked = profile.soloAgent;
    document.getElementById('agentAcceptingClients').checked = profile.acceptingClients;
    document.getElementById('agentEoInsurance').checked = profile.carriesEoInsurance;
    renderServicesEditor('agentServicesEditor', profile.services);
    renderOpenHouseDaysEditor('agentOpenHouseDays', profile.openHouseDays);
    renderTagCheckboxes('agentSpecialtyTags', 'specialty-check', SPECIALTY_TAGS, SPECIALTY_TAG_LABELS, profile.specialtyTags);
    renderTagCheckboxes('agentLanguages', 'language-check', LANGUAGES, null, profile.languages);
    document.getElementById('agentNotifyNewRequests').checked = profile.notifyNewRequests;
    ['agentZip1', 'agentZip2', 'agentZip3', 'agentZip4'].forEach((id, i) => {
      document.getElementById(id).value = profile.serviceZips[i] || '';
    });

    if (profile.status === 'pending') {
      statusEl.innerHTML = '<p class="tiny">⏳ Your application is pending admin review.</p>';
      summaryEl.textContent = 'Agent application — pending review';
      toolsSection.classList.add('hidden');
    } else if (profile.status === 'rejected') {
      statusEl.innerHTML = `<p class="tiny">Your application wasn't approved${profile.rejectionReason ? `: ${escapeHtml(profile.rejectionReason)}` : '.'} Edit and resubmit below.</p>`;
      summaryEl.textContent = 'Agent application — not approved, edit & resubmit';
      toolsSection.classList.add('hidden');
    } else {
      statusEl.innerHTML = '<p class="tiny">✅ You\'re an approved agent — edit your profile any time below.</p>';
      summaryEl.textContent = 'My agent application (approved)';
      toolsSection.classList.remove('hidden');
      document.getElementById('agentPortfolioGallery').innerHTML = photos.length
        ? photos.map(p => `<div class="photo-thumb"><img src="/api/agent-photos/${p.id}" alt="" loading="lazy"><button type="button" class="photo-delete" data-action="delete-agent-photo" data-id="${p.id}">✕</button></div>`).join('')
        : '<span class="tiny">No portfolio photos yet.</span>';

      const videoWrap = document.getElementById('agentVideoPreviewWrap');
      videoWrap.innerHTML = profile.hasVideo
        ? `<video controls preload="none" class="media-video" src="/api/agent-video/${profile.userId}"></video><button type="button" class="btn btn-danger btn-sm mt-8" data-action="remove-agent-video">Remove Video</button>`
        : '<p class="tiny">No intro video yet.</p>';

      document.getElementById('agentStatsPanel').innerHTML = renderAgentStatsPanel(stats);
      loadAgentReferral();
      loadMyTeam();

      const licenseWrap = document.getElementById('agentLicensePhotoWrap');
      licenseWrap.innerHTML = profile.hasLicensePhoto
        ? `<img src="/api/license-photos/${profile.userId}" alt="License photo" class="media-photo">
           <p class="tiny">${profile.licenseVerified ? '✅ Verified by an admin.' : '⏳ Uploaded, awaiting admin review.'}</p>
           <button type="button" class="btn btn-danger btn-sm" data-action="remove-license-photo">Remove</button>`
        : '<p class="tiny">No license photo uploaded yet.</p>';

      renderPackagesEditor(packages);
      document.getElementById('agentCaseStudiesGallery').innerHTML = (caseStudies || []).length
        ? caseStudies.map(c => `
          <div class="card">
            <div class="mini-two">
              <img src="/api/case-study-photos/${c.id}/before" alt="Before" class="media-fit">
              <img src="/api/case-study-photos/${c.id}/after" alt="After" class="media-fit">
            </div>
            <p class="tiny"><strong>${escapeHtml(c.title || 'Case study')}</strong>${c.resultNote ? ` — ${escapeHtml(c.resultNote)}` : ''}</p>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-case-study" data-id="${c.id}">Remove</button>
          </div>
        `).join('')
        : '<span class="tiny">No case studies yet.</span>';
      loadMyBids();
      loadMyInvites();
    }
  } catch { /* not signed in / non-critical */ }
}

async function loadMyPreListings() {
  const el = document.getElementById('myPreListingsList');
  try {
    const { preListings } = await apiGet('/api/pre-listings?mine=1');
    attentionState.bids = preListings.reduce((sum, p) => sum + (p.pendingBidCount || 0), 0);
    attentionState.showings = preListings.reduce((sum, p) => sum + (p.pendingShowingCount || 0), 0);
    renderAttentionStrip();
    el.innerHTML = preListings.length ? preListings.map(p => {
      const needsAttention = [
        p.pendingBidCount > 0 && `${p.pendingBidCount} proposal${p.pendingBidCount === 1 ? '' : 's'}`,
        p.pendingShowingCount > 0 && `${p.pendingShowingCount} showing request${p.pendingShowingCount === 1 ? '' : 's'}`,
      ].filter(Boolean);
      return `
      <div class="card">
        <div class="card-head">
          <h3>${escapeHtml(p.title || p.propertyType)}</h3>
          <span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${p.status}</span>
        </div>
        <div class="mini-block">${escapeHtml(p.propertyType)} · ${p.beds}bd/${p.baths}ba in ${escapeHtml(p.city)}, ${escapeHtml(p.state)} ${escapeHtml(p.zip || '')}<br>${money(p.askingPrice)} asking</div>
        <p class="tiny"><span class="badge ${p.occupancyStatus === 'vacant' ? 'badge-gold' : ''}">${p.occupancyStatus === 'vacant' ? 'Vacant' : 'Occupied'}</span></p>
        <p class="tiny">${voteSummary(p.votes, 'Votes')}</p>
        ${needsAttention.length ? `<p class="tiny"><span class="badge badge-gold">👋 ${needsAttention.join(' · ')} waiting on you</span></p>` : ''}
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" data-action="open-pre-listing" data-id="${p.id}">View Proposals</button>
          ${p.status === 'open' ? `<button class="btn btn-ghost btn-sm" data-action="edit-pre-listing-from-list" data-id="${p.id}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="close-pre-listing-from-list" data-id="${p.id}">Close</button>` : ''}
          ${p.status !== 'awarded' ? `<button class="btn btn-danger btn-sm" data-action="delete-pre-listing-from-list" data-id="${p.id}">Delete</button>` : ''}
        </div>
      </div>
    `;
    }).join('') : '<div class="empty-state">You haven\'t posted a pre-listing yet.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadMyTransactions() {
  const el = document.getElementById('myTransactionsList');
  try {
    const { transactions } = await apiGet('/api/transactions?mine=1');
    el.innerHTML = transactions.length ? transactions.map(t => `
      <div class="card">
        <div class="card-head">
          <h3>${escapeHtml(t.listingA.owner)} ⇄ ${escapeHtml(t.listingB.owner)}</h3>
          <span class="badge ${t.status === 'open' ? 'badge-active' : 'badge-paused'}">${t.status}</span>
        </div>
        <div class="mini-block">${escapeHtml(t.listingA.propertyType)} in ${escapeHtml(t.listingA.city)}, ${escapeHtml(t.listingA.state)} (${money(t.listingA.estimatedValue)})<br>for ${escapeHtml(t.listingB.propertyType)} in ${escapeHtml(t.listingB.city)}, ${escapeHtml(t.listingB.state)} (${money(t.listingB.estimatedValue)})</div>
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" data-action="open-transaction" data-id="${t.id}">View Proposals</button>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No transaction requests yet — open one from a match card on the Matches tab.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadMyBids() {
  const el = document.getElementById('myBidsList');
  try {
    const { bids } = await apiGet('/api/agents/my-bids');
    el.innerHTML = bids.length ? bids.map(b => {
      const target = b.requestType === 'pre_listing' ? b.preListing : b.transaction;
      const label = b.requestType === 'pre_listing'
        ? (target ? `${escapeHtml(target.title || target.propertyType)} — ${escapeHtml(target.city)}, ${escapeHtml(target.state)} (${money(target.askingPrice)})` : 'Pre-listing removed')
        : (target ? `Transaction #${target.id}` : 'Transaction removed');
      // Only pre-listings have one clear homeowner to check in with — a transaction has two trade partners, so
      // the check-in button is scoped to the case where "who do I message" isn't ambiguous.
      const checkInTarget = b.isStale && b.requestType === 'pre_listing' && b.preListing ? b.preListing.userId : null;
      return `
        <div class="side">
          <strong>${label}</strong>
          <span class="tiny">Your proposal: ${b.commissionPct ? `${b.commissionPct}% commission` : ''}${b.commissionPct && b.flatFee ? ' + ' : ''}${b.flatFee ? money(b.flatFee) + ' flat' : ''} · <span class="badge ${b.status === 'accepted' ? 'badge-active' : b.status === 'declined' ? 'badge-paused' : ''}">${b.status}</span></span>
          ${b.isStale ? '<span class="tiny gone-quiet-nudge">Still pending after a while — maybe follow up with the homeowner.</span>' : ''}
          <button class="link-btn" data-action="open-${b.requestType === 'pre_listing' ? 'pre-listing' : 'transaction'}" data-id="${b.requestId}">View</button>
          ${checkInTarget ? `<button class="link-btn" data-action="check-in-bid" data-user-id="${checkInTarget}" data-title="${escapeHtml(target.title || 'your pre-listing')}">Send a check-in</button>` : ''}
        </div>
      `;
    }).join('') : '<span class="tiny">No proposals submitted yet.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

async function loadMarketplaceBrowse() {
  const el = document.getElementById('marketplaceBrowseList');
  const city = document.getElementById('marketCity').value.trim();
  const state = document.getElementById('marketState').value.trim();
  const params = new URLSearchParams();
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  try {
    const [{ preListings }, { transactions }] = await Promise.all([
      apiGet(`/api/pre-listings?${params.toString()}`),
      apiGet('/api/transactions'),
    ]);
    const onlyInArea = document.getElementById('marketOnlyInArea').checked;
    const filteredPreListings = onlyInArea ? preListings.filter(p => p.inServiceArea) : preListings;

    // "New since your last visit" — per-device only (never shared, never read by the server), same spirit as
    // remembering the last tab. Read before overwriting, so this visit's count reflects the *previous* visit,
    // not itself; a first-ever visit has nothing to compare against, so nothing is marked new.
    let lastVisit = null;
    try { lastVisit = localStorage.getItem('ah_browse_last_visit'); } catch {}
    const isNew = p => lastVisit && new Date(p.createdAt + 'Z').getTime() > new Date(lastVisit).getTime();
    const newCount = lastVisit ? filteredPreListings.filter(isNew).length : 0;
    try { localStorage.setItem('ah_browse_last_visit', new Date().toISOString()); } catch {}

    const plCards = filteredPreListings.map(p => `
      <div class="card">
        <div class="card-head">
          <h3>${escapeHtml(p.title || p.propertyType)}</h3>
          <span class="badge badge-gold">Pre-Listing</span>${isNew(p) ? ' <span class="badge badge-active">New</span>' : ''}
        </div>
        <div class="mini-block">${escapeHtml(p.propertyType)} · ${p.beds}bd/${p.baths}ba in ${escapeHtml(p.city)}, ${escapeHtml(p.state)} ${escapeHtml(p.zip)}<br>${money(p.askingPrice)} asking</div>
        <p class="tiny">
          <span class="badge ${p.occupancyStatus === 'vacant' ? 'badge-gold' : ''}">${p.occupancyStatus === 'vacant' ? 'Vacant' : 'Occupied'}</span>
          ${p.distanceMiles !== null ? ` · <span class="badge ${p.inServiceArea ? 'badge-active' : 'badge-paused'}">${p.inServiceArea ? `${p.distanceMiles} mi — in your area` : `${p.distanceMiles} mi — outside your area`}</span>` : ''}
        </p>
        <p class="tiny">${voteSummary(p.votes, 'Votes')}</p>
        <div class="card-actions"><button class="btn btn-primary btn-sm" data-action="open-pre-listing" data-id="${p.id}">View &amp; Propose</button></div>
      </div>
    `);
    const txCards = transactions.map(t => `
      <div class="card">
        <div class="card-head"><h3>${escapeHtml(t.listingA.owner)} ⇄ ${escapeHtml(t.listingB.owner)}</h3><span class="badge badge-gold">Trade Closing</span></div>
        <div class="mini-block">${escapeHtml(t.listingA.propertyType)} in ${escapeHtml(t.listingA.city)}, ${escapeHtml(t.listingA.state)}<br>for ${escapeHtml(t.listingB.propertyType)} in ${escapeHtml(t.listingB.city)}, ${escapeHtml(t.listingB.state)}</div>
        <div class="card-actions"><button class="btn btn-primary btn-sm" data-action="open-transaction" data-id="${t.id}">View &amp; Propose</button></div>
      </div>
    `);
    const newBanner = newCount > 0 ? `<p class="tiny">🆕 ${newCount} new pre-listing${newCount === 1 ? '' : 's'} since your last visit.</p>` : '';
    el.innerHTML = newBanner + ((plCards.length + txCards.length) ? [...plCards, ...txCards].join('') : '<div class="empty-state">Nothing open right now.</div>');
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadMarketplaceTab() {
  document.getElementById('marketplaceDetailView').classList.add('hidden');
  document.getElementById('marketplaceListView').classList.remove('hidden');
  fillTypeSelect(document.getElementById('plPropertyType'), false);
  renderServicesEditor('agentServicesEditor', []);
  renderOpenHouseDaysEditor('agentOpenHouseDays', []);
  loadAgentStatus();
  loadMyPreListings();
  loadMyTransactions();
  loadMarketplaceBrowse();
  loadCostEstimator();
  loadAgentDirectory();
  loadFavoriteAgents();
  loadMyDisputes();
  loadAgentAlerts();
}

// A quick-scan table above the full proposal cards, once there's something to compare — the whole point of
// Agent Strategy is comparing agents fairly, so this shouldn't require scrolling through full cards first.
function renderBidComparisonTable(bids, canAct) {
  if (!bids || bids.length < 2) return '';
  const rows = bids.map(b => {
    const winRatePct = b.winRate !== null && b.winRate !== undefined ? `${Math.round(b.winRate * 100)}%` : '—';
    const respLabel = formatResponseHours(b.avgResponseHours) || '—';
    const feeParts = [b.commissionPct ? `${b.commissionPct}%` : '', b.flatFee ? money(b.flatFee) : ''].filter(Boolean);
    const serviceCount = (b.services || []).length;
    const statusBadge = `<span class="badge ${b.status === 'accepted' ? 'badge-active' : b.status === 'declined' ? 'badge-paused' : 'badge-gold'}">${b.status}</span>`;
    return `<tr>
      <td><a class="profile-link" href="/profile/${b.agentUserId}">${escapeHtml(b.agentName)}</a>${b.topRated ? ' 🏆' : ''}</td>
      <td>${ratingChipHtml(b.rating, b.reviewCount)}</td>
      <td>${feeParts.length ? feeParts.join(' + ') : '—'}</td>
      <td>${serviceCount} service${serviceCount === 1 ? '' : 's'}</td>
      <td>${winRatePct}</td>
      <td>${respLabel}</td>
      <td>${statusBadge}</td>
      <td>${canAct && b.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" data-action="accept-bid" data-bid-id="${b.id}">Accept</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `
    <div class="comparison-table-wrap">
      <table class="comparison-table">
        <thead><tr><th>Agent</th><th>Rating</th><th>Fee</th><th>Services</th><th>Win rate</th><th>Replies in</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="tiny">Full details for each proposal, including their message and what's included, are below.</p>
  `;
}

function renderBidCard(b, canAct, backLink) {
  const winRatePct = b.winRate !== null && b.winRate !== undefined ? Math.round(b.winRate * 100) : null;
  const respLabel = formatResponseHours(b.avgResponseHours);
  const statusBadge = `<span class="badge ${b.status === 'accepted' ? 'badge-active' : b.status === 'declined' ? 'badge-paused' : 'badge-gold'}">${b.status}</span>`;
  const details = agentDetailsHtml({
    status: b.licenseVerified ? [{ text: 'License Verified', tone: 'good' }] : [],
    stats: [
      winRatePct !== null && { k: 'Win rate', v: `${winRatePct}%` },
      respLabel && { k: 'Replies in', v: respLabel },
    ].filter(Boolean),
    selfReported: [
      b.homesSoldLastYear && { k: 'Sold, last 12 mo', v: String(b.homesSoldLastYear) },
      b.avgDaysOnMarket && { k: 'On market', v: `~${b.avgDaysOnMarket} days` },
    ].filter(Boolean),
  });
  return `
    <div class="card">
      ${personHeadHtml({
        avatar: avatarHtml(b.agentName, { seed: b.agentUserId, size: 'lg' }),
        nameHtml: `<a class="profile-link" href="/profile/${b.agentUserId}${backLink ? `?back=${encodeURIComponent(backLink)}` : ''}">${escapeHtml(b.agentName)}</a>${b.isVerified ? ' <span class="badge badge-verified" title="Verified">✓</span>' : ''}${b.topRated ? ' <span class="badge badge-gold" title="4.5+ rating, 3+ reviews, 30%+ win rate">🏆 Top Rated</span>' : ''}`,
        sub: b.brokerageName || '',
        chips: [ratingChipHtml(b.rating, b.reviewCount), b.yearsExperience ? chipHtml(`${b.yearsExperience} yrs experience`, 'outline') : ''].filter(Boolean),
        aside: statusBadge,
      })}
      ${b.isStale ? `<p class="tiny gone-quiet-nudge">This proposal has been pending a while — consider reviewing it or letting the agent know where things stand.</p>` : ''}
      ${details}
      ${b.hasVideo ? `<video controls preload="none" class="media-video media-video-sm" src="/api/agent-video/${b.agentUserId}"></video>` : ''}
      <p>${escapeHtml(b.message)}</p>
      <div class="mini-two">
        <div class="mini-block"><span class="label">Proposed fee</span>${b.commissionPct ? `${b.commissionPct}% commission` : ''}${b.commissionPct && b.flatFee ? ' + ' : ''}${b.flatFee ? `${money(b.flatFee)} flat` : ''}</div>
        <div class="mini-block"><span class="label">Included services</span>${renderServicesSummary(b.services)}</div>
      </div>
      ${b.openHouseDays && b.openHouseDays.length > 0 ? `<p class="tiny"><span class="label">Typically holds open houses</span> ${b.openHouseDays.map(d => OPEN_HOUSE_DAY_LABELS[d] || d).join(', ')}</p>` : ''}
      <div class="card-actions">
        ${canAct && b.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-action="accept-bid" data-bid-id="${b.id}">Accept This Proposal</button>` : ''}
        ${canAct ? `<button class="btn btn-ghost btn-sm" data-action="message-user" data-id="${b.agentUserId}" data-name="${escapeHtml(b.agentName)}">Message ${escapeHtml(b.agentName)}</button>` : ''}
        ${canAct ? `<button class="btn btn-ghost btn-sm" data-action="toggle-favorite-agent" data-agent-id="${b.agentUserId}">☆ Favorite</button>` : ''}
      </div>
    </div>
  `;
}

function renderBidFormAndVote(myBid, myVote, showVote) {
  const services = myBid ? myBid.services : [];
  return `
    <div class="panel">
      <h3>${myBid ? 'Your Proposal' : 'Submit a Proposal'}</h3>
      ${!myBid && currentAgentPackages.length > 0 ? `
        <div class="field"><label>Quick-fill from a package</label>
          <div class="card-actions">
            ${currentAgentPackages.map(p => `<button type="button" class="btn btn-ghost btn-sm" data-action="quickfill-package" data-tier="${p.tier}">${PACKAGE_TIER_LABELS[p.tier]}${p.flatFee ? ` (${money(p.flatFee)})` : ''}${p.flatFee && p.commissionPct ? ' + ' : ''}${p.commissionPct ? `${p.commissionPct}%` : ''}</button>`).join('')}
          </div>
        </div>
      ` : ''}
      <div class="field"><label>Message</label><textarea id="bidMessage" maxlength="2000">${escapeHtml(myBid ? myBid.message : '')}</textarea></div>
      <div class="form-row two-col">
        <div class="field"><label>Commission (%)</label><input type="number" id="bidCommissionPct" min="0" max="100" step="0.1" value="${myBid && myBid.commissionPct ? myBid.commissionPct : ''}"></div>
        <div class="field"><label>…or flat fee ($)</label><input type="number" id="bidFlatFee" min="0" max="500000" step="100" value="${myBid && myBid.flatFee ? myBid.flatFee : ''}"></div>
      </div>
      <div class="field"><label>Included services</label><div id="bidServicesEditor"></div></div>
      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="submit-bid">${myBid ? 'Update Proposal' : 'Submit Proposal'}</button>
        ${myBid && myBid.status === 'pending' ? '<button type="button" class="btn btn-danger btn-sm" data-action="withdraw-bid" data-bid-id="' + myBid.id + '">Withdraw</button>' : ''}
      </div>
    </div>
    ${showVote ? `
    <div class="panel">
      <h3>Is the price right?</h3>
      <div class="card-actions">
        <button type="button" class="btn ${myVote && myVote.vote === 'too_high' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="cast-vote" data-vote="too_high">Too High</button>
        <button type="button" class="btn ${myVote && myVote.vote === 'just_right' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="cast-vote" data-vote="just_right">Just Right</button>
        <button type="button" class="btn ${myVote && myVote.vote === 'too_low' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="cast-vote" data-vote="too_low">Too Low</button>
      </div>
    </div>` : ''}
  `;
}

// ---- Owner tools for their own pre-listing: edit the details, or close it ----
// A homeowner's private checklist of common CA pre-listing disclosures — informational, not legal advice (the
// list itself is defined server-side in functions/_lib/disclosures.js; the client only knows the labels/notes
// the API sends back, so a wording change there never needs a client deploy to match). Visible to the owner
// regardless of status, unlike votes/proposals, since it stays useful even after the pre-listing is awarded.
function renderDisclosuresChecklist(p) {
  const checked = new Set(p.disclosureChecklist || []);
  const done = checked.size, total = DISCLOSURE_ITEMS.length;
  return `
    <details class="panel">
      <summary>Seller disclosures checklist (${done}/${total})</summary>
      <p class="tiny">Common California pre-listing disclosures — not a complete list for every property, and not legal advice. Check with a real estate attorney or your agent for what your specific sale needs.</p>
      <div id="disclosuresChecklist" data-pre-listing-id="${p.id}">
        ${DISCLOSURE_ITEMS.map(item => `
          <label class="checkbox-row">
            <input type="checkbox" class="disclosure-check" value="${item.key}" ${checked.has(item.key) ? 'checked' : ''}>
            <span>${escapeHtml(item.label)}<br><span class="tiny">${escapeHtml(item.note)}</span></span>
          </label>
        `).join('')}
      </div>
    </details>
  `;
}

function renderPreListingOwnerBar(p) {
  const deleteBtn = `<button type="button" class="btn btn-danger btn-sm" data-action="delete-pre-listing" data-id="${p.id}">Delete</button>`;
  if (p.status === 'open') {
    return `<div class="card-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="edit-pre-listing">Edit details</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="close-pre-listing">Close pre-listing</button>
      ${deleteBtn}
    </div>`;
  }
  if (p.status === 'closed') return `<p class="tiny">You closed this pre-listing, so agents can no longer vote or send proposals.</p><div class="card-actions">${deleteBtn}</div>`;
  return ''; // awarded — deletion is blocked server-side too, same protection as closing/editing
}

function renderPreListingEditForm(p) {
  const v = x => escapeHtml(x ?? '');
  const typeOptions = PROPERTY_TYPES.map(t => `<option value="${escapeHtml(t)}"${t === p.propertyType ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const photos = p.photoIds.map(pid => `
    <div class="edit-photo">
      <img src="/api/pre-listing-photos/${pid}" alt="" loading="lazy">
      <button type="button" class="btn btn-ghost btn-sm" data-action="delete-pre-listing-photo" data-photo-id="${pid}">Remove</button>
    </div>`).join('');
  const total = p.votes && p.votes.total ? p.votes.total : 0;
  return `
    <div class="card hidden" id="preListingEditPanel" data-asking-price="${v(p.askingPrice)}" data-votes="${total}">
      <div class="card-head"><h2>Edit pre-listing</h2></div>
      <p class="tiny">Changing the asking price clears the price votes agents have already cast, because they were about the old price. Proposals stay.</p>
      <div class="form-row two-col">
        <div class="field"><label for="pleTitle">Title (optional)</label><input type="text" id="pleTitle" maxlength="120" value="${v(p.title)}"></div>
        <div class="field"><label for="pleAskingPrice">Asking price ($) <span class="required-mark">*</span></label><input type="number" id="pleAskingPrice" min="1" max="500000000" step="1000" value="${v(p.askingPrice)}"></div>
      </div>
      <div class="form-row three-col">
        <div class="field"><label for="pleCity">City <span class="required-mark">*</span></label><input type="text" id="pleCity" maxlength="80" value="${v(p.city)}"></div>
        <div class="field"><label for="pleState">State <span class="required-mark">*</span></label><input type="text" id="pleState" maxlength="20" value="${v(p.state)}"></div>
        <div class="field"><label for="pleZip">Zip <span class="required-mark">*</span></label><input type="text" id="pleZip" maxlength="10" inputmode="numeric" value="${v(p.zip)}"></div>
      </div>
      <div class="field"><label for="pleNeighborhood">Neighborhood (public)</label><input type="text" id="pleNeighborhood" maxlength="80" value="${v(p.neighborhood)}"></div>
      <div class="field"><label for="pleAddress">Street address (private — only you can see it)</label><input type="text" id="pleAddress" maxlength="150" value="${v(p.address)}"></div>
      <div class="form-row three-col">
        <div class="field"><label for="plePropertyType">Property type <span class="required-mark">*</span></label><select id="plePropertyType">${typeOptions}</select></div>
        <div class="field"><label for="pleBeds">Beds <span class="required-mark">*</span></label><input type="number" id="pleBeds" min="0" max="50" value="${v(p.beds)}"></div>
        <div class="field"><label for="pleBaths">Baths <span class="required-mark">*</span></label><input type="number" id="pleBaths" min="0" max="50" step="0.5" value="${v(p.baths)}"></div>
      </div>
      <div class="field"><label for="pleSqft">Sq ft</label><input type="number" id="pleSqft" min="0" max="200000" step="50" value="${v(p.sqft)}"></div>
      <div class="field"><label for="pleDescription">Description</label><textarea id="pleDescription" maxlength="2000">${v(p.description)}</textarea></div>
      <div class="form-row two-col">
        <div class="field"><label for="pleOccupancyStatus">Occupied or vacant during the sale?</label>
          <select id="pleOccupancyStatus"><option value="occupied"${p.occupancyStatus === 'occupied' ? ' selected' : ''}>Occupied</option><option value="vacant"${p.occupancyStatus === 'vacant' ? ' selected' : ''}>Vacant</option></select>
        </div>
        <div class="field"><label for="pleShowingNoticeHours">Showing notice required (hours)</label><input type="number" id="pleShowingNoticeHours" min="0" max="336" value="${v(p.showingNoticeHours)}"></div>
      </div>
      <div class="field"><label for="pleSpecialInstructions">Special instructions for agents</label><textarea id="pleSpecialInstructions" maxlength="500">${v(p.specialInstructions)}</textarea></div>
      <p class="tiny"><strong>Optional preferences for agents (informational only):</strong></p>
      <div class="form-row three-col">
        <div class="field"><label for="pleMinYearsExperience">Min. years of experience</label><input type="number" id="pleMinYearsExperience" min="0" max="80" value="${v(p.minYearsExperience)}"></div>
        <div class="field"><label for="plePreferredLanguage">Preferred language</label><input type="text" id="plePreferredLanguage" maxlength="40" value="${v(p.preferredLanguage)}"></div>
        <div class="field"><label for="plePreferredAgreementMonths">Preferred agreement length (months)</label><input type="number" id="plePreferredAgreementMonths" min="1" max="60" value="${v(p.preferredAgreementMonths)}"></div>
      </div>
      <div class="form-row two-col">
        <label class="checkbox-row"><input type="checkbox" id="pleRequireDedicatedContact"${p.requireDedicatedContact ? ' checked' : ''}><span>I want a single dedicated point of contact, no team hand-offs</span></label>
        <label class="checkbox-row"><input type="checkbox" id="plePrefersExclusive"${p.prefersExclusive ? ' checked' : ''}><span>I'd prefer an exclusive listing agreement</span></label>
      </div>
      <label class="checkbox-row"><input type="checkbox" id="plePrefersLocalSpecialist"${p.prefersLocalSpecialist ? ' checked' : ''}><span>I'd prefer an agent who specializes in my specific area, not one covering a huge territory</span></label>
      <div class="field">
        <label>Photos</label>
        <div class="edit-photos" id="pleExistingPhotos">${photos}</div>
        <input type="file" id="plePhotos" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
        <p class="tiny">Up to 8 in total. Added photos upload when you save.</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="save-pre-listing">Save changes</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-edit-pre-listing">Cancel</button>
      </div>
    </div>`;
}

// Swaps the read-only card for the edit form (and back).
function showPreListingEditor(on) {
  const view = document.getElementById('preListingViewCard');
  const panel = document.getElementById('preListingEditPanel');
  if (!view || !panel) return;
  view.classList.toggle('hidden', on);
  panel.classList.toggle('hidden', !on);
  if (on) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function savePreListingEdit(id) {
  const panel = document.getElementById('preListingEditPanel');
  if (!panel) return;
  const val = key => document.getElementById('ple' + key).value;
  const checked = key => document.getElementById('ple' + key).checked;

  const voteCount = Number(panel.dataset.votes) || 0;
  if (voteCount > 0 && Number(val('AskingPrice')) !== Number(panel.dataset.askingPrice)
      && !confirm(`Changing the asking price clears the ${voteCount} price vote${voteCount === 1 ? '' : 's'} agents already cast, since they were about the old price. Continue?`)) return;

  const btn = panel.querySelector('[data-action="save-pre-listing"]');
  btn.disabled = true;
  try {
    const result = await apiPut(`/api/pre-listings/${id}`, {
      title: val('Title').trim(),
      askingPrice: val('AskingPrice'),
      city: val('City').trim(),
      state: val('State').trim(),
      zip: val('Zip').trim(),
      neighborhood: val('Neighborhood').trim(),
      address: val('Address').trim(),
      propertyType: val('PropertyType'),
      beds: val('Beds'),
      baths: val('Baths'),
      sqft: val('Sqft') || null,
      description: val('Description').trim(),
      occupancyStatus: val('OccupancyStatus'),
      showingNoticeHours: val('ShowingNoticeHours') || 0,
      specialInstructions: val('SpecialInstructions').trim(),
      minYearsExperience: val('MinYearsExperience') || null,
      preferredLanguage: val('PreferredLanguage').trim(),
      preferredAgreementMonths: val('PreferredAgreementMonths') || null,
      requireDedicatedContact: checked('RequireDedicatedContact'),
      prefersExclusive: checked('PrefersExclusive'),
      prefersLocalSpecialist: checked('PrefersLocalSpecialist'),
    });
    for (const file of [...document.getElementById('plePhotos').files]) {
      const formData = new FormData();
      formData.append('photo', file);
      try { await apiUpload(`/api/pre-listings/${id}/photos`, formData); }
      catch (err) { toast(`Photo upload failed: ${err.message}`); }
    }
    toast(result.votesCleared ? 'Saved — the old price votes were cleared so agents can weigh in on the new price.' : 'Pre-listing updated.');
    openPreListingDetail(id);
  } catch (err) { toast(err.message); } finally { btn.disabled = false; }
}

async function closePreListing(id, fromList) {
  if (!confirm("Close this pre-listing? Agents will no longer be able to vote or send proposals, and it can't be reopened. You can post a new one any time.")) return;
  try {
    await apiPut(`/api/pre-listings/${id}`, { action: 'close' });
    toast('Pre-listing closed.');
    if (fromList) loadMyPreListings(); else openPreListingDetail(id);
  } catch (err) { toast(err.message); }
}

async function deletePreListing(id, fromList) {
  if (!confirm('Permanently delete this pre-listing? It cannot be recovered after this.')) return;
  try {
    await apiDelete(`/api/pre-listings/${id}`);
    toast('Pre-listing deleted.');
    if (fromList) loadMyPreListings(); else backToMarketplaceList();
  } catch (err) { toast(err.message); }
}

function showMarketplaceDetail() {
  document.getElementById('marketplaceListView').classList.add('hidden');
  document.getElementById('marketplaceDetailView').classList.remove('hidden');
  document.getElementById('marketplaceDetailView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backToMarketplaceList() {
  marketplaceDetail = null;
  document.getElementById('marketplaceDetailView').classList.add('hidden');
  document.getElementById('marketplaceListView').classList.remove('hidden');
  loadMyPreListings();
  loadMyTransactions();
  loadMarketplaceBrowse();
}

async function openPreListingDetail(id, opts = {}) {
  const contentEl = document.getElementById('marketplaceDetailContent');
  try {
    const { preListing: p, bids, myBid, myVote, isOwner, homeownerRating } = await apiGet(`/api/pre-listings/${id}`);
    marketplaceDetail = { kind: 'pre_listing', id };
    showMarketplaceDetail();

    const photosHtml = p.photoIds.length
      ? `<div class="photo-gallery">${p.photoIds.map(pid => `<img src="/api/pre-listing-photos/${pid}" alt="" loading="lazy" class="media-thumb">`).join('')}</div>`
      : '';
    const isAwardedAgent = !isOwner && myBid && myBid.status === 'accepted';

    contentEl.innerHTML = `
      <div class="card" id="preListingViewCard">
        <div class="card-head"><h2>${escapeHtml(p.title || p.propertyType)}</h2><span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${p.status}</span></div>
        <div class="mini-block">${escapeHtml(p.propertyType)} · ${p.beds}bd/${p.baths}ba${p.sqft ? ` · ${p.sqft.toLocaleString('en-US')} sqft` : ''} in ${escapeHtml(p.neighborhood ? p.neighborhood + ', ' : '')}${escapeHtml(p.city)}, ${escapeHtml(p.state)} ${escapeHtml(p.zip)}<br>${money(p.askingPrice)} asking</div>
        <div class="mini-two">
          <div class="mini-block"><span class="label">Occupancy</span>${p.occupancyStatus === 'vacant' ? 'Vacant' : 'Occupied'} during the sale</div>
          <div class="mini-block"><span class="label">Showing notice</span>${p.showingNoticeHours > 0 ? `${p.showingNoticeHours} hours required` : 'None required'}</div>
        </div>
        ${p.specialInstructions ? `<p class="tiny"><span class="label">Special instructions</span> ${escapeHtml(p.specialInstructions)}</p>` : ''}
        ${renderStipulations(p)}
        ${p.distanceMiles !== null && p.distanceMiles !== undefined ? `<p class="tiny">${p.inServiceArea ? `✅ ${p.distanceMiles} miles from your nearest service zip — within your 20-mile area.` : `⚠️ ${p.distanceMiles} miles from your nearest service zip — outside your declared 20-mile area.`}</p>` : ''}
        ${!isOwner ? renderHomeownerRatingBadge(homeownerRating, 'Homeowner rating') : ''}
        ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
        ${photosHtml}
        <p class="tiny">${voteSummary(p.votes, 'Agent votes')}</p>
        ${renderPriceHistory(p.priceHistory)}
        ${isOwner ? `<p class="form-note trust"><strong>Talk to a lender.</strong> If selling here means financing your next place, rates, loan programs and approvals come from lenders, not from websites or real estate agents. Talk to your own mortgage broker, or use our preferred lender, <strong>Point Mortgage Corporation</strong> (NMLS #231073), at <a href="tel:+16194754095">(619) 475-4095</a>. You are always free to choose any lender you like, and you can verify any lender's license at nmlsconsumeraccess.org.</p>` : ''}
        ${isOwner ? renderPreListingOwnerBar(p) : ''}
      </div>
      ${isOwner && p.status === 'open' ? renderPreListingEditForm(p) : ''}
      ${isOwner ? renderDisclosuresChecklist(p) : ''}
      ${isOwner ? '<div id="showingsPanel"></div>' : ''}
      ${isOwner
        ? `<h3>Proposals (${bids.length})</h3>${bids.length ? `${renderBidComparisonTable(bids, true)}${bids.map(b => renderBidCard(b, true, `pre-listing-${id}`)).join('')}` : '<div class="empty-state">No proposals yet.</div>'}
           ${p.status === 'open' ? renderInviteAgentPanel() : ''}
           ${p.status === 'awarded' ? `<div id="milestonesPanel"></div>${renderDisputePanel()}${renderReviewForm()}` : ''}`
        : (currentAgentProfile && currentAgentProfile.status === 'approved'
          ? (isAwardedAgent
            ? `<div id="milestonesPanel"></div>${renderDisputePanel()}${renderHomeownerReviewForm()}`
            : `${renderBidFormAndVote(myBid, myVote, true)}${p.status === 'open' ? renderRequestShowingForm() : ''}`)
          : '<p class="tiny">Only approved agents can submit proposals or vote on pricing.</p>')}
    `;
    if (!isOwner && currentAgentProfile && currentAgentProfile.status === 'approved' && !isAwardedAgent) {
      renderServicesEditor('bidServicesEditor', myBid ? myBid.services : []);
    }
    if (opts.edit && isOwner && p.status === 'open') showPreListingEditor(true);
    if (p.status === 'awarded' && (isOwner || isAwardedAgent)) loadMilestonesInto('pre_listing', id);
    if (isOwner && p.status === 'open') loadInvitedAgentsInto('pre_listing', id);
    if (isOwner) loadShowingsInto(id, true);
    if (!isOwner && currentAgentProfile && currentAgentProfile.status === 'approved' && !isAwardedAgent && p.status === 'open') loadShowingsInto(id, false);
  } catch (e) { contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function openTransactionDetail(id) {
  const contentEl = document.getElementById('marketplaceDetailContent');
  try {
    const { transaction: t, bids, myBid, isParty, homeownerRatings } = await apiGet(`/api/transactions/${id}`);
    marketplaceDetail = { kind: 'transaction', id };
    showMarketplaceDetail();
    const isAwardedAgent = !isParty && myBid && myBid.status === 'accepted';

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(t.listingA.owner)} ⇄ ${escapeHtml(t.listingB.owner)}</h2><span class="badge ${t.status === 'open' ? 'badge-active' : 'badge-paused'}">${t.status}</span></div>
        <div class="mini-two">
          <div class="mini-block"><span class="label">${escapeHtml(t.listingA.owner)} has</span>${escapeHtml(t.listingA.propertyType)} in ${escapeHtml(t.listingA.city)}, ${escapeHtml(t.listingA.state)}<br>${money(t.listingA.estimatedValue)}</div>
          <div class="mini-block"><span class="label">${escapeHtml(t.listingB.owner)} has</span>${escapeHtml(t.listingB.propertyType)} in ${escapeHtml(t.listingB.city)}, ${escapeHtml(t.listingB.state)}<br>${money(t.listingB.estimatedValue)}</div>
        </div>
        ${t.note ? `<p>${escapeHtml(t.note)}</p>` : ''}
        ${!isParty ? `${renderHomeownerRatingBadge(homeownerRatings && homeownerRatings.a, `${t.listingA.owner} rating`)}${renderHomeownerRatingBadge(homeownerRatings && homeownerRatings.b, `${t.listingB.owner} rating`)}` : ''}
        <p class="tiny">Either trade partner can accept a proposal — coordinate with your trade partner via messages first.</p>
      </div>
      ${isParty
        ? `<h3>Proposals (${bids.length})</h3>${bids.length ? `${renderBidComparisonTable(bids, true)}${bids.map(b => renderBidCard(b, true, `transaction-${id}`)).join('')}` : '<div class="empty-state">No proposals yet.</div>'}
           ${t.status === 'open' ? renderInviteAgentPanel() : ''}
           ${t.status === 'awarded' ? `<div id="milestonesPanel"></div>${renderDisputePanel()}${renderReviewForm()}` : ''}`
        : (currentAgentProfile && currentAgentProfile.status === 'approved'
          ? (isAwardedAgent
            ? `<div id="milestonesPanel"></div>${renderDisputePanel()}${renderHomeownerReviewForm()}`
            : renderBidFormAndVote(myBid, null, false))
          : '<p class="tiny">Only approved agents can submit proposals.</p>')}
    `;
    if (!isParty && currentAgentProfile && currentAgentProfile.status === 'approved' && !isAwardedAgent) {
      renderServicesEditor('bidServicesEditor', myBid ? myBid.services : []);
    }
    if (t.status === 'awarded' && (isParty || isAwardedAgent)) loadMilestonesInto('transaction', id);
    if (isParty && t.status === 'open') loadInvitedAgentsInto('transaction', id);
  } catch (e) { contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

/* ---------------- AugmentedHomes ---------------- */
let augmentedDetail = null; // { id }

function showAugmentedDetail() {
  document.getElementById('augmentedListView').classList.add('hidden');
  document.getElementById('augmentedDetailView').classList.remove('hidden');
  document.getElementById('augmentedDetailView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backToAugmentedList() {
  augmentedDetail = null;
  document.getElementById('augmentedDetailView').classList.add('hidden');
  document.getElementById('augmentedListView').classList.remove('hidden');
  loadMyAugmentedHomes();
  loadAugmentedBrowse();
}

function adaptationLabel(key) {
  const item = ADAPTATION_ITEMS.find(i => i.key === key);
  return item ? item.label : key;
}

function augmentedHomeCardHtml(h, { mine } = {}) {
  return `
    <div class="card">
      <div class="card-head">
        <h3>${escapeHtml(h.title || h.propertyType)}</h3>
        <span class="badge ${h.status === 'active' ? 'badge-active' : 'badge-paused'}">${h.status.replace('_', ' ')}</span>
      </div>
      <div class="mini-block">${escapeHtml(h.propertyType)} · ${h.beds}bd/${h.baths}ba in ${escapeHtml(h.city)}, ${escapeHtml(h.state)}<br>${money(h.askingPrice)} asking</div>
      <p class="tiny">${h.adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(adaptationLabel(k))}</span>`).join(' ')}</p>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="open-augmented-home" data-id="${h.id}">View</button>
        ${mine && h.status === 'active' ? `
          <button class="btn btn-ghost btn-sm" data-action="augmented-set-status" data-id="${h.id}" data-status="under_contract">Mark Under Contract</button>
          <button class="btn btn-ghost btn-sm" data-action="augmented-set-status" data-id="${h.id}" data-status="sold">Mark Sold</button>
          <button class="btn btn-ghost btn-sm" data-action="augmented-set-status" data-id="${h.id}" data-status="withdrawn">Withdraw</button>` : ''}
      </div>
    </div>
  `;
}

async function loadMyAugmentedHomes() {
  const el = document.getElementById('myAugmentedHomesList');
  try {
    const { homes } = await apiGet('/api/augmented-homes?mine=1');
    el.innerHTML = homes.length ? homes.map(h => augmentedHomeCardHtml(h, { mine: true })).join('') : '<div class="empty-state">You haven\'t listed a home yet.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadAugmentedBrowse() {
  const el = document.getElementById('augmentedBrowseList');
  const city = document.getElementById('augmentedCity').value.trim();
  const state = document.getElementById('augmentedState').value.trim();
  const wanted = [...document.querySelectorAll('.augmented-filter-check:checked')].map(c => c.value);
  const params = new URLSearchParams();
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  wanted.forEach(k => params.append('adaptation', k));
  try {
    const { homes } = await apiGet(`/api/augmented-homes?${params.toString()}`);
    el.innerHTML = homes.length ? homes.map(h => augmentedHomeCardHtml(h, { mine: false })).join('') : '<div class="empty-state">Nothing matching right now.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadMyAccessibilityAlerts() {
  const el = document.getElementById('accessibilityAlertsList');
  try {
    const { alerts } = await apiGet('/api/accessibility-needs-alerts');
    el.innerHTML = alerts.length ? alerts.map(a => `
      <div class="side">
        <strong>${escapeHtml(a.label)}</strong>
        <span class="tiny">${a.adaptations.map(k => escapeHtml(adaptationLabel(k))).join(', ')}${a.city || a.state ? ` · ${escapeHtml(a.city)}${a.city && a.state ? ', ' : ''}${escapeHtml(a.state)}` : ''}</span>
        <button class="link-btn" data-action="delete-accessibility-alert" data-id="${a.id}">Remove</button>
      </div>
    `).join('') : '<span class="tiny">No saved alerts yet.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

async function loadAugmentedTab() {
  document.getElementById('augmentedDetailView').classList.add('hidden');
  document.getElementById('augmentedListView').classList.remove('hidden');
  fillTypeSelect(document.getElementById('augPropertyType'), false);
  document.getElementById('augmentedAdaptationsFields').innerHTML = adaptationCheckboxesHtml([], 'augmented-create-check');
  document.getElementById('accessibilityAlertAdaptationsFields').innerHTML = adaptationCheckboxesHtml([], 'accessibility-alert-check');
  document.getElementById('augmentedFilterChips').innerHTML = adaptationCheckboxesHtml([], 'augmented-filter-check');
  loadMyAugmentedHomes();
  loadMyAccessibilityAlerts();
  loadAugmentedBrowse();
}

async function openAugmentedHomeDetail(id) {
  const contentEl = document.getElementById('augmentedDetailContent');
  try {
    const { home: h, isOwner } = await apiGet(`/api/augmented-homes/${id}`);
    augmentedDetail = { id };
    showAugmentedDetail();
    const photosHtml = h.photoIds.length
      ? `<div class="photo-gallery">${h.photoIds.map(pid => isOwner
          ? `<div class="photo-thumb"><img src="/api/augmented-home-photos/${pid}" alt="" loading="lazy"><button type="button" class="photo-delete" data-action="delete-augmented-photo" data-id="${pid}">✕</button></div>`
          : `<img src="/api/augmented-home-photos/${pid}" alt="" loading="lazy" class="media-thumb">`).join('')}</div>`
      : '';
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(h.title || h.propertyType)}</h2><span class="badge ${h.status === 'active' ? 'badge-active' : 'badge-paused'}">${h.status.replace('_', ' ')}</span></div>
        <div class="mini-block">${escapeHtml(h.propertyType)} · ${h.beds}bd/${h.baths}ba${h.sqft ? ` · ${h.sqft.toLocaleString('en-US')} sqft` : ''} in ${escapeHtml(h.neighborhood ? h.neighborhood + ', ' : '')}${escapeHtml(h.city)}, ${escapeHtml(h.state)} ${escapeHtml(h.zip)}<br>${money(h.askingPrice)} asking</div>
        ${h.description ? `<p>${escapeHtml(h.description)}</p>` : ''}
        ${photosHtml}
        <h3>Adaptations</h3>
        <p class="tiny">${h.adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(adaptationLabel(k))}</span>`).join(' ')}</p>
        ${isOwner ? `<div class="form-actions"><button type="button" class="btn btn-danger btn-sm" data-action="delete-augmented-home" data-id="${h.id}">Delete Listing</button></div>` : ''}
        ${h.adaptationNotes ? `<p class="tiny"><span class="label">Seller's notes</span> ${escapeHtml(h.adaptationNotes)}</p>` : ''}
        ${!isOwner ? `<div class="form-actions"><button class="btn btn-primary btn-sm" data-action="message-user" data-id="${h.userId}" data-name="${escapeHtml(h.owner)}">Message Seller</button></div>` : ''}
      </div>
    `;
  } catch (e) { contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

/* ---------------- FinderMine ---------------- */
let findermineDetail = null; // { id }

function showFinderMineDetail() {
  document.getElementById('findermineListView').classList.add('hidden');
  document.getElementById('findermineDetailView').classList.remove('hidden');
  document.getElementById('findermineDetailView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backToFinderMineList() {
  findermineDetail = null;
  document.getElementById('findermineDetailView').classList.add('hidden');
  document.getElementById('findermineListView').classList.remove('hidden');
  loadMyProjects();
  loadProjectsBrowse();
}

function projectCardHtml(p, { mine } = {}) {
  return `
    <div class="card">
      <div class="card-head">
        <h3>${escapeHtml(p.title)}</h3>
        <span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${p.status}</span>
      </div>
      <div class="mini-block">${escapeHtml(PROJECT_TYPE_LABELS[p.projectType] || p.projectType)} · ${escapeHtml(PROJECT_STAGE_LABELS[p.stage] || p.stage)} in ${escapeHtml(p.city)}, ${escapeHtml(p.state)}<br>${p.fundingGoal ? `${money(p.fundingGoal)} funding sought` : 'Funding goal not set'}</div>
      <p class="tiny">${p.interestCount} investor${p.interestCount === 1 ? '' : 's'} interested</p>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="open-dev-project" data-id="${p.id}">View</button>
        ${mine && p.status === 'open' ? `
          <button class="btn btn-ghost btn-sm" data-action="project-set-status" data-id="${p.id}" data-status="funded">Mark Funded</button>
          <button class="btn btn-ghost btn-sm" data-action="project-set-status" data-id="${p.id}" data-status="closed">Close</button>` : ''}
      </div>
    </div>
  `;
}

async function loadMyProjects() {
  const el = document.getElementById('myProjectsList');
  try {
    const { projects } = await apiGet('/api/dev-projects?mine=1');
    el.innerHTML = projects.length ? projects.map(p => projectCardHtml(p, { mine: true })).join('') : '<div class="empty-state">You haven\'t posted a project yet.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadProjectsBrowse() {
  const el = document.getElementById('projectsBrowseList');
  const city = document.getElementById('projectCity').value.trim();
  const state = document.getElementById('projectState').value.trim();
  const type = document.getElementById('projectTypeFilter').value;
  const stage = document.getElementById('projectStageFilter').value;
  const params = new URLSearchParams();
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (type) params.set('type', type);
  if (stage) params.set('stage', stage);
  try {
    const { projects } = await apiGet(`/api/dev-projects?${params.toString()}`);
    el.innerHTML = projects.length ? projects.map(p => projectCardHtml(p, { mine: false })).join('') : '<div class="empty-state">Nothing open right now.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadFinderMineTab() {
  document.getElementById('findermineDetailView').classList.add('hidden');
  document.getElementById('findermineListView').classList.remove('hidden');
  fillSelectFromLabels(document.getElementById('projTypeSelect'), PROJECT_TYPE_LABELS, false);
  fillSelectFromLabels(document.getElementById('projStageSelect'), PROJECT_STAGE_LABELS, false);
  fillSelectFromLabels(document.getElementById('projectTypeFilter'), PROJECT_TYPE_LABELS, true);
  fillSelectFromLabels(document.getElementById('projectStageFilter'), PROJECT_STAGE_LABELS, true);
  loadMyProjects();
  loadProjectsBrowse();
}

async function openProjectDetail(id) {
  const contentEl = document.getElementById('findermineDetailContent');
  try {
    const { project: p, isOwner, interestedInvestors, amInterested } = await apiGet(`/api/dev-projects/${id}`);
    findermineDetail = { id };
    showFinderMineDetail();
    const photosHtml = p.photoIds.length
      ? `<div class="photo-gallery">${p.photoIds.map(pid => isOwner
          ? `<div class="photo-thumb"><img src="/api/dev-project-photos/${pid}" alt="" loading="lazy"><button type="button" class="photo-delete" data-action="delete-project-photo" data-id="${pid}">✕</button></div>`
          : `<img src="/api/dev-project-photos/${pid}" alt="" loading="lazy" class="media-thumb">`).join('')}</div>`
      : '';
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(p.title)}</h2><span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${p.status}</span></div>
        <div class="mini-block">${escapeHtml(PROJECT_TYPE_LABELS[p.projectType] || p.projectType)} · ${escapeHtml(PROJECT_STAGE_LABELS[p.stage] || p.stage)} in ${escapeHtml(p.neighborhood ? p.neighborhood + ', ' : '')}${escapeHtml(p.city)}, ${escapeHtml(p.state)}</div>
        <div class="mini-two">
          <div class="mini-block"><span class="label">Funding sought</span>${p.fundingGoal ? money(p.fundingGoal) : 'Not set'}</div>
          <div class="mini-block"><span class="label">Min. investment</span>${p.minInvestment ? money(p.minInvestment) : 'Not set'}</div>
        </div>
        <div class="mini-two">
          <div class="mini-block"><span class="label">Target return</span>${escapeHtml(p.targetReturn) || 'Not stated'}</div>
          <div class="mini-block"><span class="label">Timeline</span>${p.timelineMonths ? `${p.timelineMonths} months` : 'Not stated'}</div>
        </div>
        ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
        ${photosHtml}
        <p class="tiny">${p.interestCount} investor${p.interestCount === 1 ? '' : 's'} interested</p>
        ${!isOwner ? `
          <div class="form-actions">
            <button class="btn ${amInterested ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="toggle-project-interest" data-id="${p.id}">${amInterested ? 'Interest Noted — Withdraw' : 'Express Interest'}</button>
            <button class="btn btn-ghost btn-sm" data-action="message-user" data-id="${p.userId}" data-name="${escapeHtml(p.owner)}">Message</button>
          </div>` : ''}
        ${isOwner ? `<div class="form-actions"><button type="button" class="btn btn-danger btn-sm" data-action="delete-project" data-id="${p.id}">Delete Project</button></div>` : ''}
      </div>
      ${isOwner && interestedInvestors ? `
        <h3>Interested Investors (${interestedInvestors.length})</h3>
        ${interestedInvestors.length ? interestedInvestors.map(i => `
          <div class="side">
            <strong>${escapeHtml(i.display_name)}</strong>
            ${i.note ? `<span class="tiny">${escapeHtml(i.note)}</span>` : ''}
            <button class="link-btn" data-action="message-user" data-id="${i.user_id}" data-name="${escapeHtml(i.display_name)}">Message</button>
          </div>
        `).join('') : '<div class="empty-state">No investors yet.</div>'}
      ` : ''}
    `;
  } catch (e) { contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

function renderReviewForm() {
  return `
    <div class="panel">
      <h3>Rate Your Agent</h3>
      <p class="tiny">Only the person who awarded this can leave a review, once per engagement.</p>
      <div class="field"><label>Rating</label><select id="reviewRating"><option value="5">⭐⭐⭐⭐⭐ Excellent</option><option value="4">⭐⭐⭐⭐ Good</option><option value="3">⭐⭐⭐ Okay</option><option value="2">⭐⭐ Poor</option><option value="1">⭐ Terrible</option></select></div>
      <div class="field"><label>Comment</label><textarea id="reviewComment" maxlength="1000"></textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="submit-review">Submit Review</button></div>
    </div>
  `;
}

const PACKAGE_TIERS = ['basic', 'standard', 'premium'];
function renderPackagesEditor(packages) {
  const byTier = new Map((packages || []).map(p => [p.tier, p]));
  const container = document.getElementById('agentPackagesEditor');
  container.innerHTML = PACKAGE_TIERS.map(tier => {
    const p = byTier.get(tier);
    return `
      <div class="panel">
        <h3>${PACKAGE_TIER_LABELS[tier]}</h3>
        <div class="form-row two-col">
          <div class="field"><label>Title</label><input type="text" class="pkg-title" data-tier="${tier}" maxlength="80" value="${escapeHtml(p ? p.title : '')}" placeholder="${PACKAGE_TIER_LABELS[tier]}"></div>
          <div class="field"><label>Turnaround (days)</label><input type="number" class="pkg-turnaround" data-tier="${tier}" min="1" max="365" value="${p && p.turnaroundDays ? p.turnaroundDays : ''}"></div>
        </div>
        <div class="field"><label>Description</label><textarea class="pkg-description" data-tier="${tier}" maxlength="500">${escapeHtml(p ? p.description : '')}</textarea></div>
        <div class="form-row two-col">
          <div class="field"><label>Commission (%)</label><input type="number" class="pkg-commission" data-tier="${tier}" min="0" max="100" step="0.1" value="${p && p.commissionPct ? p.commissionPct : ''}"></div>
          <div class="field"><label>…or flat fee ($)</label><input type="number" class="pkg-flatfee" data-tier="${tier}" min="0" max="500000" step="50" value="${p && p.flatFee ? p.flatFee : ''}"></div>
        </div>
        <div class="field"><label>Included services</label><div id="pkgServices_${tier}"></div></div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="save-package" data-tier="${tier}">Save ${PACKAGE_TIER_LABELS[tier]}</button>
          ${p ? `<button type="button" class="btn btn-danger btn-sm" data-action="delete-package" data-tier="${tier}">Remove</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  PACKAGE_TIERS.forEach(tier => renderServicesEditor(`pkgServices_${tier}`, byTier.get(tier) ? byTier.get(tier).services : []));
}

function collectPackageInput(tier) {
  return {
    title: document.querySelector(`.pkg-title[data-tier="${tier}"]`).value.trim(),
    description: document.querySelector(`.pkg-description[data-tier="${tier}"]`).value.trim(),
    turnaroundDays: document.querySelector(`.pkg-turnaround[data-tier="${tier}"]`).value || null,
    commissionPct: document.querySelector(`.pkg-commission[data-tier="${tier}"]`).value || null,
    flatFee: document.querySelector(`.pkg-flatfee[data-tier="${tier}"]`).value || null,
    services: collectServicesFromEditor(`pkgServices_${tier}`),
  };
}

function renderAgentStatsPanel(stats) {
  if (!stats) return '';
  const winRatePct = stats.winRate !== null ? Math.round(stats.winRate * 100) : null;
  const respLabel = formatResponseHours(stats.avgResponseHours);
  return `
    <div class="mini-block"><span class="label">Proposals</span>${stats.totalBids} submitted, ${stats.acceptedBids} accepted${winRatePct !== null ? ` (${winRatePct}% win rate)` : ''}</div>
    <div class="mini-block"><span class="label">Avg response time</span>${respLabel || 'Not enough data yet'}${stats.topRated ? ' · <span class="badge badge-gold">🏆 Top Rated</span>' : ''}</div>
  `;
}

// Reuses the same account-wide referral code every user gets (see account-security.html) but points it at the
// homeowner signup flow specifically, since an agent sharing this is pitching their own clients, not a generic
// friend invite. Counts toward the same referredCount either way — there's only one referral program.
async function loadAgentReferral() {
  try {
    const { referralCode, referredCount } = await apiGet('/api/referrals');
    document.getElementById('agentReferralLink').value = `${window.location.origin}/signup?as=homeowner&ref=${referralCode}`;
    document.getElementById('agentReferralCount').textContent = `${referredCount} client${referredCount === 1 ? '' : 's'} signed up through your link so far.`;
  } catch { /* non-critical */ }
}

// An agent belongs to at most one team at a time — this panel covers all four states: no team, a still-pending
// invite waiting on this agent's answer, an active member, or the owner (who also gets the invite-search box
// and can remove anyone else).
function renderTeamPanel({ team, myStatus, myRole }, myUserId) {
  if (!team) {
    return `
      <div class="form-row two-col">
        <input type="text" id="newTeamName" maxlength="80" placeholder="Team name, e.g. The Flores Team">
        <button type="button" class="btn btn-ghost btn-sm" data-action="create-team">Create Team</button>
      </div>`;
  }
  if (myStatus === 'invited') {
    return `
      <div class="card">
        <p>You've been invited to join <strong>${escapeHtml(team.name)}</strong>.</p>
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="respond-team-invite" data-decision="accept">Accept</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="respond-team-invite" data-decision="decline">Decline</button>
        </div>
      </div>`;
  }
  const isOwner = myRole === 'owner';
  const winRatePct = team.teamStats.winRate !== null ? Math.round(team.teamStats.winRate * 100) : null;
  const memberRows = team.members.map(m => `
    <div class="mini-block">
      ${escapeHtml(m.name)}${m.userId === myUserId ? ' (you)' : ''} — ${m.role}${m.status === 'invited' ? ', invited' : ''}
      ${m.stats ? ` · ${m.stats.totalBids} proposal${m.stats.totalBids === 1 ? '' : 's'}` : ''}
      ${isOwner && m.userId !== myUserId ? `<button type="button" class="link-btn" data-action="remove-team-member" data-user-id="${m.userId}">Remove</button>` : ''}
    </div>`).join('');
  return `
    <div class="card">
      <h4>${escapeHtml(team.name)}</h4>
      <p class="tiny">Team proposals: ${team.teamStats.totalBids} submitted, ${team.teamStats.acceptedBids} accepted${winRatePct !== null ? ` (${winRatePct}% win rate)` : ''}</p>
      ${memberRows}
      ${isOwner ? `
        <div class="form-row two-col">
          <input type="text" id="teamInviteSearch" placeholder="Search agent name or brokerage…">
          <button type="button" class="btn btn-ghost btn-sm" data-action="search-team-invite-agents">Search</button>
        </div>
        <div id="teamInviteResults"></div>
      ` : ''}
      <div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="leave-team">Leave Team</button></div>
    </div>`;
}

async function loadMyTeam() {
  const el = document.getElementById('myTeamPanel');
  if (!el) return;
  try {
    const data = await apiGet('/api/agent-teams/me');
    el.innerHTML = renderTeamPanel(data, currentUser ? currentUser.id : null);
    attentionState.teamInvite = data.myStatus === 'invited';
    renderAttentionStrip();
  } catch { /* non-critical */ }
}

async function searchTeamInviteAgents() {
  const resultsEl = document.getElementById('teamInviteResults');
  const q = document.getElementById('teamInviteSearch').value.trim();
  if (!q) { resultsEl.innerHTML = ''; return; }
  try {
    const { agents } = await apiGet(`/api/agents/directory?q=${encodeURIComponent(q)}`);
    resultsEl.innerHTML = agents.length ? agents.map(a => `
      <div class="side">
        <strong>${escapeHtml(a.displayName)}</strong>
        <span class="tiny">${escapeHtml(a.brokerageName || '')}${a.teamName ? ` · already on a team` : ''}</span>
        <button class="link-btn" data-action="invite-to-team" data-agent-id="${a.userId}">Invite</button>
      </div>
    `).join('') : '<span class="tiny">No agents found.</span>';
  } catch (e) { resultsEl.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

/* ---- Ballpark cost estimator ---- */
let costEstimatorData = null;
async function loadCostEstimator() {
  const container = document.getElementById('costEstimatorServices');
  try {
    const { estimates } = await apiGet('/api/agents/service-estimates');
    costEstimatorData = estimates;
    container.innerHTML = SERVICE_TYPES.filter(t => t !== 'other').map(type => {
      const e = estimates[type];
      return `
        <label class="checkbox-row">
          <input type="checkbox" class="cost-est-check" data-type="${type}" ${e ? '' : 'disabled'}>
          <span>${SERVICE_TYPE_LABELS[type]}${e ? ` — ${money(e.min)}–${money(e.max)} (avg ${money(e.avg)}, ${e.sampleSize} agent${e.sampleSize === 1 ? '' : 's'})` : ' — no data yet'}</span>
        </label>`;
    }).join('');
    container.querySelectorAll('.cost-est-check').forEach(cb => cb.addEventListener('change', updateCostEstimatorTotal));
    updateCostEstimatorTotal();
  } catch (e) { container.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

function updateCostEstimatorTotal() {
  const totalEl = document.getElementById('costEstimatorTotal');
  const checked = [...document.querySelectorAll('.cost-est-check:checked')];
  if (checked.length === 0) {
    totalEl.innerHTML = '<span class="label">Estimated total</span>Check a service above to see a range.';
    return;
  }
  let lo = 0, hi = 0;
  checked.forEach(cb => {
    const e = costEstimatorData[cb.dataset.type];
    if (e) { lo += e.min; hi += e.max; }
  });
  totalEl.innerHTML = `<span class="label">Estimated total</span>${money(lo)}–${money(hi)} for ${checked.length} service${checked.length === 1 ? '' : 's'}`;
}

/* ---- Agent directory / favorites ---- */
let agentDirectoryServicesFilled = false;
function fillDirectoryFilterOptionsOnce() {
  if (agentDirectoryServicesFilled) return;
  document.getElementById('agentDirService').insertAdjacentHTML('beforeend', SERVICE_TYPES.map(t => `<option value="${t}">${SERVICE_TYPE_LABELS[t]}</option>`).join(''));
  document.getElementById('agentDirSpecialty').insertAdjacentHTML('beforeend', SPECIALTY_TAGS.map(t => `<option value="${t}">${SPECIALTY_TAG_LABELS[t]}</option>`).join(''));
  document.getElementById('agentDirLanguage').insertAdjacentHTML('beforeend', LANGUAGES.map(l => `<option value="${l}">${l}</option>`).join(''));
  document.getElementById('agentDirOpenHouseDay').insertAdjacentHTML('beforeend', OPEN_HOUSE_DAYS.map(d => `<option value="${d}">${OPEN_HOUSE_DAY_LABELS[d]}</option>`).join(''));
  agentDirectoryServicesFilled = true;
}

function collectDirectoryFilters() {
  return {
    q: document.getElementById('agentDirectorySearch').value.trim(),
    priceMin: document.getElementById('agentDirPriceMin').value,
    priceMax: document.getElementById('agentDirPriceMax').value,
    service: document.getElementById('agentDirService').value,
    minRating: document.getElementById('agentDirMinRating').value,
    zip: document.getElementById('agentDirZip').value.trim(),
    topRatedOnly: document.getElementById('agentDirTopRated').checked,
    licenseVerifiedOnly: document.getElementById('agentDirLicenseVerified').checked,
    hasVideoOnly: document.getElementById('agentDirHasVideo').checked,
    specialtyTag: document.getElementById('agentDirSpecialty').value,
    language: document.getElementById('agentDirLanguage').value,
    soloAgentOnly: document.getElementById('agentDirSoloAgent').checked,
    minYearsExperience: document.getElementById('agentDirMinYears').value,
    maxAvgDaysOnMarket: document.getElementById('agentDirMaxDom').value,
    minHomesSoldLastYear: document.getElementById('agentDirMinHomesSold').value,
    minSaleToListRatio: document.getElementById('agentDirMinSaleToList').value,
    maxCommissionPct: document.getElementById('agentDirMaxCommission').value,
    maxTurnaroundDays: document.getElementById('agentDirMaxTurnaround').value,
    minReviewCount: document.getElementById('agentDirMinReviews').value,
    openHouseDay: document.getElementById('agentDirOpenHouseDay').value,
    localSpecialistOnly: document.getElementById('agentDirLocalSpecialist').checked,
    hasCaseStudiesOnly: document.getElementById('agentDirHasCaseStudies').checked,
    acceptingClientsOnly: document.getElementById('agentDirAcceptingClients').checked,
    eoInsuranceOnly: document.getElementById('agentDirEoInsurance').checked,
  };
}

function directoryFiltersToParams(f) {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.priceMin) params.set('priceMin', f.priceMin);
  if (f.priceMax) params.set('priceMax', f.priceMax);
  if (f.service) params.set('service', f.service);
  if (f.minRating) params.set('minRating', f.minRating);
  if (f.zip) params.set('zip', f.zip);
  if (f.topRatedOnly) params.set('topRatedOnly', '1');
  if (f.licenseVerifiedOnly) params.set('licenseVerifiedOnly', '1');
  if (f.hasVideoOnly) params.set('hasVideoOnly', '1');
  if (f.specialtyTag) params.set('specialtyTag', f.specialtyTag);
  if (f.language) params.set('language', f.language);
  if (f.soloAgentOnly) params.set('soloAgentOnly', '1');
  if (f.minYearsExperience) params.set('minYearsExperience', f.minYearsExperience);
  if (f.maxAvgDaysOnMarket) params.set('maxAvgDaysOnMarket', f.maxAvgDaysOnMarket);
  if (f.minHomesSoldLastYear) params.set('minHomesSoldLastYear', f.minHomesSoldLastYear);
  if (f.minSaleToListRatio) params.set('minSaleToListRatio', f.minSaleToListRatio);
  if (f.maxCommissionPct) params.set('maxCommissionPct', f.maxCommissionPct);
  if (f.maxTurnaroundDays) params.set('maxTurnaroundDays', f.maxTurnaroundDays);
  if (f.minReviewCount) params.set('minReviewCount', f.minReviewCount);
  if (f.openHouseDay) params.set('openHouseDay', f.openHouseDay);
  if (f.localSpecialistOnly) params.set('localSpecialistOnly', '1');
  if (f.hasCaseStudiesOnly) params.set('hasCaseStudiesOnly', '1');
  if (f.acceptingClientsOnly) params.set('acceptingClientsOnly', '1');
  if (f.eoInsuranceOnly) params.set('eoInsuranceOnly', '1');
  return params;
}

async function loadAgentDirectory() {
  const el = document.getElementById('agentDirectoryList');
  fillDirectoryFilterOptionsOnce();
  const params = directoryFiltersToParams(collectDirectoryFilters());

  try {
    const { agents } = await apiGet(`/api/agents/directory?${params.toString()}`);
    el.innerHTML = agents.length ? agents.map(a => directoryAgentCardHtml(a, { favorite: true, message: true })).join('') : '<div class="empty-state">No agents match these filters.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadAgentAlerts() {
  const el = document.getElementById('agentAlertsList');
  try {
    const { alerts } = await apiGet('/api/agent-search-alerts');
    el.innerHTML = alerts.length ? alerts.map(a => `
      <div class="side">
        <strong>${escapeHtml(a.label)}</strong>
        <button class="link-btn" data-action="delete-agent-alert" data-id="${a.id}">Delete</button>
      </div>
    `).join('') : '<span class="tiny">No saved searches yet — set your filters above and click "Save as Alert".</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

async function loadFavoriteAgents() {
  const el = document.getElementById('favoriteAgentsList');
  try {
    const { agents } = await apiGet('/api/agents/favorites');
    el.innerHTML = agents.length ? agents.map(a => `
      <div class="side">
        ${avatarHtml(a.displayName, { seed: a.agentUserId, size: 'sm' })}
        <strong><a class="profile-link" href="/profile/${a.agentUserId}">${escapeHtml(a.displayName)}</a></strong>
        <span class="tiny">${escapeHtml(a.brokerageName || '')}${a.rating ? ` · ⭐ ${a.rating} (${a.reviewCount})` : ''}</span>
        <button class="link-btn" data-action="message-user" data-id="${a.agentUserId}" data-name="${escapeHtml(a.displayName)}">Message</button>
        <button class="link-btn" data-action="toggle-favorite-agent" data-agent-id="${a.agentUserId}">Remove</button>
      </div>
    `).join('') : '<span class="tiny">No favorite agents yet — favorite one from a proposal or the directory above.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

async function toggleFavoriteAgent(agentUserId) {
  try {
    const { favorited } = await apiPost(`/api/agents/${agentUserId}/favorite`, {});
    toast(favorited ? 'Added to favorites!' : 'Removed from favorites.');
    loadFavoriteAgents();
    if (!document.getElementById('agentDirectoryWrap').classList.contains('hidden')) loadAgentDirectory();
  } catch (err) { toast(err.message); }
}

/* ---- Disputes ---- */
const DISPUTE_REASON_LABELS = { work_not_done: 'Work not done', quality_issue: 'Quality issue', communication: 'Communication problem', payment_dispute: 'Payment dispute', other: 'Other' };

async function loadMyDisputes() {
  const el = document.getElementById('myDisputesList');
  try {
    const { disputes } = await apiGet('/api/disputes');
    el.innerHTML = disputes.length ? disputes.map(d => `
      <div class="side">
        <strong>${escapeHtml(DISPUTE_REASON_LABELS[d.reason] || d.reason)}</strong>
        <span class="tiny">${escapeHtml(d.raisedByName)} vs. ${escapeHtml(d.againstName)} · <span class="badge ${d.status === 'open' ? 'badge-gold' : d.status === 'resolved' ? 'badge-active' : 'badge-paused'}">${d.status}</span></span>
        <span class="tiny">${escapeHtml(d.description)}</span>
        ${d.adminNotes ? `<span class="tiny"><span class="label">Admin notes</span> ${escapeHtml(d.adminNotes)}</span>` : ''}
      </div>
    `).join('') : '<span class="tiny">No disputes raised.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

/* ---- Agent invitations ---- */
async function loadMyInvites() {
  const el = document.getElementById('myInvitesList');
  try {
    const { invites } = await apiGet('/api/agents/my-invites');
    el.innerHTML = invites.length ? invites.map(i => {
      const target = i.requestType === 'pre_listing' ? i.preListing : i.transaction;
      const label = i.requestType === 'pre_listing'
        ? (target ? `${escapeHtml(target.title || 'Pre-listing')} — ${escapeHtml(target.city)}, ${escapeHtml(target.state)} (${money(target.askingPrice)})` : 'Pre-listing removed')
        : (target ? `Transaction #${target.id}` : 'Transaction removed');
      return `
        <div class="side">
          <strong>${label}</strong>
          ${i.message ? `<span class="tiny">"${escapeHtml(i.message)}"</span>` : ''}
          <div class="card-actions">
            <button class="link-btn" data-action="open-${i.requestType === 'pre_listing' ? 'pre-listing' : 'transaction'}" data-id="${i.requestId}">View &amp; Propose</button>
            <button class="link-btn" data-action="decline-invite" data-invite-id="${i.id}">Decline</button>
          </div>
        </div>
      `;
    }).join('') : '<span class="tiny">No invitations right now.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

/* ---- Milestones, disputes, homeowner reviews, and direct invites within a request's detail view ---- */
// A starting point, not a required sequence — every deal is different, and these are just common enough to be
// worth one click instead of typing them out. Only suggested for ones not already on the checklist.
const SUGGESTED_MILESTONES = ['Inspection', 'Appraisal', 'Loan contingency cleared', 'Disclosures signed', 'Final walkthrough', 'Closing'];

function renderMilestonesHtml(milestones) {
  const existingLabels = new Set(milestones.map(m => m.label));
  const suggestions = SUGGESTED_MILESTONES.filter(s => !existingLabels.has(s));
  return `
    <div class="panel">
      <h3>Progress Checklist</h3>
      <p class="tiny">Tracked on Amico Haus for visibility only — no payment moves through this; handle actual payment off-platform as you normally would.</p>
      ${milestones.map(m => `
        <label class="checkbox-row">
          <input type="checkbox" class="milestone-check" data-milestone-id="${m.id}" ${m.isDone ? 'checked' : ''}>
          <span>${escapeHtml(m.label)}${m.isDone && m.doneByName ? ` <span class="tiny">— done by ${escapeHtml(m.doneByName)}</span>` : ''}</span>
          <button type="button" class="link-btn" data-action="delete-milestone" data-milestone-id="${m.id}">✕</button>
        </label>
      `).join('')}
      ${suggestions.length ? `<p class="tiny">Common steps: ${suggestions.map(s => `<button type="button" class="link-btn" data-action="add-suggested-milestone" data-label="${escapeHtml(s)}">+ ${escapeHtml(s)}</button>`).join(' ')}</p>` : ''}
      <div class="form-row two-col">
        <input type="text" id="newMilestoneLabel" maxlength="200" placeholder="Add a checklist item…">
        <button type="button" class="btn btn-ghost btn-sm" data-action="add-milestone">Add</button>
      </div>
    </div>
  `;
}

async function loadMilestonesInto(kind, id) {
  const panel = document.getElementById('milestonesPanel');
  if (!panel) return;
  try {
    const basePath = kind === 'pre_listing' ? `/api/pre-listings/${id}` : `/api/transactions/${id}`;
    const { milestones } = await apiGet(`${basePath}/milestones`);
    panel.innerHTML = renderMilestonesHtml(milestones);
  } catch { panel.innerHTML = ''; }
}

function renderHomeownerReviewForm() {
  return `
    <div class="panel">
      <h3>Rate the Homeowner</h3>
      <p class="tiny">Helps other agents decide whether to bid — visible on their public track record.</p>
      <div class="field"><label>Rating</label><select id="homeownerReviewRating"><option value="5">⭐⭐⭐⭐⭐ Excellent</option><option value="4">⭐⭐⭐⭐ Good</option><option value="3">⭐⭐⭐ Okay</option><option value="2">⭐⭐ Poor</option><option value="1">⭐ Terrible</option></select></div>
      <div class="field"><label>Comment</label><textarea id="homeownerReviewComment" maxlength="1000"></textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="submit-homeowner-review">Submit Review</button></div>
    </div>
  `;
}

function renderDisputePanel() {
  return `
    <div class="panel">
      <h3>Report an Issue</h3>
      <p class="tiny">Raises this to an Amico Haus admin to look into — not a refund or payment mechanism.</p>
      <div class="field"><label>Reason</label>
        <select id="disputeReason">
          <option value="work_not_done">Work not done</option>
          <option value="quality_issue">Quality issue</option>
          <option value="communication">Communication problem</option>
          <option value="payment_dispute">Payment dispute</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field"><label>What happened?</label><textarea id="disputeDescription" maxlength="2000"></textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-danger btn-sm" data-action="raise-dispute">Report Issue</button></div>
    </div>
  `;
}

// "Agent votes: 1 too high · 0 too low · 5 just right — 4 of 6 from agents within 20 miles of this home".
// The server counts votes from agents whose service area covers the home (`nearby`); it is null when the
// home's zip is unknown, and then we simply don't claim anything about distance.
function voteSummary(v, label) {
  if (!v.total) return `${label}: none yet`;
  const base = `${label}: ${v.too_high} too high · ${v.too_low} too low · ${v.just_right} just right`;
  if (v.nearby === null || v.nearby === undefined) return base;
  return `${base} — ${v.nearby} of ${v.total} from agents within 20 miles of this home`;
}

function renderPriceHistory(history) {
  if (!history || !history.length) return '';
  const changes = history.map(h => `${money(h.oldPrice)} → ${money(h.newPrice)} on ${new Date(h.changedAt + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  return `<p class="tiny"><span class="label">Price history</span> ${changes.join(' · ')}</p>`;
}

function renderHomeownerRatingBadge(rating, label) {
  if (!rating || !rating.reviewCount) return '';
  return `<p class="tiny"><span class="label">${label}</span> ⭐ ${rating.avgRating} (${rating.reviewCount} review${rating.reviewCount === 1 ? '' : 's'} from past agents)</p>`;
}

// Informational preferences only — never a hard filter or contract term, so
// this is just a plain-language summary for an agent deciding whether to bid.
function renderStipulations(p) {
  const parts = [];
  if (p.minYearsExperience) parts.push(`${p.minYearsExperience}+ years of experience preferred`);
  if (p.preferredLanguage) parts.push(`prefers an agent who speaks ${escapeHtml(p.preferredLanguage)}`);
  if (p.requireDedicatedContact) parts.push('wants a single dedicated point of contact, no team hand-offs');
  if (p.prefersExclusive) parts.push('prefers an exclusive listing agreement');
  if (p.preferredAgreementMonths) parts.push(`preferred agreement length: ${p.preferredAgreementMonths} months`);
  if (p.prefersLocalSpecialist) parts.push('prefers an agent who specializes in this area, not one covering a huge territory');
  if (parts.length === 0) return '';
  return `<p class="tiny"><span class="label">Seller preferences</span> ${parts.join(' · ')}</p>`;
}

// The agent-facing half: a small form to propose a time, plus their own past requests (never a competitor's —
// the API itself only ever returns the caller's own rows here, same privacy model as proposals).
function renderRequestShowingForm() {
  return `
    <div class="panel">
      <h3>Request a Showing</h3>
      <div class="form-row two-col">
        <div class="field"><label for="showingProposedAt">Proposed time</label><input type="datetime-local" id="showingProposedAt"></div>
        <div class="field"><label for="showingNote">Note (optional)</label><input type="text" id="showingNote" maxlength="300"></div>
      </div>
      <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="request-showing">Request Showing</button></div>
      <div id="showingsPanel"></div>
    </div>
  `;
}

function renderShowingRow(s, isOwner) {
  const when = new Date(s.proposedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const statusBadge = `<span class="badge ${s.status === 'accepted' ? 'badge-active' : s.status === 'pending' ? 'badge-gold' : 'badge-paused'}">${s.status}</span>`;
  return `
    <div class="mini-block">
      <span class="label">${isOwner ? escapeHtml(s.agentName) : when}</span>
      ${isOwner ? when : ''}${s.note ? ` — ${escapeHtml(s.note)}` : ''} ${statusBadge}
      ${isOwner && s.status === 'pending' ? `
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="decide-showing" data-showing-id="${s.id}" data-decision="accept">Accept</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="decide-showing" data-showing-id="${s.id}" data-decision="decline">Decline</button>
        </div>` : ''}
      ${!isOwner && s.status === 'pending' ? `<div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="cancel-showing" data-showing-id="${s.id}">Cancel</button></div>` : ''}
    </div>
  `;
}

async function loadShowingsInto(preListingId, isOwner) {
  const el = document.getElementById('showingsPanel');
  if (!el) return;
  try {
    const { showings } = await apiGet(`/api/pre-listings/${preListingId}/showings`);
    el.innerHTML = showings.length
      ? (isOwner ? '<h3>Showing Requests</h3>' : '<p class="tiny">Your requests</p>') + showings.map(s => renderShowingRow(s, isOwner)).join('')
      : (isOwner ? '' : '<p class="tiny">No requests yet.</p>');
  } catch { /* non-critical */ }
}

function renderInviteAgentPanel() {
  return `
    <div class="panel">
      <h3>Invite a Specific Agent</h3>
      <p class="tiny">Already have someone in mind? Invite them directly — they can still submit a normal proposal, and you don't have to advertise this to every agent on the platform.</p>
      <div class="form-row two-col">
        <input type="text" id="inviteAgentSearch" placeholder="Search agent name or brokerage…">
        <button type="button" class="btn btn-ghost btn-sm" data-action="search-invite-agents">Search</button>
      </div>
      <div id="inviteAgentResults"></div>
      <div id="invitedAgentsList"></div>
    </div>
  `;
}

async function loadInvitedAgentsInto(kind, id) {
  const el = document.getElementById('invitedAgentsList');
  if (!el) return;
  try {
    const basePath = kind === 'pre_listing' ? `/api/pre-listings/${id}` : `/api/transactions/${id}`;
    const { invites } = await apiGet(`${basePath}/invites`);
    el.innerHTML = invites.length ? `<p class="tiny"><span class="label">Invited</span> ${invites.map(i => `${escapeHtml(i.agentName)} (${i.status})`).join(', ')}</p>` : '';
  } catch { /* non-critical */ }
}

async function searchInviteAgents() {
  const resultsEl = document.getElementById('inviteAgentResults');
  const q = document.getElementById('inviteAgentSearch').value.trim();
  if (!q) { resultsEl.innerHTML = ''; return; }
  try {
    const { agents } = await apiGet(`/api/agents/directory?q=${encodeURIComponent(q)}`);
    resultsEl.innerHTML = agents.length ? agents.map(a => `
      <div class="side">
        <strong>${escapeHtml(a.displayName)}</strong>
        <span class="tiny">${escapeHtml(a.brokerageName || '')}${a.rating ? ` · ⭐ ${a.rating}` : ''}</span>
        <button class="link-btn" data-action="send-invite" data-agent-id="${a.userId}">Invite</button>
      </div>
    `).join('') : '<span class="tiny">No agents found.</span>';
  } catch (e) { resultsEl.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

/* ---------------- Wiring ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuthOrRedirect();
  if (!user) return;
  document.getElementById('whoami').textContent = user.displayName;

  fillTypeSelect(document.getElementById('propertyType'), false);
  fillTypeSelect(document.getElementById('desiredType'), true);
  fillTypeSelect(document.getElementById('savedType'), true);
  fillTypeSelect(document.getElementById('portfolioDesiredType'), true);
  document.getElementById('lifeEventTagsFields').innerHTML = Object.entries(LIFE_EVENT_LABELS).map(([key, label]) => `
    <label class="checkbox-row"><input type="checkbox" class="life-event-check" value="${key}"><span>${escapeHtml(label)}</span></label>
  `).join('');

  document.getElementById('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (btn) goToTab(btn.dataset.tab);
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiPost('/api/auth/logout');
    window.location.href = '/';
  });

  document.getElementById('cashMode').addEventListener('change', e => {
    document.getElementById('cashAmountField').style.display = e.target.value === 'none' ? 'none' : 'block';
  });

  document.getElementById('isBuyerOnly').addEventListener('change', e => {
    setBuyerOnlyFieldsetState(e.target.checked);
    if (e.target.checked) {
      document.getElementById('isRental').checked = false;
      setRentalFieldsetState(false);
    }
  });

  document.getElementById('isRental').addEventListener('change', e => {
    setRentalFieldsetState(e.target.checked);
    if (e.target.checked) {
      document.getElementById('isBuyerOnly').checked = false;
      setBuyerOnlyFieldsetState(false);
    }
  });

  document.getElementById('portfolioCashMode').addEventListener('change', e => {
    document.getElementById('portfolioCashAmountField').style.display = e.target.value === 'none' ? 'none' : 'block';
  });

  // Collapsing the panel (whether mid-edit or right after a successful save,
  // which already closes it itself) always means "done" — reset to create
  // mode so re-opening it later doesn't silently still be editing someone
  // else's portfolio.
  document.getElementById('portfolioWrap').addEventListener('toggle', (e) => {
    if (!e.target.open) resetPortfolioFormToCreateMode();
  });

  document.getElementById('createPortfolioBtn').addEventListener('click', async () => {
    const btn = document.getElementById('createPortfolioBtn');
    const memberListingIds = [...document.getElementById('portfolioMembers').selectedOptions].map(o => Number(o.value));
    const payload = {
      title: document.getElementById('portfolioTitle').value.trim(),
      locations: document.getElementById('portfolioLocations').value.trim(),
      desiredType: document.getElementById('portfolioDesiredType').value,
      priceMin: document.getElementById('portfolioPriceMin').value,
      priceMax: document.getElementById('portfolioPriceMax').value,
      minBeds: document.getElementById('portfolioMinBeds').value,
      minBaths: document.getElementById('portfolioMinBaths').value,
      mustHaves: document.getElementById('portfolioMustHaves').value.trim(),
      cashMode: document.getElementById('portfolioCashMode').value,
      cashAmount: document.getElementById('portfolioCashAmount').value || 0,
    };
    btn.disabled = true;
    try {
      if (editingPortfolioId) {
        await apiPut(`/api/listings/${editingPortfolioId}`, { ...payload, action: 'edit' });
      } else {
        await apiPost('/api/portfolios', { ...payload, memberListingIds });
      }
      toast(editingPortfolioId ? 'Portfolio updated!' : 'Portfolio created!');
      document.getElementById('portfolioWrap').open = false;
      document.getElementById('portfolioTitle').value = '';
      document.getElementById('portfolioLocations').value = '';
      document.getElementById('portfolioPriceMin').value = '';
      document.getElementById('portfolioPriceMax').value = '';
      document.getElementById('portfolioMinBeds').value = '';
      document.getElementById('portfolioMinBaths').value = '';
      document.getElementById('portfolioMustHaves').value = '';
      document.getElementById('portfolioCashMode').value = 'none';
      document.getElementById('portfolioCashAmountField').style.display = 'none';
      resetPortfolioFormToCreateMode();
      loadMyListing();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('postForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = document.getElementById('postBody');
    try {
      await apiPost('/api/posts', { body: body.value.trim() });
      body.value = '';
      loadFeed();
    } catch (err) { toast(err.message); }
  });
  wireFeedEvents(document.getElementById('feedList'));

  document.getElementById('listingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('listingSubmitBtn');
    btn.disabled = true;
    const virtualTourUrl = document.getElementById('virtualTourUrl').value.trim();
    const links = [
      ...(virtualTourUrl ? [{ label: 'Virtual Tour', url: virtualTourUrl }] : []),
      ...document.getElementById('externalLinks').value.split('\n').map(s => s.trim()).filter(Boolean).map(url => ({ label: 'Link', url })),
    ];
    const payload = {
      isBuyerOnly: document.getElementById('isBuyerOnly').checked,
      isRental: document.getElementById('isRental').checked,
      rentAmount: document.getElementById('rentAmount').value || 0,
      minLeaseMonths: document.getElementById('minLeaseMonths').value || 12,
      title: document.getElementById('title').value.trim(),
      clientName: document.getElementById('clientName').value.trim(),
      city: document.getElementById('city').value.trim(),
      state: document.getElementById('state').value.trim(),
      neighborhood: document.getElementById('neighborhood').value.trim(),
      address: document.getElementById('address').value.trim(),
      propertyType: document.getElementById('propertyType').value,
      estimatedValue: document.getElementById('estimatedValue').value,
      beds: document.getElementById('beds').value,
      baths: document.getElementById('baths').value,
      sqft: document.getElementById('sqft').value || null,
      showExactAddress: document.getElementById('showExactAddress').checked,
      externalLinks: links,
      lifeEventTags: [...document.querySelectorAll('.life-event-check:checked')].map(c => c.value),
      locations: document.getElementById('locations').value.trim(),
      desiredType: document.getElementById('desiredType').value,
      priceMin: document.getElementById('priceMin').value,
      priceMax: document.getElementById('priceMax').value,
      minBeds: document.getElementById('minBeds').value,
      minBaths: document.getElementById('minBaths').value,
      mustHaves: document.getElementById('mustHaves').value.trim(),
      cashMode: document.getElementById('cashMode').value,
      cashAmount: document.getElementById('cashAmount').value || 0,
    };
    const wasEditing = !!editingListingId;
    try {
      let listingId = editingListingId;
      if (editingListingId) {
        await apiPut(`/api/listings/${editingListingId}`, { ...payload, action: 'edit' });
      } else {
        ({ id: listingId } = await apiPost('/api/listings', payload));
      }

      const files = [...document.getElementById('listingPhotos').files];
      for (const file of files) {
        const formData = new FormData();
        formData.append('photo', file);
        try { await apiUpload(`/api/listings/${listingId}/photos`, formData); }
        catch (err) { toast(`Photo upload failed: ${err.message}`); }
      }

      toast(wasEditing ? 'Listing updated!' : 'Listing created!');
      document.getElementById('listingForm').reset();
      setBuyerOnlyFieldsetState(false);
      setRentalFieldsetState(false);
      resetListingFormToCreateMode();
      if (!wasEditing) clearListingDraft();
      document.getElementById('listingDraftBanner').classList.add('hidden');
      loadMyListing();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('listingForm').addEventListener('input', scheduleListingDraftSave);
  document.getElementById('listingDraftBanner').addEventListener('click', e => {
    const restoreBtn = e.target.closest('[data-action="restore-draft"]');
    const discardBtn = e.target.closest('[data-action="discard-draft"]');
    if (restoreBtn) {
      try {
        const raw = localStorage.getItem(LISTING_DRAFT_KEY);
        if (raw) {
          document.getElementById('listingFormWrap').style.display = 'block';
          applyListingDraft(JSON.parse(raw));
          document.getElementById('listingFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch { /* ignore */ }
      document.getElementById('listingDraftBanner').classList.add('hidden');
    } else if (discardBtn) {
      clearListingDraft();
      document.getElementById('listingDraftBanner').classList.add('hidden');
    }
  });

  document.getElementById('addAnotherBtn').addEventListener('click', () => {
    resetListingFormToCreateMode();
    document.getElementById('listingForm').reset();
    setBuyerOnlyFieldsetState(false);
    setRentalFieldsetState(false);
    document.getElementById('listingFormWrap').style.display = 'block';
    document.getElementById('addAnotherBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('cancelListingBtn').addEventListener('click', () => {
    document.getElementById('listingForm').reset();
    setBuyerOnlyFieldsetState(false);
    setRentalFieldsetState(false);
    clearListingDraft();
    document.getElementById('listingDraftBanner').classList.add('hidden');
    resetListingFormToCreateMode();
    document.getElementById('listingFormWrap').style.display = 'none';
  });

  document.getElementById('bulkUploadBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('bulkCsvInput');
    const resultsEl = document.getElementById('bulkUploadResults');
    const file = fileInput.files[0];
    if (!file) { toast('Choose a CSV file first.'); return; }

    const listings = csvToListings(await file.text());
    if (listings.length === 0) { toast('No valid rows found in that CSV.'); return; }

    resultsEl.innerHTML = '<p class="tiny">Uploading…</p>';
    try {
      const { created, total, results } = await apiPost('/api/listings/bulk', { listings });
      resultsEl.innerHTML = `
        <p class="tiny">${created} of ${total} listings created.</p>
        ${results.filter(r => !r.ok).map(r => `<p class="tiny bulk-error">Row ${r.row}: ${escapeHtml(r.error)}</p>`).join('')}
      `;
      toast(`${created} of ${total} listings created.`);
      fileInput.value = '';
      loadMyListing();
    } catch (err) {
      resultsEl.innerHTML = '';
      toast(err.message);
    }
  });

  document.getElementById('myListingSummary').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle-status') {
      try {
        const next = btn.dataset.status === 'active' ? 'paused' : 'active';
        await apiPut(`/api/listings/${btn.dataset.id}`, { status: next });
        loadMyListing();
      } catch (err) { toast(err.message); }
    } else if (btn.dataset.action === 'delete-listing') {
      const isPortfolio = btn.textContent.trim() === 'Dissolve Portfolio';
      if (confirm(isPortfolio ? 'Dissolve this portfolio? Every bundled property goes back to being its own independent listing.' : "Delete this listing? You'll have 7 days to restore it from Saved → Recently Deleted.")) {
        try {
          await apiDelete(`/api/listings/${btn.dataset.id}`);
          toast(isPortfolio ? 'Portfolio dissolved.' : 'Deleted — restorable from Saved → Recently Deleted for 7 days.');
          loadMyListing();
        } catch (err) { toast(err.message); }
      }
    } else if (btn.dataset.action === 'delete-photo') {
      try {
        await apiDelete(`/api/listings/${btn.dataset.listingId}/photos/${btn.dataset.photoId}`);
        renderPhotoGallery(btn.dataset.listingId);
      } catch (err) { toast(err.message); }
    } else if (btn.dataset.action === 'add-open-house') {
      const listingId = btn.dataset.id;
      const start = document.getElementById(`ohStart-${listingId}`).value;
      const end = document.getElementById(`ohEnd-${listingId}`).value;
      if (!start || !end) { toast('Pick a start and end time.'); return; }
      try {
        await apiPost(`/api/listings/${listingId}/open-houses`, {
          startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
          note: document.getElementById(`ohNote-${listingId}`).value.trim(),
        });
        document.getElementById(`ohStart-${listingId}`).value = '';
        document.getElementById(`ohEnd-${listingId}`).value = '';
        document.getElementById(`ohNote-${listingId}`).value = '';
        toast('Open house scheduled.');
        loadOpenHousesInto(listingId);
      } catch (err) { toast(err.message); }
    } else if (btn.dataset.action === 'delete-open-house') {
      try {
        await apiDelete(`/api/listings/${btn.dataset.listingId}/open-houses/${btn.dataset.id}`);
        loadOpenHousesInto(btn.dataset.listingId);
      } catch (err) { toast(err.message); }
    } else if (btn.dataset.action === 'edit-listing') {
      const l = myListings.find(x => String(x.id) === btn.dataset.id);
      if (!l) return;
      if (l.is_portfolio) populatePortfolioFormForEdit(l);
      else populateListingFormForEdit(l);
    } else if (btn.dataset.action === 'clone-listing') {
      const l = myListings.find(x => String(x.id) === btn.dataset.id);
      if (l) populateListingFormForClone(l);
    } else if (btn.dataset.action === 'decide-offer') {
      try {
        await apiPut(`/api/listings/${btn.dataset.listingId}/offers/${btn.dataset.id}`, { action: btn.dataset.decision });
        toast(btn.dataset.decision === 'accept' ? 'Offer accepted.' : 'Offer declined.');
        loadListingOffersInto(btn.dataset.listingId);
      } catch (err) { toast(err.message); }
    } else if (btn.dataset.action === 'message-user') {
      try { await startConversationWith(btn.dataset.id, btn.dataset.name); } catch (err) { toast(err.message); }
    }
  });

  document.getElementById('groupsGrid').addEventListener('click', e => {
    const card = e.target.closest('[data-action="open-group"]');
    if (card) openGroup(card.dataset.id, card.dataset.label);
  });
  document.getElementById('backToGroups').addEventListener('click', loadGroups);
  document.getElementById('groupPostForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const groupId = document.getElementById('groupDetail').dataset.groupId;
    const body = document.getElementById('groupPostBody');
    try {
      await apiPost('/api/posts', { body: body.value.trim(), groupId });
      body.value = '';
      openGroup(groupId, document.getElementById('groupDetailTitle').textContent);
    } catch (err) { toast(err.message); }
  });
  wireFeedEvents(document.getElementById('groupPosts'));

  document.getElementById('matchesList').addEventListener('click', async e => {
    const msgBtn = e.target.closest('[data-action="message-user"]');
    if (msgBtn) { startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); return; }
    const upBtn = e.target.closest('[data-action="match-thumb-up"]');
    if (upBtn) { submitMatchFeedback(upBtn.dataset.a, upBtn.dataset.b, 'up'); return; }
    const downBtn = e.target.closest('[data-action="match-thumb-down"]');
    if (downBtn) { submitMatchFeedback(downBtn.dataset.a, downBtn.dataset.b, 'down'); return; }
    const bidsBtn = e.target.closest('[data-action="open-to-bids"]');
    if (bidsBtn) {
      if (!confirm("Open this trade to proposals from vetted agents? Either of you can accept one, or just keep using an agent you already know instead.")) return;
      try {
        const { id } = await apiPost('/api/transactions', { listingIdA: bidsBtn.dataset.a, listingIdB: bidsBtn.dataset.b });
        toast('Opened to agent bids!');
        goToTab('marketplace');
        openTransactionDetail(id);
      } catch (err) { toast(err.message); }
    }
  });
  document.getElementById('archivedMatchesList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="restore-match"]');
    if (!btn) return;
    try {
      await apiDelete(`/api/match-feedback/${btn.dataset.a}/${btn.dataset.b}`);
      loadMatches();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('favoritesList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="remove-favorite"]');
    if (!btn) return;
    try {
      await apiDelete(`/api/listings/${btn.dataset.id}/feedback`);
      loadFavorites();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('hiddenList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="unhide-listing"]');
    if (!btn) return;
    try {
      await apiDelete(`/api/listings/${btn.dataset.id}/feedback`);
      loadHidden();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('trashList').addEventListener('click', async e => {
    const restoreBtn = e.target.closest('[data-action="restore-trash"]');
    const purgeBtn = e.target.closest('[data-action="purge-trash"]');
    if (restoreBtn) {
      try {
        await apiPost(`/api/listings/trash/${restoreBtn.dataset.id}`, {});
        toast('Restored!');
        loadTrash();
      } catch (err) { toast(err.message); }
    } else if (purgeBtn) {
      if (confirm('Permanently delete this? It cannot be recovered after this.')) {
        try {
          await apiDelete(`/api/listings/trash/${purgeBtn.dataset.id}`);
          loadTrash();
        } catch (err) { toast(err.message); }
      }
    }
  });

  document.getElementById('addSavedSearchBtn').addEventListener('click', async () => {
    try {
      await apiPost('/api/saved-searches', {
        locations: document.getElementById('savedLocations').value.trim(),
        propertyType: document.getElementById('savedType').value,
        priceMax: document.getElementById('savedPriceMax').value || 0,
      });
      document.getElementById('savedLocations').value = '';
      document.getElementById('savedPriceMax').value = '';
      toast('Saved search added.');
      loadSavedSearches();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('savedSearchList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-saved-search"]');
    if (!btn) return;
    await apiDelete(`/api/saved-searches/${btn.dataset.id}`);
    loadSavedSearches();
  });

  document.getElementById('conversationList').addEventListener('click', e => {
    if (e.target.closest('.profile-link')) return;
    const card = e.target.closest('[data-action="open-conversation"]');
    if (card) openConversation(card.dataset.id, card.dataset.name, card.dataset.userId);
  });
  document.getElementById('backToConversations').addEventListener('click', loadConversations);
  document.getElementById('threadOpenToBidsBtn').addEventListener('click', async (e) => {
    const wrap = document.getElementById('threadOpenToBidsWrap');
    if (!confirm("Open this trade to proposals from vetted agents? Either of you can accept one, or just keep using an agent you already know instead.")) return;
    try {
      const { id } = await apiPost('/api/transactions', { listingIdA: wrap.dataset.listingA, listingIdB: wrap.dataset.listingB });
      toast('Opened to agent bids!');
      goToTab('marketplace');
      openTransactionDetail(id);
    } catch (err) { toast(err.message); }
  });
  document.getElementById('messageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const conversationId = document.getElementById('messageThread').dataset.conversationId;
    const input = document.getElementById('messageBody');
    try {
      await apiPost(`/api/conversations/${conversationId}/messages`, { body: input.value.trim() });
      input.value = '';
      await renderMessages(conversationId);
    } catch (err) { toast(err.message); }
  });

  const notifBtn = document.getElementById('notifBtn');
  const notifPanel = document.getElementById('notifPanel');
  notifBtn.addEventListener('click', () => {
    notifPanel.classList.toggle('hidden');
    if (!notifPanel.classList.contains('hidden')) loadNotifications();
  });
  document.addEventListener('click', e => {
    if (!notifPanel.contains(e.target) && e.target !== notifBtn && !notifBtn.contains(e.target)) {
      notifPanel.classList.add('hidden');
    }
  });
  document.getElementById('markAllReadBtn').addEventListener('click', async () => {
    await apiPost('/api/notifications/read-all');
    loadNotifications();
  });
  document.getElementById('tab-marketplace').addEventListener('click', e => {
    const btn = e.target.closest('[data-action^="goto-"]');
    if (!btn) return;
    if (AGENT_TAB_SECTIONS[btn.dataset.action]) openAgentTabSection(AGENT_TAB_SECTIONS[btn.dataset.action]);
    // The attention strip's own links — straight to an already-visible section, not a collapsible one, so just
    // scroll (preventDefault since these render as <a href="#">, which would otherwise jump to the page top).
    else if (btn.dataset.action === 'goto-my-pre-listings') { e.preventDefault(); document.getElementById('myPreListingsList').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (btn.dataset.action === 'goto-team-invite') { e.preventDefault(); openAgentTabSection('becomeAgentWrap'); requestAnimationFrame(() => document.getElementById('myTeamPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  });

  async function sendQuickReply(wrap) {
    const input = wrap.querySelector('.quick-reply-input');
    const text = input.value.trim();
    if (!text) return;
    try {
      await apiPost(`/api/conversations/${wrap.dataset.conversationId}/messages`, { body: text });
      input.value = '';
      toast('Reply sent.');
      loadNotifications();
    } catch (err) { toast(err.message); }
  }

  const notifList = document.getElementById('notifList');
  const activateNotification = e => {
    // Checked first, and returns either way: a click or Enter inside the reply box must never also fall through
    // to opening the notification (the whole item is itself a role="button" wrapper the reply box sits inside).
    const replyWrap = e.target.closest('.quick-reply');
    if (replyWrap) {
      if (e.type === 'click' && e.target.closest('[data-action="quick-reply-send"]')) sendQuickReply(replyWrap);
      else if (e.type === 'keydown' && e.key === 'Enter' && e.target.classList.contains('quick-reply-input')) sendQuickReply(replyWrap);
      return;
    }
    const item = e.target.closest('[data-action="open-notification"]');
    if (item) openNotification(item.dataset.type, item.dataset.link);
  };
  notifList.addEventListener('click', activateNotification);
  notifList.addEventListener('keydown', e => {
    if (e.target.closest('.quick-reply')) { activateNotification(e); return; } // let typing (incl. Space) through
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateNotification(e); }
  });
  loadNotifications();
  refreshMessagesTabBadge();

  document.getElementById('onboardingCreateBtn').addEventListener('click', () => goToTab('listing'));

  /* ---- Marketplace wiring ---- */
  document.getElementById('createPreListingBtn').addEventListener('click', async () => {
    const btn = document.getElementById('createPreListingBtn');
    btn.disabled = true;
    try {
      const { id } = await apiPost('/api/pre-listings', {
        title: document.getElementById('plTitle').value.trim(),
        askingPrice: document.getElementById('plAskingPrice').value,
        city: document.getElementById('plCity').value.trim(),
        state: document.getElementById('plState').value.trim(),
        zip: document.getElementById('plZip').value.trim(),
        neighborhood: document.getElementById('plNeighborhood').value.trim(),
        address: document.getElementById('plAddress').value.trim(),
        propertyType: document.getElementById('plPropertyType').value,
        beds: document.getElementById('plBeds').value,
        baths: document.getElementById('plBaths').value,
        sqft: document.getElementById('plSqft').value || null,
        description: document.getElementById('plDescription').value.trim(),
        occupancyStatus: document.getElementById('plOccupancyStatus').value,
        showingNoticeHours: document.getElementById('plShowingNoticeHours').value || 0,
        specialInstructions: document.getElementById('plSpecialInstructions').value.trim(),
        minYearsExperience: document.getElementById('plMinYearsExperience').value || null,
        preferredLanguage: document.getElementById('plPreferredLanguage').value.trim(),
        preferredAgreementMonths: document.getElementById('plPreferredAgreementMonths').value || null,
        requireDedicatedContact: document.getElementById('plRequireDedicatedContact').checked,
        prefersExclusive: document.getElementById('plPrefersExclusive').checked,
        prefersLocalSpecialist: document.getElementById('plPrefersLocalSpecialist').checked,
      });
      const files = [...document.getElementById('plPhotos').files];
      for (const file of files) {
        const formData = new FormData();
        formData.append('photo', file);
        try { await apiUpload(`/api/pre-listings/${id}/photos`, formData); }
        catch (err) { toast(`Photo upload failed: ${err.message}`); }
      }
      toast('Pre-listing posted — agents can now weigh in on your price.');
      document.getElementById('postHomeWrap').open = false;
      ['plTitle', 'plAskingPrice', 'plCity', 'plState', 'plZip', 'plNeighborhood', 'plAddress', 'plSqft', 'plDescription', 'plShowingNoticeHours', 'plSpecialInstructions', 'plMinYearsExperience', 'plPreferredLanguage', 'plPreferredAgreementMonths'].forEach(f => document.getElementById(f).value = '');
      document.getElementById('plBeds').value = '';
      document.getElementById('plBaths').value = '';
      document.getElementById('plPhotos').value = '';
      document.getElementById('plOccupancyStatus').value = 'occupied';
      document.getElementById('plRequireDedicatedContact').checked = false;
      document.getElementById('plPrefersExclusive').checked = false;
      document.getElementById('plPrefersLocalSpecialist').checked = false;
      loadMyPreListings();
      loadMarketplaceBrowse();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.getElementById('submitAgentApplicationBtn').addEventListener('click', async () => {
    const btn = document.getElementById('submitAgentApplicationBtn');
    btn.disabled = true;
    try {
      const serviceZips = ['agentZip1', 'agentZip2', 'agentZip3', 'agentZip4']
        .map(id => document.getElementById(id).value.trim()).filter(Boolean);
      await apiPost('/api/agents/apply', {
        brokerageName: document.getElementById('agentBrokerage').value.trim(),
        licenseNumber: document.getElementById('agentLicense').value.trim(),
        yearsExperience: document.getElementById('agentYears').value || 0,
        homesSoldLastYear: document.getElementById('agentHomesSold').value || null,
        avgDaysOnMarket: document.getElementById('agentAvgDom').value || null,
        saleToListRatio: document.getElementById('agentSaleToList').value || null,
        bio: document.getElementById('agentBio').value.trim(),
        certifications: document.getElementById('agentCertifications').value.trim(),
        defaultCommissionPct: document.getElementById('agentCommissionPct').value || null,
        defaultFlatFee: document.getElementById('agentFlatFee').value || null,
        services: collectServicesFromEditor('agentServicesEditor'),
        serviceZips,
        openHouseDays: collectOpenHouseDaysFromEditor('agentOpenHouseDays'),
        specialtyTags: collectTagCheckboxes('agentSpecialtyTags', 'specialty-check'),
        languages: collectTagCheckboxes('agentLanguages', 'language-check'),
        soloAgent: document.getElementById('agentSoloAgent').checked,
        acceptingClients: document.getElementById('agentAcceptingClients').checked,
        carriesEoInsurance: document.getElementById('agentEoInsurance').checked,
        notifyNewRequests: document.getElementById('agentNotifyNewRequests').checked,
      });
      toast('Application submitted!');
      loadAgentStatus();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.getElementById('agentPortfolioPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('photo', file);
    try {
      await apiUpload('/api/agents/portfolio-photos', formData);
      e.target.value = '';
      loadAgentStatus();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('agentPortfolioGallery').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-agent-photo"]');
    if (!btn) return;
    try {
      await apiDelete(`/api/agents/portfolio-photos/${btn.dataset.id}`);
      loadAgentStatus();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('addCaseStudyBtn').addEventListener('click', async () => {
    const btn = document.getElementById('addCaseStudyBtn');
    const beforeFile = document.getElementById('caseStudyBeforeInput').files[0];
    const afterFile = document.getElementById('caseStudyAfterInput').files[0];
    if (!beforeFile || !afterFile) { toast('Pick both a before and after photo.'); return; }
    btn.disabled = true;
    try {
      const formData = new FormData();
      formData.append('before', beforeFile);
      formData.append('after', afterFile);
      formData.append('title', document.getElementById('caseStudyTitle').value.trim());
      formData.append('resultNote', document.getElementById('caseStudyResultNote').value.trim());
      await apiUpload('/api/agents/case-studies', formData);
      toast('Case study added!');
      document.getElementById('caseStudyTitle').value = '';
      document.getElementById('caseStudyResultNote').value = '';
      document.getElementById('caseStudyBeforeInput').value = '';
      document.getElementById('caseStudyAfterInput').value = '';
      loadAgentStatus();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
  document.getElementById('agentCaseStudiesGallery').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-case-study"]');
    if (!btn) return;
    try {
      await apiDelete(`/api/agents/case-studies/${btn.dataset.id}`);
      loadAgentStatus();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('agentVideoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await checkVideoDuration(file, AGENT_VIDEO_MAX_SECONDS);
      document.getElementById('agentVideoStatus').textContent = 'Uploading…';
      const res = await fetch('/api/agents/video', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': file.type }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      toast('Intro video uploaded!');
      document.getElementById('agentVideoStatus').textContent = '';
      e.target.value = '';
      loadAgentStatus();
    } catch (err) {
      document.getElementById('agentVideoStatus').textContent = '';
      toast(err.message);
    }
  });
  document.getElementById('agentVideoPreviewWrap').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="remove-agent-video"]')) return;
    try {
      await apiDelete('/api/agents/video');
      loadAgentStatus();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('agentLicensePhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('photo', file);
    try {
      await apiUpload('/api/agents/license-photo', formData);
      e.target.value = '';
      toast('License photo uploaded — awaiting admin review.');
      loadAgentStatus();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('agentLicensePhotoWrap').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="remove-license-photo"]')) return;
    try {
      await apiDelete('/api/agents/license-photo');
      loadAgentStatus();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('agentPackagesEditor').addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-action="save-package"]');
    const deleteBtn = e.target.closest('[data-action="delete-package"]');
    try {
      if (saveBtn) {
        await apiPut(`/api/agents/packages/${saveBtn.dataset.tier}`, collectPackageInput(saveBtn.dataset.tier));
        toast(`${PACKAGE_TIER_LABELS[saveBtn.dataset.tier]} package saved!`);
        loadAgentStatus();
      } else if (deleteBtn) {
        await apiDelete(`/api/agents/packages/${deleteBtn.dataset.tier}`);
        toast(`${PACKAGE_TIER_LABELS[deleteBtn.dataset.tier]} package removed.`);
        loadAgentStatus();
      }
    } catch (err) { toast(err.message); }
  });

  const directoryFilterIds = [
    'agentDirPriceMin', 'agentDirPriceMax', 'agentDirService', 'agentDirMinRating', 'agentDirZip', 'agentDirTopRated',
    'agentDirLicenseVerified', 'agentDirHasVideo', 'agentDirSpecialty', 'agentDirLanguage', 'agentDirSoloAgent',
    'agentDirMinYears', 'agentDirMaxDom', 'agentDirMinHomesSold', 'agentDirMinSaleToList', 'agentDirMaxCommission',
    'agentDirMaxTurnaround', 'agentDirMinReviews', 'agentDirOpenHouseDay', 'agentDirLocalSpecialist',
    'agentDirHasCaseStudies', 'agentDirAcceptingClients', 'agentDirEoInsurance',
  ];
  directoryFilterIds.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'INPUT' && el.type !== 'checkbox' ? 'input' : 'change', () => loadAgentDirectory());
  });
  document.getElementById('agentDirectorySearch').addEventListener('input', () => loadAgentDirectory());

  document.getElementById('copyAgentReferralBtn').addEventListener('click', async () => {
    const input = document.getElementById('agentReferralLink');
    try { await navigator.clipboard.writeText(input.value); toast('Invite link copied.'); }
    catch { input.select(); toast('Select and copy the link above.'); }
  });

  // myTeamPanel's own contents get replaced wholesale on every loadMyTeam(), so this listens on the section
  // that wraps it (never itself replaced) rather than on the panel directly — same delegation pattern as
  // marketplaceDetailContent elsewhere in this file.
  document.getElementById('agentToolsSection').addEventListener('click', async (e) => {
    const createBtn = e.target.closest('[data-action="create-team"]');
    const respondBtn = e.target.closest('[data-action="respond-team-invite"]');
    const removeBtn = e.target.closest('[data-action="remove-team-member"]');
    const searchBtn = e.target.closest('[data-action="search-team-invite-agents"]');
    const inviteBtn = e.target.closest('[data-action="invite-to-team"]');
    const leaveBtn = e.target.closest('[data-action="leave-team"]');
    if (!createBtn && !respondBtn && !removeBtn && !searchBtn && !inviteBtn && !leaveBtn) return;

    try {
      if (createBtn) {
        const name = document.getElementById('newTeamName').value.trim();
        if (!name) { toast('Give your team a name.'); return; }
        await apiPost('/api/agent-teams', { name });
        toast('Team created!');
        loadMyTeam();
      } else if (respondBtn) {
        const data = await apiGet('/api/agent-teams/me');
        await apiPut(`/api/agent-teams/${data.team.id}/members/${currentUser.id}`, { action: respondBtn.dataset.decision });
        toast(respondBtn.dataset.decision === 'accept' ? "You're on the team!" : 'Invite declined.');
        loadMyTeam();
      } else if (removeBtn) {
        const data = await apiGet('/api/agent-teams/me');
        if (!confirm('Remove this person from the team?')) return;
        await apiPut(`/api/agent-teams/${data.team.id}/members/${removeBtn.dataset.userId}`, { action: 'remove' });
        loadMyTeam();
      } else if (searchBtn) {
        searchTeamInviteAgents();
      } else if (inviteBtn) {
        const data = await apiGet('/api/agent-teams/me');
        await apiPost(`/api/agent-teams/${data.team.id}/invite`, { agentUserId: Number(inviteBtn.dataset.agentId) });
        toast('Invitation sent!');
        loadMyTeam();
      } else if (leaveBtn) {
        if (!confirm('Leave this team?')) return;
        const data = await apiGet('/api/agent-teams/me');
        await apiPut(`/api/agent-teams/${data.team.id}/members/${currentUser.id}`, { action: 'leave' });
        loadMyTeam();
      }
    } catch (err) { toast(err.message); }
  });

  document.getElementById('saveAgentAlertBtn').addEventListener('click', async () => {
    try {
      const filters = collectDirectoryFilters();
      await apiPost('/api/agent-search-alerts', { label: document.getElementById('agentAlertLabel').value.trim(), filters });
      toast('Search saved — you\'ll be notified when a new agent matches.');
      document.getElementById('agentAlertLabel').value = '';
      loadAgentAlerts();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('agentAlertsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-agent-alert"]');
    if (!btn) return;
    try {
      await apiDelete(`/api/agent-search-alerts/${btn.dataset.id}`);
      loadAgentAlerts();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('marketplaceFilters').addEventListener('input', () => loadMarketplaceBrowse());
  document.getElementById('marketOnlyInArea').addEventListener('change', () => loadMarketplaceBrowse());

  function wireMarketplaceOpenButtons(containerId) {
    document.getElementById(containerId).addEventListener('click', async e => {
      const plBtn = e.target.closest('[data-action="open-pre-listing"]');
      const txBtn = e.target.closest('[data-action="open-transaction"]');
      const editPlBtn = e.target.closest('[data-action="edit-pre-listing-from-list"]');
      const closePlBtn = e.target.closest('[data-action="close-pre-listing-from-list"]');
      const deletePlBtn = e.target.closest('[data-action="delete-pre-listing-from-list"]');
      const checkInBtn = e.target.closest('[data-action="check-in-bid"]');
      if (plBtn) openPreListingDetail(plBtn.dataset.id);
      else if (editPlBtn) openPreListingDetail(editPlBtn.dataset.id, { edit: true });
      else if (closePlBtn) closePreListing(closePlBtn.dataset.id, true);
      else if (deletePlBtn) deletePreListing(deletePlBtn.dataset.id, true);
      else if (txBtn) openTransactionDetail(txBtn.dataset.id);
      else if (checkInBtn) {
        try {
          const { id: conversationId } = await apiPost('/api/conversations', { userId: Number(checkInBtn.dataset.userId) });
          const { conversations } = await apiGet('/api/conversations');
          const convo = conversations.find(c => c.id === conversationId);
          goToTab('messages');
          await openConversation(conversationId, convo ? convo.other_name : 'Homeowner', checkInBtn.dataset.userId);
          // Drafted, not sent — a template is a starting point, not something that should go out un-reviewed.
          document.getElementById('messageBody').value = `Hi! Just checking in on my proposal for ${checkInBtn.dataset.title} — happy to answer any questions.`;
          document.getElementById('messageBody').focus();
        } catch (err) { toast(err.message); }
      }
    });
  }
  wireMarketplaceOpenButtons('myPreListingsList');
  wireMarketplaceOpenButtons('myTransactionsList');
  wireMarketplaceOpenButtons('marketplaceBrowseList');
  wireMarketplaceOpenButtons('myBidsList');

  document.getElementById('backToMarketplace').addEventListener('click', backToMarketplaceList);
  // Escape backs out of whatever's currently open — a detail view first (most common), else the full-screen
  // conversation thread — so the keyboard alone can navigate back out, not just the mouse.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (marketplaceDetail && !document.getElementById('marketplaceDetailView').classList.contains('hidden')) backToMarketplaceList();
    else if (augmentedDetail && !document.getElementById('augmentedDetailView').classList.contains('hidden')) backToAugmentedList();
    else if (findermineDetail && !document.getElementById('findermineDetailView').classList.contains('hidden')) backToFinderMineList();
    else if (!document.getElementById('messageThread').classList.contains('hidden')) loadConversations();
  });

  function refreshDetail(kind, id) {
    return kind === 'pre_listing' ? openPreListingDetail(id) : openTransactionDetail(id);
  }

  document.getElementById('marketplaceDetailContent').addEventListener('click', async (e) => {
    if (!marketplaceDetail) return;
    const { kind, id } = marketplaceDetail;
    const basePath = kind === 'pre_listing' ? `/api/pre-listings/${id}` : `/api/transactions/${id}`;

    const acceptBtn = e.target.closest('[data-action="accept-bid"]');
    const submitBidBtn = e.target.closest('[data-action="submit-bid"]');
    const withdrawBtn = e.target.closest('[data-action="withdraw-bid"]');
    const voteBtn = e.target.closest('[data-action="cast-vote"]');
    const reviewBtn = e.target.closest('[data-action="submit-review"]');
    const favoriteBtn = e.target.closest('[data-action="toggle-favorite-agent"]');
    const msgBtn = e.target.closest('[data-action="message-user"]');
    const addMilestoneBtn = e.target.closest('[data-action="add-milestone"]');
    const addSuggestedMilestoneBtn = e.target.closest('[data-action="add-suggested-milestone"]');
    const deleteMilestoneBtn = e.target.closest('[data-action="delete-milestone"]');
    const disputeBtn = e.target.closest('[data-action="raise-dispute"]');
    const homeownerReviewBtn = e.target.closest('[data-action="submit-homeowner-review"]');
    const searchInviteBtn = e.target.closest('[data-action="search-invite-agents"]');
    const sendInviteBtn = e.target.closest('[data-action="send-invite"]');
    const quickfillBtn = e.target.closest('[data-action="quickfill-package"]');
    const editPlBtn = e.target.closest('[data-action="edit-pre-listing"]');
    const cancelEditBtn = e.target.closest('[data-action="cancel-edit-pre-listing"]');
    const savePlBtn = e.target.closest('[data-action="save-pre-listing"]');
    const closePlBtn = e.target.closest('[data-action="close-pre-listing"]');
    const deletePlBtn = e.target.closest('[data-action="delete-pre-listing"]');
    const deletePlPhotoBtn = e.target.closest('[data-action="delete-pre-listing-photo"]');
    const requestShowingBtn = e.target.closest('[data-action="request-showing"]');
    const decideShowingBtn = e.target.closest('[data-action="decide-showing"]');
    const cancelShowingBtn = e.target.closest('[data-action="cancel-showing"]');

    try {
      if (requestShowingBtn) {
        const proposedAt = document.getElementById('showingProposedAt').value;
        if (!proposedAt) { toast('Pick a date and time first.'); return; }
        await apiPost(`${basePath}/showings`, { proposedAt: new Date(proposedAt).toISOString(), note: document.getElementById('showingNote').value.trim() });
        document.getElementById('showingNote').value = '';
        toast('Showing requested!');
        loadShowingsInto(id, false);
        return;
      }
      if (decideShowingBtn) {
        await apiPut(`${basePath}/showings/${decideShowingBtn.dataset.showingId}`, { action: decideShowingBtn.dataset.decision });
        loadShowingsInto(id, true);
        return;
      }
      if (cancelShowingBtn) {
        await apiPut(`${basePath}/showings/${cancelShowingBtn.dataset.showingId}`, { action: 'cancel' });
        loadShowingsInto(id, false);
        return;
      }
      if (editPlBtn) { showPreListingEditor(true); return; }
      if (cancelEditBtn) { openPreListingDetail(id); return; } // re-fetch: drops unsaved edits and any removed photo
      if (savePlBtn) { await savePreListingEdit(id); return; }
      if (closePlBtn) { await closePreListing(id, false); return; }
      if (deletePlBtn) { await deletePreListing(id, false); return; }
      if (deletePlPhotoBtn) {
        if (!confirm('Remove this photo?')) return;
        await apiDelete(`/api/pre-listings/${id}/photos/${deletePlPhotoBtn.dataset.photoId}`);
        deletePlPhotoBtn.closest('.edit-photo').remove();
        return;
      }
      if (quickfillBtn) {
        const pkg = currentAgentPackages.find(p => p.tier === quickfillBtn.dataset.tier);
        if (!pkg) return;
        document.getElementById('bidMessage').value = pkg.description || `${PACKAGE_TIER_LABELS[pkg.tier]} package${pkg.turnaroundDays ? ` — ready in about ${pkg.turnaroundDays} days` : ''}.`;
        document.getElementById('bidCommissionPct').value = pkg.commissionPct || '';
        document.getElementById('bidFlatFee').value = pkg.flatFee || '';
        renderServicesEditor('bidServicesEditor', pkg.services);
        return;
      }
      if (acceptBtn) {
        if (!confirm('Award this proposal? Every other pending proposal will be declined.')) return;
        await apiPut(`${basePath}/bids/${acceptBtn.dataset.bidId}`, { action: 'accept' });
        toast('Proposal accepted!');
        refreshDetail(kind, id);
      } else if (submitBidBtn) {
        await apiPost(`${basePath}/bids`, {
          message: document.getElementById('bidMessage').value.trim(),
          commissionPct: document.getElementById('bidCommissionPct').value || null,
          flatFee: document.getElementById('bidFlatFee').value || null,
          services: collectServicesFromEditor('bidServicesEditor'),
        });
        toast('Proposal submitted!');
        refreshDetail(kind, id);
      } else if (withdrawBtn) {
        await apiPut(`${basePath}/bids/${withdrawBtn.dataset.bidId}`, { action: 'withdraw' });
        toast('Proposal withdrawn.');
        refreshDetail(kind, id);
      } else if (voteBtn) {
        await apiPost(`${basePath}/votes`, { vote: voteBtn.dataset.vote });
        toast('Vote saved!');
        openPreListingDetail(id);
      } else if (reviewBtn) {
        await apiPost(`${basePath}/review`, {
          rating: document.getElementById('reviewRating').value,
          comment: document.getElementById('reviewComment').value.trim(),
        });
        toast('Review submitted — thank you!');
        refreshDetail(kind, id);
      } else if (favoriteBtn) {
        await toggleFavoriteAgent(Number(favoriteBtn.dataset.agentId));
      } else if (msgBtn) {
        await startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); // switches to the Messages tab itself
      } else if (addMilestoneBtn) {
        const label = document.getElementById('newMilestoneLabel').value.trim();
        if (!label) return;
        await apiPost(`${basePath}/milestones`, { label });
        document.getElementById('newMilestoneLabel').value = '';
        loadMilestonesInto(kind, id);
      } else if (addSuggestedMilestoneBtn) {
        await apiPost(`${basePath}/milestones`, { label: addSuggestedMilestoneBtn.dataset.label });
        loadMilestonesInto(kind, id);
      } else if (deleteMilestoneBtn) {
        await apiDelete(`${basePath}/milestones/${deleteMilestoneBtn.dataset.milestoneId}`);
        loadMilestonesInto(kind, id);
      } else if (disputeBtn) {
        await apiPost(`${basePath}/disputes`, {
          reason: document.getElementById('disputeReason').value,
          description: document.getElementById('disputeDescription').value.trim(),
        });
        toast('Reported — an admin will review this.');
        document.getElementById('disputeDescription').value = '';
        loadMyDisputes();
      } else if (homeownerReviewBtn) {
        await apiPost(`${basePath}/review-homeowner`, {
          rating: document.getElementById('homeownerReviewRating').value,
          comment: document.getElementById('homeownerReviewComment').value.trim(),
        });
        toast('Review submitted — thank you!');
        refreshDetail(kind, id);
      } else if (searchInviteBtn) {
        searchInviteAgents();
      } else if (sendInviteBtn) {
        await apiPost(`${basePath}/invites`, { agentUserId: Number(sendInviteBtn.dataset.agentId) });
        toast('Invitation sent!');
        loadInvitedAgentsInto(kind, id);
      }
    } catch (err) { toast(err.message); }
  });

  document.getElementById('marketplaceDetailContent').addEventListener('change', async (e) => {
    const milestoneCheck = e.target.closest('.milestone-check');
    const disclosureCheck = e.target.closest('.disclosure-check');
    if (milestoneCheck && marketplaceDetail) {
      const { kind, id } = marketplaceDetail;
      const basePath = kind === 'pre_listing' ? `/api/pre-listings/${id}` : `/api/transactions/${id}`;
      try {
        await apiPut(`${basePath}/milestones/${milestoneCheck.dataset.milestoneId}`, { isDone: milestoneCheck.checked });
        loadMilestonesInto(kind, id);
      } catch (err) { toast(err.message); }
    } else if (disclosureCheck) {
      const wrap = disclosureCheck.closest('#disclosuresChecklist');
      const preListingId = wrap.dataset.preListingId;
      const checkedKeys = [...wrap.querySelectorAll('.disclosure-check:checked')].map(c => c.value);
      try {
        await apiPut(`/api/pre-listings/${preListingId}/disclosures`, { checked: checkedKeys });
        wrap.closest('details').querySelector('summary').textContent = `Seller disclosures checklist (${checkedKeys.length}/${DISCLOSURE_ITEMS.length})`;
      } catch (err) {
        disclosureCheck.checked = !disclosureCheck.checked; // the PUT failed, so undo the optimistic UI change
        toast(err.message);
      }
    }
  });

  function wireFavoriteToggle(containerId) {
    document.getElementById(containerId).addEventListener('click', async e => {
      const btn = e.target.closest('[data-action="toggle-favorite-agent"]');
      const msgBtn = e.target.closest('[data-action="message-user"]');
      if (msgBtn) { try { await startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); } catch (err) { toast(err.message); } return; }
      if (!btn) return;
      try { await toggleFavoriteAgent(Number(btn.dataset.agentId)); } catch (err) { toast(err.message); }
    });
  }
  wireFavoriteToggle('agentDirectoryList');
  wireFavoriteToggle('favoriteAgentsList');

  document.getElementById('myInvitesList').addEventListener('click', async e => {
    const declineBtn = e.target.closest('[data-action="decline-invite"]');
    if (!declineBtn) return;
    try {
      await apiPut(`/api/agent-invites/${declineBtn.dataset.inviteId}`, {});
      loadMyInvites();
    } catch (err) { toast(err.message); }
  });
  wireMarketplaceOpenButtons('myInvitesList');

  /* ---------------- AugmentedHomes wiring ---------------- */
  document.getElementById('createAugmentedHomeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('createAugmentedHomeBtn');
    btn.disabled = true;
    try {
      const adaptations = [...document.querySelectorAll('.augmented-create-check:checked')].map(c => c.value);
      const { id } = await apiPost('/api/augmented-homes', {
        title: document.getElementById('augTitle').value.trim(),
        askingPrice: document.getElementById('augAskingPrice').value,
        city: document.getElementById('augCity').value.trim(),
        state: document.getElementById('augState').value.trim(),
        zip: document.getElementById('augZip').value.trim(),
        neighborhood: document.getElementById('augNeighborhood').value.trim(),
        address: document.getElementById('augAddress').value.trim(),
        propertyType: document.getElementById('augPropertyType').value,
        beds: document.getElementById('augBeds').value,
        baths: document.getElementById('augBaths').value,
        sqft: document.getElementById('augSqft').value || null,
        description: document.getElementById('augDescription').value.trim(),
        adaptations,
        adaptationNotes: document.getElementById('augAdaptationNotes').value.trim(),
      });
      const files = [...document.getElementById('augPhotos').files];
      for (const file of files) {
        const formData = new FormData();
        formData.append('photo', file);
        try { await apiUpload(`/api/augmented-homes/${id}/photos`, formData); }
        catch (err) { toast(`Photo upload failed: ${err.message}`); }
      }
      toast('Listed on AugmentedHomes.');
      document.getElementById('postAugmentedWrap').open = false;
      ['augTitle', 'augAskingPrice', 'augCity', 'augState', 'augZip', 'augNeighborhood', 'augAddress', 'augSqft', 'augDescription', 'augAdaptationNotes'].forEach(f => document.getElementById(f).value = '');
      document.getElementById('augBeds').value = '';
      document.getElementById('augBaths').value = '';
      document.getElementById('augPhotos').value = '';
      document.querySelectorAll('.augmented-create-check').forEach(c => c.checked = false);
      loadMyAugmentedHomes();
      loadAugmentedBrowse();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.getElementById('saveAccessibilityAlertBtn').addEventListener('click', async () => {
    try {
      const adaptations = [...document.querySelectorAll('.accessibility-alert-check:checked')].map(c => c.value);
      await apiPost('/api/accessibility-needs-alerts', {
        label: document.getElementById('accessibilityAlertLabel').value.trim(),
        adaptations,
        city: document.getElementById('accessibilityAlertCity').value.trim(),
        state: document.getElementById('accessibilityAlertState').value.trim(),
      });
      document.getElementById('accessibilityAlertLabel').value = '';
      document.getElementById('accessibilityAlertCity').value = '';
      document.getElementById('accessibilityAlertState').value = '';
      document.querySelectorAll('.accessibility-alert-check').forEach(c => c.checked = false);
      loadMyAccessibilityAlerts();
      toast("Saved — we'll notify you when a match is listed.");
    } catch (err) { toast(err.message); }
  });

  document.getElementById('accessibilityAlertsList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="delete-accessibility-alert"]');
    if (!btn) return;
    try { await apiDelete(`/api/accessibility-needs-alerts/${btn.dataset.id}`); loadMyAccessibilityAlerts(); }
    catch (err) { toast(err.message); }
  });

  document.getElementById('augmentedFilters').addEventListener('input', () => loadAugmentedBrowse());
  document.getElementById('augmentedFilterChips').addEventListener('change', () => loadAugmentedBrowse());

  function wireAugmentedOpenButtons(containerId) {
    document.getElementById(containerId).addEventListener('click', async e => {
      const openBtn = e.target.closest('[data-action="open-augmented-home"]');
      const statusBtn = e.target.closest('[data-action="augmented-set-status"]');
      if (openBtn) openAugmentedHomeDetail(openBtn.dataset.id);
      else if (statusBtn) {
        try { await apiPut(`/api/augmented-homes/${statusBtn.dataset.id}`, { action: 'set-status', status: statusBtn.dataset.status }); loadMyAugmentedHomes(); }
        catch (err) { toast(err.message); }
      }
    });
  }
  wireAugmentedOpenButtons('myAugmentedHomesList');
  wireAugmentedOpenButtons('augmentedBrowseList');

  document.getElementById('backToAugmented').addEventListener('click', backToAugmentedList);

  document.getElementById('augmentedDetailContent').addEventListener('click', async e => {
    const msgBtn = e.target.closest('[data-action="message-user"]');
    const deletePhotoBtn = e.target.closest('[data-action="delete-augmented-photo"]');
    const deleteHomeBtn = e.target.closest('[data-action="delete-augmented-home"]');
    if (msgBtn) { try { await startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); } catch (err) { toast(err.message); } }
    else if (deletePhotoBtn) {
      if (!confirm('Remove this photo?')) return;
      try { await apiDelete(`/api/augmented-homes/${augmentedDetail.id}/photos/${deletePhotoBtn.dataset.id}`); openAugmentedHomeDetail(augmentedDetail.id); }
      catch (err) { toast(err.message); }
    } else if (deleteHomeBtn) {
      if (!confirm('Permanently delete this listing? It cannot be recovered after this.')) return;
      try { await apiDelete(`/api/augmented-homes/${deleteHomeBtn.dataset.id}`); toast('Listing deleted.'); backToAugmentedList(); }
      catch (err) { toast(err.message); }
    }
  });

  /* ---------------- FinderMine wiring ---------------- */
  document.getElementById('createProjectBtn').addEventListener('click', async () => {
    const btn = document.getElementById('createProjectBtn');
    btn.disabled = true;
    try {
      const { id } = await apiPost('/api/dev-projects', {
        title: document.getElementById('projTitle').value.trim(),
        city: document.getElementById('projCity').value.trim(),
        state: document.getElementById('projState').value.trim(),
        zip: document.getElementById('projZip').value.trim(),
        neighborhood: document.getElementById('projNeighborhood').value.trim(),
        address: document.getElementById('projAddress').value.trim(),
        projectType: document.getElementById('projTypeSelect').value,
        stage: document.getElementById('projStageSelect').value,
        fundingGoal: document.getElementById('projFundingGoal').value || 0,
        minInvestment: document.getElementById('projMinInvestment').value || 0,
        targetReturn: document.getElementById('projTargetReturn').value.trim(),
        timelineMonths: document.getElementById('projTimelineMonths').value || null,
        description: document.getElementById('projDescription').value.trim(),
      });
      const files = [...document.getElementById('projPhotos').files];
      for (const file of files) {
        const formData = new FormData();
        formData.append('photo', file);
        try { await apiUpload(`/api/dev-projects/${id}/photos`, formData); }
        catch (err) { toast(`Photo upload failed: ${err.message}`); }
      }
      toast('Project posted on FinderMine.');
      document.getElementById('postProjectWrap').open = false;
      ['projTitle', 'projCity', 'projState', 'projZip', 'projNeighborhood', 'projAddress', 'projFundingGoal', 'projMinInvestment', 'projTargetReturn', 'projTimelineMonths', 'projDescription'].forEach(f => document.getElementById(f).value = '');
      document.getElementById('projPhotos').value = '';
      loadMyProjects();
      loadProjectsBrowse();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.getElementById('projectFilters').addEventListener('input', () => loadProjectsBrowse());
  document.getElementById('projectTypeFilter').addEventListener('change', () => loadProjectsBrowse());
  document.getElementById('projectStageFilter').addEventListener('change', () => loadProjectsBrowse());

  function wireProjectOpenButtons(containerId) {
    document.getElementById(containerId).addEventListener('click', async e => {
      const openBtn = e.target.closest('[data-action="open-dev-project"]');
      const statusBtn = e.target.closest('[data-action="project-set-status"]');
      if (openBtn) openProjectDetail(openBtn.dataset.id);
      else if (statusBtn) {
        try { await apiPut(`/api/dev-projects/${statusBtn.dataset.id}`, { action: 'set-status', status: statusBtn.dataset.status }); loadMyProjects(); }
        catch (err) { toast(err.message); }
      }
    });
  }
  wireProjectOpenButtons('myProjectsList');
  wireProjectOpenButtons('projectsBrowseList');

  document.getElementById('backToFinderMine').addEventListener('click', backToFinderMineList);

  document.getElementById('findermineDetailContent').addEventListener('click', async e => {
    const msgBtn = e.target.closest('[data-action="message-user"]');
    const interestBtn = e.target.closest('[data-action="toggle-project-interest"]');
    const deletePhotoBtn = e.target.closest('[data-action="delete-project-photo"]');
    const deleteProjectBtn = e.target.closest('[data-action="delete-project"]');
    if (msgBtn) { try { await startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); } catch (err) { toast(err.message); } }
    else if (interestBtn) {
      try {
        const { interested } = await apiPost(`/api/dev-projects/${interestBtn.dataset.id}/interest`, {});
        toast(interested ? 'Marked as interested.' : 'Interest withdrawn.');
        openProjectDetail(interestBtn.dataset.id); // refresh investor count/list and button label
      } catch (err) { toast(err.message); }
    } else if (deletePhotoBtn) {
      if (!confirm('Remove this photo?')) return;
      try { await apiDelete(`/api/dev-projects/${findermineDetail.id}/photos/${deletePhotoBtn.dataset.id}`); openProjectDetail(findermineDetail.id); }
      catch (err) { toast(err.message); }
    } else if (deleteProjectBtn) {
      if (!confirm('Permanently delete this project? It cannot be recovered after this.')) return;
      try { await apiDelete(`/api/dev-projects/${deleteProjectBtn.dataset.id}`); toast('Project deleted.'); backToFinderMineList(); }
      catch (err) { toast(err.message); }
    }
  });

  // The Agent Strategy tab is where the app opens, unless a deep link
  // (/app#pre-listing-12, #transaction-7, #messages-3, #post-home) from a
  // bookmark, notification or shared URL says otherwise — and a deep link always wins over the remembered tab
  // below, since it's a more specific instruction about where the user wants to be right now. Only one of the
  // two runs, so the tab's data isn't fetched twice. The Feed loads when its tab is opened.
  const openedByLink = location.hash ? await openAppLink(location.hash) : false;
  if (!openedByLink) {
    const VALID_TABS = ['marketplace', 'feed', 'listing', 'groups', 'matches', 'saved', 'messages', 'augmented', 'findermine'];
    let lastTab = 'marketplace';
    try { if (VALID_TABS.includes(localStorage.getItem('ah_last_tab'))) lastTab = localStorage.getItem('ah_last_tab'); } catch {}
    goToTab(lastTab);
  }
});
