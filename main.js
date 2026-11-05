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

// Kept in sync by hand with functions/_lib/greenFeatures.js.
const GREEN_FEATURE_ITEMS = [
  { key: 'solar_panels', label: 'Solar panels', note: 'Rooftop or ground-mount solar, owned or leased.' },
  { key: 'battery_storage', label: 'Battery storage', note: 'A home battery system (e.g. Powerwall) for stored solar power or backup.' },
  { key: 'ev_charger', label: 'EV charger', note: 'A dedicated electric-vehicle charging station installed at the home.' },
  { key: 'high_efficiency_hvac', label: 'High-efficiency HVAC', note: 'A high-SEER heat pump or similarly rated efficient heating/cooling system.' },
  { key: 'tankless_water_heater', label: 'Tankless water heater', note: 'An on-demand water heater instead of a storage tank.' },
  { key: 'enhanced_insulation', label: 'Enhanced insulation', note: 'Upgraded wall, attic, or window insulation beyond standard code.' },
  { key: 'energy_efficient_appliances', label: 'Energy-efficient appliances', note: 'ENERGY STAR or similarly rated major appliances.' },
  { key: 'low_flow_fixtures', label: 'Low-flow fixtures', note: 'Low-flow toilets, showerheads, and faucets to cut water use.' },
  { key: 'greywater_rainwater', label: 'Greywater / rainwater system', note: 'A greywater reuse system or rainwater catchment for irrigation.' },
  { key: 'drought_tolerant_landscaping', label: 'Drought-tolerant landscaping', note: 'Native or low-water landscaping in place of a traditional lawn.' },
  { key: 'green_certification', label: 'Green building certification', note: 'A recognized certification such as LEED, ENERGY STAR, or similar.' },
  { key: 'geothermal', label: 'Geothermal system', note: 'A geothermal heat pump using ground-source heating and cooling.' },
];

function greenFeatureLabel(key) {
  const item = GREEN_FEATURE_ITEMS.find(i => i.key === key);
  return item ? item.label : key;
}

function greenFeatureCheckboxesHtml(checkedKeys, checkClass) {
  const checked = new Set(checkedKeys || []);
  return GREEN_FEATURE_ITEMS.map(item => `
    <label class="checkbox-row">
      <input type="checkbox" class="${checkClass}" value="${item.key}" ${checked.has(item.key) ? 'checked' : ''}>
      <span>${escapeHtml(item.label)}<br><span class="tiny">${escapeHtml(item.note)}</span></span>
    </label>
  `).join('');
}

// Kept in sync by hand with functions/_lib/devProjects.js (the stored key 'flip' reads as "Renovation").
const PROJECT_TYPE_LABELS = {
  flip: 'Renovation', new_construction: 'New Construction', multifamily: 'Multi-Family',
  commercial: 'Commercial', land: 'Land / Entitlement', other: 'Other',
};
const PROJECT_STAGE_LABELS = {
  concept: 'Concept', permitting: 'Permitting', under_construction: 'Under Construction',
  funded: 'Ready to build', completed: 'Completed',
};
// FinderMine is for projects looking for a builder, partner or co-buyer, never investment offers, so a project that
// was marked "funded" before now just reads as closed, and new posts can't pick that stage.
const PROJECT_STAGE_CHOICES = Object.fromEntries(Object.entries(PROJECT_STAGE_LABELS).filter(([k]) => k !== 'funded'));
const PROJECT_STATUS_LABELS = { open: 'open', funded: 'closed', closed: 'closed' };
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
  if (name === 'marketpulse') { loadMarketPulse(); loadMyMarketPulseAlerts(); }
  if (name === 'listing') { loadMyListing(); if (!editingListingId) checkForListingDraft(); }
  if (name === 'groups') loadGroups();
  if (name === 'matches') loadMatches();
  if (name === 'saved') { loadFavorites(); loadHidden(); loadTrash(); }
  if (name === 'messages') loadConversations();
  if (name === 'marketplace') loadMarketplaceTab();
  if (name === 'augmented') loadAugmentedTab();
  if (name === 'findermine') loadFinderMineTab();
  if (name === 'greenhomes') loadGreenTab();
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
  syncOwnerConfirmListingRow();
}

// The "I own this home or have the owner's written permission" box (Y1): asked when a home is created, not on an
// edit and not for a buyer profile (no home to own). Never part of the listing draft autosave.
function syncOwnerConfirmListingRow() {
  const row = document.getElementById('ownerConfirmListingRow');
  if (!row) return;
  const buyerOnly = document.getElementById('isBuyerOnly').checked;
  row.classList.toggle('hidden', !!editingListingId || buyerOnly);
}

// Shows a toast and focuses the box when the ownership checkbox with this id isn't ticked. true = stop the post.
function ownerConfirmMissing(id) {
  const box = document.getElementById(id);
  if (!box || box.checked) return false;
  toast(OWNER_CONFIRM_REQUIRED);
  box.focus();
  return true;
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
// The listing a "Duplicate" pre-filled the create form from (sent as cloneOf so the server can refuse copying a
// listing that moderation paused).
let cloneSourceListingId = null;
let editingPortfolioId = null;
let myListings = [];

// ---- Mello-Roos / HOA fields, shared by the four home forms (regular listing, pre-listing, AugmentedHomes,
// GreenHomes) and the edit forms. Saved separately right after the home itself (PUT /api/home-costs/...), the same
// way photos upload afterwards. readHomeCosts runs before the home is created, so a missing amount stops the
// submit instead of leaving a half-saved home.
function homeCostsFromRow(row) {
  if (!row) return null;
  let d = row.hoa_details_json;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  return { melloRoosAnnual: row.mello_roos_annual ?? null, hoaMonthly: row.hoa_monthly ?? null, hoaDetails: d || {} };
}

function homeCostsFieldsHtml(prefix, costs) {
  const c = costs || { melloRoosAnnual: null, hoaMonthly: null, hoaDetails: {} };
  const d = c.hoaDetails || {};
  const status = v => (v === null || v === undefined ? '' : v === 0 ? 'none' : 'yes');
  const statusOptions = v => [['', 'Not sure'], ['none', 'None'], ['yes', 'Yes']].map(([k, label]) => `<option value="${k}"${status(v) === k ? ' selected' : ''}>${label}</option>`).join('');
  const ruleOptions = (choices, sel) => `<option value="">Not sure</option>${choices.map(k => `<option value="${k}"${sel === k ? ' selected' : ''}>${HOA_RULE_LABELS[k]}</option>`).join('')}`;
  const includes = new Set(d.includes || []);
  return `
    <details class="score-breakdown home-costs-fields" data-costs-prefix="${prefix}"${status(c.melloRoosAnnual) || status(c.hoaMonthly) ? ' open' : ''}>
      <summary>Mello-Roos and HOA (optional; buyers ask about these first)</summary>
      <div class="form-row two-col">
        <div class="field"><label for="${prefix}MelloStatus">Mello-Roos</label><select id="${prefix}MelloStatus">${statusOptions(c.melloRoosAnnual)}</select></div>
        <div class="field"><label for="${prefix}Mello">Mello-Roos per year ($)</label><input type="number" id="${prefix}Mello" min="1" max="100000" step="1" inputmode="numeric" value="${c.melloRoosAnnual > 0 ? c.melloRoosAnnual : ''}"></div>
      </div>
      <p class="tiny">Your property tax bill lists it as a special tax or "CFD".</p>
      <div class="form-row two-col">
        <div class="field"><label for="${prefix}HoaStatus">HOA</label><select id="${prefix}HoaStatus">${statusOptions(c.hoaMonthly)}</select></div>
        <div class="field"><label for="${prefix}Hoa">HOA dues per month ($)</label><input type="number" id="${prefix}Hoa" min="1" max="20000" step="1" inputmode="numeric" value="${c.hoaMonthly > 0 ? c.hoaMonthly : ''}"></div>
      </div>
      <fieldset class="hoa-includes">
        <legend class="label">Dues include</legend>
        ${Object.entries(HOA_INCLUDE_LABELS).map(([k, label]) => `<label class="checkbox-row"><input type="checkbox" data-hoa-include value="${k}"${includes.has(k) ? ' checked' : ''}><span>${label}</span></label>`).join('')}
      </fieldset>
      <div class="form-row three-col">
        <div class="field"><label for="${prefix}Rentals">Renting out</label><select id="${prefix}Rentals">${ruleOptions(['allowed', 'no_short_term', 'limited'], d.rentals)}</select></div>
        <div class="field"><label for="${prefix}Pets">Pets</label><select id="${prefix}Pets">${ruleOptions(['allowed', 'limited'], d.pets)}</select></div>
        <div class="field"><label for="${prefix}Assessment">Special assessment, if any</label><input type="text" id="${prefix}Assessment" maxlength="120" placeholder="e.g. $40/mo for the roof, through 2027" value="${escapeHtml(d.specialAssessment || '')}"></div>
      </div>
    </details>`;
}

function readHomeCosts(prefix) {
  const get = idName => document.getElementById(prefix + idName);
  if (!get('MelloStatus')) return null;
  const amount = (statusId, amountId, label, max) => {
    const st = get(statusId).value;
    const typed = get(amountId).value.trim();
    if (st === 'none' || (typed !== '' && Number(typed) === 0)) return 0;
    if (st !== 'yes' && !typed) return null; // "Not sure" with an amount typed in counts as Yes
    const n = Number(typed);
    if (!typed || !Number.isInteger(n) || n <= 0) throw new Error(`Add the ${label} amount in whole dollars, or pick "Not sure".`);
    if (n > max) throw new Error(`The ${label} amount looks too high (the most is ${money(max)}).`);
    return n;
  };
  const hoaMonthly = amount('HoaStatus', 'Hoa', 'HOA dues per month', 20000);
  return {
    melloRoosAnnual: amount('MelloStatus', 'Mello', 'Mello-Roos per year', 100000),
    hoaMonthly,
    hoaDetails: hoaMonthly === 0 ? {} : {
      includes: [...document.querySelectorAll(`[data-costs-prefix="${prefix}"] [data-hoa-include]:checked`)].map(i => i.value),
      rentals: get('Rentals').value,
      pets: get('Pets').value,
      specialAssessment: get('Assessment').value.trim(),
    },
  };
}

async function saveHomeCosts(kind, id, costs) {
  if (costs) await apiPut(`/api/home-costs/${kind}/${id}`, costs);
}

function resetHomeCostsFields(containerId, prefix) {
  const box = document.getElementById(containerId);
  if (box) box.innerHTML = homeCostsFieldsHtml(prefix);
}


function resetListingFormToCreateMode() {
  editingListingId = null;
  cloneSourceListingId = null;
  resetHomeCostsFields('listingCostsFields', 'lc');
  document.getElementById('listingSubmitBtn').textContent = 'Create Listing';
  document.getElementById('isBuyerOnly').disabled = false;
  document.getElementById('isRental').disabled = false;
  syncOwnerConfirmListingRow();
}

// Shared by edit (same listing, kind locked) and clone (a fresh listing
// pre-filled from an existing one) — the field list is the same either way,
// only what happens with the kind toggle and identity-specific fields differs.
function fillListingFormFields(l, { forClone } = {}) {
  const costsBox = document.getElementById('listingCostsFields');
  if (costsBox) costsBox.innerHTML = homeCostsFieldsHtml('lc', forClone ? null : homeCostsFromRow(l));
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
  // address or listing photos/links.
  document.getElementById('address').value = forClone ? '' : (l.address || '');
  document.getElementById('propertyType').value = l.property_type || '';
  document.getElementById('estimatedValue').value = l.estimated_value || '';
  document.getElementById('beds').value = l.beds || '';
  document.getElementById('baths').value = l.baths || '';
  document.getElementById('sqft').value = l.sqft || '';
  const links = forClone ? [] : (l.external_links || []);
  document.getElementById('virtualTourUrl').value = links.find(link => link.label === 'Virtual Tour')?.url || '';
  document.getElementById('externalLinks').value = links.filter(link => link.label !== 'Virtual Tour').map(link => link.url).join('\n');
  // Keys saved before the relabel tick their new choice.
  const checkedLifeEvents = new Set(forClone ? [] : (l.life_event_tags || []).map(currentLifeEventKey).filter(Boolean));
  document.querySelectorAll('.life-event-check').forEach(c => { c.checked = checkedLifeEvents.has(c.value); });
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
  cloneSourceListingId = null;
  syncOwnerConfirmListingRow();
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
  cloneSourceListingId = l.id;
  applyAgentOnlyListingTools();
  document.getElementById('listingFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Autosaves the create-listing form to localStorage as the user types, so an
// accidental tab close or navigation away doesn't lose a half-filled listing.
// Deliberately per-device only (not synced anywhere) — it's a convenience
// against a slip, not durable storage.
const LISTING_DRAFT_KEY = 'amicohaus_listing_draft_v1';
const LISTING_DRAFT_FIELD_IDS = [
  'isBuyerOnly', 'isRental', 'title', 'clientName', 'city', 'state', 'neighborhood', 'address',
  'propertyType', 'estimatedValue', 'beds', 'baths', 'sqft', 'virtualTourUrl', 'externalLinks',
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

const MARKET_EVENT_TONE = {
  new_listing: 'ticker-neutral', price_drop: 'ticker-down',
  offer_accepted: 'ticker-up', open_house_scheduled: 'ticker-neutral',
};
const MARKET_EVENT_ARROW = { new_listing: '●', price_drop: '▼', offer_accepted: '▲', open_house_scheduled: '●' };

function signedMoney(n) {
  n = Number(n) || 0;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
}

// A tiny inline price-history line for a listing card. Needs at least 2 points to mean anything -- a single
// point is just "the asking price," not a trend -- so a brand-new listing with no history renders nothing.
// A 0 is a pre-listing with no price set yet ("Open to price opinions"), so it's left out rather than drawn as $0
// (and so is the old $1 a blank price used to save as, which made a "▲ 74999900%" badge).
function pricedPoints(series) {
  return (series || []).filter(v => Number(v) >= 1000);
}

function sparklineHtml(rawSeries) {
  const series = pricedPoints(rawSeries);
  if (series.length < 2) return '';
  const w = 88, h = 22, pad = 2;
  const min = Math.min(...series), max = Math.max(...series);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (series.length - 1);
  const points = series.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const tone = series[series.length - 1] < series[0] ? 'ticker-down' : series[series.length - 1] > series[0] ? 'ticker-up' : 'ticker-neutral';
  const title = `${money(series[0])} → ${money(series[series.length - 1])}`;
  return `<svg class="sparkline ${tone}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Price history: ${title}"><title>${title}</title><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// Compact "▼ 4%" chip alongside the sparkline, for when the shape alone isn't specific enough.
function priceTrendBadge(rawSeries) {
  const series = pricedPoints(rawSeries);
  if (series.length < 2 || series[0] === series[series.length - 1]) return '';
  const pct = Math.round(((series[series.length - 1] - series[0]) / series[0]) * 100);
  const tone = pct < 0 ? 'ticker-down' : 'ticker-up';
  return `<span class="trend-badge ${tone}">${pct < 0 ? '▼' : '▲'} ${Math.abs(pct)}%</span>`;
}

// An accepted offer is not a closed sale, so its price is never shown here.
function marketEventFigure(e) {
  if (e.eventType === 'price_drop') return signedMoney(e.delta);
  return e.amount && e.eventType !== 'offer_accepted' ? money(e.amount) : '';
}

function renderTickerItem(e) {
  const tone = MARKET_EVENT_TONE[e.eventType] || 'ticker-neutral';
  const arrow = MARKET_EVENT_ARROW[e.eventType] || '●';
  const figure = marketEventFigure(e);
  return `<span class="ticker-item"><span class="${tone}">${arrow}</span> ${escapeHtml(e.headline)}${figure ? ` <span class="${tone}">${figure}</span>` : ''}</span>`;
}

function renderMarketEventRow(e) {
  const tone = MARKET_EVENT_TONE[e.eventType] || 'ticker-neutral';
  const figure = marketEventFigure(e);
  return `
    <div class="card market-event-row">
      <div>
        <strong><a href="${marketEntityHref(e.entityKind, e.entityId)}" data-action="open-market-entity" data-link="${escapeHtml(marketEntityHref(e.entityKind, e.entityId))}">${escapeHtml(e.headline)}</a></strong>
        <div class="tiny">${timeAgo(e.createdAt)}${e.city ? ` · ${escapeHtml(e.city)}, ${escapeHtml(e.state)}` : ''}</div>
      </div>
      ${figure ? `<span class="market-event-delta ${tone}">${figure}</span>` : ''}
    </div>
  `;
}

const MARKET_EVENT_TYPE_LABEL = { new_listing: 'New listing', price_drop: 'Price drop', offer_accepted: 'Offer accepted', open_house_scheduled: 'Open house scheduled' };
const MARKET_ENTITY_KIND_LABEL = { listing: 'Agent Strategy', augmented_home: 'AugmentedHomes', green_home: 'GreenHomes', dev_project: 'FinderMine' };

function renderMarketTrends(trends) {
  const el = document.getElementById('marketTrends');
  if (!el || !trends) return;
  const counts = trends.eventCounts7d || {};
  const totalThisWeek = Object.values(counts).reduce((a, b) => a + b, 0);
  const topCity = (trends.topCities7d || [])[0];
  el.innerHTML = `
    <div class="stat-item"><span class="stat-num">${totalThisWeek}</span><span class="stat-label">Events this week</span></div>
    <div class="stat-item"><span class="stat-num">${counts.price_drop || 0}</span><span class="stat-label">Price drops this week</span></div>
    <div class="stat-item"><span class="stat-num">${trends.priceDropCount30d || 0}</span><span class="stat-label">Drops last 30 days</span></div>
    <div class="stat-item"><span class="stat-num">${money(trends.priceDropTotal30d || 0)}</span><span class="stat-label">Total price cuts (30d)</span></div>
    <div class="stat-item"><span class="stat-num">${topCity ? escapeHtml(topCity.city) : '—'}</span><span class="stat-label">Busiest city this week</span></div>
  `;
}

async function loadMyMarketPulseAlerts() {
  const el = document.getElementById('marketPulseAlertsList');
  try {
    const { alerts } = await apiGet('/api/market-pulse-alerts');
    el.innerHTML = alerts.length ? alerts.map(a => `
      <div class="side">
        <strong>${escapeHtml(a.label)}</strong>
        <span class="tiny">${a.eventType ? escapeHtml(MARKET_EVENT_TYPE_LABEL[a.eventType] || a.eventType) : 'Any event'} · ${a.entityKind ? escapeHtml(MARKET_ENTITY_KIND_LABEL[a.entityKind] || a.entityKind) : 'Any marketplace'}${a.city || a.state ? ` · ${escapeHtml(a.city || '')}${a.city && a.state ? ', ' : ''}${escapeHtml(a.state || '')}` : ''}</span>
        <button class="link-btn" data-action="delete-market-pulse-alert" data-id="${a.id}">Remove</button>
      </div>
    `).join('') : '<span class="tiny">No saved alerts yet.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

let marketPulseTimer = null;
const MARKET_PULSE_SEEN_KEY = 'ah_market_pulse_seen';

// A small red dot on the nav tab when real activity has happened since this device last opened Market
// Pulse -- checked once at load, cleared the moment the tab is actually opened (see loadMarketPulse below).
async function checkUnseenMarketPulse() {
  const dot = document.getElementById('marketPulseUnseenDot');
  if (!dot) return;
  try {
    const { events } = await apiGet('/api/market-events?limit=1');
    if (!events.length) return;
    let seen = ''; try { seen = localStorage.getItem(MARKET_PULSE_SEEN_KEY) || ''; } catch {}
    dot.classList.toggle('hidden', events[0].createdAt <= seen);
  } catch { /* non-critical */ }
}

function leaderboardCardHtml(entry, label) {
  if (!entry) return '';
  const tone = 'ticker-up';
  const figure = entry.event_count ? `${entry.event_count} events` : '';
  return `
    <div class="card market-event-row">
      <div>
        <span class="tiny label">${escapeHtml(label)}</span>
        <div><a href="${marketEntityHref(entry.entity_kind, entry.entity_id)}" data-action="open-market-entity" data-link="${escapeHtml(marketEntityHref(entry.entity_kind, entry.entity_id))}"><strong>${escapeHtml(entry.headline)}</strong></a></div>
        <div class="tiny">${entry.city ? `${escapeHtml(entry.city)}, ${escapeHtml(entry.state)}` : ''}</div>
      </div>
      ${figure ? `<span class="market-event-delta ${tone}">${figure}</span>` : ''}
    </div>
  `;
}

function renderMarketLeaderboard(leaderboard) {
  const el = document.getElementById('marketLeaderboard');
  if (!el || !leaderboard) return;
  // No "biggest price drop" spotlight on one seller's home; activity counts only new listings and open houses.
  const cards = [
    leaderboardCardHtml(leaderboard.mostActivity || leaderboard.hottest, 'Most activity this week'),
  ].filter(Boolean);
  el.innerHTML = cards.join('');
}

/* ---------------- Compare mode (AugmentedHomes / GreenHomes) ---------------- */
// Client-side only -- every field the comparison needs is already in the browse-list data each card was
// rendered from (cached here by vertical), so there's no second fetch, just a lookup by id.
const MAX_COMPARE = 3;
let compareTray = [];
const compareBrowseCache = { augmented_home: [], green_home: [] };

function isInCompareTray(kind, id) {
  return compareTray.some(c => c.compareKind === kind && c.id === id);
}

const COMPARE_STORAGE_KEY = 'ah_compare_tray';
// Per-device convenience only, same spirit as the "last tab" / "browse last visit" localStorage uses
// elsewhere -- never read back by the server, just survives a reload on this browser.
function saveCompareTray() {
  try { localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compareTray)); } catch {}
}
function loadStoredCompareTray() {
  try {
    const raw = localStorage.getItem(COMPARE_STORAGE_KEY);
    if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) compareTray = parsed; }
  } catch { /* ignore a corrupt or inaccessible value */ }
}

function toggleCompare(kind, id) {
  const idx = compareTray.findIndex(c => c.compareKind === kind && c.id === id);
  if (idx >= 0) {
    compareTray.splice(idx, 1);
  } else {
    if (compareTray.length >= MAX_COMPARE) { toast(`You can compare up to ${MAX_COMPARE} at a time.`); return; }
    const item = (compareBrowseCache[kind] || []).find(h => h.id === id);
    if (!item) return;
    compareTray.push({ ...item, compareKind: kind });
  }
  const btn = document.querySelector(`[data-action="toggle-compare"][data-kind="${kind}"][data-id="${id}"]`);
  if (btn) btn.textContent = isInCompareTray(kind, id) ? '✓ Comparing' : '⚖ Compare';
  saveCompareTray();
  renderCompareTrayBar();
}

function renderCompareTrayBar() {
  const bar = document.getElementById('compareTrayBar');
  if (!bar) return;
  if (!compareTray.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <span>${compareTray.length} selected to compare</span>
    <button type="button" class="btn btn-primary btn-sm" id="openCompareBtn">View Comparison</button>
    <button type="button" class="btn btn-ghost btn-sm" id="clearCompareBtn">Clear</button>
  `;
  document.getElementById('openCompareBtn').addEventListener('click', openCompareOverlay);
  document.getElementById('clearCompareBtn').addEventListener('click', clearCompareTray);
}

function clearCompareTray() {
  document.querySelectorAll('[data-action="toggle-compare"]').forEach(btn => { btn.textContent = '⚖ Compare'; });
  compareTray = [];
  saveCompareTray();
  renderCompareTrayBar();
  closeCompareOverlay();
}

function shareCompareLink() {
  if (!compareTray.length) return;
  const parts = compareTray.map(c => `${c.compareKind}-${c.id}`).join(',');
  const url = `${window.location.origin}/app?compare=${encodeURIComponent(parts)}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => toast('Comparison link copied!')).catch(() => toast(url));
  } else {
    toast(url);
  }
}

// A shared comparison link (?compare=augmented_home-5,green_home-12) re-fetches each item's CURRENT data
// through its real detail endpoint (sign-in required, same as browsing those verticals normally already
// is) -- never trusts stale data baked into the URL itself, and silently skips anything since removed.
async function loadCompareFromShareLink() {
  const params = new URLSearchParams(window.location.search);
  const compareParam = params.get('compare');
  if (!compareParam) return;
  const user = await fetchCurrentUser();
  if (!user) { toast('Sign in to view this shared comparison.'); return; }

  const DETAIL_ROUTE = { augmented_home: 'augmented-homes', green_home: 'green-homes' };
  const pairs = compareParam.split(',').map(p => p.split('-')).filter(p => p.length === 2 && DETAIL_ROUTE[p[0]]).slice(0, MAX_COMPARE);
  const loaded = [];
  for (const [kind, idStr] of pairs) {
    const id = Number(idStr);
    if (!id) continue;
    try {
      const { home } = await apiGet(`/api/${DETAIL_ROUTE[kind]}/${id}`);
      loaded.push({
        compareKind: kind, id: home.id, title: home.title, propertyType: home.propertyType,
        city: home.city, state: home.state, askingPrice: home.askingPrice, sqft: home.sqft,
        beds: home.beds, baths: home.baths, createdAt: home.createdAt, photoIds: home.photoIds,
        priceSeries: seriesFromPriceHistory(home.priceHistory, home.askingPrice),
        adaptations: home.adaptations, greenFeatures: home.greenFeatures,
        favoriteCount: 0, commentCount: 0,
      });
    } catch { /* this one's gone or no longer visible -- just leave it out */ }
  }
  if (loaded.length) {
    compareTray = loaded;
    saveCompareTray();
    renderCompareTrayBar();
    openCompareOverlay();
  } else {
    toast("That shared comparison isn't available anymore.");
  }
}

const COMPARE_PHOTO_ROUTE = { augmented_home: 'augmented-home-photos', green_home: 'green-home-photos' };

function compareColumnHtml(item) {
  const photoId = item.photoIds && item.photoIds[0];
  const imgSrc = photoId ? `/api/${COMPARE_PHOTO_ROUTE[item.compareKind]}/${photoId}` : propertyArtUrl(item.propertyType, item.id);
  const features = item.compareKind === 'augmented_home'
    ? (item.adaptations || []).map(adaptationLabel)
    : (item.greenFeatures || []).map(greenFeatureLabel);
  return `
    <div class="compare-column">
      <button type="button" class="link-btn danger" data-action="remove-compare" data-kind="${item.compareKind}" data-id="${item.id}">✕ Remove</button>
      <img class="directory-thumb" src="${imgSrc}" alt="${escapeHtml(photoId ? homePhotoAlt(item) : 'Illustrative photo, not this home')}" loading="lazy">
      <h4>${escapeHtml(item.title || item.propertyType)}</h4>
      <p class="tiny">${escapeHtml(item.city)}, ${escapeHtml(item.state)}</p>
      <p><strong>${money(item.askingPrice)}</strong>${pricePerSqftLabel(item.askingPrice, item.sqft)}</p>
      ${sparklineHtml(item.priceSeries)}
      <p class="tiny">${item.beds}bd/${item.baths}ba${item.sqft ? ` · ${item.sqft.toLocaleString('en-US')} sqft` : ''}</p>
      <p class="tiny">${daysOnMarketLabel(item.createdAt)}</p>
      <p class="tiny">${features.map(l => `<span class="badge badge-gold">${escapeHtml(l)}</span>`).join(' ')}</p>
    </div>
  `;
}

function openCompareOverlay() {
  const grid = document.getElementById('compareGrid');
  grid.innerHTML = compareTray.length
    ? compareTray.map(compareColumnHtml).join('')
    : '<div class="empty-state">Nothing to compare yet.</div>';
  document.getElementById('compareOverlay').classList.remove('hidden');
}

function closeCompareOverlay() {
  document.getElementById('compareOverlay')?.classList.add('hidden');
}

/* ---------------- Global search ---------------- */
const SEARCH_KIND_LABEL = { listing: 'Agent Strategy', augmented_home: 'AugmentedHomes', green_home: 'GreenHomes', dev_project: 'FinderMine' };
let globalSearchTimer = null;

function renderSearchResults(results) {
  const el = document.getElementById('globalSearchResults');
  if (!el) return;
  if (!results.length) {
    el.innerHTML = '<div class="tiny search-empty">No matches.</div>';
    el.classList.remove('hidden');
    return;
  }
  el.innerHTML = results.map(r => `
    <a class="search-result-item" href="${marketEntityHref(r.kind, r.id)}" data-action="open-market-entity" data-link="${escapeHtml(marketEntityHref(r.kind, r.id))}">
      <strong>${escapeHtml(r.title)}</strong>
      <span class="tiny">${escapeHtml(r.city)}, ${escapeHtml(r.state)} · ${SEARCH_KIND_LABEL[r.kind] || r.kind}${r.amount ? ` · ${money(r.amount)}` : ''}</span>
    </a>
  `).join('');
  el.classList.remove('hidden');
}

async function runGlobalSearch(q) {
  const el = document.getElementById('globalSearchResults');
  if (q.trim().length < 2) { el?.classList.add('hidden'); return; }
  try {
    const { results } = await apiGet(`/api/search?q=${encodeURIComponent(q.trim())}`);
    renderSearchResults(results);
  } catch { /* non-critical, just don't show results */ }
}

async function loadMarketPulse() {
  clearTimeout(marketPulseTimer);
  const trackEl = document.getElementById('marketTickerTrack');
  const listEl = document.getElementById('marketEventsList');
  const city = document.getElementById('marketPulseFilterCity')?.value.trim();
  const state = document.getElementById('marketPulseFilterState')?.value.trim();
  const params = new URLSearchParams({ limit: '50' });
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  const exportBtn = document.getElementById('marketPulseExportBtn');
  if (exportBtn) {
    const exportParams = new URLSearchParams();
    if (city) exportParams.set('city', city);
    if (state) exportParams.set('state', state);
    exportBtn.href = `/api/market-events/export.csv${exportParams.toString() ? `?${exportParams.toString()}` : ''}`;
  }
  try {
    const { events, trends, leaderboard } = await apiGet(`/api/market-events?${params.toString()}`);
    renderMarketTrends(trends);
    renderMarketLeaderboard(leaderboard);
    if (events.length === 0) {
      trackEl.innerHTML = '<span class="ticker-item ticker-empty">No market activity yet — list a home or schedule an open house to kick off the feed.</span>';
      listEl.innerHTML = '<div class="empty-state">No market activity yet.</div>';
    } else {
      const tickerHtml = events.map(renderTickerItem).join('');
      // Rendered twice back-to-back so the CSS marquee's translateX(-50%) loop has no visible seam.
      trackEl.innerHTML = tickerHtml + tickerHtml;
      listEl.innerHTML = events.map(renderMarketEventRow).join('');
      // Only count as "seen" when looking at everything -- a city-filtered view shouldn't silently clear
      // the unseen flag for activity elsewhere that this device never actually looked at.
      if (!city && !state) {
        try { localStorage.setItem(MARKET_PULSE_SEEN_KEY, events[0].createdAt); } catch {}
        document.getElementById('marketPulseUnseenDot')?.classList.add('hidden');
      }
    }
  } catch (e) {
    trackEl.innerHTML = `<span class="ticker-item ticker-empty">${escapeHtml(e.message)}</span>`;
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
  if (document.getElementById('tab-marketpulse')?.classList.contains('active')) {
    marketPulseTimer = setTimeout(loadMarketPulse, 20000);
  }
}

function renderPostCard(p) {
  const isMine = currentUser && currentUser.id === p.user_id;
  return `
    <div class="match-card" data-post-id="${p.id}" data-user-id="${p.user_id}">
      <div class="card-agent"><a class="profile-link" href="/profile/${p.user_id}">${escapeHtml(contentAuthorLabel(p.author_name, p.authorAgent))}</a> · ${timeAgo(p.created_at)}</div>
      ${hiddenContentNoteHtml(p, isMine, 'post')}
      <p>${escapeHtml(p.body)}</p>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-action="like" data-id="${p.id}">👍 ${p.like_count}</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-comments" data-id="${p.id}">💬 ${p.comment_count}</button>
        ${isMine
          ? `<button class="btn btn-danger btn-sm" data-action="delete-post" data-id="${p.id}">Delete</button>`
          : `<button class="btn btn-ghost btn-sm" data-action="report-post" data-id="${p.id}">Report</button>
             <button class="btn btn-ghost btn-sm" data-action="block-user" data-id="${p.user_id}" data-name="${escapeHtml(p.author_name)}">Block</button>`}
        ${currentUser && currentUser.role === 'admin' && !isMine && !p.hidden ? `<button class="btn btn-ghost btn-sm" data-action="admin-hide-post" data-id="${p.id}">Hide</button>` : ''}
      </div>
      <div class="comments-block hidden" id="comments-${p.id}">
        <div class="comments-list" id="comments-list-${p.id}"></div>
        <form class="comment-form" data-post-id="${p.id}">
          <input type="text" maxlength="1000" placeholder="Write a comment…" aria-label="Write a comment" required>
          <button type="submit" class="btn btn-ghost btn-sm">Send</button>
        </form>
        <p class="tiny composer-note">${escapeHtml(HOME_TEXT_NOTE)}</p>
      </div>
    </div>
  `;
}

function renderComment(c) {
  const isMine = currentUser && currentUser.id === c.user_id;
  return `
    <div class="side" data-comment-id="${c.id}">
      <strong><a class="profile-link" href="/profile/${c.user_id}">${escapeHtml(contentAuthorLabel(c.author_name, c.authorAgent))}</a></strong> <span class="tiny">${timeAgo(c.created_at)}</span>
      ${hiddenContentNoteHtml(c, isMine, 'comment')}
      <p class="tiny">${escapeHtml(c.body)}</p>
      <button type="button" class="link-btn" data-action="like-comment" data-id="${c.id}">👍 ${c.like_count || 0}</button>
      ${isMine
        ? `<button class="link-btn danger" data-action="delete-comment" data-id="${c.id}">Delete</button>`
        : `<button class="link-btn" data-action="report-comment" data-id="${c.id}">Report</button>`}
      ${c.canHide ? `<button type="button" class="link-btn" data-action="hide-comment" data-id="${c.id}">Hide</button>` : ''}
    </div>
  `;
}

async function renderComments(postId) {
  const { comments } = await apiGet(`/api/posts/${postId}/comments`);
  document.getElementById(`comments-list-${postId}`).innerHTML = comments.map(renderComment).join('') || '<p class="tiny">No comments yet.</p>';
  document.getElementById(`comments-${postId}`).dataset.loaded = '1';
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

    const likeCommentBtn = e.target.closest('[data-action="like-comment"]');
    if (likeCommentBtn) {
      try {
        const { likeCount } = await apiPost(`/api/comments/${likeCommentBtn.dataset.id}/like`);
        likeCommentBtn.textContent = `👍 ${likeCount}`;
      } catch (err) { toast(err.message); }
      return;
    }

    const reportPostBtn = e.target.closest('[data-action="report-post"]');
    if (reportPostBtn) { submitReport('post', reportPostBtn.dataset.id, reportPostBtn); return; }

    const blockBtn = e.target.closest('[data-action="block-user"]');
    if (blockBtn) {
      if (await confirmAndBlock(blockBtn.dataset.id, blockBtn.dataset.name)) {
        container.querySelectorAll(`[data-user-id="${blockBtn.dataset.id}"]`).forEach(el => el.remove());
      }
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
    if (reportCommentBtn) { submitReport('comment', reportCommentBtn.dataset.id, reportCommentBtn); return; }

    // Admins only: hide someone else's post with a reason, or show a hidden post or comment again.
    const adminHidePostBtn = e.target.closest('[data-action="admin-hide-post"]');
    if (adminHidePostBtn) {
      if (await hidePostWithPrompt(adminHidePostBtn.dataset.id)) adminHidePostBtn.closest('[data-post-id]').remove();
      return;
    }
    const unhideBtn = e.target.closest('[data-action="unhide-content"]');
    if (unhideBtn) {
      if (await unhideContentById(unhideBtn.dataset.kind, unhideBtn.dataset.id)) unhideBtn.closest('.hidden-note').remove();
      return;
    }

    const hideCommentBtn = e.target.closest('[data-action="hide-comment"]');
    if (hideCommentBtn) {
      if (await hideCommentWithPrompt(hideCommentBtn.dataset.id)) hideCommentBtn.closest('[data-comment-id]').remove();
      return;
    }

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
    } catch (err) { toastActionError(err); }
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
      <div class="card ${activityAccentClass(l.recent_activity)}">
        <div class="card-head">
          <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
          <span class="badge ${l.status === 'active' ? 'badge-active' : 'badge-paused'}">${l.status}</span>
          ${l.is_buyer_only ? '<span class="badge badge-gold">Buyer</span>' : ''}
          ${l.is_rental ? '<span class="badge badge-gold">For Rent</span>' : ''}
          ${l.is_portfolio ? `<span class="badge badge-gold">Portfolio · ${(l.portfolio_members || []).length}</span>` : ''}
          ${l.bundled_into ? '<span class="badge badge-gold">🔗 Bundled</span>' : ''}
        </div>
        ${activityRibbonHtml(l.recent_activity)}
        <div class="card-agent">${l.client_name ? `Listed for <strong>${escapeHtml(l.client_name)}</strong> · ` : ''}${l.views || 0} view${l.views === 1 ? '' : 's'}${matchCountById ? ` · ${matchCountById.get(l.id) || 0} match${(matchCountById.get(l.id) || 0) === 1 ? '' : 'es'}` : ''} · ${daysOnMarketLabel(l.created_at)}</div>
        ${socialProofHtml(l.favorite_count, l.comment_count)}
        ${(l.is_buyer_only || l.is_portfolio) ? '' : `<div class="photo-gallery" id="gallery-${l.id}"><span class="tiny">Loading photos…</span></div>
        <div class="field">
          <label for="addPhotos-${l.id}">Add photos</label>
          <input type="file" id="addPhotos-${l.id}" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
          <p class="tiny field-hint">${escapeHtml(PHOTO_RIGHTS_NOTE)}</p>
        </div>`}
        <div class="mini-two">
          <div class="mini-block"><span class="label">Has</span>${l.is_portfolio ? `${(l.portfolio_members || []).length} properties` : listingLabel(l)}${l.is_buyer_only ? '' : `<br>${money(l.estimated_value)}${l.is_portfolio ? ' combined' : ''}${pricePerSqftLabel(l.estimated_value, l.sqft)} ${sparklineHtml(l.price_series)}${priceTrendBadge(l.price_series)}`}</div>
          ${l.is_rental
            ? `<div class="mini-block"><span class="label">Rent</span>${money(l.rent_amount)}/mo<br>${l.min_lease_months}-month minimum lease</div>`
            : `<div class="mini-block"><span class="label">Wants</span>${escapeHtml(l.desired_type)} in ${escapeHtml(l.locations)}<br>${money(l.price_min)}–${money(l.price_max)}</div>`}
        </div>
        ${l.is_portfolio ? `<div class="mini-block"><span class="label">Includes</span>${(l.portfolio_members || []).map(m => `${escapeHtml(m.title || m.propertyType)} in ${escapeHtml(m.city)}, ${escapeHtml(m.state)} (${money(m.estimatedValue)})`).join('<br>')}</div>` : ''}
        ${l.bundled_into ? '<p class="tiny">This property is bundled into a portfolio — manage it from that portfolio\'s card.</p>' : ''}
        ${l.hidden_at && l.status !== 'active' ? `<p class="tiny">Paused by Amico Haus: ${escapeHtml(l.hidden_reason || 'a rules problem')}. Questions? Use <a href="/contact">Contact</a>.</p>` : ''}
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
          ${l.hidden_at && l.status !== 'active' ? '' : `<button class="btn btn-ghost btn-sm" data-action="toggle-status" data-id="${l.id}" data-status="${l.status}">${l.status === 'active' ? 'Pause' : 'Reactivate'}</button>`}
          <button class="btn btn-danger btn-sm" data-action="delete-listing" data-id="${l.id}">${l.is_portfolio ? 'Dissolve Portfolio' : 'Delete'}</button>
          `}
          ${!l.is_portfolio && !l.hidden_at ? `<button class="btn btn-ghost btn-sm" data-action="clone-listing" data-id="${l.id}">Duplicate</button>` : ''}
          ${(l.is_buyer_only || l.is_portfolio) ? '' : `<a class="btn btn-ghost btn-sm" href="/listing/${l.id}/flyer" target="_blank" rel="noopener noreferrer">🖨️ Print Flyer</a> <a class="btn btn-ghost btn-sm" href="/api/listings/${l.id}/performance.csv" download>📊 Export Performance</a>`}
        </div>
      </div>
    `).join('');

    for (const l of listings) {
      if (l.is_buyer_only || l.is_portfolio) continue;
      renderPhotoGallery(l.id);
      document.getElementById(`addPhotos-${l.id}`).addEventListener('change', async (e) => {
        const photoResult = await uploadPhotos(`/api/listings/${l.id}/photos`, [...e.target.files]);
        if (photoResult.failed.length) toastWithPhotoResult('', photoResult);
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
    el.innerHTML = offers.length ? `<p class="tiny">${escapeHtml(OFFER_OWNER_NOTE)}</p>` + offers.map(o => `
      <div class="side">
        <strong>${money(o.offerPrice)} — ${o.financingType === 'cash' ? 'Cash' : 'Financed'}</strong>
        <span class="tiny">From <a class="profile-link" href="/profile/${o.buyerUserId}">${escapeHtml(o.buyerName)}</a>${o.buyerLicense ? ` · DRE #${escapeHtml(o.buyerLicense)} on file${o.buyerBrokerage ? ' · ' + escapeHtml(o.buyerBrokerage) : ''}` : ''} · ${reportUserButtonHtml(o.buyerUserId)} · <span class="badge ${o.status === 'accepted' ? 'badge-active' : o.status === 'declined' || o.status === 'withdrawn' ? 'badge-paused' : ''}">${o.status}</span></span>
        ${o.closingTimeline ? `<p class="tiny"><span class="label">Timeline</span> ${escapeHtml(o.closingTimeline)}</p>` : ''}
        ${o.contingencies ? `<p class="tiny"><span class="label">Contingencies</span> ${escapeHtml(o.contingencies)}</p>` : ''}
        ${o.message ? `<p class="tiny">"${escapeHtml(o.message)}"</p>` : ''}
        ${o.status === 'pending' ? `
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="decide-offer" data-listing-id="${listingId}" data-id="${o.id}" data-decision="accept">Accept</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="decide-offer" data-listing-id="${listingId}" data-id="${o.id}" data-decision="decline">Decline</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="message-user" data-id="${o.buyerUserId}" data-name="${escapeHtml(o.buyerName)}">Message</button>
          </div>
          ${offerToolsNoteHtml()}
          <details class="panel">
            <summary>Counter this offer</summary>
            <div class="field"><label for="counterPrice-${o.id}">Counter price ($)</label><input type="number" id="counterPrice-${o.id}" min="1" max="500000000" step="1000"></div>
            <div class="field"><label for="counterMsg-${o.id}">Message (optional)</label><textarea id="counterMsg-${o.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
            <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-offer" data-listing-id="${listingId}" data-id="${o.id}">Send Counter</button></div>
          </details>` : ''}
        ${o.status === 'countered' && o.counteredBy === 'owner' ? `<p class="tiny"><span class="label">Your counter</span> ${money(o.counterPrice)}${o.counterMessage ? ` — "${escapeHtml(o.counterMessage)}"` : ''} · waiting on buyer</p>` : ''}
        ${o.status === 'countered' && o.counteredBy === 'buyer' ? `
          <p class="tiny"><span class="label">Buyer countered</span> ${money(o.counterPrice)}${o.counterMessage ? ` — "${escapeHtml(o.counterMessage)}"` : ''}</p>
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="decide-offer" data-listing-id="${listingId}" data-id="${o.id}" data-decision="accept_counter">Accept ${money(o.counterPrice)}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="decide-offer" data-listing-id="${listingId}" data-id="${o.id}" data-decision="decline_counter">Decline</button>
          </div>
          ${offerToolsNoteHtml()}
          <details class="panel">
            <summary>Counter again</summary>
            <div class="field"><label for="counterPrice-${o.id}">Counter price ($)</label><input type="number" id="counterPrice-${o.id}" min="1" max="500000000" step="1000"></div>
            <div class="field"><label for="counterMsg-${o.id}">Message (optional)</label><textarea id="counterMsg-${o.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
            <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-offer" data-listing-id="${listingId}" data-id="${o.id}">Send Counter</button></div>
          </details>` : ''}
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
      <div class="card clickable" role="button" tabindex="0" data-action="open-group" data-id="${g.id}" data-label="${escapeHtml(g.label)}">
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
  return `${listingLabel(side)} · ${money(side.estimatedValue)} (owner's estimate)${pricePerSqftLabel(side.estimatedValue, side.sqft)}`;
}

// A compact one-liner under each side's price line -- days on market plus a ribbon when something real
// happened recently, without the full card-level treatment list/browse cards get (this card is already
// dense with two listings side by side).
function matchMetaLine(side) {
  if (side.isBuyerOnly || side.isRental) return '';
  const parts = [daysOnMarketLabel(side.createdAt)];
  if (side.favoriteCount) parts.push(`♥ ${side.favoriteCount}`);
  if (side.commentCount) parts.push(`💬 ${side.commentCount}`);
  return `<p class="tiny">${activityRibbonHtml(side.recentActivity)} ${parts.filter(Boolean).join(' · ')}</p>`;
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
  const otherLine = matchLine(other);
  const mineLine = matchLine(mine);
  const topBadge = m.isBuyerMatch
    ? '<span class="badge badge-gold">Buyer</span>'
    : (m.isRentalMatch
      ? '<span class="badge badge-gold">Rental</span>'
      : ((mine.isPortfolio || other.isPortfolio) ? '<span class="badge badge-gold">Portfolio</span>' : ''));
  const scorePill = `<span class="score-pill" title="${scoreTitle}">${Math.round((m.scoreAWantsB + m.scoreBWantsA) / 2)}% match</span>`;
  const goneQuietNote = m.goneQuiet
    ? `<p class="tiny gone-quiet-nudge">👋 Nobody's reached out yet — say hello to ${escapeHtml(other.owner)}?</p>`
    : '';
  return `
    <div class="match-card">
      <div class="match-top">
        ${scorePill}
        ${topBadge}
      </div>
      <div class="match-pair">
        <div class="side"><img class="side-thumb" src="${propertyArtUrl(mine.propertyType, mine.listingId)}" alt=""><h4><a class="profile-link" href="/profile/${mine.userId}">${escapeHtml(mine.owner)}</a></h4><p class="tiny">${mineLine}</p>${matchMetaLine(mine)}${renderLifeEventTags(mine.lifeEventTags)}</div>
        <div class="swap-icon">${(m.isBuyerMatch || m.isRentalMatch) ? '→' : '⇄'}</div>
        <div class="side"><img class="side-thumb" src="${propertyArtUrl(other.propertyType, other.listingId)}" alt=""><h4><a class="profile-link" href="/profile/${other.userId}">${escapeHtml(other.owner)}</a></h4><p class="tiny">${otherLine}</p>${matchMetaLine(other)}${renderLifeEventTags(other.lifeEventTags)}</div>
      </div>
      ${m.isRentalMatch ? '<p class="tiny match-disclaimer">Lease terms are negotiated directly between the two of you. Want to run your own numbers? Try the <a href="/calculator" target="_blank" rel="noopener">rent calculator</a>.</p>' : ''}
      ${goneQuietNote}
      ${renderBreakdownSection(m)}
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="message-user" data-id="${other.userId}" data-name="${escapeHtml(other.owner)}">Message ${escapeHtml(other.owner)}</button>
        ${(!m.isBuyerMatch && !m.isRentalMatch) ? `<button type="button" class="btn btn-ghost btn-sm" data-action="open-to-bids" data-a="${mine.listingId}" data-b="${other.listingId}" title="Bring in approved agents to propose on finalizing this trade">Open to Agent Bids</button>` : ''}
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
    <div class="card ${activityAccentClass(l.recent_activity)}" data-listing-id="${l.id}">
      <div class="directory-thumb-wrap">
        <img class="directory-thumb" src="${l.photo_id ? `/api/photos/${l.photo_id}` : propertyArtUrl(l.property_type, l.id)}" alt="${escapeHtml(l.photo_id ? homePhotoAlt({ propertyType: l.property_type, city: l.city }) : 'Illustrative photo, not this home')}" loading="lazy">
        ${activityRibbonHtml(l.recent_activity)}
      </div>
      ${l.photo_id ? '' : '<span class="photo-caption">Illustrative photo</span>'}
      <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
      <div class="card-agent">${escapeHtml(l.owner_name)}</div>
      <div class="mini-block">${listingLabel(l)} · ${money(l.estimated_value)} <span class="tiny">(owner's estimate)</span>${pricePerSqftLabel(l.estimated_value, l.sqft)}</div>
      <p class="tiny">${daysOnMarketLabel(l.created_at)}</p>
      ${socialProofHtml(l.favorite_count, l.comment_count)}
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
        ${escapeHtml(savedSearchLabel(s))}${savedSearchTimingHtml(s)}
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
    list.innerHTML = conversations.length ? conversations.map(c => {
      // An agent's DRE number and brokerage sit right under their name (California DRE rule).
      const creds = c.otherAgent ? agentCredentialsLine(c.otherAgent.licenseNumber, c.otherAgent.brokerageName) : '';
      return `
      <div class="card conversation-item" role="button" tabindex="0" data-action="open-conversation" data-id="${c.id}" data-name="${escapeHtml(c.other_name)}" data-user-id="${c.other_user_id}">
        <h3><a class="profile-link" href="/profile/${c.other_user_id}">${escapeHtml(c.other_name)}</a>${c.unread_count > 0 ? '<span class="unread-dot"></span>' : ''}${c.blockedByMe ? ' <span class="badge badge-paused">Blocked</span>' : ''}</h3>
        ${creds ? `<p class="tiny agent-id-line">${escapeHtml(creds)}</p>` : ''}
        <p class="tiny">${c.last_message ? escapeHtml(c.last_message) : 'No messages yet.'}</p>
      </div>
    `;
    }).join('') : '<div class="empty-state">No conversations yet — message someone from your Matches tab.</div>';
  } catch (e) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function openConversation(id, name, otherUserId) {
  document.getElementById('conversationList').classList.add('hidden');
  const thread = document.getElementById('messageThread');
  thread.classList.remove('hidden');
  thread.dataset.conversationId = id;
  thread.dataset.otherUserId = otherUserId || '';
  thread.dataset.otherName = name || '';
  document.getElementById('threadTitle').textContent = name;
  // Cleared first so the last thread's identity line or Quiet-mode note never shows on this one while it loads.
  setThreadIdentity(null);
  setComposerMode('open');
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

// The other person's DRE number and brokerage under the thread title, when they're an agent.
function setThreadIdentity(other) {
  const el = document.getElementById('threadIdentity');
  if (!el) return;
  const line = other && other.agent ? agentCredentialsLine(other.agent.licenseNumber, other.agent.brokerageName) : '';
  const creds = line && other.agent.isPlatformOperator ? `${line} · ${PLATFORM_OPERATOR_LABEL}` : line;
  el.textContent = creds;
  el.classList.toggle('hidden', !creds);
}

// How the other person takes agent messages, as it applies to this viewer: 'open' (as usual), 'weekly' (delivered
// together Sunday morning) or 'quiet' (no agent messages: the composer is switched off with a pointer to opinions and
// proposals, which still reach them right away).
// 'weekly_held': Weekly, and this week's one message is already waiting for Sunday, so a second would be refused.
const COMPOSER_NOTES = {
  weekly: 'This homeowner reads agent messages once a week. Your message will be delivered Sunday morning.',
  weekly_held: CONTACT_ERROR_COPY.weekly_limit,
  quiet: 'This homeowner has chosen Quiet mode. Send a price opinion or a proposal instead.',
};
// 'blocked': you blocked this person, so the composer is off with a one-tap Unblock (their side never says so).
function setComposerMode(mode) {
  const note = document.getElementById('threadComposerNote');
  const form = document.getElementById('messageForm');
  if (!note || !form) return;
  if (mode === 'blocked') {
    const name = document.getElementById('messageThread').dataset.otherName || 'this person';
    note.innerHTML = `You blocked ${escapeHtml(name)}. <button type="button" class="link-btn" data-action="thread-unblock">Unblock</button>`;
    note.classList.remove('hidden');
  } else {
    const text = COMPOSER_NOTES[mode] || '';
    note.textContent = text;
    note.classList.toggle('hidden', !text);
  }
  const off = mode === 'quiet' || mode === 'weekly_held' || mode === 'blocked';
  form.querySelectorAll('input, button').forEach(el => { el.disabled = off; });
  form.classList.toggle('composer-off', off);
  const blockBtn = document.getElementById('threadBlockBtn');
  if (blockBtn) blockBtn.classList.toggle('hidden', mode === 'blocked' || !document.getElementById('messageThread').dataset.otherUserId);
  const reportBtn = document.getElementById('threadReportBtn');
  if (reportBtn) reportBtn.classList.toggle('hidden', !document.getElementById('messageThread').dataset.otherUserId);
}

async function renderMessages(conversationId) {
  const { messages, other } = await apiGet(`/api/conversations/${conversationId}/messages`);
  // The user may have opened another thread while this one loaded.
  if (String(document.getElementById('messageThread').dataset.conversationId) !== String(conversationId)) return;
  setThreadIdentity(other);
  const mode = other && other.deliveryMode ? other.deliveryMode : 'open';
  const heldMine = messages.some(m => m.sender_id === currentUser.id && m.deliverAfter);
  setComposerMode(other && other.blockedByMe ? 'blocked' : mode === 'weekly' && heldMine ? 'weekly_held' : mode);
  document.getElementById('messageList').innerHTML = messages.map(m => `
    <div class="side ${m.sender_id === currentUser.id ? 'mine' : ''}${m.deliverAfter ? ' held' : ''}">
      <p class="tiny">${escapeHtml(m.body)}</p>
      <span class="tiny">${timeAgo(m.created_at)}${m.deliverAfter && m.sender_id === currentUser.id ? ` · <span class="held-label">${escapeHtml(heldDeliveryLabel(m.deliverAfter))}</span>` : ''}</span>
    </div>
  `).join('') || '<p class="tiny">No messages yet — say hello.</p>';
}

async function startConversationWith(userId, name) {
  try {
    const { id } = await apiPost('/api/conversations', { userId: Number(userId) });
    goToTab('messages');
    await openConversation(id, name, userId);
  } catch (err) { toast(contactErrorMessage(err), { durationMs: 7000 }); }
}

// What to say after a message goes out: a held (Weekly mode) message waits for Sunday morning.
function sentMessageToast(result) {
  if (result && result.held) toast('Sent. It will be delivered Sunday morning.', { durationMs: 5000 });
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
// Uploads each chosen photo, one at a time, and collects the ones that didn't make it, so the "posted"
// message can say "3 of 4 photos uploaded" (a separate failure toast used to be covered by the success
// one a moment later). apiUpload in client.js shrinks big phone photos first.
async function uploadPhotos(path, files) {
  const failed = [];
  for (const file of files) {
    const formData = new FormData();
    formData.append('photo', file);
    try { await apiUpload(path, formData); }
    catch (err) { failed.push(`${file.name} (${err.message})`); }
  }
  return { total: files.length, failed };
}

// The success message, plus which photos didn't upload, left up long enough to read when something did.
function toastWithPhotoResult(message, { total, failed }) {
  if (!failed.length) { toast(message); return; }
  const summary = `${total - failed.length} of ${total} photos uploaded. Didn't upload: ${failed.join(', ')}.`;
  toast(message ? `${message} ${summary}` : summary, { durationMs: 12000 });
}

// '#control': the You're in Control settings (contact dial, quiet hours, phone privacy), linked from profile pages.
const AGENT_TAB_HASHES = { '#post-home': 'postHomeWrap', '#become-agent': 'becomeAgentWrap', '#find-agent': 'agentDirectoryWrap', '#control': 'youreInControl' };

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
  const m = /#(pre-listing|transaction|messages|agent|augmented-home|dev-project|green-home)-(\d+)$/.exec(link || '');
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
  // The weekly delivery notice ("Your weekly agent messages are here") points at the Messages tab as a whole.
  if (hash === '#messages') {
    goToTab('messages');
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
  if (target.kind === 'green-home') { goToTab('greenhomes'); openGreenHomeDetail(target.id); return true; }
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

/* ---------------- Blocking and reports ---------------- */
// A small "Block" button on an agent's proposal, price opinion, showing request or interview card (owner's view).
// Handled by the detail view's click listener, which calls confirmAndBlock and redraws.
function blockButtonHtml(userId, name) {
  if (!userId) return '';
  return `<button type="button" class="btn btn-ghost btn-sm" data-action="block-agent" data-id="${Number(userId)}" data-name="${escapeHtml(name || '')}">Block</button>`;
}

// Asks first, then blocks (POST /api/blocks). true once blocked. A block works both ways for contact, and the
// blocked person is never told.
async function confirmAndBlock(userId, name) {
  if (!userId || !confirm(blockConfirmText(name))) return false;
  try {
    await apiPost('/api/blocks', { userId: Number(userId) });
    toast(`Blocked ${name || 'them'}. You can unblock anytime in Account › Blocked Users.`, { durationMs: 5000 });
    return true;
  } catch (err) { toastActionError(err); return false; }
}

// "Report" on a person (an offer's buyer, a seller, an agent's proposal or price opinion): opens the same inline
// report form inside its own host. Handled by the document-level click listener below.
function reportUserButtonHtml(userId) {
  if (!userId) return '';
  return `<span data-report-host><button type="button" class="link-btn" data-action="report-user" data-id="${Number(userId)}">Report</button></span>`;
}

// "Report" on a post or comment opens a short form right under it (a reason preset plus optional details).
function submitReport(targetType, targetId, anchor) {
  const host = anchor && anchor.closest('[data-report-host], [data-comment-id], [data-post-id]');
  if (!host) return;
  const open = host.querySelector(':scope > .inline-report');
  if (open) { open.remove(); return; }
  host.insertAdjacentHTML('beforeend', inlineReportFormHtml(targetType, targetId));
}

async function sendInlineReport(btn) {
  const box = btn.closest('.inline-report');
  if (!box) return;
  const preset = box.querySelector('.report-reason').value;
  const details = box.querySelector('.report-details').value.trim();
  if (!preset && !details) { toast('Say what the problem is, then send.'); box.querySelector('.report-details').focus(); return; }
  btn.disabled = true;
  try {
    await apiPost('/api/reports', reportPayload(box.dataset.targetType, box.dataset.targetId, preset, details));
    box.innerHTML = '<p class="tiny">Report sent. Thank you.</p>';
  } catch (err) { btn.disabled = false; toastActionError(err); }
}

document.addEventListener('click', e => {
  const reportUser = e.target.closest('[data-action="report-user"]');
  if (reportUser) { if (reportUser.dataset.id) submitReport('user', reportUser.dataset.id, reportUser); return; }
  const send = e.target.closest('[data-action="send-report"]');
  if (send) { sendInlineReport(send); return; }
  const cancel = e.target.closest('[data-action="cancel-report"]');
  if (cancel) cancel.closest('.inline-report')?.remove();
});

// What someone who isn't an approved agent sees of an open pre-listing: place, type, size and price only.
function preListingTeaserNoteHtml() {
  return `<p class="form-note teaser-note">${escapeHtml(PRE_LISTING_TEASER_NOTE)} <a href="/app#post-home" data-action="goto-post-home">Post yours free.</a></p>`;
}

function preListingTeaserCardHtml(p, isNewSinceLastVisit = false, timingFits = false) {
  const price = isPriceOpen(p) ? `<span class="price-open">${PRICE_OPEN_LABEL}</span>` : `${money(p.askingPrice)} asking`;
  return `
      <div class="card teaser-card">
        <div class="card-head">
          <h3>${escapeHtml(p.propertyType)} in ${escapeHtml(p.city)}</h3>
          <span class="card-badges"><span class="badge badge-gold">Pre-Listing</span>${isNewSinceLastVisit ? '<span class="badge badge-active">New</span>' : ''}${timingFits ? timingFitsBadgeHtml() : ''}</span>
        </div>
        <div class="mini-block">${Number(p.beds) || 0}bd/${Number(p.baths) || 0}ba · ${escapeHtml(p.city)}, ${escapeHtml(p.state)} ${escapeHtml(p.zip || '')}<br>${price}</div>
        <p class="tiny">${daysOnMarketLabel(p.createdAt)}</p>
      </div>`;
}

const TRADE_OPEN_CONFIRM = 'Open this trade to proposals from approved agents? Your trade partner confirms it first, and you can always keep using an agent you already know instead.';
// After POST /api/transactions: agents see the request only once the other partner confirms it.
function tradeOpenedToast(partnerConfirmed) {
  toast(partnerConfirmed
    ? 'Trade request confirmed. Approved agents who serve your area can now send proposals.'
    : 'Sent to your trade partner to confirm. Agents see it once they do.');
}
const AGENT_RULES_VERSION = '2026-11-04';
const TRADE_CONFIRM_TEXT = "Confirm this trade request? Approved agents who serve your area can then see it and send proposals. One agent for both homes, or two agents under the same brokerage, is dual agency and needs both owners' written consent; each of you can choose your own agent.";

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
      // Some recordings don't report a length; then only the server's size limit applies.
      if (Number.isFinite(video.duration) && video.duration > maxSeconds) {
        reject(new Error(`Video must be ${Math.round(maxSeconds / 60)} minutes or under (this one is about ${Math.round(video.duration)}s).`));
      } else {
        resolve();
      }
    };
    video.onerror = () => { URL.revokeObjectURL(video.src); resolve(); }; // best effort: the server's size limit still applies
    video.src = URL.createObjectURL(file);
  });
}

// What an approved agent can still add to their profile, most valuable first. Homeowners compare agents on these,
// so a fuller profile wins more proposals; agents who used the 3-minute apply see what's left.
function agentProfileProgress(profile, photos, packages, caseStudies) {
  const steps = [
    { done: !!profile.bio, label: 'a short bio' },
    { done: (profile.services || []).length > 0, label: 'the services you include' },
    { done: !!profile.hasVideo, label: 'an intro video' },
    { done: (photos || []).length > 0, label: 'portfolio photos' },
    { done: (packages || []).length > 0, label: 'a service package' },
    { done: (caseStudies || []).length > 0, label: 'a case study' },
    { done: !!profile.yearsExperience, label: 'your years of experience' },
    { done: (profile.specialtyTags || []).length > 0, label: 'your specialties' },
  ];
  const done = steps.filter(s => s.done).length;
  const missing = steps.filter(s => !s.done).map(s => s.label);
  const pct = Math.round((done / steps.length) * 100);
  return `
    <div class="profile-progress" role="group" aria-label="Profile completeness">
      <div class="progress-bar"><span class="progress-fill progress-${Math.round(pct / 10) * 10}"></span></div>
      <p class="tiny"><strong>Profile ${pct}% complete.</strong> ${missing.length ? `Next: add ${escapeHtml(missing.slice(0, 2).join(' and '))}. Homeowners compare agents on these.` : 'Everything homeowners compare is filled in. Nice!'}</p>
    </div>`;
}

// Posting a home for a client and bulk upload are for approved agents only (Y1; the server refuses them too).
function applyAgentOnlyListingTools() {
  const ok = !!currentAgentProfile && currentAgentProfile.status === 'approved';
  document.getElementById('bulkUploadWrap')?.classList.toggle('hidden', !ok);
  document.getElementById('clientNameField')?.classList.toggle('hidden', !ok);
  if (!ok) { const input = document.getElementById('clientName'); if (input) input.value = ''; }
}
function isApprovedAgentNow() {
  return !!currentAgentProfile && currentAgentProfile.status === 'approved';
}
// loadAgentStatus only runs on the marketplace tab, so the listing form asks once at boot.
async function primeAgentListingTools() {
  if (!currentAgentProfile) {
    try {
      const { profile } = await apiGet('/api/agents/me');
      if (!currentAgentProfile) currentAgentProfile = profile || null;
    } catch { /* signed out or offline: the tools stay hidden */ }
  }
  applyAgentOnlyListingTools();
}

async function loadAgentStatus() {
  try { await loadAgentStatusInner(); } finally { applyAgentOnlyListingTools(); }
}
async function loadAgentStatusInner() {
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
      prefillClaimedZip([]);
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
    // Already agreed to this version of the agent rules: no need to tick it again on a profile edit.
    document.getElementById('agentAcceptRules').checked = profile.rulesVersion === AGENT_RULES_VERSION;
    ['agentZip1', 'agentZip2', 'agentZip3', 'agentZip4'].forEach((id, i) => {
      document.getElementById(id).value = profile.serviceZips[i] || '';
    });
    prefillClaimedZip(profile.serviceZips);

    if (profile.status === 'pending') {
      statusEl.innerHTML = '<p class="tiny">⏳ Your application is being reviewed. You\'ll get an email and a notification here as soon as it\'s decided.</p>';
      summaryEl.textContent = 'Agent application — pending review';
      toolsSection.classList.add('hidden');
    } else if (profile.status === 'rejected') {
      statusEl.innerHTML = `<p class="tiny">Your application wasn't approved${profile.rejectionReason ? `: ${escapeHtml(profile.rejectionReason)}` : '.'} Edit and resubmit below.</p>`;
      summaryEl.textContent = 'Agent application — not approved, edit & resubmit';
      toolsSection.classList.add('hidden');
    } else {
      statusEl.innerHTML = '<p class="tiny">✅ You\'re an approved agent — edit your profile any time below.</p>' + agentProfileProgress(profile, photos, packages, caseStudies);
      summaryEl.textContent = 'My agent application (approved)';
      toolsSection.classList.remove('hidden');
      loadAgentGrowth();
      document.getElementById('agentPortfolioGallery').innerHTML = photos.length
        ? photos.map(p => `<div class="photo-thumb"><img src="/api/agent-photos/${p.id}" alt="Your portfolio photo" loading="lazy"><button type="button" class="photo-delete" data-action="delete-agent-photo" data-id="${p.id}">✕</button></div>`).join('')
        : '<span class="tiny">No portfolio photos yet.</span>';

      const videoWrap = document.getElementById('agentVideoPreviewWrap');
      videoWrap.innerHTML = profile.hasVideo
        ? `<video controls preload="none" class="media-video" src="/api/agent-video/${profile.userId}"></video><button type="button" class="btn btn-danger btn-sm mt-8" data-action="remove-agent-video">Remove Video</button>`
        : '<p class="tiny">No intro video yet.</p>';

      document.getElementById('agentStatsPanel').innerHTML = renderAgentStatsPanel(stats);
      apiGet('/api/agents/my-bids').then(({ bids }) => {
        const pendingCount = (bids || []).filter(b => b.status === 'pending').length;
        document.getElementById('agentStatsPanel').innerHTML = renderAgentStatsPanel(stats, pendingCount);
      }).catch(() => { /* stats panel already shows without the pipeline tile */ });
      loadAgentReferral();
      loadMyTeam();

      const licenseWrap = document.getElementById('agentLicensePhotoWrap');
      licenseWrap.innerHTML = profile.hasLicensePhoto
        ? `<img src="/api/license-photos/${profile.userId}" alt="License photo" class="media-photo">
           <p class="tiny">Saved. Homeowners see your license as "${escapeHtml(licenseOnFileLabel(profile.licenseNumber))}". <a href="${escapeHtml(dreLookupUrl(profile.licenseNumber))}" target="_blank" rel="noopener noreferrer">Check current status</a></p>
           <button type="button" class="btn btn-danger btn-sm" data-action="remove-license-photo">Remove</button>`
        : '<p class="tiny">No license photo (optional).</p>';

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

// The facts line on a pre-listing card (the owner's list and the browse grid): type, beds/baths, place and price.
// A home posted without a price reads "Open to price opinions" instead of "$0 asking".
function preListingFactsHtml(p, { zip = '' } = {}) {
  const price = isPriceOpen(p)
    ? `<span class="price-open">${PRICE_OPEN_LABEL}</span>`
    : `${money(p.askingPrice)} asking${pricePerSqftLabel(p.askingPrice, p.sqft)} ${priceTrendBadge(p.priceSeries)}`;
  return `${sparklineHtml(p.priceSeries)}${escapeHtml(p.propertyType)} · ${p.beds}bd/${p.baths}ba in ${escapeHtml(p.city)}, ${escapeHtml(p.state)} ${escapeHtml(zip)}<br>${price}`;
}

// "New proposals paused" (the owner paused new proposals; agents who already sent one can still update it).
function pausedBadgeHtml(p) {
  return p && p.proposalsPaused && p.status === 'open' ? '<span class="badge badge-paused">New proposals paused</span>' : '';
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
          <span class="card-badges">${pausedBadgeHtml(p)}<span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${p.status}</span></span>
        </div>
        <div class="mini-block">${preListingFactsHtml(p, { zip: p.zip || '' })}</div>
        <p class="tiny">${daysOnMarketLabel(p.createdAt)}</p>
        <p class="tiny"><span class="badge ${p.occupancyStatus === 'vacant' ? 'badge-gold' : ''}">${p.occupancyStatus === 'vacant' ? 'Vacant' : 'Occupied'}</span></p>
        <p class="tiny">${voteSummary(p.votes, 'Votes', p.status, { priceOpen: isPriceOpen(p) })}</p>
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
        ? (target ? `${escapeHtml(target.title || target.propertyType)} — ${escapeHtml(target.city)}, ${escapeHtml(target.state)} (${askingPriceLabel(target)})` : 'Pre-listing removed')
        : (target ? `Transaction #${target.id}` : 'Transaction removed');
      // Only pre-listings have one clear homeowner to check in with — a transaction has two trade partners, so
      // the check-in button is scoped to the case where "who do I message" isn't ambiguous.
      const checkInTarget = b.isStale && b.requestType === 'pre_listing' && b.preListing ? b.preListing.userId : null;
      return `
        <div class="side">
          <strong>${label}</strong>
          <span class="tiny">Your proposal: ${b.commissionPct ? `${b.commissionPct}% commission` : ''}${b.commissionPct && b.flatFee ? ' + ' : ''}${b.flatFee ? money(b.flatFee) + ' flat' : ''} · <span class="badge ${b.status === 'accepted' ? 'badge-active' : b.status === 'declined' ? 'badge-paused' : ''}">${b.status}</span></span>
          ${b.isStale ? '<span class="tiny gone-quiet-nudge">Still pending after a while — maybe follow up with the homeowner.</span>' : ''}
          ${b.finalistFeedback && b.finalistFeedback.length ? `<span class="tiny">You were a finalist. What tipped the homeowner's decision: ${b.finalistFeedback.map(escapeHtml).join(', ')}.</span>` : ''}
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
    const [{ preListings, timingFitIds }, { transactions }] = await Promise.all([
      apiGet(`/api/pre-listings?${params.toString()}`),
      apiGet('/api/transactions'),
    ]);
    // Anyone who isn't an approved agent gets a short teaser per open pre-listing (no photos, owner or votes) and a
    // pointer to post their own; only approved local agents can open one.
    const teaserMode = preListings.some(p => p.teaser);
    document.getElementById('openRequestsTeaserNote').classList.toggle('hidden', !teaserMode);
    document.getElementById('marketOnlyInArea').closest('.checkbox-row').classList.toggle('hidden', teaserMode);
    const onlyInArea = !teaserMode && document.getElementById('marketOnlyInArea').checked;
    const filteredPreListings = onlyInArea ? preListings.filter(p => p.inServiceArea) : preListings;
    // Pre-listings whose owner's timing fits one of this member's saved-search move-in windows (ids only).
    const fits = new Set(timingFitIds || []);

    // "New since your last visit" — per-device only (never shared, never read by the server), same spirit as
    // remembering the last tab. Read before overwriting, so this visit's count reflects the *previous* visit,
    // not itself; a first-ever visit has nothing to compare against, so nothing is marked new.
    let lastVisit = null;
    try { lastVisit = localStorage.getItem('ah_browse_last_visit'); } catch {}
    const isNew = p => lastVisit && new Date(p.createdAt + 'Z').getTime() > new Date(lastVisit).getTime();
    const newCount = lastVisit ? filteredPreListings.filter(isNew).length : 0;
    try { localStorage.setItem('ah_browse_last_visit', new Date().toISOString()); } catch {}

    const plCards = filteredPreListings.map(p => p.teaser ? preListingTeaserCardHtml(p, isNew(p), fits.has(p.id)) : `
      <div class="card">
        <div class="card-head">
          <h3>${escapeHtml(p.title || p.propertyType)}</h3>
          <span class="card-badges">${pausedBadgeHtml(p)}<span class="badge badge-gold">Pre-Listing</span>${isNew(p) ? '<span class="badge badge-active">New</span>' : ''}${fits.has(p.id) ? timingFitsBadgeHtml() : ''}</span>
        </div>
        <div class="mini-block">${preListingFactsHtml(p, { zip: p.zip })}</div>
        <p class="tiny">${daysOnMarketLabel(p.createdAt)}</p>
        <p class="tiny">
          <span class="badge ${p.occupancyStatus === 'vacant' ? 'badge-gold' : ''}">${p.occupancyStatus === 'vacant' ? 'Vacant' : 'Occupied'}</span>
          ${p.distanceMiles !== null ? ` · <span class="badge ${p.inServiceArea ? 'badge-active' : 'badge-paused'}">${p.inServiceArea ? `${p.distanceMiles} mi — in your area` : `${p.distanceMiles} mi — outside your area`}</span>` : ''}
        </p>
        <p class="tiny">${voteSummary(p.votes, 'Votes', p.status, { priceOpen: isPriceOpen(p) })}</p>
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
  renderPostFormDial();
  loadControlPanel();
}

/* ---------------- You're in Control: contact dial, quiet hours, phone privacy ---------------- */
// Person-level settings (GET/PUT /api/contact-settings): how agents can message you, quiet hours for emails and
// phone alerts, and whether your phone number shows publicly. The panel sits under My Pre-Listings; the post form
// carries the dial too, so it's chosen right when a home goes up.
let contactSettings = null; // { contactMode, quietStart, quietEnd, phonePublic, hasPhone } once loaded

function currentContactMode() {
  return contactSettings && CONTACT_MODE_LABELS[contactSettings.contactMode] ? contactSettings.contactMode : 'open';
}

function contactDialHtml(name, mode) {
  const choices = Object.entries(CONTACT_MODE_LABELS).map(([key, label]) => {
    const [lead, rest] = label.split(' — ');
    return `<label class="choice"><input type="radio" name="${name}" value="${key}"${key === mode ? ' checked' : ''}><span><strong>${escapeHtml(lead)}</strong> — ${escapeHtml(rest)}</span></label>`;
  }).join('');
  return `
    <fieldset class="contact-dial">
      <legend>How can agents reach you?</legend>
      <p class="tiny">You decide. Your phone number and exact address stay private until you tap Share on an agent you like. Rudy Flores, who runs Amico Haus and is also an agent, gets your name and email when you post so he can run the site, and doesn't use them to contact you about your home unless you share with him (<a href="/privacy">Privacy</a>).</p>
      <div class="dial-choices">${choices}</div>
    </fieldset>`;
}

function selectedDialMode(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el && CONTACT_MODE_LABELS[el.value] ? el.value : null;
}

// The post form's dial starts at the person's saved choice; a choice already made in the form is never overwritten
// (force: after posting, when the form is cleared).
function renderPostFormDial(force = false) {
  const el = document.getElementById('plContactDial');
  if (!el || (!force && el.dataset.touched === '1')) return;
  el.dataset.touched = '';
  el.innerHTML = contactDialHtml('plContactMode', currentContactMode());
}

const CONTACT_MODE_SUMMARY = {
  open: 'Agents can message you anytime.',
  weekly: 'Agent messages arrive together on Sunday morning, one per agent.',
  quiet: 'Quiet mode: agents reach you through price opinions and proposals.',
};
const CONTACT_MODE_SAVED = {
  open: 'Saved. Agents can message you anytime.',
  weekly: 'Saved. Agent messages will arrive together on Sunday mornings.',
  quiet: 'Saved. Agents will reach you through price opinions and proposals.',
};

function controlSummaryHtml(s) {
  const quiet = s.quietStart && s.quietEnd
    ? `${quietHoursLabel(s.quietStart, s.quietEnd)} Pacific. Emails and phone alerts wait until then.`
    : 'None set: emails and phone alerts arrive anytime.';
  const phone = !s.hasPhone ? 'No phone number on your profile.' : s.phonePublic ? 'Shows on your public profile and listings.' : 'Private.';
  return `
    <ul class="control-summary">
      <li><strong>Messages:</strong> ${escapeHtml(CONTACT_MODE_SUMMARY[currentContactMode()])}</li>
      <li><strong>Quiet hours:</strong> ${escapeHtml(quiet)}</li>
      <li><strong>Phone number:</strong> ${escapeHtml(phone)}</li>
    </ul>`;
}

function renderControlPanel() {
  const el = document.getElementById('controlPanel');
  if (!el || !contactSettings) return;
  const s = contactSettings;
  const hasQuiet = !!(s.quietStart && s.quietEnd);
  const isAgent = !!currentAgentProfile && currentAgentProfile.status === 'approved';
  el.innerHTML = `
    <div class="panel control-panel">
      ${controlSummaryHtml(s)}
      ${contactDialHtml('controlContactMode', currentContactMode())}
      <div class="control-section">
        <h3>Quiet hours</h3>
        <p class="tiny">Emails and phone alerts wait until your quiet hours end. In-app alerts still arrive right away. Times are Pacific.</p>
        ${isAgent ? '<p class="tiny">Set on-duty hours as an agent? Those decide when your emails arrive; quiet hours apply when no on-duty hours are set.</p>' : ''}
        <div class="form-row two-col">
          <div class="field"><label for="quietStart">From</label><input type="time" id="quietStart" value="${escapeHtml(s.quietStart || '')}"></div>
          <div class="field"><label for="quietEnd">Until</label><input type="time" id="quietEnd" value="${escapeHtml(s.quietEnd || '')}"></div>
        </div>
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-control-action="save-quiet">Save quiet hours</button>
          <button type="button" class="btn btn-ghost btn-sm" data-control-action="clear-quiet"${hasQuiet ? '' : ' disabled'}>Clear</button>
        </div>
      </div>
      <div class="control-section">
        <label class="checkbox-row"><input type="checkbox" id="phonePublicToggle"${s.phonePublic && s.hasPhone ? ' checked' : ''}${s.hasPhone ? '' : ' disabled'}><span>Show my phone number on my public profile and listings<br><span class="tiny">Off by default. When it's off, people reach you through Amico Haus messages.</span></span></label>
        ${s.hasPhone ? '' : `<p class="tiny"><a href="/profile.html?id=${Number(currentUser && currentUser.id) || ''}">Add a phone number on your profile first</a></p>`}
      </div>
    </div>`;
}

async function loadControlPanel() {
  const el = document.getElementById('controlPanel');
  try {
    contactSettings = await apiGet('/api/contact-settings');
    renderControlPanel();
  } catch (e) {
    if (el) el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
  renderPostFormDial();
}

// Saves one change and redraws from what the server says is saved, so a change that didn't save springs back.
// Keyboard focus comes back to the same control after the redraw (on the dial: the saved choice), and the dial's
// radios stay enabled while a dial choice saves, so arrowing through Open / Weekly / Quiet keeps working.
async function saveContactSettings(changes, savedMessage) {
  const panel = document.getElementById('controlPanel');
  const active = document.activeElement;
  const refocus = panel && active && panel.contains(active)
    ? (active.name === 'controlContactMode' ? 'input[name="controlContactMode"]:checked' : active.id ? `#${active.id}` : null)
    : null;
  const dialSave = Object.keys(changes).length === 1 && 'contactMode' in changes;
  if (panel) panel.querySelectorAll('input, button').forEach(el => { if (!(dialSave && el.name === 'controlContactMode')) el.disabled = true; });
  try {
    contactSettings = await apiPut('/api/contact-settings', changes);
    toast(typeof savedMessage === 'function' ? savedMessage(contactSettings) : savedMessage, { durationMs: 4000 });
  } catch (err) { toast(err.message, { durationMs: 6000 }); }
  renderControlPanel();
  renderPostFormDial();
  if (refocus) {
    const target = document.querySelector(`#controlPanel ${refocus}`);
    if (target && !target.disabled) target.focus();
  }
}

// Arrow keys step through a radio group one choice at a time (a change event each), so the dial waits a moment and
// saves only the choice the person lands on.
const DIAL_SAVE_DELAY_MS = 450;
let dialSaveTimer = null;

// One save at a time, in the order they were made. The server writes every setting back from what it read, so two
// saves in flight together (a dial choice and the phone box inside the dial's wait, or two dial choices) could
// otherwise undo each other, and the panel could end on a choice the person didn't make last.
let contactSaveQueue = Promise.resolve();
function queueContactSave(task) {
  const next = contactSaveQueue.then(task, task);
  contactSaveQueue = next.catch(() => {});
  return next;
}

function wireControlPanel() {
  const panel = document.getElementById('controlPanel');
  panel.addEventListener('change', (e) => {
    if (e.target.name === 'controlContactMode' && CONTACT_MODE_LABELS[e.target.value]) {
      const mode = e.target.value;
      clearTimeout(dialSaveTimer);
      dialSaveTimer = setTimeout(() => {
        dialSaveTimer = null;
        // Compared when its turn comes, against what the save before it left saved.
        queueContactSave(() => (mode !== currentContactMode() ? saveContactSettings({ contactMode: mode }, CONTACT_MODE_SAVED[mode]) : null));
      }, DIAL_SAVE_DELAY_MS);
    } else if (e.target.id === 'phonePublicToggle') {
      const on = e.target.checked;
      queueContactSave(() => saveContactSettings({ phonePublic: on }, on ? 'Saved. Your phone number now shows on your public profile and listings.' : 'Saved. Your phone number is private.'));
    }
  });
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-control-action]');
    if (!btn) return;
    if (btn.dataset.controlAction === 'save-quiet') {
      const quietStart = document.getElementById('quietStart').value;
      const quietEnd = document.getElementById('quietEnd').value;
      if (!quietStart || !quietEnd) { toast('Pick when your quiet hours start and end.'); return; }
      if (quietStart === quietEnd) { toast('Pick two different times for your quiet hours.'); return; }
      queueContactSave(() => saveContactSettings({ quietStart, quietEnd }, s => `Quiet hours saved: ${quietHoursLabel(s.quietStart, s.quietEnd)} Pacific.`));
    } else if (btn.dataset.controlAction === 'clear-quiet') {
      queueContactSave(() => saveContactSettings({ quietStart: '', quietEnd: '' }, 'Quiet hours cleared. Emails and phone alerts can arrive anytime.'));
    }
  });
  // A dial choice made in the post form stays put when the saved settings finish loading.
  document.getElementById('plContactDial').addEventListener('change', (e) => {
    if (e.target.name === 'plContactMode') e.currentTarget.dataset.touched = '1';
  });
}

// The homeowner's own proposal comparison (pre-listing or trade). One filtered + sorted list drives both the quick-scan
// table and the full cards. Controls only appear once there's enough to narrow (3+ proposals), and the accepted
// proposal is never filtered out -- its engagement (milestones, reviews) hangs off it.
let proposalView = null; // { bids, backLink } for whichever detail view is open

// Same 3+-reviews-first rule as the agent directory, so one 5-star review can't outrank a 4.8 average over 40.
const PROPOSAL_SORTS = {
  newest: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id,
  rating: (a, b) => {
    const tier = x => (x.reviewCount >= 3 ? 0 : x.reviewCount > 0 ? 1 : 2);
    return tier(a) - tier(b) || (b.rating ?? 0) - (a.rating ?? 0) || b.reviewCount - a.reviewCount;
  },
  mostHired: (a, b) => (b.hiresOnPlatform || 0) - (a.hiresOnPlatform || 0) || b.reviewCount - a.reviewCount,
  // Pre-listings only: the lowest fee at the owner's expected sale price leaves them the most.
  takeHome: (a, b) => proposalFeeDollars(a, takeHomePrice()) - proposalFeeDollars(b, takeHomePrice()),
};

function proposalControlsHtml(feeSort) {
  const serviceOptions = Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
  return `
    <div class="proposal-controls">
      <div class="form-row three-col">
        <div class="field"><label for="proposalSort">Sort by</label>
          <select id="proposalSort" data-proposal-control><option value="newest">Newest first</option><option value="rating">Highest rated</option><option value="mostHired">Most hired on Amico Haus</option>${feeSort ? '<option value="takeHome">Your estimated take-home (high to low)</option>' : ''}</select>
        </div>
        <div class="field"><label for="proposalFeeType">Fee type</label>
          <select id="proposalFeeType" data-proposal-control><option value="">Any</option><option value="commission">Commission</option><option value="flat">Flat fee</option></select>
        </div>
        <div class="field"><label for="proposalMustInclude">Must include</label>
          <select id="proposalMustInclude" data-proposal-control><option value="">Any service</option>${serviceOptions}</select>
        </div>
      </div>
      <div class="form-row two-col">
        <label class="checkbox-row"><input type="checkbox" id="proposalHideDeclined" data-proposal-control><span>Hide declined proposals</span></label>
      </div>
      ${proposalView && proposalView.preListingId ? `<div class="form-row two-col">
        <div class="field"><label for="proposalPick">Your picks</label>
          <select id="proposalPick" data-proposal-control><option value="">Show all</option><option value="shortlist">Shortlisted only</option><option value="hidePassed">Hide the ones I passed on</option></select>
        </div>
      </div>` : ''}
    </div>`;
}

// opts come from the on-screen controls on a re-render; the first render of a detail view passes nothing, so it can't
// pick up controls left over from the previously opened listing while the new HTML is still being built.
function filteredProposals(bids, opts = {}) {
  const { sort = 'newest', feeType = '', mustInclude = '', hideDeclined = false, pick = '' } = opts;
  const kept = bids.filter(b => {
    if (b.status === 'accepted') return true;
    if (feeType === 'commission' && !b.commissionPct) return false;
    if (feeType === 'flat' && !b.flatFee) return false;
    if (mustInclude && !(b.services || []).some(s => s.type === mustInclude)) return false;
    if (hideDeclined && b.status === 'declined') return false;
    if (pick === 'shortlist' && b.ownerPick !== 'shortlist') return false;
    if (pick === 'hidePassed' && b.ownerPick === 'pass') return false;
    return true;
  });
  return kept.sort(PROPOSAL_SORTS[sort] || PROPOSAL_SORTS.newest);
}

function proposalResultsHtml(bids, backLink, opts, feePrice = null) {
  const shown = filteredProposals(bids, opts);
  const countLine = shown.length < bids.length ? `<p class="tiny">Showing ${shown.length} of ${bids.length} proposals.</p>` : '';
  if (!shown.length) return `${countLine}<div class="empty-state">No proposals match these filters.</div>`;
  return `${countLine}${renderBidComparisonTable(shown, true, feePrice)}${shown.map(b => renderBidCard(b, true, backLink)).join('')}`;
}

// feeSort (pre-listings): adds the "most take-home" sort and a fee-in-dollars column at the owner's expected price.
// preListingId (pre-listings only): enables pitch reels and the shortlist / pass picks on each card.
function renderProposalsSection(bids, backLink, { feeSort = false, startPrice = 0, preListingId = null } = {}) {
  proposalView = { bids, backLink, feeSort, startPrice, preListingId };
  if (!bids.length) return '<h3>Proposals (0)</h3><div class="empty-state">No proposals yet.</div>';
  return `<h3>Proposals (${bids.length})</h3><p class="tiny operator-note">${escapeHtml(FEE_NOTE)} ${escapeHtml(OPERATOR_NOTE)}</p>${bids.length >= 3 ? proposalControlsHtml(feeSort) : ''}<div id="proposalResults">${proposalResultsHtml(bids, backLink, {}, feeSort ? startPrice : null)}</div>`;
}

function rerenderProposalResults() {
  const el = document.getElementById('proposalResults');
  if (!el || !proposalView) return;
  // The sort/filter controls only exist once there are 3+ proposals; the take-home inputs re-render this too.
  const ctl = idName => document.getElementById(idName);
  el.innerHTML = proposalResultsHtml(proposalView.bids, proposalView.backLink, {
    sort: ctl('proposalSort') ? ctl('proposalSort').value : 'newest',
    feeType: ctl('proposalFeeType') ? ctl('proposalFeeType').value : '',
    mustInclude: ctl('proposalMustInclude') ? ctl('proposalMustInclude').value : '',
    hideDeclined: !!(ctl('proposalHideDeclined') && ctl('proposalHideDeclined').checked),
    pick: ctl('proposalPick') ? ctl('proposalPick').value : '',
  }, proposalView.feeSort ? takeHomePrice() : null);
}

// A quick-scan table above the full proposal cards, once there's something to compare — the whole point of
// Agent Strategy is comparing agents fairly, so this shouldn't require scrolling through full cards first.
function renderBidComparisonTable(bids, canAct, feePrice = null) {
  if (!bids || bids.length < 2) return '';
  const rows = bids.map(b => {
    const hiredLabel = b.hiresOnPlatform > 0 ? `${b.hiresOnPlatform}×` : b.isNewToAmicoHaus ? 'New here' : '0';
    const respLabel = formatResponseHours(b.avgResponseHours) || '—';
    const feeParts = [b.commissionPct ? `${b.commissionPct}%` : '', b.flatFee ? money(b.flatFee) : ''].filter(Boolean);
    const serviceCount = (b.services || []).length;
    const statusBadge = `<span class="badge ${b.status === 'accepted' ? 'badge-active' : b.status === 'declined' ? 'badge-paused' : 'badge-gold'}">${b.status}</span>`;
    return `<tr>
      <td>${b.ownerPick === 'shortlist' ? '<span title="Shortlisted">★</span> ' : ''}<a class="profile-link" href="/profile/${b.agentUserId}">${escapeHtml(b.agentName)}</a>${b.isPlatformOperator ? ' <span class="tiny">(platform operator)</span>' : ''}</td>
      <td>${ratingChipHtml(b.rating, b.reviewCount)}</td>
      <td>${feeParts.length ? feeParts.join(' + ') : '—'}</td>
      ${feePrice ? `<td>${money(proposalFeeDollars(b, feePrice))}</td>` : ''}
      <td>${serviceCount} service${serviceCount === 1 ? '' : 's'}</td>
      <td>${hiredLabel}</td>
      <td>${respLabel}</td>
      <td>${statusBadge}</td>
      <td>${canAct && b.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" data-action="accept-bid" data-bid-id="${b.id}">Accept</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `
    <div class="comparison-table-wrap">
      <table class="comparison-table">
        <thead><tr><th>Agent</th><th>Rating</th><th>Fee</th>${feePrice ? `<th>Fee at ${money(feePrice)}</th>` : ''}<th>Services</th><th>Hired</th><th>Proposal speed</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="tiny">Full details for each proposal, including their message and what's included, are below.</p>
  `;
}

function renderBidCard(b, canAct, backLink) {
  const respLabel = formatResponseHours(b.avgResponseHours);
  const statusBadge = `<span class="badge ${b.status === 'accepted' ? 'badge-active' : b.status === 'declined' ? 'badge-paused' : 'badge-gold'}">${b.status}</span>`;
  const details = agentDetailsHtml({
    status: [
      b.isPlatformOperator && { text: 'Platform operator: runs Amico Haus' },
      (b.foundingZips || []).length > 0 && { text: `Founding agent · ${b.foundingZips.join(', ')}`, tone: 'good' },
      b.afterDecisionNight && { text: 'Sent or updated after your Decision Night' },
    ].filter(Boolean),
    stats: [
      b.hiresOnPlatform > 0 && { k: 'Hired here', v: `${b.hiresOnPlatform} time${b.hiresOnPlatform === 1 ? '' : 's'}` },
      b.finalistCount > 0 && { k: 'Finalist', v: `${b.finalistCount} home${b.finalistCount === 1 ? '' : 's'}` },
      respLabel && { k: 'Proposal speed', v: respLabel },
    ].filter(Boolean),
    selfReported: [
      b.pastClients && b.pastClients.count > 0 && { k: 'Past clients (outside Amico, not verified)', v: `★ ${b.pastClients.avgRating} (${b.pastClients.count})` },
      b.homesSoldLastYear && { k: 'Sold, last 12 mo', v: String(b.homesSoldLastYear) },
      b.avgDaysOnMarket && { k: 'On market', v: `~${b.avgDaysOnMarket} days` },
    ].filter(Boolean),
  });
  return `
    <div class="card">
      ${personHeadHtml({
        avatar: avatarHtml(b.agentName, { seed: b.agentUserId, size: 'lg' }),
        nameHtml: `<a class="profile-link" href="/profile/${b.agentUserId}${backLink ? `?back=${encodeURIComponent(backLink)}` : ''}">${escapeHtml(b.agentName)}</a>`,
        // Name, DRE number and brokerage together, as California's DRE asks at a first point of contact.
        sub: agentLicenseOnFileLine(b.licenseNumber, b.brokerageName),
        chips: [ratingChipHtml(b.rating, b.reviewCount), b.yearsExperience ? chipHtml(`${b.yearsExperience} yrs experience (self-reported)`, 'outline') : ''].filter(Boolean),
        aside: `${b.ownerPick ? `<span class="badge ${b.ownerPick === 'shortlist' ? 'badge-gold' : 'badge-paused'}">${b.ownerPick === 'shortlist' ? '★ Shortlisted' : 'Passed'}</span> ` : ''}${statusBadge}`,
      })}
      ${b.isStale ? `<p class="tiny gone-quiet-nudge">This proposal has been pending a while — consider reviewing it or letting the agent know where things stand.</p>` : ''}
      ${details}
      ${foundingCaptionHtml(b.foundingZips)}
      ${b.hasPitchVideo && proposalView && proposalView.preListingId ? `<p class="tiny"><span class="label">Pitch reel for your home</span></p><video controls preload="none" playsinline class="media-video media-video-sm" src="/api/pre-listings/${proposalView.preListingId}/pitch-video?agent=${b.agentUserId}&v=${escapeHtml(b.pitchVersion || '')}"></video>`
        : b.hasVideo ? `<video controls preload="none" class="media-video media-video-sm" src="/api/agent-video/${b.agentUserId}"></video>` : ''}
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
        ${canAct && proposalView && proposalView.preListingId && b.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-action="pick-bid" data-bid-id="${b.id}" data-pick="${b.ownerPick === 'shortlist' ? 'clear' : 'shortlist'}">${b.ownerPick === 'shortlist' ? 'Remove from shortlist' : '★ Shortlist'}</button>` : ''}
        ${canAct && proposalView && proposalView.preListingId && (b.status === 'pending' || b.status === 'accepted' || isSharingWith(b.agentUserId)) ? shareContactSlotHtml(proposalView.preListingId, b.agentUserId, b.agentName) : ''}
        ${canAct ? blockButtonHtml(b.agentUserId, b.agentName) : ''}
        ${canAct ? reportUserButtonHtml(b.agentUserId) : ''}
      </div>
    </div>
  `;
}

// paused: the homeowner paused new proposals and this agent hasn't sent one yet, so the form gives way to a note
// (an agent who already sent one can still update it). priceOpen: no asking price yet, so the opinion form asks for a
// suggested list price instead of a vote.
function renderBidFormAndVote(myBid, myVote, showVote, { paused = false, priceOpen = false } = {}) {
  // While paused, only a live (pending) proposal can still be updated; a withdrawn or declined one can't be sent
  // again until the owner resumes (the server refuses it), so those agents get the paused note, not the form.
  const canUpdate = !!myBid && myBid.status === 'pending';
  if (paused && !canUpdate) {
    return `
    <div class="panel proposals-paused-panel">
      <div class="card-head"><h3>Submit a Proposal</h3><span class="badge badge-paused">New proposals paused</span></div>
      <p class="tiny">${escapeHtml(CONTACT_ERROR_COPY.proposals_paused)}</p>
      ${myBid && myBid.message ? `<p class="tiny"><strong>Your earlier proposal:</strong> ${escapeHtml(myBid.message)}</p>` : ''}
    </div>
    ${showVote ? renderPriceOpinionForm(myVote, { priceOpen }) : ''}
  `;
  }
  return `
    <div class="panel">
      <h3>${myBid ? 'Your Proposal' : 'Submit a Proposal'}</h3>
      ${paused ? '<p class="tiny">This homeowner paused new proposals for now. Yours is already in, so you can still update it.</p>' : ''}
      ${!myBid && currentAgentPackages.length > 0 ? `
        <div class="field"><label>Quick-fill from a package</label>
          <div class="card-actions">
            ${currentAgentPackages.map(p => `<button type="button" class="btn btn-ghost btn-sm" data-action="quickfill-package" data-tier="${p.tier}">${PACKAGE_TIER_LABELS[p.tier]}${p.flatFee ? ` (${money(p.flatFee)})` : ''}${p.flatFee && p.commissionPct ? ' + ' : ''}${p.commissionPct ? `${p.commissionPct}%` : ''}</button>`).join('')}
          </div>
        </div>
      ` : ''}
      <div class="field"><label for="bidMessage">Message</label><textarea id="bidMessage" maxlength="2000" aria-describedby="bidMessageNote">${escapeHtml(myBid ? myBid.message : '')}</textarea><p class="tiny field-hint composer-note" id="bidMessageNote">Base your price on the home and comparable sales only.</p></div>
      <div class="form-row two-col">
        <div class="field"><label for="bidCommissionPct">Commission (%)</label><input type="number" id="bidCommissionPct" min="0" max="100" step="0.1" value="${myBid && myBid.commissionPct ? myBid.commissionPct : ''}"></div>
        <div class="field"><label for="bidFlatFee">…or flat fee ($)</label><input type="number" id="bidFlatFee" min="0" max="500000" step="100" value="${myBid && myBid.flatFee ? myBid.flatFee : ''}"></div>
      </div>
      <div class="field"><label>Included services</label><div id="bidServicesEditor"></div></div>
      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="submit-bid">${myBid ? 'Update Proposal' : 'Submit Proposal'}</button>
        ${myBid && myBid.status === 'pending' ? '<button type="button" class="btn btn-danger btn-sm" data-action="withdraw-bid" data-bid-id="' + myBid.id + '">Withdraw</button>' : ''}
      </div>
    </div>
    ${showVote ? renderPriceOpinionForm(myVote, { priceOpen }) : ''}
  `;
}

// ---- Take-home estimate (homeowner's own pre-listing) ----
// Turns each proposal's fee into dollars at the owner's expected sale price, after the usual selling costs, so
// "2.5% vs $9,500 flat" becomes what they'd actually keep. All math happens here in the browser; the loan payoff
// is saved only on this device (localStorage), never sent anywhere.
function proposalFeeDollars(b, price) {
  return Math.round(((Number(b.commissionPct) || 0) / 100) * price + (Number(b.flatFee) || 0));
}

// Before the take-home panel is on screen (the first render builds everything as one string), the start price
// it will show stands in.
function takeHomePrice() {
  const el = document.getElementById('thPrice');
  if (el) return Math.max(0, Number(el.value) || 0);
  return proposalView && proposalView.startPrice ? proposalView.startPrice : 0;
}

// The home's asking price. With no asking price yet ("Open to price opinions") it starts blank and the owner types
// their own guess. Never a number worked out from the agents' price opinions.
function takeHomeStartPrice(p) {
  return !isPriceOpen(p) && Number(p.askingPrice) > 0 ? Number(p.askingPrice) : 0;
}

function keepMoney(n) {
  return n < 0 ? `-${money(-n)}` : money(n);
}

function takeHomeInputs() {
  const num = (idName, fallback) => {
    const el = document.getElementById(idName);
    const n = el && el.value !== '' ? Number(el.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return { price: takeHomePrice(), payoff: num('thPayoff', 0), buyerPct: num('thBuyerPct', 0), transfer: num('thTransfer', 1.1), closingPct: num('thClosing', 1) };
}

function takeHomeResultHtml(bids, inp) {
  if (!inp.price) return '<p class="tiny">Type the price you expect to sell for, and this shows your estimate for each proposal.</p>';
  const costs = Math.round(inp.price * inp.buyerPct / 100 + inp.price / 1000 * inp.transfer + inp.price * inp.closingPct / 100);
  const beforeFee = inp.price - inp.payoff - costs;
  const live = (bids || []).filter(b => b.status === 'pending' || b.status === 'accepted')
    .map(b => ({ b, fee: proposalFeeDollars(b, inp.price) }))
    .sort((x, y) => x.fee - y.fee);
  const rows = live.map(({ b, fee }) => `<tr><td>${escapeHtml(b.agentName)}${b.status === 'accepted' ? ' <span class="badge badge-active">hired</span>' : ''}</td><td><strong>${keepMoney(beforeFee - fee)}</strong></td><td>${money(fee)}</td></tr>`).join('');
  return `
    <p class="tiny estimate-label">${escapeHtml(ESTIMATE_LABEL)}</p>
    <p class="take-home-base">Before any listing agent's fee: <strong>${keepMoney(beforeFee)}</strong> <span class="tiny">(${money(inp.price)} sale, minus ${money(inp.payoff)} payoff and ${money(costs)} in the other selling costs you entered)</span></p>
    ${rows ? `<div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>Agent</th><th>Your estimate after their fee</th><th>Their fee</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="tiny">Proposals will show up here with your estimate for each.</p>`}`;
}

function renderTakeHomePanel(p, bids) {
  const startPrice = takeHomeStartPrice(p);
  let payoff = '';
  try { payoff = localStorage.getItem(`ah_payoff_${p.id}`) || ''; } catch { /* storage blocked */ }
  const inp = { price: startPrice, payoff: Number(payoff) || 0, buyerPct: 0, transfer: 1.1, closingPct: 1 };
  return `
    <details class="panel" id="takeHomePanel" data-pre-listing-id="${p.id}" open>
      <summary>Your take-home estimate</summary>
      <p class="tiny">Compare proposals in dollars using your own numbers. ${startPrice ? 'The sale price starts at your asking price; change it to your own guess anytime.' : 'Type your own guess for the sale price.'} Your loan payoff stays on this device. Your escrow officer will give you the real numbers.</p>
      <div class="form-row three-col">
        <div class="field"><label for="thPrice">Expected sale price ($)</label><input type="number" id="thPrice" data-take-home min="0" step="1000" inputmode="numeric" placeholder="Your own guess" value="${startPrice ? Number(startPrice) : ''}"></div>
        <div class="field"><label for="thPayoff">Loan payoff ($)</label><input type="number" id="thPayoff" data-take-home min="0" step="1000" inputmode="numeric" placeholder="0 if paid off" value="${escapeHtml(payoff)}"></div>
        <div class="field"><label for="thBuyerPct">Buyer's agent pay you plan to offer (%)</label><input type="number" id="thBuyerPct" data-take-home min="0" max="10" step="0.25" inputmode="decimal" value="0"></div>
      </div>
      <div class="form-row two-col">
        <div class="field"><label for="thTransfer">Transfer tax ($ per $1,000, your guess)</label><input type="number" id="thTransfer" data-take-home min="0" step="0.05" inputmode="decimal" value="1.10"></div>
        <div class="field"><label for="thClosing">Title, escrow and other costs (% of price, your guess)</label><input type="number" id="thClosing" data-take-home min="0" max="10" step="0.1" inputmode="decimal" value="1"></div>
      </div>
      <p class="tiny">Change any number to your own. Your escrow officer can tell you the transfer tax and closing costs for your sale.</p>
      <p class="tiny">Buying your next home too? <a href="/sell-or-buy-first" target="_blank" rel="noopener">Plan whether to sell or buy first →</a></p>
      <div id="takeHomeResult">${takeHomeResultHtml(bids, inp)}</div>
      <p class="tiny money-tool-note">${escapeHtml(MONEY_TOOL_NOTE)}</p>
    </details>`;
}

function refreshTakeHome() {
  const panel = document.getElementById('takeHomePanel');
  if (!panel || !proposalView) return;
  try { localStorage.setItem(`ah_payoff_${panel.dataset.preListingId}`, document.getElementById('thPayoff').value); } catch { /* storage blocked */ }
  document.getElementById('takeHomeResult').innerHTML = takeHomeResultHtml(proposalView.bids, takeHomeInputs());
  if (document.getElementById('proposalResults')) rerenderProposalResults();
}

// The founding agents' first-opinion promise, and (for the owner) how many agents serve the ZIP so far.
function zipCoverageHtml(p, isOwner, myVote) {
  const z = p.zipCoverage;
  if (!z) return '';
  const by = z.firstOpinionBy ? new Date(z.firstOpinionBy) : null;
  const when = by ? by.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const lines = [];
  if (z.viewerIsFounding && p.status === 'open') {
    // With no asking price there's nothing to vote on: the suggested list price is the opinion.
    if (myVote && (myVote.vote || (isPriceOpen(p) && myVote.priceOpinion))) lines.push(`Thanks, founding agent: your price opinion on this ${escapeHtml(z.zip)} home is in.`);
    else if (by && by.getTime() > Date.now()) lines.push(`You're a founding agent in ${escapeHtml(z.zip)}: aim to send your price opinion by ${escapeHtml(when)}.`);
  }
  if (isOwner && by && by.getTime() > Date.now() && p.status === 'open' && !(p.votes && p.votes.total)) lines.push(`Founding agents in ${escapeHtml(z.zip)} aim to send their first price opinion by ${escapeHtml(when)}.`);
  if (isOwner && z.agentsServing < z.foundingSpots && p.status === 'open') {
    const serving = z.agentsServing === 0 ? 'No approved agents list' : `${z.agentsServing} approved agent${z.agentsServing === 1 ? ' lists' : 's list'}`;
    lines.push(`${serving} ${escapeHtml(z.zip)} in their service area on Amico Haus so far. Know a great local agent? <button type="button" class="link-btn" data-action="copy-agent-invite" data-zip="${escapeHtml(z.zip)}">Copy an invite link for them</button>, invite one already here below, or <a href="/unlock-your-zip#zip-${escapeHtml(z.zip)}" target="_blank" rel="noopener">share the ZIP board</a>.`);
  }
  return lines.map(l => `<p class="tiny zip-coverage">${l}</p>`).join('');
}

// Came from "Unlock your ZIP" (or an invite link with ?zip=): put that ZIP in the first empty service-ZIP box, unless
// the profile already lists it. Cleared once the application is saved.
function prefillClaimedZip(currentZips) {
  let claimed = '';
  try { claimed = localStorage.getItem('ah_claim_zip') || ''; } catch { return; }
  if (!/^\d{5}$/.test(claimed) || (currentZips || []).map(String).includes(claimed)) return;
  const slot = ['agentZip1', 'agentZip2', 'agentZip3', 'agentZip4'].map(id => document.getElementById(id)).find(el => el && !el.value.trim());
  if (slot) slot.value = claimed;
}

const VOTE_LABELS = { too_high: 'Too high', just_right: 'Just right', too_low: 'Too low' };
const DECK_ACCEPT = '.pdf,.pptx,.ppt,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';

// "2026-09-14" -> "Sep 14, 2026" (read as a calendar date, so no time-zone shift).
function compDateLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const DECK_MAX_BYTES = 20 * 1024 * 1024;
const DECK_EXTENSIONS = ['pdf', 'pptx', 'ppt', 'docx', 'doc'];

function deckLineHtml(deck) {
  if (!deck || !marketplaceDetail) return '';
  return `📎 <a href="/api/pre-listings/${marketplaceDetail.id}/votes/deck">${escapeHtml(deck.name)}</a> · ${formatFileSize(deck.size)} <button type="button" class="link-btn" data-action="remove-deck">Remove</button>`;
}

function deckHint(deck) {
  return deck ? 'Choosing a new file replaces this one. Saving your price opinion is separate.' : 'A pricing deck, a CMA or a marketing plan. It uploads as soon as you pick it; your other answers stay as they are.';
}

// The agent's sealed price opinion: their vote on the asking price, the list price they'd suggest, up to 3 sold
// comps, a note, and one presentation file. The homeowner sees it; other agents never do. When the homeowner hasn't set an
// asking price (priceOpen), there's nothing to vote on: the suggested list price is required instead.
function renderPriceOpinionForm(myVote, { priceOpen = false } = {}) {
  const mine = myVote || { vote: null, note: '', priceOpinion: null, comps: [], deck: null };
  const comps = [0, 1, 2].map(i => mine.comps[i] || {});
  const v = x => escapeHtml(x ?? '');
  const today = new Date().toISOString().slice(0, 10);
  const voteHtml = priceOpen
    ? '<p class="inline-note">This homeowner hasn\'t set a price yet. Share your suggested list price and comps.</p>'
    : `${myVote && !myVote.vote && (myVote.priceOpinion || myVote.comps.length) ? '<p class="tiny gone-quiet-nudge">The homeowner changed the asking price, so votes were reset. Your suggested price, comps and file are still here. Pick your vote again and save.</p>' : ''}
      <div class="field"><span class="label">Is the asking price right?</span>
        <div class="card-actions" role="group" aria-label="Your vote on the asking price">
          ${Object.entries(VOTE_LABELS).map(([key, label]) => `<button type="button" class="btn ${mine.vote === key ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="pick-vote" data-vote="${key}" aria-pressed="${mine.vote === key}">${label}</button>`).join('')}
        </div>
      </div>`;
  return `
    <div class="panel" id="priceOpinionPanel" data-vote="${priceOpen ? '' : v(mine.vote)}"${priceOpen ? ' data-price-open="1"' : ''}>
      <div class="card-head"><h3>Your price opinion</h3><span class="badge badge-gold">Sealed</span></div>
      <p class="tiny">${priceOpen
        ? 'The homeowner sees your suggested price, comps, note and file; other agents never do. Other agents see only how many agents shared an opinion.'
        : 'The homeowner sees your suggested price, comps, note and file; other agents never do. Your vote counts toward the too high / just right / too low totals, which other agents see only after casting their own.'}</p>
      ${voteHtml}
      <div class="field"><label for="opinionPrice">The list price you'd suggest ($)${priceOpen ? ' <span class="required-mark">*</span>' : ''}</label><input type="number" id="opinionPrice" min="10000" max="500000000" step="1000" inputmode="numeric" aria-describedby="opinionPriceNote" value="${v(mine.priceOpinion)}"${priceOpen ? ' required' : ''}><p class="tiny field-hint composer-note" id="opinionPriceNote">${escapeHtml(PRICE_BASIS_NOTE)}</p></div>
      <p class="tiny">The homeowner keeps a private history of each number you share here. Other agents never see it.</p>
      <details class="score-breakdown"${mine.comps.length ? ' open' : ''}>
        <summary>Comps that back it up (up to 3)</summary>
        ${comps.map((c, i) => `
          <div class="comp-row" data-comp-row="${i}">
            <div class="field"><label for="compAddress${i}">Comp ${i + 1} address</label><input type="text" id="compAddress${i}" maxlength="120" value="${v(c.address)}"></div>
            <div class="form-row three-col">
              <div class="field"><label for="compPrice${i}">Sold for ($)</label><input type="number" id="compPrice${i}" min="1000" step="1000" inputmode="numeric" value="${v(c.soldPrice)}"></div>
              <div class="field"><label for="compDate${i}">Sold on</label><input type="date" id="compDate${i}" max="${today}" value="${v(c.soldDate)}"></div>
              <div class="field"><label for="compSqft${i}">Sq ft</label><input type="number" id="compSqft${i}" min="100" step="1" inputmode="numeric" value="${v(c.sqft)}"></div>
            </div>
          </div>`).join('')}
      </details>
      ${prepCheckboxesHtml(mine.prep)}
      <div class="field"><label for="opinionNote">Note for the homeowner (optional)</label><textarea id="opinionNote" maxlength="300" placeholder="e.g. Priced to the two most recent sales on the same street.">${v(mine.note)}</textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="save-opinion">Save price opinion</button></div>
      <div class="field">
        <label for="opinionDeck">Your presentation (PDF, PowerPoint or Word, up to 20MB)</label>
        <p class="tiny deck-current" id="deckCurrent">${deckLineHtml(mine.deck)}</p>
        <input type="file" id="opinionDeck" accept="${DECK_ACCEPT}">
        <p class="tiny" id="deckHint" role="status" aria-live="polite">${deckHint(mine.deck)}</p>
      </div>
    </div>`;
}

// What the homeowner sees: each agent's sealed opinion on its own card, in the order they arrived, and the low-to-high
// range once 3+ agents have suggested a price. No middle, average or other number worked out across agents (Rudy
// 11.04). Opinions, not appraisals.
function renderPriceOpinionsPanel(data, preListingId) {
  if (!data) return '';
  const { opinions, summary } = data;
  const priced = opinions.filter(o => o.priceOpinion).length;
  const summaryHtml = summary
    ? `<div class="opinion-summary"><div><span class="label">Range</span>${money(summary.low)} to ${money(summary.high)}</div><div><span class="label">From</span>${summary.count} agents</div></div>`
    : `<p class="tiny">The range shows up once 3 agents have suggested a price (${priced} so far).</p>`;
  const cards = opinions.map(o => {
    const comps = (o.comps || []).map(c => `<li><strong>${escapeHtml(c.address)}</strong> sold for ${money(c.soldPrice)}${c.soldDate ? ` on ${escapeHtml(compDateLabel(c.soldDate))}` : ''}${c.sqft ? ` · ${c.sqft.toLocaleString('en-US')} sq ft (${money(Math.round(c.soldPrice / c.sqft))}/sq ft)` : ''}</li>`).join('');
    // Name, DRE number and brokerage together (California DRE rule for a first point of contact).
    const creds = agentLicenseOnFileLine(o.licenseNumber, o.brokerageName);
    const share = shareContactSlotHtml(preListingId, o.agentUserId, o.agentName);
    return `
      <div class="card opinion-card">
        <div class="card-head"><h4><a class="profile-link" href="/profile/${o.agentUserId}">${escapeHtml(o.agentName)}</a>${creds ? `<span class="agent-id-rest"> · ${escapeHtml(creds)}</span>` : ''}${o.isPlatformOperator ? ` ${chipHtml('Platform operator: runs Amico Haus', 'outline')}` : ''}</h4>${o.vote ? `<span class="badge badge-gold">${VOTE_LABELS[o.vote] || ''}</span>` : ''}</div>
        ${o.priceOpinion ? `<p class="opinion-price">Suggests ${money(o.priceOpinion)}</p>` : '<p class="tiny">No suggested price yet.</p>'}
        ${opinionCardExtrasHtml(o)}
        ${o.note ? `<p>${escapeHtml(o.note)}</p>` : ''}
        ${prepListHtml(o.prep)}
        ${comps ? `<span class="label">Comps</span><ul class="comp-list">${comps}</ul>` : ''}
        ${o.deck ? `<p class="tiny">📎 <a href="/api/pre-listings/${preListingId}/votes/deck?agent=${o.agentUserId}">${escapeHtml(o.deck.name)}</a> · ${formatFileSize(o.deck.size)}</p>` : ''}
        <div class="card-actions">${share}${blockButtonHtml(o.agentUserId, o.agentName)}${reportUserButtonHtml(o.agentUserId)}</div>
      </div>`;
  }).join('');
  return `
    <div class="panel" id="priceOpinionsPanel">
      <h3>Agents' price opinions (${opinions.length})</h3>
      ${opinionRefreshBarHtml(data, preListingId)}
      <p class="tiny">Agents never see each other's suggested prices, comps or files, and can't see the vote totals until they've voted. Every number here is an agent price opinion, not an appraisal.</p>
      ${opinions.length ? summaryHtml + prepSummaryHtml(data.prepSummary, opinions.length) + cards : '<div class="empty-state">No agent has weighed in yet. You\'ll get a notification when one does.</div>'}
    </div>`;
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
    // Pausing stops new proposals only: agents who already sent one can still update it, and opinions keep coming.
    return `<div class="card-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="edit-pre-listing">Edit details</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="${p.proposalsPaused ? 'resume-proposals' : 'pause-proposals'}">${p.proposalsPaused ? 'Resume proposals' : 'Pause new proposals'}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="close-pre-listing">Close pre-listing</button>
      ${deleteBtn}
    </div>
    ${p.proposalsPaused ? '<p class="inline-note paused-note">New proposals are paused. Agents who already sent one can still update it.</p>' : ''}`;
  }
  if (p.status === 'closed') return `<p class="tiny">You closed this pre-listing, so agents can no longer vote or send proposals.</p><div class="card-actions">${deleteBtn}</div>`;
  return ''; // awarded — deletion is blocked server-side too, same protection as closing/editing
}

function renderPreListingEditForm(p) {
  const v = x => escapeHtml(x ?? '');
  const typeOptions = PROPERTY_TYPES.map(t => `<option value="${escapeHtml(t)}"${t === p.propertyType ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const photos = p.photoIds.map(pid => `
    <div class="edit-photo">
      <img src="/api/pre-listing-photos/${pid}" alt="${escapeHtml(homePhotoAlt(p))}" loading="lazy">
      <button type="button" class="btn btn-ghost btn-sm" data-action="delete-pre-listing-photo" data-photo-id="${pid}">Remove</button>
    </div>`).join('');
  // Only real votes (too high / just right / too low) are cleared by a price change; a home with no price has none.
  const priceOpen = isPriceOpen(p);
  const total = !priceOpen && p.votes && p.votes.total ? p.votes.total : 0;
  const price = priceOpen ? 0 : Number(p.askingPrice) || 0;
  return `
    <div class="card hidden" id="preListingEditPanel" data-asking-price="${price}" data-votes="${total}">
      <div class="card-head"><h2>Edit pre-listing</h2></div>
      <p class="tiny">Changing the asking price clears the price votes agents have already cast, because they were about the old price. Proposals and agents' suggested prices stay.</p>
      <div class="form-row two-col">
        <div class="field"><label for="pleTitle">Title (optional)</label><input type="text" id="pleTitle" maxlength="120" value="${v(p.title)}"></div>
        <div class="field"><label for="pleAskingPrice">Asking price (optional)</label><input type="text" id="pleAskingPrice" maxlength="15" inputmode="numeric" autocomplete="off" placeholder="e.g. 750,000" aria-describedby="pleAskingPriceHint" value="${price ? price : ''}"><p class="tiny field-hint" id="pleAskingPriceHint">Not sure yet? Leave it blank and local agents will tell you what they think it's worth.</p></div>
      </div>
      <div class="form-row three-col">
        <div class="field"><label for="pleCity">City <span class="required-mark">*</span></label><input type="text" id="pleCity" maxlength="80" value="${v(p.city)}"></div>
        <div class="field"><label for="pleState">State <span class="required-mark">*</span></label><input type="text" id="pleState" maxlength="20" value="${v(p.state)}"></div>
        <div class="field"><label for="pleZip">Zip <span class="required-mark">*</span></label><input type="text" id="pleZip" maxlength="10" inputmode="numeric" value="${v(p.zip)}"></div>
      </div>
      <div class="field"><label for="pleNeighborhood">Neighborhood (public)</label><input type="text" id="pleNeighborhood" maxlength="80" value="${v(p.neighborhood)}"></div>
      <div class="field"><label for="pleAddress">Street address (private — only agents you share it with, or who RSVP to a broker preview you open, see it)</label><input type="text" id="pleAddress" maxlength="150" value="${v(p.address)}"></div>
      <div class="form-row three-col">
        <div class="field"><label for="plePropertyType">Property type <span class="required-mark">*</span></label><select id="plePropertyType">${typeOptions}</select></div>
        <div class="field"><label for="pleBeds">Beds <span class="required-mark">*</span></label><input type="number" id="pleBeds" min="0" max="50" required value="${v(p.beds)}"></div>
        <div class="field"><label for="pleBaths">Baths <span class="required-mark">*</span></label><input type="number" id="pleBaths" min="0" max="50" step="0.5" required value="${v(p.baths)}"></div>
      </div>
      <div class="field"><label for="pleSqft">Sq ft</label><input type="number" id="pleSqft" min="0" max="200000" step="50" value="${v(p.sqft)}"></div>
      <div class="field"><label for="pleDescription">Description</label><textarea id="pleDescription" maxlength="2000">${v(p.description)}</textarea><p class="tiny field-hint composer-note">${escapeHtml(HOME_TEXT_NOTE)}</p></div>
      <div class="form-row two-col">
        <div class="field"><label for="pleOccupancyStatus">Occupied or vacant during the sale?</label>
          <select id="pleOccupancyStatus"><option value="occupied"${p.occupancyStatus === 'occupied' ? ' selected' : ''}>Occupied</option><option value="vacant"${p.occupancyStatus === 'vacant' ? ' selected' : ''}>Vacant</option></select>
        </div>
        <div class="field"><label for="pleShowingNoticeHours">Showing notice required (hours)</label><input type="number" id="pleShowingNoticeHours" min="0" max="336" value="${v(p.showingNoticeHours)}"></div>
      </div>
      <div class="field"><label for="pleSpecialInstructions">Notes for agents (pets, sign preference, best showing times). Don't put lockbox, gate or alarm codes here.</label><textarea id="pleSpecialInstructions" maxlength="500">${v(p.specialInstructions)}</textarea><p class="tiny field-hint">Only you, the agent you hire, agents you share your contact info with, and Amico Haus admins see these notes.</p></div>
      <p class="tiny"><strong>Optional preferences for agents (informational only):</strong></p>
      <div class="form-row three-col">
        <div class="field"><label for="pleMinYearsExperience">Min. years of experience (agent-reported)</label><input type="number" id="pleMinYearsExperience" min="0" max="80" value="${v(p.minYearsExperience)}"></div>
        <div class="field"><label for="plePreferredLanguage">Preferred language</label><input type="text" id="plePreferredLanguage" maxlength="40" value="${v(p.preferredLanguage)}"></div>
        <div class="field"><label for="plePreferredAgreementMonths">Preferred agreement length (months)</label><input type="number" id="plePreferredAgreementMonths" min="1" max="60" value="${v(p.preferredAgreementMonths)}"></div>
      </div>
      <div class="form-row two-col">
        <label class="checkbox-row"><input type="checkbox" id="pleRequireDedicatedContact"${p.requireDedicatedContact ? ' checked' : ''}><span>I want a single dedicated point of contact, no team hand-offs</span></label>
        <label class="checkbox-row"><input type="checkbox" id="plePrefersExclusive"${p.prefersExclusive ? ' checked' : ''}><span>I'd prefer an exclusive listing agreement</span></label>
      </div>
      <label class="checkbox-row"><input type="checkbox" id="plePrefersLocalSpecialist"${p.prefersLocalSpecialist ? ' checked' : ''}><span>I'd prefer an agent who specializes in my specific area, not one covering a huge territory</span></label>
      <div class="field">
        <label for="plePhotos">Photos</label>
        <div class="edit-photos" id="pleExistingPhotos">${photos}</div>
        <input type="file" id="plePhotos" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
        <p class="tiny">Up to 8 in total. Added photos upload when you save. ${escapeHtml(PHOTO_RIGHTS_NOTE)}</p>
      </div>
      ${homeCostsFieldsHtml('plec', p.costs)}
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

// What the post and edit forms check before sending (prefix 'pl' or 'ple'): the asking price is blank or a
// whole-dollar amount, and beds and baths are filled in (a typed 0 is fine: a studio has 0 beds). The server checks
// the same things; this just says so before a round trip. null = all good.
function preListingFormProblem(prefix) {
  const priceEl = document.getElementById(`${prefix}AskingPrice`);
  const price = parseAskingPriceInput(priceEl.value);
  if (price.error) return { field: priceEl, message: price.error };
  const missing = el => el.value.trim() === '' || !!(el.validity && el.validity.badInput);
  const beds = document.getElementById(`${prefix}Beds`);
  if (missing(beds)) return { field: beds, message: 'Please fill in the number of beds (0 is fine for a studio).' };
  const baths = document.getElementById(`${prefix}Baths`);
  if (missing(baths)) return { field: baths, message: 'Please fill in the number of baths.' };
  return null;
}

async function savePreListingEdit(id) {
  const panel = document.getElementById('preListingEditPanel');
  if (!panel) return;
  const val = key => document.getElementById('ple' + key).value;
  const checked = key => document.getElementById('ple' + key).checked;

  const problem = preListingFormProblem('ple');
  if (problem) { toast(problem.message); problem.field.focus(); return; }
  const askingPrice = parseAskingPriceInput(val('AskingPrice')).value;

  // Clearing the price (or setting one where there was none) is a price change too.
  const voteCount = Number(panel.dataset.votes) || 0;
  if (voteCount > 0 && (askingPrice || 0) !== Number(panel.dataset.askingPrice)
      && !confirm(`Changing the asking price clears the ${voteCount} price vote${voteCount === 1 ? '' : 's'} agents already cast, since they were about the old price. Continue?`)) return;

  const btn = panel.querySelector('[data-action="save-pre-listing"]');
  btn.disabled = true;
  try {
    const costs = readHomeCosts('plec');
    const result = await apiPut(`/api/pre-listings/${id}`, {
      title: val('Title').trim(),
      askingPrice, // null = open to price opinions
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
    await saveHomeCosts('pre_listing', id, costs);
    const photoResult = await uploadPhotos(`/api/pre-listings/${id}/photos`, [...document.getElementById('plePhotos').files]);
    toastWithPhotoResult(result.votesCleared ? 'Saved — the old price votes were cleared so agents can weigh in on the new price.' : 'Pre-listing updated.', photoResult);
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

// ---- "Share my contact info with this agent" and "Who saw my address" (the owner's own pre-listing) ----
// Who the owner shares their contact info with on the pre-listing that's open, so every proposal card and
// price-opinion card for one agent shows the same state, and a share or a stop redraws them in place (no jump back to
// the top). Set by openPreListingDetail. Only the owner gets any of it; a new share needs the home open or awarded,
// while stopping a share works in any status.
const contactShareView = { preListingId: null, isOwner: false, canShare: false, shares: new Map(), addressViews: [] };
let lastPriceOpinions = null; // the owner's price opinions on the open pre-listing (for a new share's identity line)

function setContactShareView(preListingId, isOwner, canShare, shares, addressViews) {
  contactShareView.preListingId = preListingId;
  contactShareView.isOwner = !!isOwner;
  contactShareView.canShare = !!isOwner && !!canShare;
  contactShareView.shares = new Map((isOwner ? shares || [] : []).map(s => [String(s.agentId), s]));
  contactShareView.addressViews = isOwner ? addressViews || [] : [];
}

function isSharingWith(agentId) {
  return contactShareView.isOwner && contactShareView.shares.has(String(agentId));
}

function shareSlotInnerHtml(agentId, agentName) {
  const attrs = `data-agent-id="${Number(agentId)}" data-agent-name="${escapeHtml(agentName)}"`;
  if (isSharingWith(agentId)) return `<span class="contact-shared">Contact shared ✓</span> <button type="button" class="link-btn" data-action="unshare-contact" ${attrs}>Stop sharing</button>`;
  return contactShareView.canShare ? `<button type="button" class="btn btn-ghost btn-sm" data-action="share-contact" ${attrs}>Share my contact info</button>` : '';
}

function shareContactSlotHtml(preListingId, agentId, agentName) {
  if (!contactShareView.isOwner || !agentId || String(contactShareView.preListingId) !== String(preListingId)) return '';
  if (!contactShareView.canShare && !isSharingWith(agentId)) return '';
  return `<span class="share-slot" data-share-slot="${Number(agentId)}">${shareSlotInnerHtml(agentId, agentName)}</span>`;
}

// After a share or a stop: every button for that agent, and the panel's list.
function refreshShareSlots(agentId, agentName) {
  document.querySelectorAll(`[data-share-slot="${Number(agentId)}"]`).forEach(slot => { slot.innerHTML = shareSlotInnerHtml(agentId, agentName); });
  const panel = document.getElementById('addressPrivacyPanel');
  if (panel) panel.innerHTML = addressPrivacyPanelHtml();
}

function identityOf(row) {
  return agentIdentityLine({ name: row.agentName, licenseNumber: row.licenseNumber, brokerageName: row.brokerageName });
}

// The owner's record: every agent their exact address was shown to (through their share, or a broker preview they
// opened), and who they're sharing their contact info with right now.
function addressPrivacyPanelHtml() {
  const views = [...contactShareView.addressViews].sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
  const shares = [...contactShareView.shares.values()];
  const viewRows = views.map(v => {
    const how = v.via === 'preview' ? 'via your broker preview' : 'via your share';
    const first = shortDateLabel(v.firstSeenAt);
    const last = shortDateLabel(v.lastSeenAt);
    return `<li class="address-view-row">${escapeHtml(identityOf(v))} — ${how}${first ? ` · first ${escapeHtml(first)}` : ''}${last ? `, last ${escapeHtml(last)}` : ''}</li>`;
  }).join('');
  const shareRows = shares.map(s => `
      <li class="address-view-row">${escapeHtml(identityOf(s))}${shortDateLabel(s.sharedAt) ? ` · shared ${escapeHtml(shortDateLabel(s.sharedAt))}` : ''}
        <button type="button" class="link-btn" data-action="unshare-contact" data-agent-id="${Number(s.agentId)}" data-agent-name="${escapeHtml(s.agentName)}">Stop sharing</button></li>`).join('');
  return `
    <div class="panel address-privacy">
      <h3>Who saw my address</h3>
      <p class="tiny">Only agents you share with, or who RSVP to a broker preview you open, can see your exact address. Each one is listed here.</p>
      ${viewRows ? `<ul class="address-view-list">${viewRows}</ul>` : '<p class="tiny">No agent has seen your exact address yet.</p>'}
      ${shareRows ? `<h4>Sharing your contact info with</h4><ul class="address-view-list">${shareRows}</ul>` : ''}
      ${contactShareView.canShare ? '<p class="tiny">Like an agent\'s proposal or price opinion? Tap "Share my contact info" on it, and they\'ll see your address, phone and email for this home.</p>' : ''}
    </div>`;
}

// What an agent sees once the homeowner shares their contact info with them.
function sharedContactHtml(c) {
  if (!c) return '';
  const phoneDigits = String(c.phone || '').replace(/[^\d+]/g, '');
  const email = String(c.email || '').trim();
  const emailOk = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/.test(email);
  const lines = [
    c.address && `<li><span class="label">Address</span>${escapeHtml(c.address)}</li>`,
    c.phone && `<li><span class="label">Phone</span>${phoneDigits ? `<a href="tel:${escapeHtml(phoneDigits)}">${escapeHtml(c.phone)}</a>` : escapeHtml(c.phone)}</li>`,
    email && `<li><span class="label">Email</span>${emailOk ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : escapeHtml(email)}</li>`,
  ].filter(Boolean).join('');
  return `
    <div class="panel shared-contact">
      <h3>${escapeHtml(c.ownerName || 'The homeowner')} shared their contact info</h3>
      <ul class="shared-contact-lines">${lines}</ul>
      ${shortDateLabel(c.sharedAt) ? `<p class="tiny">Shared with you on ${escapeHtml(shortDateLabel(c.sharedAt))}. Reach out directly anytime.</p>` : ''}
    </div>`;
}

async function shareContactWith(btn) {
  const agentId = Number(btn.dataset.agentId);
  const agentName = btn.dataset.agentName || 'this agent';
  const preListingId = contactShareView.preListingId;
  if (!agentId || !preListingId) return;
  if (!confirm(`Share your contact info with ${agentName}? They'll see your exact address, phone number and email for this home, so they can reach you directly. You can stop sharing anytime (they won't see it here anymore).`)) return;
  btn.disabled = true;
  try {
    const { share } = await apiPost(`/api/pre-listings/${preListingId}/contact-shares`, { agentId });
    if (String(contactShareView.preListingId) !== String(preListingId)) return; // moved on to another home meanwhile
    contactShareView.shares.set(String(agentId), { agentId, agentName, ...shareIdentity(agentId), sharedAt: (share && share.sharedAt) || '' });
    refreshShareSlots(agentId, agentName);
    toast(`Shared with ${agentName}. They'll get a heads-up.`);
  } catch (err) { toast(contactErrorMessage(err), { durationMs: 7000 }); btn.disabled = false; }
}

async function stopSharingWith(btn) {
  const agentId = Number(btn.dataset.agentId);
  const agentName = btn.dataset.agentName || 'this agent';
  const preListingId = contactShareView.preListingId;
  if (!agentId || !preListingId) return;
  if (!confirm(`Stop sharing your contact info with ${agentName}? They won't see your address, phone or email here anymore (they may already have noted them).`)) return;
  btn.disabled = true;
  try {
    await apiDelete(`/api/pre-listings/${preListingId}/contact-shares/${agentId}`);
    if (String(contactShareView.preListingId) !== String(preListingId)) return;
    contactShareView.shares.delete(String(agentId));
    refreshShareSlots(agentId, agentName);
    toast(`Stopped sharing with ${agentName}.`);
  } catch (err) { toast(contactErrorMessage(err)); btn.disabled = false; }
}

// The DRE number and brokerage for an agent on the open pre-listing, from their proposal or price opinion, so a new
// share's row in the panel carries the identity line right away (before the next reload).
function shareIdentity(agentId) {
  const fromBid = proposalView && (proposalView.bids || []).find(b => String(b.agentUserId) === String(agentId));
  const fromOpinion = (lastPriceOpinions && lastPriceOpinions.opinions || []).find(o => String(o.agentUserId) === String(agentId));
  const src = fromBid || fromOpinion || {};
  return { licenseNumber: src.licenseNumber || '', brokerageName: src.brokerageName || '' };
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
    const data = await apiGet(`/api/pre-listings/${id}`);
    const { preListing: p, bids, myBid, myVote, priceOpinions, isOwner, myOpinionTrail, myRefreshAsk } = data;
    marketplaceDetail = { kind: 'pre_listing', id };
    showMarketplaceDetail();

    const photosHtml = p.photoIds.length
      ? `<div class="photo-gallery">${p.photoIds.map(pid => `<img src="/api/pre-listing-photos/${pid}" alt="${escapeHtml(homePhotoAlt(p))}" loading="lazy" class="media-thumb">`).join('')}</div>`
      : '';
    const isAwardedAgent = !isOwner && myBid && myBid.status === 'accepted';
    const isApprovedAgentViewer = !isOwner && !!currentAgentProfile && currentAgentProfile.status === 'approved';
    const priceOpen = isPriceOpen(p);
    // Owner only: who they're sharing their contact info with, and every agent the exact address was shown to.
    // (Read from the top level or the pre-listing object, whichever the API puts them on.)
    setContactShareView(id, isOwner, p.status === 'open' || p.status === 'awarded', data.contactShares || p.contactShares || [], data.addressViews || p.addressViews || []);
    // An agent the homeowner chose to share their contact info with.
    const sharedContact = !isOwner ? (data.sharedContact || p.sharedContact || null) : null;
    const opinionCount = isOwner && priceOpinions ? priceOpinions.opinions.filter(o => o.priceOpinion).length : null;
    lastPriceOpinions = isOwner ? priceOpinions : null;
    // The owner's tools, one segment each. ownerToolsHtml (ready-meter.js) orders them by the owner's latest check-in;
    // the facts card above (with the lender note) never moves.
    const ownerSegments = isOwner ? {
      video: renderVideoTourPanel(p, true),
      opinions: renderPriceOpinionsPanel(priceOpinions, id),
      agent_view: agentViewOwnerPanelHtml(p),
      address: `<div id="addressPrivacyPanel">${addressPrivacyPanelHtml()}</div>`,
      edit: p.status === 'open' ? renderPreListingEditForm(p) : '',
      disclosures: renderDisclosuresChecklist(p),
      listing_ready: renderListingReadyPanel(p),
      timing: renderTimingPanel(p),
      previews: '<div id="previewsPanel"></div>',
      interviews: '<div id="interviewsPanel"></div>',
      showings: '<div id="showingsPanel"></div>',
      decision_night: decisionNightOwnerHtml(p, bids),
      proposals: `${p.decisionNight && p.decisionNight.sealed ? sealedProposalsHtml(p.decisionNight)
          : `${renderTakeHomePanel(p, bids)}${renderProposalsSection(bids, `pre-listing-${id}`, { feeSort: true, startPrice: takeHomeStartPrice(p), preListingId: id })}`}
        ${p.status === 'open' ? renderInviteAgentPanel() : ''}
        ${p.status === 'awarded' ? `<div id="milestonesPanel"></div>${renderRulesReportPanel(hiredAgentOf(bids))}${renderReviewForm()}` : ''}`,
    } : null;

    contentEl.innerHTML = `
      <div class="card" id="preListingViewCard">
        <div class="card-head"><h2>${escapeHtml(p.title || p.propertyType)}</h2><span class="card-badges">${pausedBadgeHtml(p)}<span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${p.status}</span></span></div>
        <div class="mini-block">${escapeHtml(p.propertyType)} · ${p.beds}bd/${p.baths}ba${p.sqft ? ` · ${p.sqft.toLocaleString('en-US')} sqft` : ''} in ${escapeHtml(p.neighborhood ? p.neighborhood + ', ' : '')}${escapeHtml(p.city)}, ${escapeHtml(p.state)} ${escapeHtml(p.zip)}<br>${priceOpen ? `<span class="price-open">${PRICE_OPEN_LABEL}</span>` : `${money(p.askingPrice)} asking`}</div>
        ${isOwner && p.address ? `<p class="tiny"><span class="label">Street address (private)</span> ${escapeHtml(p.address)}</p>` : ''}
        <div class="mini-two">
          <div class="mini-block"><span class="label">Occupancy</span>${p.occupancyStatus === 'vacant' ? 'Vacant' : 'Occupied'} during the sale</div>
          <div class="mini-block"><span class="label">Showing notice</span>${p.showingNoticeHours > 0 ? `${p.showingNoticeHours} hours required` : 'None required'}</div>
        </div>
        ${timingFactsHtml(p, isOwner)}
        ${p.specialInstructions ? `<p class="tiny"><span class="label">Notes for agents</span> ${escapeHtml(p.specialInstructions)}</p>` : ''}
        ${homeCostsDetailHtml(p.costs)}
        ${renderStipulations(p)}
        ${p.distanceMiles !== null && p.distanceMiles !== undefined ? `<p class="tiny">${p.inServiceArea ? `✅ ${p.distanceMiles} miles from your nearest service zip — within your 20-mile area.` : `⚠️ ${p.distanceMiles} miles from your nearest service zip — outside your declared 20-mile area.`}</p>` : ''}
        ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
        ${photosHtml}
        <p class="tiny">${voteSummary(p.votes, 'Agent votes', p.status, { priceOpen, opinionCount })}</p>
        ${zipCoverageHtml(p, isOwner, myVote)}
        ${!isOwner && p.agentView ? agentViewStripHtml(p.agentView) : ''}
        ${isOwner && p.agentsOnDuty > 0 ? `<p class="tiny on-duty-line">🟢 ${p.agentsOnDuty} agent${p.agentsOnDuty === 1 ? '' : 's'} who serve${p.agentsOnDuty === 1 ? 's' : ''} ${escapeHtml(p.zip)} ${p.agentsOnDuty === 1 ? 'is' : 'are'} on duty right now.</p>` : ''}
        ${p.buyerDemand ? `<p class="demand-meter">👀 <strong>${p.buyerDemand} buyers</strong> on Amico Haus are looking for a home like this in ${escapeHtml(p.city)}${priceOpen ? '' : ' at this price'}.</p>` : ''}
        ${isOwner ? timingDemandHtml(p) : ''}
        ${renderPriceHistory(p.priceHistory)}
        ${isOwner ? `<p class="form-note trust"><strong>Talk to a lender.</strong> If selling here means financing your next place, rates, loan programs and approvals come from lenders, not from websites or real estate agents. Talk to your own mortgage broker, or use our preferred lender, <strong>Point Mortgage Corporation</strong> (NMLS #231073), at <a href="tel:+16194754095">(619) 475-4095</a>. You are always free to choose any lender you like, and you can verify any lender's license at nmlsconsumeraccess.org.</p>` : ''}
        ${isOwner ? renderPreListingOwnerBar(p) : ''}
      </div>
      ${isOwner
        ? `${readyCheckInHtml(p)}${ownerToolsHtml(ownerSegments, p.readyMeter)}`
        : `${sharedContactHtml(sharedContact)}
      ${isApprovedAgentViewer ? renderVideoTourPanel(p, false) : ''}
      ${isApprovedAgentViewer ? '<div id="previewsPanel"></div><div id="interviewsPanel"></div>' : ''}
      ${currentAgentProfile && currentAgentProfile.status === 'approved'
          ? (isAwardedAgent
            ? `<div id="milestonesPanel"></div>${renderRulesReportPanel({ userId: p.userId, name: p.owner, isHomeowner: true })}`
            : `${agentDecisionLineHtml(p)}${agentRefreshHtml(p, myRefreshAsk, myOpinionTrail, myVote)}${renderBidFormAndVote(myBid, myVote, p.status === 'open', { paused: p.status === 'open' && !!p.proposalsPaused && !p.invitedByOwner, priceOpen })}${agentPitchHtml(p, myBid)}${p.status === 'open' ? renderRequestShowingForm() : ''}`)
          : `<p class="tiny">Only approved agents can submit proposals or vote on pricing.</p>${preListingTeaserNoteHtml()}`}`}
    `;
    if (!isOwner && currentAgentProfile && currentAgentProfile.status === 'approved' && !isAwardedAgent && document.getElementById('bidServicesEditor')) {
      renderServicesEditor('bidServicesEditor', myBid ? myBid.services : []);
    }
    if (opts.edit && isOwner && p.status === 'open') showPreListingEditor(true);
    if (p.status === 'awarded' && (isOwner || isAwardedAgent)) loadMilestonesInto('pre_listing', id);
    if (isOwner && p.status === 'open') loadInvitedAgentsInto('pre_listing', id);
    if (isOwner) loadShowingsInto(id, true);
    if (isOwner || isApprovedAgentViewer) {
      loadPreviewsInto(id, isOwner, p.status);
      loadInterviewsInto(id, isOwner, bids, p.status);
    }
    if (!isOwner && currentAgentProfile && currentAgentProfile.status === 'approved' && !isAwardedAgent && p.status === 'open') loadShowingsInto(id, false);
  } catch (e) {
    // Homeowners, buyers and agents still waiting on approval can't open a pre-listing: say so, with a way to post one.
    if (apiErrorCode(e) === 'agents_only') {
      marketplaceDetail = { kind: 'pre_listing', id };
      showMarketplaceDetail();
      contentEl.innerHTML = `<div class="card">${preListingTeaserNoteHtml()}</div>`;
      return;
    }
    contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function openTransactionDetail(id) {
  const contentEl = document.getElementById('marketplaceDetailContent');
  try {
    const { transaction: t, bids, myBid, isParty, needsMyConfirmation, awaitingPartner, dualAgencyNote } = await apiGet(`/api/transactions/${id}`);
    marketplaceDetail = { kind: 'transaction', id };
    showMarketplaceDetail();
    const isAwardedAgent = !isParty && myBid && myBid.status === 'accepted';

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(t.listingA.owner)} ⇄ ${escapeHtml(t.listingB.owner)}</h2><span class="badge ${t.status === 'open' ? 'badge-active' : 'badge-paused'}">${t.status}</span></div>
        <div class="mini-two">
          <div class="mini-block"><span class="label">${escapeHtml(t.listingA.owner)} has</span>${escapeHtml(t.listingA.propertyType)} in ${escapeHtml(t.listingA.city)}, ${escapeHtml(t.listingA.state)}<br>${money(t.listingA.estimatedValue)} <span class="tiny">(owner's estimate)</span></div>
          <div class="mini-block"><span class="label">${escapeHtml(t.listingB.owner)} has</span>${escapeHtml(t.listingB.propertyType)} in ${escapeHtml(t.listingB.city)}, ${escapeHtml(t.listingB.state)}<br>${money(t.listingB.estimatedValue)} <span class="tiny">(owner's estimate)</span></div>
        </div>
        ${t.note ? `<p>${escapeHtml(t.note)}</p>` : ''}
        ${needsMyConfirmation ? `<div class="inline-note">Your trade partner opened this request to agent proposals. Agents can't see it, send proposals or be hired until you confirm. <button type="button" class="btn btn-primary btn-sm" data-action="confirm-trade">Confirm this trade request</button></div>` : ''}
        ${awaitingPartner ? "<p class=\"inline-note\">Waiting for your trade partner to confirm. Agents can't see this request until they do.</p>" : ''}
        <p class="tiny">Coordinate with your trade partner via messages before accepting a proposal.</p>
        <p class="tiny dual-agency-note">${escapeHtml(dualAgencyNote || DUAL_AGENCY_NOTE)}</p>
      </div>
      ${isParty
        ? `${renderProposalsSection(bids, `transaction-${id}`)}
           ${t.status === 'open' ? renderInviteAgentPanel() : ''}
           ${t.status === 'awarded' ? `<div id="milestonesPanel"></div>${renderRulesReportPanel(hiredAgentOf(bids))}${renderReviewForm()}` : ''}`
        : (currentAgentProfile && currentAgentProfile.status === 'approved'
          ? (isAwardedAgent
            ? '<div id="milestonesPanel"></div>'
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
  loadAugmentedFavorites();
  loadAugmentedBrowse();
}

function adaptationLabel(key) {
  const item = ADAPTATION_ITEMS.find(i => i.key === key);
  return item ? item.label : key;
}

function augmentedHomeCardHtml(h, { mine } = {}) {
  return `
    <div class="card ${activityAccentClass(h.recentActivity)}">
      <div class="card-head">
        <h3>${escapeHtml(h.title || h.propertyType)}</h3>
        <span class="badge ${h.status === 'active' ? 'badge-active' : 'badge-paused'}">${h.status.replace('_', ' ')}</span>
      </div>
      ${activityRibbonHtml(h.recentActivity)}
      <div class="mini-block">${sparklineHtml(h.priceSeries)}${escapeHtml(h.propertyType)} · ${h.beds}bd/${h.baths}ba in ${escapeHtml(h.city)}, ${escapeHtml(h.state)}<br>${money(h.askingPrice)} asking${pricePerSqftLabel(h.askingPrice, h.sqft)} ${priceTrendBadge(h.priceSeries)}</div>
      <p class="tiny">${daysOnMarketLabel(h.createdAt)}</p>
      ${socialProofHtml(h.favoriteCount, h.commentCount)}
      <p class="tiny">${h.adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(adaptationLabel(k))}</span>`).join(' ')}</p>
      ${mine ? renderLifeEventTags(h.lifeEventTags) : ''}
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="open-augmented-home" data-id="${h.id}">View</button>
        ${!mine ? `<button type="button" class="btn btn-ghost btn-sm" data-action="toggle-compare" data-kind="augmented_home" data-id="${h.id}">${isInCompareTray('augmented_home', h.id) ? '✓ Comparing' : '⚖ Compare'}</button>` : ''}
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

const BROWSE_PAGE_SIZE = 60;
let augmentedBrowseOffset = 0;
let augmentedBrowseHasMore = false;

function augmentedBrowseParams() {
  const city = document.getElementById('augmentedCity').value.trim();
  const state = document.getElementById('augmentedState').value.trim();
  const wanted = [...document.querySelectorAll('.augmented-filter-check:checked')].map(c => c.value);
  const params = new URLSearchParams({ limit: String(BROWSE_PAGE_SIZE) });
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  wanted.forEach(k => params.append('adaptation', k));
  return { params, city, state };
}

async function loadAugmentedBrowse() {
  const el = document.getElementById('augmentedBrowseList');
  const { params, city, state } = augmentedBrowseParams();
  loadMomentumBanner('augmentedMomentum', 'augmented_home', city, state);
  try {
    const { homes, hasMore } = await apiGet(`/api/augmented-homes?${params.toString()}`);
    compareBrowseCache.augmented_home = homes;
    augmentedBrowseOffset = homes.length;
    augmentedBrowseHasMore = !!hasMore;
    document.getElementById('augmentedLoadMoreBtn')?.classList.toggle('hidden', !augmentedBrowseHasMore);
    el.innerHTML = homes.length ? homes.map(h => augmentedHomeCardHtml(h, { mine: false })).join('') : '<div class="empty-state">Nothing matching right now.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadMoreAugmentedBrowse() {
  if (!augmentedBrowseHasMore) return;
  const el = document.getElementById('augmentedBrowseList');
  const btn = document.getElementById('augmentedLoadMoreBtn');
  const { params } = augmentedBrowseParams();
  params.set('offset', String(augmentedBrowseOffset));
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const { homes, hasMore } = await apiGet(`/api/augmented-homes?${params.toString()}`);
    compareBrowseCache.augmented_home = [...compareBrowseCache.augmented_home, ...homes];
    augmentedBrowseOffset += homes.length;
    augmentedBrowseHasMore = !!hasMore;
    btn?.classList.toggle('hidden', !augmentedBrowseHasMore);
    el.insertAdjacentHTML('beforeend', homes.map(h => augmentedHomeCardHtml(h, { mine: false })).join(''));
  } catch (e) { toast(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Load More'; }
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
  document.getElementById('augLifeEventFields').innerHTML = lifeEventCheckboxesHtml('aug-life-event-check');
  loadMyAugmentedHomes();
  loadMyAccessibilityAlerts();
  loadAugmentedFavorites();
  loadAugmentedBrowse();
}

async function loadAugmentedFavorites() {
  const el = document.getElementById('augmentedFavoritesList');
  try {
    const { homes } = await apiGet('/api/augmented-homes?favorites=1');
    el.innerHTML = homes.length ? homes.map(h => augmentedHomeCardHtml(h, { mine: false })).join('') : '<div class="empty-state">No favorites saved yet.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

// Always-open variant of renderPostCard's comments-block (no like/toggle/delete-post row — there's no
// visible "post", just the thread). Reuses the exact ids renderComments()/wireFeedEvents() already expect.
function dealThreadCardHtml(postId) {
  return `
    <div class="card about-card">
      <h2>Discussion</h2>
      <div class="comments-block" id="comments-${postId}">
        <div class="comments-list" id="comments-list-${postId}"></div>
        <form class="comment-form" data-post-id="${postId}">
          <input type="text" maxlength="1000" placeholder="Write a comment…" aria-label="Write a comment" required>
          <button type="submit" class="btn btn-ghost btn-sm">Send</button>
        </form>
        <p class="tiny composer-note">${escapeHtml(HOME_TEXT_NOTE)}</p>
      </div>
    </div>
  `;
}

async function openAugmentedHomeDetail(id) {
  const contentEl = document.getElementById('augmentedDetailContent');
  try {
    const [{ home: h, isOwner }, { postId }] = await Promise.all([
      apiGet(`/api/augmented-homes/${id}`),
      apiGet(`/api/augmented-homes/${id}/thread`),
    ]);
    augmentedDetail = { id, isOwner, ownerId: h.userId };
    showAugmentedDetail();
    const photosHtml = h.photoIds.length
      ? `<div class="photo-gallery">${h.photoIds.map(pid => isOwner
          ? `<div class="photo-thumb"><img src="/api/augmented-home-photos/${pid}" alt="${escapeHtml(homePhotoAlt(h))}" loading="lazy"><button type="button" class="photo-delete" data-action="delete-augmented-photo" data-id="${pid}">✕</button></div>`
          : `<img src="/api/augmented-home-photos/${pid}" alt="${escapeHtml(homePhotoAlt(h))}" loading="lazy" class="media-thumb">`).join('')}</div>`
      : '';
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(h.title || h.propertyType)}</h2><span class="badge ${h.status === 'active' ? 'badge-active' : 'badge-paused'}">${h.status.replace('_', ' ')}</span></div>
        <div class="mini-block">${escapeHtml(h.propertyType)} · ${h.beds}bd/${h.baths}ba${h.sqft ? ` · ${h.sqft.toLocaleString('en-US')} sqft` : ''} in ${escapeHtml(h.neighborhood ? h.neighborhood + ', ' : '')}${escapeHtml(h.city)}, ${escapeHtml(h.state)} ${escapeHtml(h.zip)}<br>${money(h.askingPrice)} asking</div>
        ${isOwner ? renderLifeEventTags(h.lifeEventTags) : ''}
        ${h.description ? `<p>${escapeHtml(h.description)}</p>` : ''}
        ${photosHtml}
        <h3>Adaptations</h3>
        <p class="tiny">${h.adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(adaptationLabel(k))}</span>`).join(' ')}</p>
        ${isOwner ? `<div class="form-actions"><a class="btn btn-ghost btn-sm" href="/augmented-home/${h.id}/flyer" target="_blank" rel="noopener noreferrer">🖨️ Print Flyer</a> <a class="btn btn-ghost btn-sm" href="/api/augmented-homes/${h.id}/performance.csv" download>📊 Export Performance</a> <button type="button" class="btn btn-danger btn-sm" data-action="delete-augmented-home" data-id="${h.id}">Delete Listing</button></div>` : ''}
        ${h.adaptationNotes ? `<p class="tiny"><span class="label">Seller's notes</span> ${escapeHtml(h.adaptationNotes)}</p>` : ''}
        ${homeCostsDetailHtml(h.costs)}
        ${isOwner ? `<div class="panel home-costs-editor">${homeCostsFieldsHtml('ahc', h.costs)}<div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="save-home-costs" data-kind="augmented_home" data-id="${h.id}" data-prefix="ahc">Save Mello-Roos and HOA</button></div></div>` : ''}
        ${renderPriceHistory(h.priceHistory)}
        ${sparklineHtml(seriesFromPriceHistory(h.priceHistory, h.askingPrice))}
        ${!isOwner ? `
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" data-action="message-user" data-id="${h.userId}" data-name="${escapeHtml(h.owner)}">Message Seller</button>
            <button class="btn ${h.isFavorited ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="toggle-augmented-favorite" data-id="${h.id}">${h.isFavorited ? '♥ Saved' : '♡ Save'}</button>
          </div>` : ''}
        ${h.status === 'active' ? `<p class="tiny"><a href="/augmented-home/${h.id}" target="_blank" rel="noopener noreferrer">View Public Page ↗</a></p>` : ''}
      </div>

      <div class="card about-card">
        <h2>Open Houses</h2>
        <div id="augmentedOpenHouses-${h.id}"><span class="tiny">Loading…</span></div>
        ${isOwner ? `
          <div class="form-row two-col">
            <input type="datetime-local" id="augOhStart-${h.id}">
            <input type="datetime-local" id="augOhEnd-${h.id}">
          </div>
          <div class="field"><input type="text" id="augOhNote-${h.id}" maxlength="300" placeholder="Note (optional)"></div>
          <div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="add-augmented-open-house" data-id="${h.id}">Schedule</button></div>
        ` : ''}
      </div>

      <div class="card about-card">
        <h2>Offers</h2>
        <div id="augmentedOffers-${h.id}"><span class="tiny">Loading…</span></div>
      </div>

      ${dealThreadCardHtml(postId)}
    `;
    loadAugmentedOpenHousesInto(h.id);
    loadAugmentedOffersInto(h.id, isOwner);
    renderComments(postId);
  } catch (e) { contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadAugmentedOpenHousesInto(homeId) {
  const el = document.getElementById(`augmentedOpenHouses-${homeId}`);
  if (!el) return;
  try {
    const { openHouses } = await apiGet(`/api/augmented-homes/${homeId}/open-houses`);
    el.innerHTML = openHouses.length ? openHouses.map(oh => `
      <div class="side" data-open-house-id="${oh.id}">
        <strong>${new Date(oh.startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
        <span class="tiny" data-rsvp-count>${oh.rsvpCount} ${oh.rsvpCount === 1 ? 'person is' : 'people are'} going${oh.note ? ` — ${escapeHtml(oh.note)}` : ''}</span>
        <div class="card-actions">
          <button type="button" class="btn ${oh.imGoing ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="rsvp-augmented-open-house" data-home-id="${homeId}" data-id="${oh.id}">${oh.imGoing ? "I'm Going ✓" : "I'm Going"}</button>
          <button type="button" class="link-btn" data-action="delete-augmented-open-house" data-home-id="${homeId}" data-id="${oh.id}">Cancel</button>
        </div>
      </div>
    `).join('') : '<span class="tiny">None scheduled.</span>';
  } catch { el.innerHTML = '<span class="tiny">Could not load open houses.</span>'; }
}

async function loadAugmentedOffersInto(homeId, isOwner) {
  const el = document.getElementById(`augmentedOffers-${homeId}`);
  if (!el) return;
  try {
    const { offers, myOffer } = await apiGet(`/api/augmented-homes/${homeId}/offers`);
    if (isOwner) {
      el.innerHTML = offers.length ? `<p class="tiny">${escapeHtml(OFFER_OWNER_NOTE)}</p>` + offers.map(o => `
        <div class="side">
          <strong>${money(o.offerPrice)} — ${o.financingType === 'cash' ? 'Cash' : 'Financed'}</strong>
          <span class="tiny">From <a class="profile-link" href="/profile/${o.buyerUserId}">${escapeHtml(o.buyerName)}</a>${o.buyerLicense ? ` · DRE #${escapeHtml(o.buyerLicense)} on file${o.buyerBrokerage ? ' · ' + escapeHtml(o.buyerBrokerage) : ''}` : ''} · ${reportUserButtonHtml(o.buyerUserId)} · <span class="badge ${o.status === 'accepted' ? 'badge-active' : o.status === 'declined' || o.status === 'withdrawn' ? 'badge-paused' : ''}">${o.status}</span></span>
          ${o.closingTimeline ? `<p class="tiny"><span class="label">Timeline</span> ${escapeHtml(o.closingTimeline)}</p>` : ''}
          ${o.contingencies ? `<p class="tiny"><span class="label">Contingencies</span> ${escapeHtml(o.contingencies)}</p>` : ''}
          ${o.message ? `<p class="tiny">"${escapeHtml(o.message)}"</p>` : ''}
          ${o.status === 'pending' ? `
            <div class="card-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="decide-augmented-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="accept">Accept</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="decide-augmented-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="decline">Decline</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="message-user" data-id="${o.buyerUserId}" data-name="${escapeHtml(o.buyerName)}">Message</button>
            </div>
            ${offerToolsNoteHtml()}
            <details class="panel">
              <summary>Counter this offer</summary>
              <div class="field"><label for="augCounterPrice-${o.id}">Counter price ($)</label><input type="number" id="augCounterPrice-${o.id}" min="1" max="500000000" step="1000"></div>
              <div class="field"><label for="augCounterMsg-${o.id}">Message (optional)</label><textarea id="augCounterMsg-${o.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
              <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-augmented-offer" data-home-id="${homeId}" data-id="${o.id}">Send Counter</button></div>
            </details>` : ''}
          ${o.status === 'countered' && o.counteredBy === 'owner' ? `<p class="tiny"><span class="label">Your counter</span> ${money(o.counterPrice)}${o.counterMessage ? ` — "${escapeHtml(o.counterMessage)}"` : ''} · waiting on buyer</p>` : ''}
          ${o.status === 'countered' && o.counteredBy === 'buyer' ? `
            <p class="tiny"><span class="label">Buyer countered</span> ${money(o.counterPrice)}${o.counterMessage ? ` — "${escapeHtml(o.counterMessage)}"` : ''}</p>
            <div class="card-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="decide-augmented-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="accept_counter">Accept ${money(o.counterPrice)}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="decide-augmented-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="decline_counter">Decline</button>
            </div>
            ${offerToolsNoteHtml()}
            <details class="panel">
              <summary>Counter again</summary>
              <div class="field"><label for="augCounterPrice-${o.id}">Counter price ($)</label><input type="number" id="augCounterPrice-${o.id}" min="1" max="500000000" step="1000"></div>
              <div class="field"><label for="augCounterMsg-${o.id}">Message (optional)</label><textarea id="augCounterMsg-${o.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
              <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-augmented-offer" data-home-id="${homeId}" data-id="${o.id}">Send Counter</button></div>
            </details>` : ''}
        </div>
      `).join('') : '<span class="tiny">No offers yet.</span>';
      return;
    }

    // Buyer's own view
    if (myOffer && myOffer.status === 'pending') {
      el.innerHTML = `
        <div class="side">
          <strong>${money(myOffer.offerPrice)}</strong> — ${myOffer.financingType === 'cash' ? 'Cash' : 'Financed'} <span class="badge">pending</span>
          <div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-augmented-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Withdraw Offer</button></div>
        </div>`;
    } else if (myOffer && myOffer.status === 'countered' && myOffer.counteredBy === 'owner') {
      el.innerHTML = `
        <div class="side">
          <strong>${money(myOffer.offerPrice)}</strong> — ${myOffer.financingType === 'cash' ? 'Cash' : 'Financed'} <span class="badge">countered</span>
          <p class="tiny"><span class="label">Seller's counter</span> ${money(myOffer.counterPrice)}${myOffer.counterMessage ? ` — "${escapeHtml(myOffer.counterMessage)}"` : ''}</p>
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="decide-augmented-offer" data-home-id="${homeId}" data-id="${myOffer.id}" data-decision="accept_counter">Accept ${money(myOffer.counterPrice)}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="decide-augmented-offer" data-home-id="${homeId}" data-id="${myOffer.id}" data-decision="decline_counter">Decline</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-augmented-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Withdraw</button>
          </div>
          ${offerToolsNoteHtml()}
          <details class="panel">
            <summary>Counter back</summary>
            <div class="field"><label for="augCounterBackPrice-${myOffer.id}">Counter price ($)</label><input type="number" id="augCounterBackPrice-${myOffer.id}" min="1" max="500000000" step="1000"></div>
            <div class="field"><label for="augCounterBackMsg-${myOffer.id}">Message (optional)</label><textarea id="augCounterBackMsg-${myOffer.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
            <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-augmented-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Send Counter</button></div>
          </details>
        </div>`;
    } else if (myOffer && myOffer.status === 'countered' && myOffer.counteredBy === 'buyer') {
      el.innerHTML = `
        <div class="side">
          <strong>${money(myOffer.counterPrice)}</strong>${myOffer.counterMessage ? ` — "${escapeHtml(myOffer.counterMessage)}"` : ''} <span class="badge">countered</span>
          <p class="tiny">Waiting on the seller to respond.</p>
          <div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-augmented-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Withdraw Offer</button></div>
        </div>`;
    } else if (myOffer && myOffer.status !== 'pending') {
      el.innerHTML = `<div class="side"><strong>${money(myOffer.offerPrice)}</strong> — <span class="badge">${myOffer.status}</span></div>`;
    } else {
      el.innerHTML = `
        <div class="field"><label for="augOfferPrice-${homeId}">Offer price ($)</label><input type="number" id="augOfferPrice-${homeId}" min="1" max="500000000" step="1000"></div>
        <div class="field"><label for="augOfferFinancingType-${homeId}">Financing</label><select id="augOfferFinancingType-${homeId}"><option value="financed">Financed</option><option value="cash">Cash</option></select></div>
        <div class="field"><label for="augOfferClosingTimeline-${homeId}">Proposed closing timeline</label><input type="text" id="augOfferClosingTimeline-${homeId}" maxlength="100" placeholder="e.g. 30 days"></div>
        <div class="field"><label for="augOfferContingencies-${homeId}">Contingencies</label><input type="text" id="augOfferContingencies-${homeId}" maxlength="500" placeholder="e.g. subject to inspection, financing approval"></div>
        <div class="field"><label for="augOfferMessage-${homeId}">Note about your terms (optional)</label><textarea id="augOfferMessage-${homeId}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
        <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="submit-augmented-offer" data-home-id="${homeId}">Submit Offer</button></div>
        ${offerToolsNoteHtml()}
      `;
    }
    const sellerId = augmentedDetail && String(augmentedDetail.id) === String(homeId) ? augmentedDetail.ownerId : null;
    if (myOffer && sellerId) el.insertAdjacentHTML('beforeend', `<div class="tiny">Problem with this seller? ${reportUserButtonHtml(sellerId)}</div>`);
  } catch { el.innerHTML = '<span class="tiny">Could not load offers.</span>'; }
}

/* ---------------- GreenHomes ---------------- */
let greenDetail = null; // { id }

function showGreenDetail() {
  document.getElementById('greenListView').classList.add('hidden');
  document.getElementById('greenDetailView').classList.remove('hidden');
  document.getElementById('greenDetailView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backToGreenList() {
  greenDetail = null;
  document.getElementById('greenDetailView').classList.add('hidden');
  document.getElementById('greenListView').classList.remove('hidden');
  loadMyGreenHomes();
  loadGreenFavorites();
  loadGreenBrowse();
}

function greenHomeCardHtml(h, { mine } = {}) {
  return `
    <div class="card ${activityAccentClass(h.recentActivity)}">
      <div class="card-head">
        <h3>${escapeHtml(h.title || h.propertyType)}</h3>
        <span class="badge ${h.status === 'active' ? 'badge-active' : 'badge-paused'}">${h.status.replace('_', ' ')}</span>
      </div>
      ${activityRibbonHtml(h.recentActivity)}
      <div class="mini-block">${sparklineHtml(h.priceSeries)}${escapeHtml(h.propertyType)} · ${h.beds}bd/${h.baths}ba in ${escapeHtml(h.city)}, ${escapeHtml(h.state)}<br>${money(h.askingPrice)} asking${pricePerSqftLabel(h.askingPrice, h.sqft)} ${priceTrendBadge(h.priceSeries)}</div>
      <p class="tiny">${daysOnMarketLabel(h.createdAt)}</p>
      ${socialProofHtml(h.favoriteCount, h.commentCount)}
      <p class="tiny">${h.greenFeatures.map(k => `<span class="badge badge-gold">${escapeHtml(greenFeatureLabel(k))}</span>`).join(' ')}</p>
      ${mine ? renderLifeEventTags(h.lifeEventTags) : ''}
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="open-green-home" data-id="${h.id}">View</button>
        ${!mine ? `<button type="button" class="btn btn-ghost btn-sm" data-action="toggle-compare" data-kind="green_home" data-id="${h.id}">${isInCompareTray('green_home', h.id) ? '✓ Comparing' : '⚖ Compare'}</button>` : ''}
        ${mine && h.status === 'active' ? `
          <button class="btn btn-ghost btn-sm" data-action="green-set-status" data-id="${h.id}" data-status="under_contract">Mark Under Contract</button>
          <button class="btn btn-ghost btn-sm" data-action="green-set-status" data-id="${h.id}" data-status="sold">Mark Sold</button>
          <button class="btn btn-ghost btn-sm" data-action="green-set-status" data-id="${h.id}" data-status="withdrawn">Withdraw</button>` : ''}
      </div>
    </div>
  `;
}

async function loadMyGreenHomes() {
  const el = document.getElementById('myGreenHomesList');
  try {
    const { homes } = await apiGet('/api/green-homes?mine=1');
    el.innerHTML = homes.length ? homes.map(h => greenHomeCardHtml(h, { mine: true })).join('') : '<div class="empty-state">You haven\'t listed a home yet.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

let greenBrowseOffset = 0;
let greenBrowseHasMore = false;

function greenBrowseParams() {
  const city = document.getElementById('greenFilterCity').value.trim();
  const state = document.getElementById('greenFilterState').value.trim();
  const wanted = [...document.querySelectorAll('.green-filter-check:checked')].map(c => c.value);
  const params = new URLSearchParams({ limit: String(BROWSE_PAGE_SIZE) });
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  wanted.forEach(k => params.append('feature', k));
  return { params, city, state };
}

async function loadGreenBrowse() {
  const el = document.getElementById('greenBrowseList');
  const { params, city, state } = greenBrowseParams();
  loadMomentumBanner('greenMomentum', 'green_home', city, state);
  try {
    const { homes, hasMore } = await apiGet(`/api/green-homes?${params.toString()}`);
    compareBrowseCache.green_home = homes;
    greenBrowseOffset = homes.length;
    greenBrowseHasMore = !!hasMore;
    document.getElementById('greenLoadMoreBtn')?.classList.toggle('hidden', !greenBrowseHasMore);
    el.innerHTML = homes.length ? homes.map(h => greenHomeCardHtml(h, { mine: false })).join('') : '<div class="empty-state">Nothing matching right now.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadMoreGreenBrowse() {
  if (!greenBrowseHasMore) return;
  const el = document.getElementById('greenBrowseList');
  const btn = document.getElementById('greenLoadMoreBtn');
  const { params } = greenBrowseParams();
  params.set('offset', String(greenBrowseOffset));
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const { homes, hasMore } = await apiGet(`/api/green-homes?${params.toString()}`);
    compareBrowseCache.green_home = [...compareBrowseCache.green_home, ...homes];
    greenBrowseOffset += homes.length;
    greenBrowseHasMore = !!hasMore;
    btn?.classList.toggle('hidden', !greenBrowseHasMore);
    el.insertAdjacentHTML('beforeend', homes.map(h => greenHomeCardHtml(h, { mine: false })).join(''));
  } catch (e) { toast(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Load More'; }
}

async function loadMyGreenAlerts() {
  const el = document.getElementById('greenAlertsList');
  try {
    const { alerts } = await apiGet('/api/green-needs-alerts');
    el.innerHTML = alerts.length ? alerts.map(a => `
      <div class="side">
        <strong>${escapeHtml(a.label)}</strong>
        <span class="tiny">${a.greenFeatures.map(k => escapeHtml(greenFeatureLabel(k))).join(', ')}${a.city || a.state ? ` · ${escapeHtml(a.city)}${a.city && a.state ? ', ' : ''}${escapeHtml(a.state)}` : ''}</span>
        <button class="link-btn" data-action="delete-green-alert" data-id="${a.id}">Remove</button>
      </div>
    `).join('') : '<span class="tiny">No saved alerts yet.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

async function loadGreenTab() {
  document.getElementById('greenDetailView').classList.add('hidden');
  document.getElementById('greenListView').classList.remove('hidden');
  fillTypeSelect(document.getElementById('greenPropertyType'), false);
  document.getElementById('greenFeaturesFields').innerHTML = greenFeatureCheckboxesHtml([], 'green-create-check');
  document.getElementById('greenAlertFeaturesFields').innerHTML = greenFeatureCheckboxesHtml([], 'green-alert-check');
  document.getElementById('greenFilterChips').innerHTML = greenFeatureCheckboxesHtml([], 'green-filter-check');
  document.getElementById('greenLifeEventFields').innerHTML = lifeEventCheckboxesHtml('green-life-event-check');
  loadMyGreenHomes();
  loadMyGreenAlerts();
  loadGreenFavorites();
  loadGreenBrowse();
}

async function loadGreenFavorites() {
  const el = document.getElementById('greenFavoritesList');
  try {
    const { homes } = await apiGet('/api/green-homes?favorites=1');
    el.innerHTML = homes.length ? homes.map(h => greenHomeCardHtml(h, { mine: false })).join('') : '<div class="empty-state">No favorites saved yet.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function openGreenHomeDetail(id) {
  const contentEl = document.getElementById('greenDetailContent');
  try {
    const [{ home: h, isOwner }, { postId }] = await Promise.all([
      apiGet(`/api/green-homes/${id}`),
      apiGet(`/api/green-homes/${id}/thread`),
    ]);
    greenDetail = { id, isOwner, ownerId: h.userId };
    showGreenDetail();
    const photosHtml = h.photoIds.length
      ? `<div class="photo-gallery">${h.photoIds.map(pid => isOwner
          ? `<div class="photo-thumb"><img src="/api/green-home-photos/${pid}" alt="${escapeHtml(homePhotoAlt(h))}" loading="lazy"><button type="button" class="photo-delete" data-action="delete-green-photo" data-id="${pid}">✕</button></div>`
          : `<img src="/api/green-home-photos/${pid}" alt="${escapeHtml(homePhotoAlt(h))}" loading="lazy" class="media-thumb">`).join('')}</div>`
      : '';
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(h.title || h.propertyType)}</h2><span class="badge ${h.status === 'active' ? 'badge-active' : 'badge-paused'}">${h.status.replace('_', ' ')}</span></div>
        <div class="mini-block">${escapeHtml(h.propertyType)} · ${h.beds}bd/${h.baths}ba${h.sqft ? ` · ${h.sqft.toLocaleString('en-US')} sqft` : ''} in ${escapeHtml(h.neighborhood ? h.neighborhood + ', ' : '')}${escapeHtml(h.city)}, ${escapeHtml(h.state)} ${escapeHtml(h.zip)}<br>${money(h.askingPrice)} asking</div>
        ${isOwner ? renderLifeEventTags(h.lifeEventTags) : ''}
        ${h.description ? `<p>${escapeHtml(h.description)}</p>` : ''}
        ${photosHtml}
        <h3>Green Features</h3>
        <p class="tiny">${h.greenFeatures.map(k => `<span class="badge badge-gold">${escapeHtml(greenFeatureLabel(k))}</span>`).join(' ')}</p>
        ${isOwner ? `<div class="form-actions"><a class="btn btn-ghost btn-sm" href="/green-home/${h.id}/flyer" target="_blank" rel="noopener noreferrer">🖨️ Print Flyer</a> <a class="btn btn-ghost btn-sm" href="/api/green-homes/${h.id}/performance.csv" download>📊 Export Performance</a> <button type="button" class="btn btn-danger btn-sm" data-action="delete-green-home" data-id="${h.id}">Delete Listing</button></div>` : ''}
        ${h.featureNotes ? `<p class="tiny"><span class="label">Seller's notes</span> ${escapeHtml(h.featureNotes)}</p>` : ''}
        ${homeCostsDetailHtml(h.costs)}
        ${isOwner ? `<div class="panel home-costs-editor">${homeCostsFieldsHtml('ghc', h.costs)}<div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="save-home-costs" data-kind="green_home" data-id="${h.id}" data-prefix="ghc">Save Mello-Roos and HOA</button></div></div>` : ''}
        ${renderPriceHistory(h.priceHistory)}
        ${sparklineHtml(seriesFromPriceHistory(h.priceHistory, h.askingPrice))}
        ${!isOwner ? `
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" data-action="message-user" data-id="${h.userId}" data-name="${escapeHtml(h.owner)}">Message Seller</button>
            <button class="btn ${h.isFavorited ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="toggle-green-favorite" data-id="${h.id}">${h.isFavorited ? '♥ Saved' : '♡ Save'}</button>
          </div>` : ''}
        ${h.status === 'active' ? `<p class="tiny"><a href="/green-home/${h.id}" target="_blank" rel="noopener noreferrer">View Public Page ↗</a></p>` : ''}
      </div>

      <div class="card about-card">
        <h2>Open Houses</h2>
        <div id="greenOpenHouses-${h.id}"><span class="tiny">Loading…</span></div>
        ${isOwner ? `
          <div class="form-row two-col">
            <input type="datetime-local" id="greenOhStart-${h.id}">
            <input type="datetime-local" id="greenOhEnd-${h.id}">
          </div>
          <div class="field"><input type="text" id="greenOhNote-${h.id}" maxlength="300" placeholder="Note (optional)"></div>
          <div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="add-green-open-house" data-id="${h.id}">Schedule</button></div>
        ` : ''}
      </div>

      <div class="card about-card">
        <h2>Offers</h2>
        <div id="greenOffers-${h.id}"><span class="tiny">Loading…</span></div>
      </div>

      ${dealThreadCardHtml(postId)}
    `;
    loadGreenOpenHousesInto(h.id);
    loadGreenOffersInto(h.id, isOwner);
    renderComments(postId);
  } catch (e) { contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadGreenOpenHousesInto(homeId) {
  const el = document.getElementById(`greenOpenHouses-${homeId}`);
  if (!el) return;
  try {
    const { openHouses } = await apiGet(`/api/green-homes/${homeId}/open-houses`);
    el.innerHTML = openHouses.length ? openHouses.map(oh => `
      <div class="side" data-open-house-id="${oh.id}">
        <strong>${new Date(oh.startsAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
        <span class="tiny" data-rsvp-count>${oh.rsvpCount} ${oh.rsvpCount === 1 ? 'person is' : 'people are'} going${oh.note ? ` — ${escapeHtml(oh.note)}` : ''}</span>
        <div class="card-actions">
          <button type="button" class="btn ${oh.imGoing ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="rsvp-green-open-house" data-home-id="${homeId}" data-id="${oh.id}">${oh.imGoing ? "I'm Going ✓" : "I'm Going"}</button>
          <button type="button" class="link-btn" data-action="delete-green-open-house" data-home-id="${homeId}" data-id="${oh.id}">Cancel</button>
        </div>
      </div>
    `).join('') : '<span class="tiny">None scheduled.</span>';
  } catch { el.innerHTML = '<span class="tiny">Could not load open houses.</span>'; }
}

async function loadGreenOffersInto(homeId, isOwner) {
  const el = document.getElementById(`greenOffers-${homeId}`);
  if (!el) return;
  try {
    const { offers, myOffer } = await apiGet(`/api/green-homes/${homeId}/offers`);
    if (isOwner) {
      el.innerHTML = offers.length ? `<p class="tiny">${escapeHtml(OFFER_OWNER_NOTE)}</p>` + offers.map(o => `
        <div class="side">
          <strong>${money(o.offerPrice)} — ${o.financingType === 'cash' ? 'Cash' : 'Financed'}</strong>
          <span class="tiny">From <a class="profile-link" href="/profile/${o.buyerUserId}">${escapeHtml(o.buyerName)}</a>${o.buyerLicense ? ` · DRE #${escapeHtml(o.buyerLicense)} on file${o.buyerBrokerage ? ' · ' + escapeHtml(o.buyerBrokerage) : ''}` : ''} · ${reportUserButtonHtml(o.buyerUserId)} · <span class="badge ${o.status === 'accepted' ? 'badge-active' : o.status === 'declined' || o.status === 'withdrawn' ? 'badge-paused' : ''}">${o.status}</span></span>
          ${o.closingTimeline ? `<p class="tiny"><span class="label">Timeline</span> ${escapeHtml(o.closingTimeline)}</p>` : ''}
          ${o.contingencies ? `<p class="tiny"><span class="label">Contingencies</span> ${escapeHtml(o.contingencies)}</p>` : ''}
          ${o.message ? `<p class="tiny">"${escapeHtml(o.message)}"</p>` : ''}
          ${o.status === 'pending' ? `
            <div class="card-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="decide-green-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="accept">Accept</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="decide-green-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="decline">Decline</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="message-user" data-id="${o.buyerUserId}" data-name="${escapeHtml(o.buyerName)}">Message</button>
            </div>
            ${offerToolsNoteHtml()}
            <details class="panel">
              <summary>Counter this offer</summary>
              <div class="field"><label for="greenCounterPrice-${o.id}">Counter price ($)</label><input type="number" id="greenCounterPrice-${o.id}" min="1" max="500000000" step="1000"></div>
              <div class="field"><label for="greenCounterMsg-${o.id}">Message (optional)</label><textarea id="greenCounterMsg-${o.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
              <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-green-offer" data-home-id="${homeId}" data-id="${o.id}">Send Counter</button></div>
            </details>` : ''}
          ${o.status === 'countered' && o.counteredBy === 'owner' ? `<p class="tiny"><span class="label">Your counter</span> ${money(o.counterPrice)}${o.counterMessage ? ` — "${escapeHtml(o.counterMessage)}"` : ''} · waiting on buyer</p>` : ''}
          ${o.status === 'countered' && o.counteredBy === 'buyer' ? `
            <p class="tiny"><span class="label">Buyer countered</span> ${money(o.counterPrice)}${o.counterMessage ? ` — "${escapeHtml(o.counterMessage)}"` : ''}</p>
            <div class="card-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="decide-green-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="accept_counter">Accept ${money(o.counterPrice)}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="decide-green-offer" data-home-id="${homeId}" data-id="${o.id}" data-decision="decline_counter">Decline</button>
            </div>
            ${offerToolsNoteHtml()}
            <details class="panel">
              <summary>Counter again</summary>
              <div class="field"><label for="greenCounterPrice-${o.id}">Counter price ($)</label><input type="number" id="greenCounterPrice-${o.id}" min="1" max="500000000" step="1000"></div>
              <div class="field"><label for="greenCounterMsg-${o.id}">Message (optional)</label><textarea id="greenCounterMsg-${o.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
              <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-green-offer" data-home-id="${homeId}" data-id="${o.id}">Send Counter</button></div>
            </details>` : ''}
        </div>
      `).join('') : '<span class="tiny">No offers yet.</span>';
      return;
    }

    if (myOffer && myOffer.status === 'pending') {
      el.innerHTML = `
        <div class="side">
          <strong>${money(myOffer.offerPrice)}</strong> — ${myOffer.financingType === 'cash' ? 'Cash' : 'Financed'} <span class="badge">pending</span>
          <div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-green-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Withdraw Offer</button></div>
        </div>`;
    } else if (myOffer && myOffer.status === 'countered' && myOffer.counteredBy === 'owner') {
      el.innerHTML = `
        <div class="side">
          <strong>${money(myOffer.offerPrice)}</strong> — ${myOffer.financingType === 'cash' ? 'Cash' : 'Financed'} <span class="badge">countered</span>
          <p class="tiny"><span class="label">Seller's counter</span> ${money(myOffer.counterPrice)}${myOffer.counterMessage ? ` — "${escapeHtml(myOffer.counterMessage)}"` : ''}</p>
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="decide-green-offer" data-home-id="${homeId}" data-id="${myOffer.id}" data-decision="accept_counter">Accept ${money(myOffer.counterPrice)}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="decide-green-offer" data-home-id="${homeId}" data-id="${myOffer.id}" data-decision="decline_counter">Decline</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-green-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Withdraw</button>
          </div>
          ${offerToolsNoteHtml()}
          <details class="panel">
            <summary>Counter back</summary>
            <div class="field"><label for="greenCounterBackPrice-${myOffer.id}">Counter price ($)</label><input type="number" id="greenCounterBackPrice-${myOffer.id}" min="1" max="500000000" step="1000"></div>
            <div class="field"><label for="greenCounterBackMsg-${myOffer.id}">Message (optional)</label><textarea id="greenCounterBackMsg-${myOffer.id}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
            <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="counter-green-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Send Counter</button></div>
          </details>
        </div>`;
    } else if (myOffer && myOffer.status === 'countered' && myOffer.counteredBy === 'buyer') {
      el.innerHTML = `
        <div class="side">
          <strong>${money(myOffer.counterPrice)}</strong>${myOffer.counterMessage ? ` — "${escapeHtml(myOffer.counterMessage)}"` : ''} <span class="badge">countered</span>
          <p class="tiny">Waiting on the seller to respond.</p>
          <div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="withdraw-green-offer" data-home-id="${homeId}" data-id="${myOffer.id}">Withdraw Offer</button></div>
        </div>`;
    } else if (myOffer && myOffer.status !== 'pending') {
      el.innerHTML = `<div class="side"><strong>${money(myOffer.offerPrice)}</strong> — <span class="badge">${myOffer.status}</span></div>`;
    } else {
      el.innerHTML = `
        <div class="field"><label for="greenOfferPrice-${homeId}">Offer price ($)</label><input type="number" id="greenOfferPrice-${homeId}" min="1" max="500000000" step="1000"></div>
        <div class="field"><label for="greenOfferFinancingType-${homeId}">Financing</label><select id="greenOfferFinancingType-${homeId}"><option value="financed">Financed</option><option value="cash">Cash</option></select></div>
        <div class="field"><label for="greenOfferClosingTimeline-${homeId}">Proposed closing timeline</label><input type="text" id="greenOfferClosingTimeline-${homeId}" maxlength="100" placeholder="e.g. 30 days"></div>
        <div class="field"><label for="greenOfferContingencies-${homeId}">Contingencies</label><input type="text" id="greenOfferContingencies-${homeId}" maxlength="500" placeholder="e.g. subject to inspection, financing approval"></div>
        <div class="field"><label for="greenOfferMessage-${homeId}">Note about your terms (optional)</label><textarea id="greenOfferMessage-${homeId}" maxlength="1000"></textarea><p class="tiny field-hint composer-note">${escapeHtml(OFFER_MESSAGE_NOTE)}</p></div>
        <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="submit-green-offer" data-home-id="${homeId}">Submit Offer</button></div>
        ${offerToolsNoteHtml()}
      `;
    }
    const sellerId = greenDetail && String(greenDetail.id) === String(homeId) ? greenDetail.ownerId : null;
    if (myOffer && sellerId) el.insertAdjacentHTML('beforeend', `<div class="tiny">Problem with this seller? ${reportUserButtonHtml(sellerId)}</div>`);
  } catch { el.innerHTML = '<span class="tiny">Could not load offers.</span>'; }
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
  loadProjectFavorites();
  loadProjectsBrowse();
}

function projectCardHtml(p, { mine } = {}) {
  return `
    <div class="card ${activityAccentClass(p.recentActivity)}">
      <div class="card-head">
        <h3>${escapeHtml(p.title)}</h3>
        <span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${escapeHtml(PROJECT_STATUS_LABELS[p.status] || p.status)}</span>
      </div>
      ${activityRibbonHtml(p.recentActivity)}
      <div class="mini-block">${escapeHtml(PROJECT_TYPE_LABELS[p.projectType] || p.projectType)} · ${escapeHtml(PROJECT_STAGE_LABELS[p.stage] || p.stage)} in ${escapeHtml(p.city)}, ${escapeHtml(p.state)}${p.timelineMonths ? `<br>About ${Number(p.timelineMonths)} months` : ''}</div>
      <p class="tiny">${daysOnMarketLabel(p.createdAt)}</p>
      ${socialProofHtml(p.favoriteCount, p.commentCount)}
      ${p.adaptations && p.adaptations.length ? `<p class="tiny">${p.adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(adaptationLabel(k))}</span>`).join(' ')}</p>` : ''}
      ${p.greenFeatures && p.greenFeatures.length ? `<p class="tiny">${p.greenFeatures.map(k => `<span class="badge badge-gold">${escapeHtml(greenFeatureLabel(k))}</span>`).join(' ')}</p>` : ''}
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="open-dev-project" data-id="${p.id}">View</button>
        ${mine && p.status === 'open' ? `
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

let projectsBrowseOffset = 0;
let projectsBrowseHasMore = false;

function projectsBrowseParams() {
  const city = document.getElementById('projectCity').value.trim();
  const state = document.getElementById('projectState').value.trim();
  const type = document.getElementById('projectTypeFilter').value;
  const stage = document.getElementById('projectStageFilter').value;
  const wantedAdaptations = [...document.querySelectorAll('.project-adaptation-filter-check:checked')].map(c => c.value);
  const wantedGreenFeatures = [...document.querySelectorAll('.project-green-feature-filter-check:checked')].map(c => c.value);
  const params = new URLSearchParams({ limit: String(BROWSE_PAGE_SIZE) });
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (type) params.set('type', type);
  if (stage) params.set('stage', stage);
  wantedAdaptations.forEach(k => params.append('adaptation', k));
  wantedGreenFeatures.forEach(k => params.append('greenFeature', k));
  return { params, city, state };
}

async function loadProjectsBrowse() {
  const el = document.getElementById('projectsBrowseList');
  const { params, city, state } = projectsBrowseParams();
  loadMomentumBanner('projectsMomentum', 'dev_project', city, state);
  try {
    const { projects, hasMore } = await apiGet(`/api/dev-projects?${params.toString()}`);
    projectsBrowseOffset = projects.length;
    projectsBrowseHasMore = !!hasMore;
    document.getElementById('projectsLoadMoreBtn')?.classList.toggle('hidden', !projectsBrowseHasMore);
    el.innerHTML = projects.length ? projects.map(p => projectCardHtml(p, { mine: false })).join('') : '<div class="empty-state">Nothing open right now.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function loadMoreProjectsBrowse() {
  if (!projectsBrowseHasMore) return;
  const el = document.getElementById('projectsBrowseList');
  const btn = document.getElementById('projectsLoadMoreBtn');
  const { params } = projectsBrowseParams();
  params.set('offset', String(projectsBrowseOffset));
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const { projects, hasMore } = await apiGet(`/api/dev-projects?${params.toString()}`);
    projectsBrowseOffset += projects.length;
    projectsBrowseHasMore = !!hasMore;
    btn?.classList.toggle('hidden', !projectsBrowseHasMore);
    el.insertAdjacentHTML('beforeend', projects.map(p => projectCardHtml(p, { mine: false })).join(''));
  } catch (e) { toast(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Load More'; }
}

async function loadFinderMineTab() {
  document.getElementById('findermineDetailView').classList.add('hidden');
  document.getElementById('findermineListView').classList.remove('hidden');
  fillSelectFromLabels(document.getElementById('projTypeSelect'), PROJECT_TYPE_LABELS, false);
  fillSelectFromLabels(document.getElementById('projStageSelect'), PROJECT_STAGE_CHOICES, false);
  fillSelectFromLabels(document.getElementById('projectTypeFilter'), PROJECT_TYPE_LABELS, true);
  fillSelectFromLabels(document.getElementById('projectStageFilter'), PROJECT_STAGE_CHOICES, true);
  document.getElementById('projAdaptationsFields').innerHTML = adaptationCheckboxesHtml([], 'proj-create-check');
  document.getElementById('projectAdaptationFilterChips').innerHTML = adaptationCheckboxesHtml([], 'project-adaptation-filter-check');
  document.getElementById('projGreenFeaturesFields').innerHTML = greenFeatureCheckboxesHtml([], 'proj-green-create-check');
  document.getElementById('projectGreenFeatureFilterChips').innerHTML = greenFeatureCheckboxesHtml([], 'project-green-feature-filter-check');
  fillSelectFromLabels(document.getElementById('projectAlertType'), PROJECT_TYPE_LABELS, true);
  loadMyProjects();
  loadMyProjectAlerts();
  loadProjectFavorites();
  loadProjectsBrowse();
}

async function loadMyProjectAlerts() {
  const el = document.getElementById('projectAlertsList');
  try {
    const { alerts } = await apiGet('/api/dev-project-needs-alerts');
    el.innerHTML = alerts.length ? alerts.map(a => `
      <div class="side">
        <strong>${escapeHtml(a.label)}</strong>
        <span class="tiny">${a.projectType ? escapeHtml(PROJECT_TYPE_LABELS[a.projectType] || a.projectType) : 'Any type'}${a.city || a.state ? ` · ${escapeHtml(a.city)}${a.city && a.state ? ', ' : ''}${escapeHtml(a.state)}` : ''}</span>
        <button class="link-btn" data-action="delete-project-alert" data-id="${a.id}">Remove</button>
      </div>
    `).join('') : '<span class="tiny">No saved alerts yet.</span>';
  } catch (e) { el.innerHTML = `<span class="tiny">${escapeHtml(e.message)}</span>`; }
}

async function loadProjectFavorites() {
  const el = document.getElementById('projectFavoritesList');
  try {
    const { projects } = await apiGet('/api/dev-projects?favorites=1');
    el.innerHTML = projects.length ? projects.map(p => projectCardHtml(p, { mine: false })).join('') : '<div class="empty-state">No favorites saved yet.</div>';
  } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

async function openProjectDetail(id) {
  const contentEl = document.getElementById('findermineDetailContent');
  try {
    const [{ project: p, isOwner }, { postId }] = await Promise.all([
      apiGet(`/api/dev-projects/${id}`),
      apiGet(`/api/dev-projects/${id}/thread`),
    ]);
    findermineDetail = { id };
    showFinderMineDetail();
    const photosHtml = p.photoIds.length
      ? `<div class="photo-gallery">${p.photoIds.map(pid => isOwner
          ? `<div class="photo-thumb"><img src="/api/dev-project-photos/${pid}" alt="${escapeHtml(`Photo or rendering of ${p.title}`)}" loading="lazy"><button type="button" class="photo-delete" data-action="delete-project-photo" data-id="${pid}">✕</button></div>`
          : `<img src="/api/dev-project-photos/${pid}" alt="${escapeHtml(`Photo or rendering of ${p.title}`)}" loading="lazy" class="media-thumb">`).join('')}</div>`
      : '';
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(p.title)}</h2><span class="badge ${p.status === 'open' ? 'badge-active' : 'badge-paused'}">${escapeHtml(PROJECT_STATUS_LABELS[p.status] || p.status)}</span></div>
        <div class="mini-block">${escapeHtml(PROJECT_TYPE_LABELS[p.projectType] || p.projectType)} · ${escapeHtml(PROJECT_STAGE_LABELS[p.stage] || p.stage)} in ${escapeHtml(p.neighborhood ? p.neighborhood + ', ' : '')}${escapeHtml(p.city)}, ${escapeHtml(p.state)}</div>
        <div class="mini-block"><span class="label">Timeline</span>${p.timelineMonths ? `${Number(p.timelineMonths)} months` : 'Not stated'}</div>
        <p class="tiny">Looking for a builder, partner or co-buyer. Reach the person behind it through Amico Haus messages. Nothing here is an offer of securities or an investment.</p>
        ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
        ${photosHtml}
        ${p.adaptations && p.adaptations.length ? `<h3>Built For</h3><p class="tiny">${p.adaptations.map(k => `<span class="badge badge-gold">${escapeHtml(adaptationLabel(k))}</span>`).join(' ')}</p>` : ''}
        ${p.greenFeatures && p.greenFeatures.length ? `<h3>Green Features</h3><p class="tiny">${p.greenFeatures.map(k => `<span class="badge badge-gold">${escapeHtml(greenFeatureLabel(k))}</span>`).join(' ')}</p>` : ''}
        ${!isOwner ? `
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" data-action="message-user" data-id="${p.userId}" data-name="${escapeHtml(p.owner)}">Message</button>
            <button class="btn ${p.isFavorited ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="toggle-project-favorite" data-id="${p.id}">${p.isFavorited ? '♥ Saved' : '♡ Save'}</button>
          </div>` : ''}
        ${isOwner ? `<div class="form-actions"><button type="button" class="btn btn-danger btn-sm" data-action="delete-project" data-id="${p.id}">Delete Project</button></div>` : ''}
        ${p.status === 'open' ? `<p class="tiny"><a href="/project/${p.id}" target="_blank" rel="noopener noreferrer">View project page ↗</a> (members only)</p>` : ''}
      </div>

      ${dealThreadCardHtml(postId)}
    `;
    renderComments(postId);
  } catch (e) { contentEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

function renderReviewForm() {
  return `
    <div class="panel">
      <h3>Rate Your Agent</h3>
      <p class="tiny">Only the person who awarded this can leave a review, once per engagement.</p>
      <div class="field"><label for="reviewRating">Rating</label><select id="reviewRating"><option value="5">⭐⭐⭐⭐⭐ Excellent</option><option value="4">⭐⭐⭐⭐ Good</option><option value="3">⭐⭐⭐ Okay</option><option value="2">⭐⭐ Poor</option><option value="1">⭐ Terrible</option></select></div>
      <div class="field"><label for="reviewComment">Comment</label><textarea id="reviewComment" maxlength="1000"></textarea></div>
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
        <div class="field"><label>Description</label><textarea class="pkg-description" data-tier="${tier}" maxlength="500">${escapeHtml(p ? p.description : '')}</textarea><p class="tiny field-hint composer-note">${escapeHtml(AGENT_TEXT_NOTE)}</p></div>
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

function renderAgentStatsPanel(stats, pendingCount) {
  if (!stats) return '';
  const respLabel = formatResponseHours(stats.avgResponseHours);
  return `
    <div class="mini-block"><span class="label">Proposals</span>${stats.totalBids} submitted, ${stats.acceptedBids} accepted</div>
    <div class="mini-block"><span class="label">Typical proposal speed</span>${respLabel || 'Not enough data yet'}</div>
    ${stats.finalistCount > 0 ? `<div class="mini-block"><span class="label">Finalist</span>On ${stats.finalistCount} home${stats.finalistCount === 1 ? '' : 's'} (the homeowner interviewed you, or shortlisted you before deciding)</div>` : ''}
    <div class="mini-block"><span class="label">Who sees your proposals</span>The homeowner you send them to. Other agents never do, and Amico Haus has no staff screen for your proposals, price opinions, pitch reels or files.</div>
    ${pendingCount !== undefined ? `<div class="mini-block"><span class="label">Your pipeline</span>${pendingCount} proposal${pendingCount === 1 ? '' : 's'} awaiting a homeowner's decision right now</div>` : ''}
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
  const memberRows = team.members.map(m => `
    <div class="mini-block">
      ${escapeHtml(m.name)}${m.userId === myUserId ? ' (you)' : ''} — ${m.role}${m.status === 'invited' ? ', invited' : ''}
      ${m.stats ? ` · ${m.stats.totalBids} proposal${m.stats.totalBids === 1 ? '' : 's'}` : ''}
      ${isOwner && m.userId !== myUserId ? `<button type="button" class="link-btn" data-action="remove-team-member" data-user-id="${m.userId}">Remove</button>` : ''}
    </div>`).join('');
  return `
    <div class="card">
      <h4>${escapeHtml(team.name)}</h4>
      <p class="tiny">Team proposals: ${team.teamStats.totalBids} submitted, ${team.teamStats.acceptedBids} accepted</p>
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
          <span>${SERVICE_TYPE_LABELS[type]}${e ? ` — agents here list ${money(e.min)} to ${money(e.max)}` : ' — not enough agents list it yet'}</span>
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
    totalEl.innerHTML = '<span class="label">Range of listed fees</span>Check a service above to see a range. Not a quote.';
    return;
  }
  let lo = 0, hi = 0;
  checked.forEach(cb => {
    const e = costEstimatorData[cb.dataset.type];
    if (e) { lo += e.min; hi += e.max; }
  });
  totalEl.innerHTML = `<span class="label">Range of listed fees</span>${money(lo)} to ${money(hi)} for ${checked.length} service${checked.length === 1 ? '' : 's'}. Not a quote: each agent sets their own fees.`;
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
    priceMax: document.getElementById('agentDirPriceMax').value,
    service: document.getElementById('agentDirService').value,
    minRating: document.getElementById('agentDirMinRating').value,
    zip: document.getElementById('agentDirZip').value.trim(),
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
    showsPastWorkOnly: document.getElementById('agentDirShowsPastWork').checked,
    acceptingClientsOnly: document.getElementById('agentDirAcceptingClients').checked,
    eoInsuranceOnly: document.getElementById('agentDirEoInsurance').checked,
    feeTypeOffered: document.getElementById('agentDirFeeType').value,
    minHires: document.getElementById('agentDirMinHires').value,
    maxProposalHours: document.getElementById('agentDirMaxProposalHours').value,
  };
}

function directoryFiltersToParams(f) {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.priceMax) params.set('priceMax', f.priceMax);
  if (f.service) params.set('service', f.service);
  if (f.minRating) params.set('minRating', f.minRating);
  if (f.zip) params.set('zip', f.zip);
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
  if (f.showsPastWorkOnly) params.set('showsPastWorkOnly', '1');
  if (f.acceptingClientsOnly) params.set('acceptingClientsOnly', '1');
  if (f.eoInsuranceOnly) params.set('eoInsuranceOnly', '1');
  if (f.feeTypeOffered) params.set('feeTypeOffered', f.feeTypeOffered);
  if (f.minHires) params.set('minHires', f.minHires);
  if (f.maxProposalHours) params.set('maxProposalHours', f.maxProposalHours);
  return params;
}

async function loadAgentDirectory() {
  const el = document.getElementById('agentDirectoryList');
  fillDirectoryFilterOptionsOnce();
  const filters = collectDirectoryFilters();
  const params = directoryFiltersToParams(filters);
  const sort = document.getElementById('agentDirSort').value;
  if (sort) params.set('sort', sort);

  try {
    const { agents } = await apiGet(`/api/agents/directory?${params.toString()}`);
    const historyFilterOn = filters.minHires || filters.maxProposalHours || filters.minRating || filters.minReviewCount;
    const anyFilterOn = Object.values(filters).some(v => v);
    el.innerHTML = agents.length
      ? agents.map(a => directoryAgentCardHtml(a, { favorite: true, message: true })).join('')
      : !anyFilterOn
        ? '<div class="empty-state">We\'re welcoming our founding agents in San Diego County now. Post your pre-listing and you\'ll be notified as soon as local agents weigh in.</div>'
        : `<div class="empty-state">No agents match these filters.${historyFilterOn ? ' Many agents are new to Amico Haus and have no track record here yet, which doesn\'t mean they\'re a bad fit. Try loosening the track-record filters.' : ''}</div>`;
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

/* ---- Past issue reports (disputes were replaced by "Report a rules problem") ---- */
// Read-only history of issue reports filed before the change. Only what the person wrote is shown: no status or
// notes from Amico Haus, since Amico Haus doesn't decide disputes between homeowners and agents.
const DISPUTE_REASON_LABELS = { work_not_done: 'Work not done', quality_issue: 'Quality issue', communication: 'Communication problem', payment_dispute: 'Fee question', other: 'Other' };

async function loadMyDisputes() {
  const wrap = document.getElementById('myDisputesWrap');
  const el = document.getElementById('myDisputesList');
  if (!wrap || !el) return;
  try {
    const { disputes } = await apiGet('/api/disputes');
    wrap.classList.toggle('hidden', !(disputes && disputes.length));
    el.innerHTML = (disputes || []).map(d => `
      <div class="side">
        <strong>${escapeHtml(DISPUTE_REASON_LABELS[d.reason] || d.reason)}</strong>
        <span class="tiny">${escapeHtml(d.raisedByName)} about ${escapeHtml(d.againstName)}</span>
        <span class="tiny">${escapeHtml(d.description)}</span>
      </div>
    `).join('');
  } catch { wrap.classList.add('hidden'); }
}

/* ---- Agent invitations ---- */
async function loadMyInvites() {
  const el = document.getElementById('myInvitesList');
  try {
    const { invites } = await apiGet('/api/agents/my-invites');
    el.innerHTML = invites.length ? invites.map(i => {
      const target = i.requestType === 'pre_listing' ? i.preListing : i.transaction;
      const label = i.requestType === 'pre_listing'
        ? (target ? `${escapeHtml(target.title || 'Pre-listing')} — ${escapeHtml(target.city)}, ${escapeHtml(target.state)} (${askingPriceLabel(target)})` : 'Pre-listing removed')
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
      <p class="tiny">Tracked on Amico Haus for visibility only. Any commission is set in your written agreement with the agent's brokerage and is normally paid through escrow at closing. Never pay an agent personally or in advance. Amico Haus never handles payments.</p>
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

// The agent the homeowner hired on this request (the accepted proposal), for the rules-report panel's help box.
function hiredAgentOf(bids) {
  const b = (bids || []).find(x => x.status === 'accepted');
  return b ? { userId: b.agentUserId, name: b.agentName, brokerageName: b.brokerageName, licenseNumber: b.licenseNumber } : null;
}

// "Report a rules problem" (Terms of Use violations only) on an awarded request. It goes to the reports queue about
// the other person. Fee or service problems are pointed to the agent's managing broker, the DRE and small claims:
// Amico Haus doesn't decide disputes between homeowners and agents.
function renderRulesReportPanel(person) {
  if (!person || !person.userId) return '';
  const help = person.isHomeowner
    ? `<p class="tiny">${escapeHtml(NO_DISPUTES_LINE)}</p>`
    : feeHelpHtml(person);
  return `
    <div class="panel rules-report">
      <h3>Report a rules problem</h3>
      <p class="tiny">For <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> problems only, like misuse of shared contact info or a fair housing concern. It goes to the Amico Haus team.</p>
      ${inlineReportFormHtml('user', person.userId, { other: false, cancel: false })}
      ${help}
    </div>
  `;
}

// "Agent votes: 1 too high · 0 too low · 5 just right — 4 of 6 from agents within 20 miles of this home".
// The server counts votes from agents whose service area covers the home (`nearby`); it is null when the
// home's zip is unknown, and then we simply don't claim anything about distance.
// A home with no asking price ("Open to price opinions") has no votes, only suggested prices: "3 agents shared a
// price opinion". opinionCount is the owner's own count; otherwise the tally's (the API counts opinions there).
function voteSummary(v, label, status = 'open', { priceOpen = false, opinionCount = null } = {}) {
  v = v || {};
  if (priceOpen || v.priceOpen) {
    const n = opinionCount ?? v.opinionCount ?? v.total ?? 0;
    if (n > 0) return `${n} agent${n === 1 ? '' : 's'} shared a price opinion`;
    return status === 'open' ? 'Price opinions: none yet. Local agents will share what they think it\'s worth.' : 'No price opinions were shared.';
  }
  if (v.sealed && status !== 'open') return `${label}: voting is closed.`;
  if (v.sealed) return v.total ? `${label}: ${v.total} agent${v.total === 1 ? ' has' : 's have'} weighed in. Sealed until you cast yours, so nobody anchors on the crowd.` : `${label}: none yet. Be the first to weigh in.`;
  if (!v.total) return `${label}: none yet`;
  const base = `${label}: ${v.too_high} too high · ${v.too_low} too low · ${v.just_right} just right`;
  if (v.nearby === null || v.nearby === undefined) return base;
  return `${base} — ${v.nearby} of ${v.total} from agents within 20 miles of this home`;
}

function renderPriceHistory(history) {
  if (!history || !history.length) return '';
  // A 0 is a time the owner had no price set ("Open to price opinions").
  const changes = history.map(h => `${priceAmountLabel(h.oldPrice)} → ${priceAmountLabel(h.newPrice)} on ${new Date(h.changedAt + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  return `<p class="tiny"><span class="label">Price history</span> ${changes.join(' · ')}</p>`;
}

// Reshapes the same priceHistory rows renderPriceHistory() reads (old/new price pairs, oldest first) into a
// flat series for the sparkline, ending at the current price if it's moved since the last logged change.
function seriesFromPriceHistory(history, currentPrice) {
  if (!history || !history.length) return [];
  const series = [history[0].oldPrice, ...history.map(h => h.newPrice)];
  if (series[series.length - 1] !== currentPrice) series.push(currentPrice);
  return series;
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
  // The owner sees who's asking with their DRE number and brokerage (California DRE rule).
  const who = agentIdentityLine({ name: s.agentName, licenseNumber: s.agentLicenseNumber, brokerageName: s.agentBrokerageName });
  return `
    <div class="mini-block showing-row">
      ${isOwner ? `<strong class="showing-agent">${escapeHtml(who)}</strong><br>` : `<span class="label">${when}</span>`}
      ${isOwner ? when : ''}${s.note ? ` — ${escapeHtml(s.note)}` : ''} ${statusBadge}
      ${isOwner && s.status === 'pending' ? `
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="decide-showing" data-showing-id="${s.id}" data-decision="accept">Accept</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="decide-showing" data-showing-id="${s.id}" data-decision="decline">Decline</button>
        </div>` : ''}
      ${!isOwner && s.status === 'pending' ? `<div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="cancel-showing" data-showing-id="${s.id}">Cancel</button></div>` : ''}
      ${isOwner && s.agentUserId ? `<div class="card-actions">${blockButtonHtml(s.agentUserId, s.agentName)}</div>` : ''}
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

/* ---------------- Updated Terms prompt (F11) ---------------- */
// A one-time, non-blocking card at the top of /app for accounts that haven't agreed to the current Terms version
// (/api/me: termsCurrent false). "Not now" hides it for this browser session; nothing else waits on it.
const TERMS_LATER_KEY = 'amicohaus_terms_later';
function initTermsUpdateBanner(user) {
  const banner = document.getElementById('termsUpdateBanner');
  const needsAgreement = !!user && user.termsCurrent === false && !!user.currentTermsVersion;
  if (!banner || !needsAgreement) return;
  let later = null;
  try { later = sessionStorage.getItem(TERMS_LATER_KEY); } catch { /* storage off: show it */ }
  if (later === user.currentTermsVersion) return;
  const dateEl = document.getElementById('termsUpdateDate');
  if (dateEl && user.termsUpdatedLabel) dateEl.textContent = user.termsUpdatedLabel;
  banner.classList.remove('hidden');
  const agreeBtn = document.getElementById('termsAgreeBtn');
  agreeBtn.addEventListener('click', async () => {
    agreeBtn.disabled = true;
    try {
      await apiPost('/api/account/accept-terms', { version: user.currentTermsVersion });
      banner.classList.add('hidden');
      toast('Thanks for agreeing to the updated Terms.');
    } catch (err) {
      // A newer Terms version shipped after this page loaded: reload so the person sees the latest first.
      if (err && err.data && err.data.code === 'terms_changed') { toast(err.message); setTimeout(() => window.location.reload(), 1500); return; }
      agreeBtn.disabled = false; toastActionError(err);
    }
  });
  document.getElementById('termsLaterBtn').addEventListener('click', () => {
    try { sessionStorage.setItem(TERMS_LATER_KEY, user.currentTermsVersion); } catch { /* ignore */ }
    banner.classList.add('hidden');
  });
}

/* ---------------- Wiring ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuthOrRedirect();
  if (!user) return;
  document.getElementById('whoami').textContent = user.displayName;
  initTermsUpdateBanner(user);
  primeAgentListingTools();

  fillTypeSelect(document.getElementById('propertyType'), false);
  fillTypeSelect(document.getElementById('desiredType'), true);
  fillTypeSelect(document.getElementById('savedType'), true);
  fillTypeSelect(document.getElementById('portfolioDesiredType'), true);
  document.getElementById('lifeEventTagsFields').innerHTML = lifeEventCheckboxesHtml('life-event-check');

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
  // Deal-thread discussion cards on the 3 detail views reuse the same comment markup/ids, so one delegated
  // listener per persistent container (wired once here, never re-wired on each open) covers them too.
  wireFeedEvents(document.getElementById('augmentedDetailContent'));
  wireFeedEvents(document.getElementById('greenDetailContent'));
  wireFeedEvents(document.getElementById('findermineDetailContent'));

  document.getElementById('listingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('listingSubmitBtn');
    if (!editingListingId && !document.getElementById('isBuyerOnly').checked && ownerConfirmMissing('ownerConfirmListing')) { btn.disabled = false; return; }
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
      clientName: isApprovedAgentNow() ? document.getElementById('clientName').value.trim() : '',
      city: document.getElementById('city').value.trim(),
      state: document.getElementById('state').value.trim(),
      neighborhood: document.getElementById('neighborhood').value.trim(),
      address: document.getElementById('address').value.trim(),
      propertyType: document.getElementById('propertyType').value,
      estimatedValue: document.getElementById('estimatedValue').value,
      beds: document.getElementById('beds').value,
      baths: document.getElementById('baths').value,
      sqft: document.getElementById('sqft').value || null,
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
      const costs = readHomeCosts('lc');
      let listingId = editingListingId;
      if (editingListingId) {
        await apiPut(`/api/listings/${editingListingId}`, { ...payload, action: 'edit' });
      } else {
        ({ id: listingId } = await apiPost('/api/listings', cloneSourceListingId ? { ...payload, cloneOf: cloneSourceListingId } : payload));
      }

      await saveHomeCosts('listing', listingId, costs);
      const photoResult = await uploadPhotos(`/api/listings/${listingId}/photos`, [...document.getElementById('listingPhotos').files]);

      toastWithPhotoResult(wasEditing ? 'Listing updated!' : 'Listing created!', photoResult);
      document.getElementById('listingForm').reset();
      document.getElementById('ownerConfirmListing').checked = false;
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
    if (!isApprovedAgentNow()) { toast('Bulk upload is for approved agents.'); return; }
    if (!file) { toast('Choose a CSV file first.'); return; }
    if (ownerConfirmMissing('ownerConfirmBulk')) return;

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
      document.getElementById('ownerConfirmBulk').checked = false;
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
        const toastByDecision = { accept: "Sent: the buyer knows you'd like to move forward (not a contract yet).", decline: 'Offer declined.', accept_counter: "Sent: the buyer knows you'd like to move forward (not a contract yet).", decline_counter: 'Counter-offer declined.' };
        toast(toastByDecision[btn.dataset.decision] || 'Updated.');
        loadListingOffersInto(btn.dataset.listingId);
      } catch (err) { toast(err.message); }
    } else if (btn.dataset.action === 'counter-offer') {
      const offerId = btn.dataset.id;
      const counterPrice = document.getElementById(`counterPrice-${offerId}`).value;
      if (!counterPrice) { toast('Enter a counter-offer price.'); return; }
      try {
        await apiPut(`/api/listings/${btn.dataset.listingId}/offers/${offerId}`, {
          action: 'counter', counterPrice, counterMessage: document.getElementById(`counterMsg-${offerId}`).value.trim(),
        });
        toast('Counter-offer sent.');
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
      if (!confirm(TRADE_OPEN_CONFIRM)) return;
      try {
        const { id, partnerConfirmed } = await apiPost('/api/transactions', { listingIdA: bidsBtn.dataset.a, listingIdB: bidsBtn.dataset.b });
        tradeOpenedToast(partnerConfirmed);
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
    const btn = document.getElementById('addSavedSearchBtn');
    const priceMin = document.getElementById('savedPriceMin').value;
    const priceMax = document.getElementById('savedPriceMax').value;
    if (priceMin && priceMax && Number(priceMax) < Number(priceMin)) { toast('Max price must be at or above the min price.'); return; }
    btn.disabled = true;
    try {
      await apiPost('/api/saved-searches', {
        locations: document.getElementById('savedLocations').value.trim(),
        propertyType: document.getElementById('savedType').value,
        priceMin: priceMin || 0,
        priceMax: priceMax || 0,
        ...savedSearchTimingFromForm(),
      });
      ['savedLocations', 'savedPriceMin', 'savedPriceMax'].forEach(id => { document.getElementById(id).value = ''; });
      resetSavedSearchTimingForm();
      toast('Saved search added.');
      loadSavedSearches();
    } catch (err) { toastActionError(err); } finally { btn.disabled = false; }
  });
  document.getElementById('savedSearchList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-saved-search"]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await apiDelete(`/api/saved-searches/${btn.dataset.id}`);
      toast('Saved search removed.');
      loadSavedSearches();
    } catch (err) { btn.disabled = false; toastActionError(err); }
  });

  // Conversation rows and group cards are whole-card buttons: Enter or Space opens them from the keyboard too.
  const openCardOnKey = e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
      e.preventDefault();
      e.target.click();
    }
  };
  document.getElementById('conversationList').addEventListener('keydown', openCardOnKey);
  document.getElementById('groupsGrid').addEventListener('keydown', openCardOnKey);
  document.getElementById('conversationList').addEventListener('click', e => {
    if (e.target.closest('.profile-link')) return;
    const card = e.target.closest('[data-action="open-conversation"]');
    if (card) openConversation(card.dataset.id, card.dataset.name, card.dataset.userId);
  });
  document.getElementById('threadReportBtn').addEventListener('click', e => {
    const otherId = document.getElementById('messageThread').dataset.otherUserId;
    if (otherId) submitReport('user', otherId, e.currentTarget);
  });
  document.getElementById('threadBlockBtn').addEventListener('click', async () => {
    const thread = document.getElementById('messageThread');
    if (await confirmAndBlock(thread.dataset.otherUserId, thread.dataset.otherName)) renderMessages(thread.dataset.conversationId);
  });
  document.getElementById('threadComposerNote').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="thread-unblock"]');
    if (!btn) return;
    const thread = document.getElementById('messageThread');
    btn.disabled = true;
    try {
      await apiDelete(`/api/blocks/${encodeURIComponent(thread.dataset.otherUserId)}`);
      toast(`Unblocked ${thread.dataset.otherName || 'them'}.`);
      await renderMessages(thread.dataset.conversationId);
    } catch (err) { btn.disabled = false; toastActionError(err); }
  });
  document.getElementById('backToConversations').addEventListener('click', loadConversations);
  document.getElementById('threadOpenToBidsBtn').addEventListener('click', async (e) => {
    const wrap = document.getElementById('threadOpenToBidsWrap');
    if (!confirm(TRADE_OPEN_CONFIRM)) return;
    try {
      const { id, partnerConfirmed } = await apiPost('/api/transactions', { listingIdA: wrap.dataset.listingA, listingIdB: wrap.dataset.listingB });
      tradeOpenedToast(partnerConfirmed);
      goToTab('marketplace');
      openTransactionDetail(id);
    } catch (err) { toast(err.message); }
  });
  let messageSending = false;
  document.getElementById('messageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    // One send at a time: a double click or double Enter would otherwise post the same message twice.
    if (messageSending) return;
    const form = e.currentTarget;
    const sendBtn = form.querySelector('button[type="submit"]');
    messageSending = true;
    if (sendBtn) sendBtn.disabled = true;
    const conversationId = document.getElementById('messageThread').dataset.conversationId;
    const input = document.getElementById('messageBody');
    try {
      const result = await apiPost(`/api/conversations/${conversationId}/messages`, { body: input.value.trim() });
      input.value = '';
      sentMessageToast(result);
      await renderMessages(conversationId);
    } catch (err) {
      toast(contactErrorMessage(err), { durationMs: 7000 });
      // The homeowner switched modes since this thread was opened: switch the composer off to match.
      if (apiErrorCode(err) === 'contact_quiet') setComposerMode('quiet');
      else if (apiErrorCode(err) === 'weekly_limit') setComposerMode('weekly_held');
      // Refused for another reason (e.g. you blocked them in another tab): reload so the composer matches.
      else if (err.status === 403) renderMessages(conversationId).catch(() => {});
    } finally {
      messageSending = false;
      // setComposerMode may have switched the composer off (Quiet, or this week's message is on its way).
      if (sendBtn && !form.classList.contains('composer-off')) sendBtn.disabled = false;
    }
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
    if (AGENT_TAB_SECTIONS[btn.dataset.action]) {
      if (btn.tagName === 'A') e.preventDefault(); // e.g. the teaser note's "Post yours free." link
      // From inside a detail view (the "agents only" note), go back to the list first so the section is on screen.
      if (!document.getElementById('marketplaceDetailView').classList.contains('hidden')) backToMarketplaceList();
      openAgentTabSection(AGENT_TAB_SECTIONS[btn.dataset.action]);
    }
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
      const result = await apiPost(`/api/conversations/${wrap.dataset.conversationId}/messages`, { body: text });
      input.value = '';
      if (result && result.held) sentMessageToast(result); else toast('Reply sent.');
      loadNotifications();
    } catch (err) { toast(contactErrorMessage(err), { durationMs: 7000 }); }
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
  checkUnseenMarketPulse();
  if (new URLSearchParams(window.location.search).has('compare')) {
    loadCompareFromShareLink();
  } else {
    loadStoredCompareTray();
    renderCompareTrayBar();
  }

  document.getElementById('onboardingCreateBtn').addEventListener('click', () => goToTab('listing'));

  /* ---- Marketplace wiring ---- */
  wireControlPanel();
  resetHomeCostsFields('listingCostsFields', 'lc');
  resetHomeCostsFields('plCostsFields', 'plc');
  // The owner's Mello-Roos / HOA editor on an AugmentedHomes or GreenHomes detail view.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="save-home-costs"]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await saveHomeCosts(btn.dataset.kind, btn.dataset.id, readHomeCosts(btn.dataset.prefix));
      toast('Mello-Roos and HOA saved.');
      if (btn.dataset.kind === 'augmented_home') openAugmentedHomeDetail(btn.dataset.id);
      else if (btn.dataset.kind === 'green_home') openGreenHomeDetail(btn.dataset.id);
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
  resetHomeCostsFields('augCostsFields', 'augc');
  resetHomeCostsFields('greenCostsFields', 'grc');

  document.getElementById('createPreListingBtn').addEventListener('click', async () => {
    const btn = document.getElementById('createPreListingBtn');
    const problem = preListingFormProblem('pl');
    if (problem) { toast(problem.message); problem.field.focus(); return; }
    if (ownerConfirmMissing('ownerConfirmPreListing')) return;
    const chosenMode = selectedDialMode('plContactMode');
    btn.disabled = true;
    try {
      const costs = readHomeCosts('plc');
      const { id } = await apiPost('/api/pre-listings', {
        title: document.getElementById('plTitle').value.trim(),
        askingPrice: parseAskingPriceInput(document.getElementById('plAskingPrice').value).value, // null = open to price opinions
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
        ...timingFromPostForm(),
      });
      await saveHomeCosts('pre_listing', id, costs);
      resetHomeCostsFields('plCostsFields', 'plc');
      // The contact dial is a setting on the person, not the home: saved only when it changed. A hiccup here never
      // undoes the post; the You're in Control panel below shows what's actually saved.
      let dialNote = '';
      if (chosenMode && chosenMode !== currentContactMode()) {
        try { contactSettings = await apiPut('/api/contact-settings', { contactMode: chosenMode }); }
        catch { dialNote = " We couldn't save how agents can reach you, so please set it again under You're in Control."; }
      }
      const photoResult = await uploadPhotos(`/api/pre-listings/${id}/photos`, [...document.getElementById('plPhotos').files]);
      toastWithPhotoResult(`Pre-listing posted — agents can now weigh in on your price.${dialNote}`, photoResult);
      document.getElementById('postHomeWrap').open = false;
      ['plTitle', 'plAskingPrice', 'plCity', 'plState', 'plZip', 'plNeighborhood', 'plAddress', 'plSqft', 'plDescription', 'plShowingNoticeHours', 'plSpecialInstructions', 'plMinYearsExperience', 'plPreferredLanguage', 'plPreferredAgreementMonths'].forEach(f => document.getElementById(f).value = '');
      document.getElementById('plBeds').value = '';
      document.getElementById('plBaths').value = '';
      document.getElementById('plPhotos').value = '';
      document.getElementById('plOccupancyStatus').value = 'occupied';
      document.getElementById('plRequireDedicatedContact').checked = false;
      document.getElementById('plPrefersExclusive').checked = false;
      document.getElementById('plPrefersLocalSpecialist').checked = false;
      document.getElementById('ownerConfirmPreListing').checked = false;
      resetPostFormTiming();
      renderPostFormDial(true);
      loadMyPreListings();
      loadMarketplaceBrowse();
      renderControlPanel();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.getElementById('submitAgentApplicationBtn').addEventListener('click', async () => {
    const btn = document.getElementById('submitAgentApplicationBtn');
    // A new (or resubmitted) application needs the agent rules ticked; on a profile edit the server only asks
    // again when the rules have changed since the agent last agreed.
    const rules = document.getElementById('agentAcceptRules');
    const isNewApplication = !currentAgentProfile || currentAgentProfile.status === 'rejected';
    if (isNewApplication && !rules.checked) { toast('Please agree to the agent rules in the Terms of Use first.'); rules.focus(); return; }
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
        acceptRules: rules.checked,
      });
      toast('Application submitted!');
      try { localStorage.removeItem('ah_claim_zip'); } catch { /* optional */ }
      loadAgentStatus();
    } catch (err) {
      toast(err.message, { durationMs: 6000 });
      if (apiErrorCode(err) === 'rules_required') { rules.focus(); openAgentTabSection('becomeAgentWrap'); }
    } finally { btn.disabled = false; }
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
      if (file.size > 95 * 1024 * 1024) throw new Error(`That video is ${formatFileSize(file.size)}; the limit is 95 MB. Exporting at 1080p usually brings it under.`);
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
      toast('License photo saved.');
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
    'agentDirPriceMax', 'agentDirService', 'agentDirMinRating', 'agentDirZip',
    'agentDirHasVideo', 'agentDirSpecialty', 'agentDirLanguage', 'agentDirSoloAgent',
    'agentDirMinYears', 'agentDirMaxDom', 'agentDirMinHomesSold', 'agentDirMinSaleToList', 'agentDirMaxCommission',
    'agentDirMaxTurnaround', 'agentDirMinReviews', 'agentDirOpenHouseDay', 'agentDirLocalSpecialist',
    'agentDirShowsPastWork', 'agentDirAcceptingClients', 'agentDirEoInsurance',
    'agentDirSort', 'agentDirFeeType', 'agentDirMinHires', 'agentDirMaxProposalHours',
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
      // Track-record filters aren't stored with alerts (alerts are only re-checked when an agent's profile changes),
      // so say so plainly rather than letting the server's generic "pick a filter" message confuse things.
      const { minHires, maxProposalHours, ...savable } = filters;
      const hasTrackRecord = !!(minHires || maxProposalHours);
      const hasSavable = Object.values(savable).some(v => v);
      if (hasTrackRecord && !hasSavable) {
        toast('The "hired" and "proposal speed" filters can\'t be saved as an alert. Add another filter, like area or specialty.');
        return;
      }
      await apiPost('/api/agent-search-alerts', { label: document.getElementById('agentAlertLabel').value.trim(), filters });
      toast(hasTrackRecord
        ? 'Search saved (without the "hired" and "proposal speed" filters) — you\'ll be notified when a new agent matches.'
        : 'Search saved — you\'ll be notified when a new agent matches.');
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
          // Drafted, not sent — a template is a starting point, not something that should go out un-reviewed. Not
          // drafted when the homeowner is in Quiet mode (the composer is off then, with a note saying why).
          const body = document.getElementById('messageBody');
          if (!body.disabled) {
            body.value = `Hi! Just checking in on my proposal for ${checkInBtn.dataset.title} — happy to answer any questions.`;
            body.focus();
          }
        } catch (err) { toast(contactErrorMessage(err), { durationMs: 7000 }); }
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
    else if (greenDetail && !document.getElementById('greenDetailView').classList.contains('hidden')) backToGreenList();
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

    // The trade partner who didn't open the request confirms it (agents can't see it or be hired until then).
    const confirmTradeBtn = e.target.closest('[data-action="confirm-trade"]');
    if (confirmTradeBtn && kind === 'transaction') {
      if (!confirm(TRADE_CONFIRM_TEXT)) return;
      confirmTradeBtn.disabled = true;
      try {
        await apiPost(`${basePath}/confirm`, {});
        toast('Confirmed. Approved agents near you can now send proposals.');
        refreshDetail(kind, id);
      } catch (err) { confirmTradeBtn.disabled = false; toastActionError(err); }
      return;
    }
    // "Block" on a proposal, price opinion, showing request or interview card (seller-prep.js draws the interview ones).
    const blockAgentBtn = e.target.closest('[data-action="block-agent"]');
    if (blockAgentBtn) {
      blockAgentBtn.disabled = true;
      if (await confirmAndBlock(blockAgentBtn.dataset.id, blockAgentBtn.dataset.name)) refreshDetail(kind, id);
      else blockAgentBtn.disabled = false;
      return;
    }
    const pickBtn = e.target.closest('[data-action="pick-bid"]');
    if (pickBtn && kind === 'pre_listing') {
      pickBtn.disabled = true;
      try {
        const { ownerPick } = await apiPut(`${basePath}/bids/${pickBtn.dataset.bidId}`, { action: pickBtn.dataset.pick });
        const bid = proposalView && proposalView.bids.find(b => String(b.id) === pickBtn.dataset.bidId);
        if (bid) bid.ownerPick = ownerPick;
        rerenderProposalResults();
        reorderInterviewAgents(proposalView ? proposalView.bids : []);
      } catch (err) { toast(err.message); pickBtn.disabled = false; }
      return;
    }
    const shareBtn = e.target.closest('[data-action="share-contact"]');
    if (shareBtn && kind === 'pre_listing') { await shareContactWith(shareBtn); return; }
    const unshareBtn = e.target.closest('[data-action="unshare-contact"]');
    if (unshareBtn && kind === 'pre_listing') { await stopSharingWith(unshareBtn); return; }
    const pauseBtn = e.target.closest('[data-action="pause-proposals"], [data-action="resume-proposals"]');
    if (pauseBtn && kind === 'pre_listing') {
      // Nothing is lost either way (resume anytime), so no confirm: the note under the buttons says what it does.
      const pausing = pauseBtn.dataset.action === 'pause-proposals';
      pauseBtn.disabled = true;
      try {
        const { proposalsPaused } = await apiPut(basePath, { action: pausing ? 'pause' : 'resume' });
        toast(proposalsPaused ? 'New proposals are paused.' : 'Proposals are open again. Agents nearby can send theirs.');
        openPreListingDetail(id);
      } catch (err) { toast(err.message); pauseBtn.disabled = false; }
      return;
    }
    const copyInviteBtn = e.target.closest('[data-action="copy-agent-invite"]');
    if (copyInviteBtn) {
      // Shared with someone new, so it carries its own source tag (it's their first visit, not an internal click).
      const link = `${location.origin}/signup?as=agent&zip=${encodeURIComponent(copyInviteBtn.dataset.zip)}&utm_source=homeowner_invite&utm_medium=share&utm_campaign=zip-${encodeURIComponent(copyInviteBtn.dataset.zip)}`;
      try { await navigator.clipboard.writeText(link); toast('Invite link copied. Send it to the agent by text or email.'); }
      catch { toast(link, { durationMs: 12000 }); }
      return;
    }
    const acceptBtn = e.target.closest('[data-action="accept-bid"]');
    const submitBidBtn = e.target.closest('[data-action="submit-bid"]');
    const withdrawBtn = e.target.closest('[data-action="withdraw-bid"]');
    const pickVoteBtn = e.target.closest('[data-action="pick-vote"]');
    const saveOpinionBtn = e.target.closest('[data-action="save-opinion"]');
    const removeDeckBtn = e.target.closest('[data-action="remove-deck"]');
    const reviewBtn = e.target.closest('[data-action="submit-review"]');
    const favoriteBtn = e.target.closest('[data-action="toggle-favorite-agent"]');
    const msgBtn = e.target.closest('[data-action="message-user"]');
    const addMilestoneBtn = e.target.closest('[data-action="add-milestone"]');
    const addSuggestedMilestoneBtn = e.target.closest('[data-action="add-suggested-milestone"]');
    const deleteMilestoneBtn = e.target.closest('[data-action="delete-milestone"]');
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
        try {
          await apiPost(`${basePath}/showings`, { proposedAt: new Date(proposedAt).toISOString(), note: document.getElementById('showingNote').value.trim() });
        } catch (err) { toast(contactErrorMessage(err, 'showing'), { durationMs: 7000 }); return; }
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
        if (!confirm('Choose this proposal? Every other pending proposal will be declined. This only marks it as chosen on Amico Haus; working with the agent takes a written agreement with their brokerage.')) return;
        await apiPut(`${basePath}/bids/${acceptBtn.dataset.bidId}`, { action: 'accept' });
        toast("Proposal chosen. Next step: a written agreement with the agent's brokerage.");
        refreshDetail(kind, id);
      } else if (submitBidBtn) {
        try {
          await apiPost(`${basePath}/bids`, {
            message: document.getElementById('bidMessage').value.trim(),
            commissionPct: document.getElementById('bidCommissionPct').value || null,
            flatFee: document.getElementById('bidFlatFee').value || null,
            services: collectServicesFromEditor('bidServicesEditor'),
          });
        } catch (err) {
          toast(contactErrorMessage(err), { durationMs: 7000 });
          // Paused while the form was open: redraw, so the form gives way to the paused note.
          if (apiErrorCode(err) === 'proposals_paused') refreshDetail(kind, id);
          return;
        }
        toast('Proposal submitted!');
        refreshDetail(kind, id);
      } else if (withdrawBtn) {
        await apiPut(`${basePath}/bids/${withdrawBtn.dataset.bidId}`, { action: 'withdraw' });
        toast('Proposal withdrawn.');
        refreshDetail(kind, id);
      } else if (pickVoteBtn) {
        // Picking only marks the choice; "Save price opinion" sends it with the price and comps.
        const panel = document.getElementById('priceOpinionPanel');
        panel.dataset.vote = pickVoteBtn.dataset.vote;
        panel.querySelectorAll('[data-action="pick-vote"]').forEach(b => {
          const on = b === pickVoteBtn;
          b.classList.toggle('btn-primary', on);
          b.classList.toggle('btn-ghost', !on);
          b.setAttribute('aria-pressed', String(on));
        });
      } else if (saveOpinionBtn) {
        const panel = document.getElementById('priceOpinionPanel');
        // No asking price yet: nothing to vote on, and the suggested list price is what the homeowner is waiting for.
        const priceOpen = panel.dataset.priceOpen === '1';
        const val = idName => document.getElementById(idName).value.trim();
        if (priceOpen && val('opinionPrice') === '') { toast("This homeowner hasn't set a price yet. Share your suggested list price."); document.getElementById('opinionPrice').focus(); return; }
        if (!priceOpen && !panel.dataset.vote) { toast('Pick too high, just right or too low first.'); return; }
        const comps = [0, 1, 2].map(i => ({ address: val(`compAddress${i}`), soldPrice: val(`compPrice${i}`), soldDate: val(`compDate${i}`), sqft: val(`compSqft${i}`) }))
          .filter(c => c.address || c.soldPrice || c.soldDate || c.sqft)
          .map(c => ({ ...c, soldPrice: c.soldPrice === '' ? '' : Number(c.soldPrice), sqft: c.sqft === '' ? '' : Number(c.sqft) }));
        await apiPost(`${basePath}/votes`, {
          ...(priceOpen ? {} : { vote: panel.dataset.vote }),
          note: val('opinionNote'),
          priceOpinion: val('opinionPrice') === '' ? '' : Number(val('opinionPrice')),
          comps,
          prep: selectedPrepItems(),
        });
        toast('Price opinion saved. The homeowner can see it; other agents can\'t.');
        openPreListingDetail(id);
      } else if (removeDeckBtn) {
        if (!confirm('Remove your presentation file?')) return;
        await apiDelete(`${basePath}/votes/deck`);
        document.getElementById('deckCurrent').innerHTML = '';
        document.getElementById('deckHint').textContent = deckHint(null);
        toast('Presentation removed.');
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
      } else if (searchInviteBtn) {
        searchInviteAgents();
      } else if (sendInviteBtn) {
        await apiPost(`${basePath}/invites`, { agentUserId: Number(sendInviteBtn.dataset.agentId) });
        toast('Invitation sent!');
        loadInvitedAgentsInto(kind, id);
      }
    } catch (err) { toastActionError(err); }
  });

  // The take-home estimate recalculates as the owner types.
  document.getElementById('marketplaceDetailContent').addEventListener('input', (e) => {
    if (e.target.closest('[data-take-home]')) refreshTakeHome();
  });

  document.getElementById('marketplaceDetailContent').addEventListener('change', async (e) => {
    if (e.target.closest('[data-proposal-control]')) { rerenderProposalResults(); return; }
    if (e.target.id === 'opinionDeck' && marketplaceDetail && e.target.files[0]) {
      // Updates the file line in place, so anything typed but not yet saved in the opinion form stays.
      const input = e.target;
      const file = input.files[0];
      const hint = document.getElementById('deckHint');
      const ext = file.name.split('.').pop().toLowerCase();
      if (!DECK_EXTENSIONS.includes(ext)) { hint.textContent = 'Pick a PDF, PowerPoint (.pptx or .ppt) or Word (.docx or .doc) file.'; input.value = ''; return; }
      if (file.size > DECK_MAX_BYTES) { hint.textContent = `That file is ${formatFileSize(file.size)}; the limit is 20 MB. Saving a PowerPoint as a PDF usually makes it much smaller.`; input.value = ''; return; }
      const formData = new FormData();
      formData.append('file', file);
      input.disabled = true;
      hint.textContent = `Uploading ${file.name}…`;
      try {
        const { deck } = await apiUpload(`/api/pre-listings/${marketplaceDetail.id}/votes/deck`, formData);
        document.getElementById('deckCurrent').innerHTML = deckLineHtml(deck);
        hint.textContent = deckHint(deck);
        toast('Presentation attached. The homeowner can open it; other agents can\'t.');
      } catch (err) { hint.textContent = err.message; }
      input.disabled = false;
      input.value = '';
      return;
    }
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
    if (ownerConfirmMissing('ownerConfirmAugmented')) return;
    btn.disabled = true;
    try {
      const adaptations = [...document.querySelectorAll('.augmented-create-check:checked')].map(c => c.value);
      const costs = readHomeCosts('augc');
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
        lifeEventTags: [...document.querySelectorAll('.aug-life-event-check:checked')].map(c => c.value),
      });
      await saveHomeCosts('augmented_home', id, costs);
      resetHomeCostsFields('augCostsFields', 'augc');
      const photoResult = await uploadPhotos(`/api/augmented-homes/${id}/photos`, [...document.getElementById('augPhotos').files]);
      toastWithPhotoResult('Listed on AugmentedHomes.', photoResult);
      document.getElementById('postAugmentedWrap').open = false;
      ['augTitle', 'augAskingPrice', 'augCity', 'augState', 'augZip', 'augNeighborhood', 'augAddress', 'augSqft', 'augDescription', 'augAdaptationNotes'].forEach(f => document.getElementById(f).value = '');
      document.getElementById('augBeds').value = '';
      document.getElementById('augBaths').value = '';
      document.getElementById('augPhotos').value = '';
      document.querySelectorAll('.augmented-create-check').forEach(c => c.checked = false);
      document.querySelectorAll('.aug-life-event-check').forEach(c => c.checked = false);
      document.getElementById('ownerConfirmAugmented').checked = false;
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
  document.getElementById('augmentedLoadMoreBtn')?.addEventListener('click', () => loadMoreAugmentedBrowse());

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
  wireAugmentedOpenButtons('augmentedFavoritesList');

  document.getElementById('backToAugmented').addEventListener('click', backToAugmentedList);

  document.getElementById('augmentedDetailContent').addEventListener('click', async e => {
    const msgBtn = e.target.closest('[data-action="message-user"]');
    const deletePhotoBtn = e.target.closest('[data-action="delete-augmented-photo"]');
    const deleteHomeBtn = e.target.closest('[data-action="delete-augmented-home"]');
    const favBtn = e.target.closest('[data-action="toggle-augmented-favorite"]');
    const addOhBtn = e.target.closest('[data-action="add-augmented-open-house"]');
    const deleteOhBtn = e.target.closest('[data-action="delete-augmented-open-house"]');
    const rsvpBtn = e.target.closest('[data-action="rsvp-augmented-open-house"]');
    const decideBtn = e.target.closest('[data-action="decide-augmented-offer"]');
    const counterBtn = e.target.closest('[data-action="counter-augmented-offer"]');
    const withdrawBtn = e.target.closest('[data-action="withdraw-augmented-offer"]');
    const submitOfferBtn = e.target.closest('[data-action="submit-augmented-offer"]');

    if (msgBtn) { try { await startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); } catch (err) { toast(err.message); } }
    else if (deletePhotoBtn) {
      if (!confirm('Remove this photo?')) return;
      try { await apiDelete(`/api/augmented-homes/${augmentedDetail.id}/photos/${deletePhotoBtn.dataset.id}`); openAugmentedHomeDetail(augmentedDetail.id); }
      catch (err) { toast(err.message); }
    } else if (deleteHomeBtn) {
      if (!confirm('Permanently delete this listing? It cannot be recovered after this.')) return;
      try { await apiDelete(`/api/augmented-homes/${deleteHomeBtn.dataset.id}`); toast('Listing deleted.'); backToAugmentedList(); }
      catch (err) { toast(err.message); }
    } else if (favBtn) {
      try { await apiPut(`/api/augmented-homes/${favBtn.dataset.id}/favorite`, {}); openAugmentedHomeDetail(favBtn.dataset.id); }
      catch (err) { toast(err.message); }
    } else if (addOhBtn) {
      const homeId = addOhBtn.dataset.id;
      const start = document.getElementById(`augOhStart-${homeId}`).value;
      const end = document.getElementById(`augOhEnd-${homeId}`).value;
      if (!start || !end) { toast('Pick a start and end time.'); return; }
      try {
        await apiPost(`/api/augmented-homes/${homeId}/open-houses`, {
          startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
          note: document.getElementById(`augOhNote-${homeId}`).value.trim(),
        });
        toast('Open house scheduled.');
        loadAugmentedOpenHousesInto(homeId);
      } catch (err) { toast(err.message); }
    } else if (deleteOhBtn) {
      try { await apiDelete(`/api/augmented-homes/${deleteOhBtn.dataset.homeId}/open-houses/${deleteOhBtn.dataset.id}`); loadAugmentedOpenHousesInto(deleteOhBtn.dataset.homeId); }
      catch (err) { toast(err.message); }
    } else if (rsvpBtn) {
      try { await apiPost(`/api/augmented-homes/${rsvpBtn.dataset.homeId}/open-houses/${rsvpBtn.dataset.id}/rsvp`, {}); loadAugmentedOpenHousesInto(rsvpBtn.dataset.homeId); }
      catch (err) { toast(err.message); }
    } else if (decideBtn) {
      try {
        await apiPut(`/api/augmented-homes/${decideBtn.dataset.homeId}/offers/${decideBtn.dataset.id}`, { action: decideBtn.dataset.decision });
        loadAugmentedOffersInto(decideBtn.dataset.homeId, augmentedDetail ? augmentedDetail.isOwner : true);
      } catch (err) { toast(err.message); }
    } else if (counterBtn) {
      const offerId = counterBtn.dataset.id;
      const priceEl = document.getElementById(`augCounterPrice-${offerId}`) || document.getElementById(`augCounterBackPrice-${offerId}`);
      const msgEl = document.getElementById(`augCounterMsg-${offerId}`) || document.getElementById(`augCounterBackMsg-${offerId}`);
      const counterPrice = priceEl.value;
      if (!counterPrice) { toast('Enter a counter-offer price.'); return; }
      try {
        await apiPut(`/api/augmented-homes/${counterBtn.dataset.homeId}/offers/${offerId}`, { action: 'counter', counterPrice, counterMessage: msgEl.value.trim() });
        toast('Counter-offer sent.');
        loadAugmentedOffersInto(counterBtn.dataset.homeId, augmentedDetail.isOwner);
      } catch (err) { toast(err.message); }
    } else if (withdrawBtn) {
      if (!confirm('Withdraw your offer?')) return;
      try {
        await apiPut(`/api/augmented-homes/${withdrawBtn.dataset.homeId}/offers/${withdrawBtn.dataset.id}`, { action: 'withdraw' });
        toast('Offer withdrawn.');
        loadAugmentedOffersInto(withdrawBtn.dataset.homeId, false);
      } catch (err) { toast(err.message); }
    } else if (submitOfferBtn) {
      const homeId = submitOfferBtn.dataset.homeId;
      const price = document.getElementById(`augOfferPrice-${homeId}`).value;
      if (!price) { toast('Enter an offer price.'); return; }
      try {
        await apiPost(`/api/augmented-homes/${homeId}/offers`, {
          offerPrice: price,
          financingType: document.getElementById(`augOfferFinancingType-${homeId}`).value,
          closingTimeline: document.getElementById(`augOfferClosingTimeline-${homeId}`).value.trim(),
          contingencies: document.getElementById(`augOfferContingencies-${homeId}`).value.trim(),
          message: document.getElementById(`augOfferMessage-${homeId}`).value.trim(),
        });
        toast('Offer sent. It is not a contract: a home sale needs a written purchase agreement.');
        loadAugmentedOffersInto(homeId, false);
      } catch (err) { toast(err.message); }
    }
  });

  /* ---------------- GreenHomes wiring ---------------- */
  document.getElementById('createGreenHomeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('createGreenHomeBtn');
    if (ownerConfirmMissing('ownerConfirmGreen')) return;
    btn.disabled = true;
    try {
      const greenFeatures = [...document.querySelectorAll('.green-create-check:checked')].map(c => c.value);
      const costs = readHomeCosts('grc');
      const { id } = await apiPost('/api/green-homes', {
        title: document.getElementById('greenTitle').value.trim(),
        askingPrice: document.getElementById('greenAskingPrice').value,
        city: document.getElementById('greenCity').value.trim(),
        state: document.getElementById('greenState').value.trim(),
        zip: document.getElementById('greenZip').value.trim(),
        neighborhood: document.getElementById('greenNeighborhood').value.trim(),
        address: document.getElementById('greenAddress').value.trim(),
        propertyType: document.getElementById('greenPropertyType').value,
        beds: document.getElementById('greenBeds').value,
        baths: document.getElementById('greenBaths').value,
        sqft: document.getElementById('greenSqft').value || null,
        description: document.getElementById('greenDescription').value.trim(),
        greenFeatures,
        featureNotes: document.getElementById('greenFeatureNotes').value.trim(),
        lifeEventTags: [...document.querySelectorAll('.green-life-event-check:checked')].map(c => c.value),
      });
      await saveHomeCosts('green_home', id, costs);
      resetHomeCostsFields('greenCostsFields', 'grc');
      const photoResult = await uploadPhotos(`/api/green-homes/${id}/photos`, [...document.getElementById('greenPhotos').files]);
      toastWithPhotoResult('Listed on GreenHomes.', photoResult);
      document.getElementById('postGreenWrap').open = false;
      ['greenTitle', 'greenAskingPrice', 'greenCity', 'greenState', 'greenZip', 'greenNeighborhood', 'greenAddress', 'greenSqft', 'greenDescription', 'greenFeatureNotes'].forEach(f => document.getElementById(f).value = '');
      document.getElementById('greenBeds').value = '';
      document.getElementById('greenBaths').value = '';
      document.getElementById('greenPhotos').value = '';
      document.querySelectorAll('.green-create-check').forEach(c => c.checked = false);
      document.querySelectorAll('.green-life-event-check').forEach(c => c.checked = false);
      document.getElementById('ownerConfirmGreen').checked = false;
      loadMyGreenHomes();
      loadGreenBrowse();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.getElementById('saveGreenAlertBtn').addEventListener('click', async () => {
    try {
      const greenFeatures = [...document.querySelectorAll('.green-alert-check:checked')].map(c => c.value);
      await apiPost('/api/green-needs-alerts', {
        label: document.getElementById('greenAlertLabel').value.trim(),
        greenFeatures,
        city: document.getElementById('greenAlertCity').value.trim(),
        state: document.getElementById('greenAlertState').value.trim(),
      });
      document.getElementById('greenAlertLabel').value = '';
      document.getElementById('greenAlertCity').value = '';
      document.getElementById('greenAlertState').value = '';
      document.querySelectorAll('.green-alert-check').forEach(c => c.checked = false);
      loadMyGreenAlerts();
      toast("Saved — we'll notify you when a match is listed.");
    } catch (err) { toast(err.message); }
  });

  document.getElementById('greenAlertsList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="delete-green-alert"]');
    if (!btn) return;
    try { await apiDelete(`/api/green-needs-alerts/${btn.dataset.id}`); loadMyGreenAlerts(); }
    catch (err) { toast(err.message); }
  });

  document.getElementById('greenFilters').addEventListener('input', () => loadGreenBrowse());
  document.getElementById('greenFilterChips').addEventListener('change', () => loadGreenBrowse());
  document.getElementById('greenLoadMoreBtn')?.addEventListener('click', () => loadMoreGreenBrowse());

  function wireGreenOpenButtons(containerId) {
    document.getElementById(containerId).addEventListener('click', async e => {
      const openBtn = e.target.closest('[data-action="open-green-home"]');
      const statusBtn = e.target.closest('[data-action="green-set-status"]');
      if (openBtn) openGreenHomeDetail(openBtn.dataset.id);
      else if (statusBtn) {
        try { await apiPut(`/api/green-homes/${statusBtn.dataset.id}`, { action: 'set-status', status: statusBtn.dataset.status }); loadMyGreenHomes(); }
        catch (err) { toast(err.message); }
      }
    });
  }
  wireGreenOpenButtons('myGreenHomesList');
  wireGreenOpenButtons('greenBrowseList');
  wireGreenOpenButtons('greenFavoritesList');

  document.getElementById('backToGreen').addEventListener('click', backToGreenList);

  document.getElementById('greenDetailContent').addEventListener('click', async e => {
    const msgBtn = e.target.closest('[data-action="message-user"]');
    const deletePhotoBtn = e.target.closest('[data-action="delete-green-photo"]');
    const deleteHomeBtn = e.target.closest('[data-action="delete-green-home"]');
    const favBtn = e.target.closest('[data-action="toggle-green-favorite"]');
    const addOhBtn = e.target.closest('[data-action="add-green-open-house"]');
    const deleteOhBtn = e.target.closest('[data-action="delete-green-open-house"]');
    const rsvpBtn = e.target.closest('[data-action="rsvp-green-open-house"]');
    const decideBtn = e.target.closest('[data-action="decide-green-offer"]');
    const counterBtn = e.target.closest('[data-action="counter-green-offer"]');
    const withdrawBtn = e.target.closest('[data-action="withdraw-green-offer"]');
    const submitOfferBtn = e.target.closest('[data-action="submit-green-offer"]');

    if (msgBtn) { try { await startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); } catch (err) { toast(err.message); } }
    else if (deletePhotoBtn) {
      if (!confirm('Remove this photo?')) return;
      try { await apiDelete(`/api/green-homes/${greenDetail.id}/photos/${deletePhotoBtn.dataset.id}`); openGreenHomeDetail(greenDetail.id); }
      catch (err) { toast(err.message); }
    } else if (deleteHomeBtn) {
      if (!confirm('Permanently delete this listing? It cannot be recovered after this.')) return;
      try { await apiDelete(`/api/green-homes/${deleteHomeBtn.dataset.id}`); toast('Listing deleted.'); backToGreenList(); }
      catch (err) { toast(err.message); }
    } else if (favBtn) {
      try { await apiPut(`/api/green-homes/${favBtn.dataset.id}/favorite`, {}); openGreenHomeDetail(favBtn.dataset.id); }
      catch (err) { toast(err.message); }
    } else if (addOhBtn) {
      const homeId = addOhBtn.dataset.id;
      const start = document.getElementById(`greenOhStart-${homeId}`).value;
      const end = document.getElementById(`greenOhEnd-${homeId}`).value;
      if (!start || !end) { toast('Pick a start and end time.'); return; }
      try {
        await apiPost(`/api/green-homes/${homeId}/open-houses`, {
          startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
          note: document.getElementById(`greenOhNote-${homeId}`).value.trim(),
        });
        toast('Open house scheduled.');
        loadGreenOpenHousesInto(homeId);
      } catch (err) { toast(err.message); }
    } else if (deleteOhBtn) {
      try { await apiDelete(`/api/green-homes/${deleteOhBtn.dataset.homeId}/open-houses/${deleteOhBtn.dataset.id}`); loadGreenOpenHousesInto(deleteOhBtn.dataset.homeId); }
      catch (err) { toast(err.message); }
    } else if (rsvpBtn) {
      try { await apiPost(`/api/green-homes/${rsvpBtn.dataset.homeId}/open-houses/${rsvpBtn.dataset.id}/rsvp`, {}); loadGreenOpenHousesInto(rsvpBtn.dataset.homeId); }
      catch (err) { toast(err.message); }
    } else if (decideBtn) {
      try {
        await apiPut(`/api/green-homes/${decideBtn.dataset.homeId}/offers/${decideBtn.dataset.id}`, { action: decideBtn.dataset.decision });
        loadGreenOffersInto(decideBtn.dataset.homeId, greenDetail ? greenDetail.isOwner : true);
      } catch (err) { toast(err.message); }
    } else if (counterBtn) {
      const offerId = counterBtn.dataset.id;
      const priceEl = document.getElementById(`greenCounterPrice-${offerId}`) || document.getElementById(`greenCounterBackPrice-${offerId}`);
      const msgEl = document.getElementById(`greenCounterMsg-${offerId}`) || document.getElementById(`greenCounterBackMsg-${offerId}`);
      const counterPrice = priceEl.value;
      if (!counterPrice) { toast('Enter a counter-offer price.'); return; }
      try {
        await apiPut(`/api/green-homes/${counterBtn.dataset.homeId}/offers/${offerId}`, { action: 'counter', counterPrice, counterMessage: msgEl.value.trim() });
        toast('Counter-offer sent.');
        loadGreenOffersInto(counterBtn.dataset.homeId, greenDetail.isOwner);
      } catch (err) { toast(err.message); }
    } else if (withdrawBtn) {
      if (!confirm('Withdraw your offer?')) return;
      try {
        await apiPut(`/api/green-homes/${withdrawBtn.dataset.homeId}/offers/${withdrawBtn.dataset.id}`, { action: 'withdraw' });
        toast('Offer withdrawn.');
        loadGreenOffersInto(withdrawBtn.dataset.homeId, false);
      } catch (err) { toast(err.message); }
    } else if (submitOfferBtn) {
      const homeId = submitOfferBtn.dataset.homeId;
      const price = document.getElementById(`greenOfferPrice-${homeId}`).value;
      if (!price) { toast('Enter an offer price.'); return; }
      try {
        await apiPost(`/api/green-homes/${homeId}/offers`, {
          offerPrice: price,
          financingType: document.getElementById(`greenOfferFinancingType-${homeId}`).value,
          closingTimeline: document.getElementById(`greenOfferClosingTimeline-${homeId}`).value.trim(),
          contingencies: document.getElementById(`greenOfferContingencies-${homeId}`).value.trim(),
          message: document.getElementById(`greenOfferMessage-${homeId}`).value.trim(),
        });
        toast('Offer sent. It is not a contract: a home sale needs a written purchase agreement.');
        loadGreenOffersInto(homeId, false);
      } catch (err) { toast(err.message); }
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
        timelineMonths: document.getElementById('projTimelineMonths').value || null,
        description: document.getElementById('projDescription').value.trim(),
        adaptations: [...document.querySelectorAll('.proj-create-check:checked')].map(c => c.value),
        greenFeatures: [...document.querySelectorAll('.proj-green-create-check:checked')].map(c => c.value),
      });
      const photoResult = await uploadPhotos(`/api/dev-projects/${id}/photos`, [...document.getElementById('projPhotos').files]);
      toastWithPhotoResult('Project posted on FinderMine.', photoResult);
      document.getElementById('postProjectWrap').open = false;
      ['projTitle', 'projCity', 'projState', 'projZip', 'projNeighborhood', 'projAddress', 'projTimelineMonths', 'projDescription'].forEach(f => document.getElementById(f).value = '');
      document.getElementById('projPhotos').value = '';
      document.querySelectorAll('.proj-create-check').forEach(c => c.checked = false);
      document.querySelectorAll('.proj-green-create-check').forEach(c => c.checked = false);
      loadMyProjects();
      loadProjectsBrowse();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  document.getElementById('projectFilters').addEventListener('input', () => loadProjectsBrowse());
  document.getElementById('projectTypeFilter').addEventListener('change', () => loadProjectsBrowse());
  document.getElementById('projectStageFilter').addEventListener('change', () => loadProjectsBrowse());
  document.getElementById('projectAdaptationFilterChips').addEventListener('change', () => loadProjectsBrowse());
  document.getElementById('projectGreenFeatureFilterChips').addEventListener('change', () => loadProjectsBrowse());
  document.getElementById('projectsLoadMoreBtn')?.addEventListener('click', () => loadMoreProjectsBrowse());

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
  wireProjectOpenButtons('projectFavoritesList');

  document.getElementById('backToFinderMine').addEventListener('click', backToFinderMineList);

  document.getElementById('findermineDetailContent').addEventListener('click', async e => {
    const msgBtn = e.target.closest('[data-action="message-user"]');
    const deletePhotoBtn = e.target.closest('[data-action="delete-project-photo"]');
    const deleteProjectBtn = e.target.closest('[data-action="delete-project"]');
    const favBtn = e.target.closest('[data-action="toggle-project-favorite"]');
    if (msgBtn) { try { await startConversationWith(msgBtn.dataset.id, msgBtn.dataset.name); } catch (err) { toast(err.message); } }
    else if (deletePhotoBtn) {
      if (!confirm('Remove this photo?')) return;
      try { await apiDelete(`/api/dev-projects/${findermineDetail.id}/photos/${deletePhotoBtn.dataset.id}`); openProjectDetail(findermineDetail.id); }
      catch (err) { toast(err.message); }
    } else if (deleteProjectBtn) {
      if (!confirm('Permanently delete this project? It cannot be recovered after this.')) return;
      try { await apiDelete(`/api/dev-projects/${deleteProjectBtn.dataset.id}`); toast('Project deleted.'); backToFinderMineList(); }
      catch (err) { toast(err.message); }
    } else if (favBtn) {
      try { await apiPut(`/api/dev-projects/${favBtn.dataset.id}/favorite`, {}); openProjectDetail(favBtn.dataset.id); }
      catch (err) { toast(err.message); }
    }
  });

  document.getElementById('saveProjectAlertBtn').addEventListener('click', async () => {
    try {
      await apiPost('/api/dev-project-needs-alerts', {
        label: document.getElementById('projectAlertLabel').value.trim(),
        projectType: document.getElementById('projectAlertType').value,
        city: document.getElementById('projectAlertCity').value.trim(),
        state: document.getElementById('projectAlertState').value.trim(),
      });
      document.getElementById('projectAlertLabel').value = '';
      document.getElementById('projectAlertType').value = '';
      document.getElementById('projectAlertCity').value = '';
      document.getElementById('projectAlertState').value = '';
      loadMyProjectAlerts();
      toast("Saved — we'll notify you when a match is posted.");
    } catch (err) { toast(err.message); }
  });

  document.getElementById('projectAlertsList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="delete-project-alert"]');
    if (!btn) return;
    try { await apiDelete(`/api/dev-project-needs-alerts/${btn.dataset.id}`); loadMyProjectAlerts(); }
    catch (err) { toast(err.message); }
  });

  document.getElementById('saveMarketPulseAlertBtn').addEventListener('click', async () => {
    try {
      await apiPost('/api/market-pulse-alerts', {
        label: document.getElementById('marketPulseAlertLabel').value.trim(),
        eventType: document.getElementById('marketPulseAlertEventType').value,
        entityKind: document.getElementById('marketPulseAlertEntityKind').value,
        city: document.getElementById('marketPulseAlertCity').value.trim(),
        state: document.getElementById('marketPulseAlertState').value.trim(),
      });
      document.getElementById('marketPulseAlertLabel').value = '';
      document.getElementById('marketPulseAlertEventType').value = '';
      document.getElementById('marketPulseAlertEntityKind').value = '';
      document.getElementById('marketPulseAlertCity').value = '';
      document.getElementById('marketPulseAlertState').value = '';
      loadMyMarketPulseAlerts();
      toast("Saved — we'll notify you when a match happens.");
    } catch (err) { toast(err.message); }
  });

  document.getElementById('marketPulseAlertsList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="delete-market-pulse-alert"]');
    if (!btn) return;
    try { await apiDelete(`/api/market-pulse-alerts/${btn.dataset.id}`); loadMyMarketPulseAlerts(); }
    catch (err) { toast(err.message); }
  });

  // Market Pulse event/leaderboard links: a /listing/{id} link is a real page, let it navigate normally; an
  // /app#... link is the SAME page we're already on, so a plain <a> wouldn't actually open the detail view
  // (nothing listens for hashchange after load) -- route those through the same deep-link opener notifications use.
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-action="open-market-entity"]');
    if (!link) return;
    const href = link.dataset.link;
    if (href && href.startsWith('/app#')) { e.preventDefault(); openAppLink(href); }
  });

  document.addEventListener('click', e => {
    const compareBtn = e.target.closest('[data-action="toggle-compare"]');
    if (compareBtn) { toggleCompare(compareBtn.dataset.kind, Number(compareBtn.dataset.id)); return; }
    const removeBtn = e.target.closest('[data-action="remove-compare"]');
    if (removeBtn) { toggleCompare(removeBtn.dataset.kind, Number(removeBtn.dataset.id)); openCompareOverlay(); return; }
  });
  document.getElementById('closeCompareBtn').addEventListener('click', closeCompareOverlay);
  document.getElementById('shareCompareBtn').addEventListener('click', shareCompareLink);

  const searchInput = document.getElementById('globalSearchInput');
  const searchResults = document.getElementById('globalSearchResults');
  searchInput.addEventListener('input', () => {
    clearTimeout(globalSearchTimer);
    globalSearchTimer = setTimeout(() => runGlobalSearch(searchInput.value), 250);
  });
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim().length >= 2) runGlobalSearch(searchInput.value); });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) searchResults.classList.add('hidden');
  });
  document.getElementById('compareOverlay').addEventListener('click', e => {
    if (e.target.id === 'compareOverlay') closeCompareOverlay();
  });

  document.getElementById('marketPulseFilterBtn').addEventListener('click', loadMarketPulse);
  document.getElementById('marketPulseFilterClearBtn').addEventListener('click', () => {
    document.getElementById('marketPulseFilterCity').value = '';
    document.getElementById('marketPulseFilterState').value = '';
    loadMarketPulse();
  });

  // The Agent Strategy tab is where the app opens, unless a deep link
  // (/app#pre-listing-12, #transaction-7, #messages-3, #post-home) from a
  // bookmark, notification or shared URL says otherwise — and a deep link always wins over the remembered tab
  // below, since it's a more specific instruction about where the user wants to be right now. Only one of the
  // two runs, so the tab's data isn't fetched twice. The Feed loads when its tab is opened.
  const openedByLink = location.hash ? await openAppLink(location.hash) : false;
  if (!openedByLink) {
    const VALID_TABS = ['marketplace', 'feed', 'marketpulse', 'listing', 'groups', 'matches', 'saved', 'messages', 'augmented', 'findermine', 'greenhomes'];
    let lastTab = 'marketplace';
    try { if (VALID_TABS.includes(localStorage.getItem('ah_last_tab'))) lastTab = localStorage.getItem('ah_last_tab'); } catch {}
    goToTab(lastTab);
  }
});
