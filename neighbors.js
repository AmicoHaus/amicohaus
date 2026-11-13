/* Amico Haus — watch areas and the head start, standing interest and trial stays in the app (loaded before main.js).
   Needs client.js first (api/apiGet/apiPost, escapeHtml, toast). Globals: the 8 functions main.js and the other
   scripts call (nbHeadStartFieldHtml, nbReadHeadStart, nbHeadStartBadgeHtml, loadWatchAreas,
   nbStandingInterestButtonHtml, nbOwnerInterestsHtml, nbTradeTrialHtml, nbOpenTradeTrial); every other name starts
   with NB_/nb. Each part shows only when its tool is live for this viewer (window.NUANCED, from /api/nuanced-tools).
   A watch area is a whole ZIP code any member can pick: this file never reads the visitor's location and never asks
   where they live. Standing interest and trial stays have no free-text field. */

// The same words as the server libs (watchAreas.js, standingInterest.js, tradeTrials.js, ideaText.js);
// tools/neighbors-test.mjs and tools/trade-trial-test.mjs compare them.
const NB_WATCH_PRECISION_LINE = 'For now a watch area is a whole ZIP code.';
const NB_WATCH_OPEN_LINE = "Anyone with an account can watch any ZIP code. You don't have to live there.";
const NB_HEAD_START_NO_AGREEMENT = "I haven't signed a listing agreement for this home.";
const NB_HEAD_START_AGENT_LINE = 'Working with an agent? Their MLS rules decide the timing: once a home with a listing agreement is marketed to the public, MLS rules generally give the agent one business day to put it on the MLS (the Clear Cooperation rule). Ask your agent before using a head start.';
const NB_HEAD_START_HELP = `During the head start only members who watch your ZIP code see your home. ${NB_WATCH_OPEN_LINE} After it, your home opens to everyone by itself, and you can open it sooner.`;
const NB_HEAD_START_HOURS = [[24, '24 hours'], [72, '3 days'], [168, '7 days']];
const NB_STANDING_LABEL = 'Not an offer to purchase.';
const NB_STANDING_LINE = "Standing interest tells an owner what you'd consider. It isn't an offer, it doesn't bind you or the owner, and it is never shown publicly.";
const NB_STANDING_ACK = "I understand this is not an offer to purchase and doesn't bind me or any owner.";
const NB_HOME_CLAIM_ACK = "I own a home on this street. I understand Amico Haus doesn't check this.";
const NB_REPLY_NAME_LINE = 'Replying shows the member your display name and starts a conversation in Messages.';
const NB_REPLY_NOTE = 'Stick to price, terms and timing. Leave out personal details like family, religion, age or background.';
const NB_TRIAL_LINE = "A trial stay is between the two of you. Amico Haus only records that you both said yes, the dates and this checklist. That record isn't a contract, and Amico Haus doesn't provide one, handle money or share addresses.";
const NB_TRIAL_ADDRESS_LINE = "Addresses aren't shared here. Exchange them yourselves in Messages when you're both ready.";
const NB_TRIAL_LONG_LINE = 'A stay of 30 days or more can create a tenancy with tenant protections, and your lender, insurer, HOA and city may each have a say. Have an attorney write your agreement first.';
const NB_TRIAL_CHECKLIST = {
  insurance: "I've checked that my homeowner's insurance covers a guest staying in my home.",
  hoa: "I've checked my HOA's rules on guests and short stays.",
  city: "I've checked my city's rules on short stays (they can apply even when no money changes hands).",
  no_money: 'No money, deposit or fee goes through Amico Haus, and none is recorded here.',
  own_home: 'I stay responsible for my own home, mortgage, bills and belongings.',
  own_agreement: "We'll write down what we agree between ourselves. Amico Haus doesn't provide a contract.",
};
const NB_TRIAL_LONG_ACK = "I understand a stay of 30 days or more can create a tenancy, and that we'll have an attorney write our agreement first.";
const NB_HOA_CITY_LINE = "Check your HOA rules and your city's rules first.";
const NB_PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];
const NB_PACIFIC = 'America/Los_Angeles';

let nbState = { areas: [], max: 3, items: [], early: [], mine: [], reaching: [], claims: [] };
let nbLoadSeq = 0;
let nbPendingTarget = null; // { kind: 'pre_listing', id } | { kind: 'area', zip }: what the interest form opens on
let nbTrials = [];
let nbTrialsTimer = null;

function nbLive(tool) { return !!(window.NUANCED && window.NUANCED[tool] === true); }
function nbGet(path, fallback) { return apiGet(path).catch(() => fallback); }
function nbFail(err) { if (typeof toastActionError === 'function') toastActionError(err); else toast((err && err.message) || 'Something went wrong. Please try again.'); }
function nbScrollTo(el) { if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function nbSqlDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : null;
}
// "Sat, Nov 14, 1:00 PM" (Pacific) for a server time; the caller adds "Pacific time".
function nbTimeLabel(s) {
  const d = nbSqlDate(s);
  return d ? d.toLocaleString('en-US', { timeZone: NB_PACIFIC, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ') : '';
}
function nbDayLabel(s) {
  const d = nbSqlDate(s);
  return d ? d.toLocaleDateString('en-US', { timeZone: NB_PACIFIC, month: 'short', day: 'numeric', year: 'numeric' }) : '';
}
function nbToday() { return new Date().toLocaleDateString('en-CA', { timeZone: NB_PACIFIC }); }
function nbMoney(n) { return `$${Number(n || 0).toLocaleString('en-US')}`; }
function nbCheckHtml(id, text, attrs = '') {
  return `<label class="checkbox-row" for="${escapeHtml(id)}"><input type="checkbox" id="${escapeHtml(id)}"${attrs}><span>${escapeHtml(text)}</span></label>`;
}

/* ---------------- The head start: form field, what it holds, the owner's badge ---------------- */

// The head-start field on a listing or pre-listing form (create only). opts = { kind, agentPosted }. For a home an
// agent posts, the field is replaced by the note about their MLS rules.
function nbHeadStartFieldHtml(prefix, opts) {
  if (!nbLive('headStart')) return '';
  const p = String(prefix || '');
  if (opts && opts.agentPosted) return `<div><p class="tiny field-hint">${escapeHtml(NB_HEAD_START_AGENT_LINE)}</p></div>`;
  return `<div data-nb-head-start="${escapeHtml(p)}">
    ${nbCheckHtml(`${p}HeadStartOn`, 'Give members who watch my ZIP code a head start', ' data-action="nb-head-start-toggle"')}
    <div class="hidden" data-nb-head-start-more>
      <div class="field"><label for="${escapeHtml(p)}HeadStartHours">How long</label>
        <select id="${escapeHtml(p)}HeadStartHours">${NB_HEAD_START_HOURS.map(([h, label]) => `<option value="${h}">${label}</option>`).join('')}</select></div>
      ${nbCheckHtml(`${p}HeadStartNoAgreement`, NB_HEAD_START_NO_AGREEMENT)}
    </div>
    <p class="tiny field-hint">${escapeHtml(NB_HEAD_START_HELP)}</p>
    <p class="tiny field-hint">${escapeHtml(NB_HEAD_START_AGENT_LINE)}</p>
  </div>`;
}

// What the field holds, for the create body's headStart: {} when it isn't there or isn't ticked.
function nbReadHeadStart(prefix) {
  const p = String(prefix || '');
  const on = document.getElementById(`${p}HeadStartOn`);
  if (!on || !on.checked) return {};
  const hours = document.getElementById(`${p}HeadStartHours`);
  const box = document.getElementById(`${p}HeadStartNoAgreement`);
  return { hours: Number(hours && hours.value) || 0, noAgreement: !!(box && box.checked) };
}

// The owner's badge while their home is in its head start. row: the owner's own listing (head_start_until, as
// /api/listings/:id sends it) or pre-listing (headStartUntil, as /api/pre-listings/:id sends it to the owner).
function nbHeadStartBadgeHtml(row) {
  if (!nbLive('headStart') || !row) return '';
  const isListing = row.head_start_until !== undefined && row.headStartUntil === undefined;
  const until = isListing ? row.head_start_until : row.headStartUntil;
  const d = nbSqlDate(until);
  if (!d || d.getTime() <= Date.now()) return '';
  return `<div class="head-start-badge">
    <p class="tiny">${escapeHtml(`Head start until ${nbTimeLabel(until)} Pacific time: only members who watch ZIP ${row.zip || ''} see it.`)}</p>
    <button type="button" class="btn btn-ghost btn-sm" data-action="nb-end-head-start" data-kind="${isListing ? 'listing' : 'pre_listing'}" data-id="${Number(row.id)}">Open to everyone now</button>
  </div>`;
}

/* ---------------- The panel in the Saved tab ---------------- */

function nbAreasHtml() {
  const { areas, max } = nbState;
  const chips = areas.map(a => `<span class="watch-area-chip">${escapeHtml(a.label ? `${a.zip} · ${a.label}` : a.zip)}
      <button type="button" class="link-btn" data-action="nb-area-remove" data-id="${Number(a.id)}" aria-label="${escapeHtml(`Remove ZIP ${a.zip}`)}">Remove</button></span>`).join('');
  const form = areas.length < max ? `
    <form data-nb-form="area">
      <div class="form-row two-col">
        <div class="field"><label for="nbAreaZip">ZIP code</label><input type="text" id="nbAreaZip" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off" required></div>
        <div class="field"><label for="nbAreaLabel">Name it (optional)</label><input type="text" id="nbAreaLabel" maxlength="40" autocomplete="off"></div>
      </div>
      <button type="submit" class="btn btn-primary btn-sm">Watch this ZIP code</button>
    </form>` : `<p class="tiny">${escapeHtml(`You're watching ${max} ZIP codes. Remove one to add another.`)}</p>`;
  return `<h2>Watch areas</h2>
    <p class="section-sub">${escapeHtml(NB_WATCH_OPEN_LINE)} ${escapeHtml(NB_WATCH_PRECISION_LINE)}</p>
    ${chips ? `<div class="card-actions">${chips}</div>` : ''}
    ${form}`;
}

function nbEarlyCardHtml(h) {
  const photo = h.photoIds && h.photoIds.length
    ? `<img class="side-thumb" src="/api/photos/${Number(h.photoIds[0])}" alt="${escapeHtml(typeof homePhotoAlt === 'function' ? homePhotoAlt(h) : 'Photo of this home')}" loading="lazy">` : '';
  const facts = [`${h.beds}bd/${h.baths}ba`, h.propertyType, h.sqft ? `${Number(h.sqft).toLocaleString('en-US')} sqft` : '', [h.city, h.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const price = h.isRental
    ? `For rent: ${nbMoney(h.rentAmount)}/mo`
    : `Owner's estimated value (not an appraisal or list price): ${nbMoney(h.estimatedValue)}`;
  return `<div class="side early-look-card">
    ${photo}
    <strong>${escapeHtml(h.title || `${h.propertyType} in ZIP ${h.zip}`)}</strong>
    <p class="tiny">${escapeHtml(facts)}</p>
    <p class="tiny">${escapeHtml(price)}</p>
    ${h.wants ? `<p class="tiny">${escapeHtml(`Wants: ${h.wants.type} in ${h.wants.locations} · ${nbMoney(h.wants.priceMin)}–${nbMoney(h.wants.priceMax)}`)}</p>` : ''}
    ${h.description ? `<p class="tiny">${escapeHtml(h.description)}</p>` : ''}
    <p class="tiny">${escapeHtml(`Open to members who watch ZIP ${h.zip} until ${h.headStartLabel}.`)}</p>
    <div class="card-actions">
      <button type="button" class="btn btn-primary btn-sm" data-action="nb-message-owner" data-id="${Number(h.owner.id)}" data-name="${escapeHtml(h.owner.name)}" data-zip="${escapeHtml(h.zip)}">Message the owner</button>
    </div>
  </div>`;
}
function nbEarlyHtml() {
  if (!nbState.early.length) return '';
  return `<h3>Neighbors First</h3><div class="stack">${nbState.early.map(nbEarlyCardHtml).join('')}</div>`;
}

function nbDigestHtml() {
  if (!nbState.areas.length) return '';
  const items = nbState.items.map(i => {
    const href = String(i.href || '');
    const inApp = href.startsWith('/app#');
    return `<li><a href="${escapeHtml(href)}"${inApp ? ` data-action="nb-open-link" data-link="${escapeHtml(href)}"` : ''}>${escapeHtml(i.text)}</a> <span class="tiny">${escapeHtml(nbDayLabel(i.createdAt))}</span></li>`;
  }).join('');
  return `<h3>What's new in your watch areas</h3>
    ${items ? `<ul class="watch-digest">${items}</ul>` : '<p class="tiny">Nothing new in the last two weeks. New homes in your ZIP codes show up here.</p>'}`;
}

function nbSelectHtml(id, options, selected = '') {
  return `<select id="${id}">${options.map(([v, label]) => `<option value="${escapeHtml(v)}"${String(v) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`;
}
function nbMyInterestHtml(i) {
  const where = i.target.kind === 'pre_listing' ? 'A pre-listing' : (i.target.street ? `${i.target.street}, ZIP ${i.target.zip}` : `ZIP ${i.target.zip}`);
  return `<div class="side standing-interest-card">
    <strong>${escapeHtml(where)}</strong>
    <p>${escapeHtml(i.line)}</p>
    <p class="tiny"><strong>${escapeHtml(NB_STANDING_LABEL)}</strong> ${escapeHtml(i.expired ? `Ended ${nbDayLabel(i.expiresAt)}.` : `Runs until ${nbDayLabel(i.expiresAt)}.`)}</p>
    <div class="card-actions">
      <button type="button" class="link-btn" data-action="nb-interest-renew" data-id="${Number(i.id)}">Renew for 90 days</button>
      <button type="button" class="link-btn" data-action="nb-interest-withdraw" data-id="${Number(i.id)}">Withdraw</button>
    </div>
  </div>`;
}
function nbInterestFormHtml() {
  const t = nbPendingTarget;
  const where = t && t.kind === 'pre_listing'
    ? `<p class="tiny">This pre-listing. <button type="button" class="link-btn" data-action="nb-interest-clear-target">Use a ZIP code instead</button></p>`
    : `<div class="form-row two-col">
        <div class="field"><label for="nbInterestZip">A ZIP code</label><input type="text" id="nbInterestZip" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off" value="${escapeHtml((t && t.zip) || '')}" required></div>
        <div class="field"><label for="nbInterestStreet">Street name (no house number)</label><input type="text" id="nbInterestStreet" maxlength="60" autocomplete="off"></div>
      </div>`;
  return `<form id="nbInterestForm" data-nb-form="interest"${t && t.kind === 'pre_listing' ? ` data-pre-listing-id="${Number(t.id)}"` : ''}>
    <fieldset class="hoa-includes"><legend class="label">Where</legend>${where}</fieldset>
    <div class="field"><label for="nbInterestAmount">I'd consider about ($)</label><input type="number" id="nbInterestAmount" min="50000" max="50000000" step="1000" inputmode="numeric" required></div>
    <div class="form-row two-col">
      <div class="field"><label for="nbInterestType">Home type</label>${nbSelectHtml('nbInterestType', [['Any', 'Any home type'], ...NB_PROPERTY_TYPES.map(p => [p, p])])}</div>
      <div class="field"><label for="nbInterestBeds">Bedrooms (at least)</label>${nbSelectHtml('nbInterestBeds', [['0', 'Any'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']])}</div>
    </div>
    <div class="form-row two-col">
      <div class="field"><label for="nbInterestFinancing">Cash or financed</label>${nbSelectHtml('nbInterestFinancing', [['either', 'Cash or financed'], ['cash', 'Cash'], ['financed', 'Financed']])}</div>
      <div class="field"><label for="nbInterestTiming">Timing</label>${nbSelectHtml('nbInterestTiming', [['flexible', 'Flexible on timing'], ['3_months', 'Within 3 months'], ['6_months', 'Within 6 months'], ['12_months', 'Within 12 months']])}</div>
    </div>
    ${nbCheckHtml('nbInterestAck', NB_STANDING_ACK)}
    <p class="tiny">${escapeHtml(NB_STANDING_LINE)}</p>
    <button type="submit" class="btn btn-primary btn-sm">Post standing interest</button>
  </form>`;
}
function nbClaimsHtml() {
  const { claims } = nbState;
  const chips = claims.map(c => `<span class="watch-area-chip">${escapeHtml(c.street ? `${c.street}, ZIP ${c.zip}` : `ZIP ${c.zip}`)}
      <button type="button" class="link-btn" data-action="nb-claim-remove" data-id="${Number(c.id)}" aria-label="${escapeHtml(`Remove ZIP ${c.zip}`)}">Remove</button></span>`).join('');
  const form = claims.length < 2 ? `
    <form data-nb-form="claim">
      <div class="form-row two-col">
        <div class="field"><label for="nbClaimZip">ZIP code</label><input type="text" id="nbClaimZip" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off" required></div>
        <div class="field"><label for="nbClaimStreet">Street name (no house number)</label><input type="text" id="nbClaimStreet" maxlength="60" autocomplete="off"></div>
      </div>
      ${nbCheckHtml('nbClaimAck', NB_HOME_CLAIM_ACK)}
      <button type="submit" class="btn btn-ghost btn-sm">Add my home</button>
    </form>` : '';
  return `<h3>My home</h3>
    <p class="tiny">Is your home not on Amico Haus? Add its ZIP code and street name, and standing interest posted there reaches you too. Only you see this.</p>
    ${chips ? `<div class="card-actions">${chips}</div>` : ''}
    ${form}`;
}
function nbReachingHtml() {
  const rows = nbState.reaching.map(i => `<div class="side standing-interest-card">
      <strong>${escapeHtml(i.where)}</strong>
      <p>${escapeHtml(i.line)}</p>
      <p class="tiny"><strong>${escapeHtml(NB_STANDING_LABEL)}</strong> ${escapeHtml(`Posted ${nbDayLabel(i.postedAt)}.`)}</p>
      ${i.canReply ? `<div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="nb-reply-open" data-id="${Number(i.id)}">Reply</button></div>
      <form class="hidden" data-nb-form="reply" data-id="${Number(i.id)}">
        <div class="field"><label for="nbReply-${Number(i.id)}">Your reply</label><textarea id="nbReply-${Number(i.id)}" maxlength="1000" rows="3" required></textarea></div>
        <p class="tiny">${escapeHtml(NB_REPLY_NAME_LINE)}</p>
        <p class="tiny">${escapeHtml(NB_REPLY_NOTE)}</p>
        <button type="submit" class="btn btn-primary btn-sm">Send reply</button>
      </form>` : '<p class="tiny">You replied. The conversation is in Messages.</p>'}
    </div>`).join('');
  return `<h3 id="nbReaching">Standing interest that reaches your home</h3>
    ${rows ? `<div class="stack">${rows}</div>` : '<p class="tiny">Nothing right now. When a member posts standing interest for your ZIP code, your street or your pre-listing, it shows here.</p>'}`;
}
function nbStandingHtml() {
  const mine = nbState.mine.map(nbMyInterestHtml).join('');
  return `<h2 id="nbStanding">Standing interest</h2>
    ${mine ? `<div class="stack">${mine}</div>` : ''}
    ${nbInterestFormHtml()}
    ${nbClaimsHtml()}
    ${nbReachingHtml()}`;
}

function nbRenderPanel() {
  const el = document.getElementById('watchAreasPanel');
  if (!el) return;
  const parts = [];
  if (nbLive('watchAreas')) {
    parts.push(nbAreasHtml());
    if (nbLive('headStart')) parts.push(nbEarlyHtml());
    parts.push(nbDigestHtml());
  }
  if (nbLive('standingOffer')) parts.push(nbStandingHtml());
  el.innerHTML = parts.length ? `<div class="watch-areas">${parts.join('')}</div>` : '';
}

// Fills #watchAreasPanel in the Saved tab: each part only when its tool is live for this viewer.
async function loadWatchAreas() {
  const el = document.getElementById('watchAreasPanel');
  if (!el) return;
  const watch = nbLive('watchAreas'), standing = nbLive('standingOffer');
  if (!watch && !standing) { el.innerHTML = ''; return; }
  const seq = ++nbLoadSeq;
  const [digest, early, mine, reaching, claims] = await Promise.all([
    watch ? nbGet('/api/watch-areas/digest', { areas: [], items: [], max: 3 }) : { areas: [], items: [], max: 3 },
    watch && nbLive('headStart') ? nbGet('/api/watch-areas/early', { homes: [] }) : { homes: [] },
    standing ? nbGet('/api/standing-interests', { interests: [] }) : { interests: [] },
    standing ? nbGet('/api/standing-interests?for=owner', { interests: [] }) : { interests: [] },
    standing ? nbGet('/api/home-claims', { claims: [] }) : { claims: [] },
  ]);
  if (seq !== nbLoadSeq) return; // a newer load is on its way
  nbState = {
    areas: digest.areas || [], max: Number(digest.max) || 3, items: digest.items || [], early: early.homes || [],
    mine: mine.interests || [], reaching: reaching.interests || [], claims: claims.claims || [],
  };
  nbRenderPanel();
}

/* ---------------- Standing interest: the button on a home, and the owner's link ---------------- */

// target = { kind: 'pre_listing', id } or { kind: 'area', zip }: opens the standing-interest form on that target.
function nbStandingInterestButtonHtml(target) {
  if (!nbLive('standingOffer') || !target) return '';
  const data = target.kind === 'pre_listing' ? ` data-kind="pre_listing" data-id="${Number(target.id)}"` : ` data-kind="area" data-zip="${escapeHtml(target.zip || '')}"`;
  return `<button type="button" class="btn btn-ghost btn-sm" data-action="nb-interest-open"${data}>I'd consider about...</button>`;
}

// A link to the owner's list in the Saved tab. No count in the link.
function nbOwnerInterestsHtml() {
  if (!nbLive('standingOffer')) return '';
  return '<p class="tiny"><a href="/app#standing-interests" data-action="nb-go-interests">Standing interest that reaches your home</a></p>';
}

async function nbShowPanel(anchorId) {
  if (typeof goToTab === 'function') goToTab('saved');
  await loadWatchAreas();
  nbScrollTo(document.getElementById(anchorId) || document.getElementById('watchAreasPanel'));
}

/* ---------------- Trial stays on a mutual trade match ---------------- */

function nbPairKey(a, b) { const x = Number(a), y = Number(b); return x < y ? `${x}-${y}` : `${y}-${x}`; }
function nbChecklistHtml(key) {
  return `<fieldset class="trial-checklist"><legend class="label">Your checklist</legend>${Object.entries(NB_TRIAL_CHECKLIST).map(([k, text]) => nbCheckHtml(`nbTrialCheck-${key}-${k}`, text, ` data-nb-check="${k}"`)).join('')}</fieldset>`;
}
// The form that suggests dates (a new trial, or other dates on one that exists). key keeps its ids apart.
function nbTrialFormHtml(key, mineId, otherId, trial) {
  const k = escapeHtml(key);
  return `<form data-nb-form="trial" data-a="${Number(mineId)}" data-b="${Number(otherId)}" data-key="${k}">
    <p class="tiny">${escapeHtml(NB_TRIAL_LINE)}</p>
    <div class="form-row two-col">
      <div class="field"><label for="nbTrialStart-${k}">Start date</label><input type="date" id="nbTrialStart-${k}" min="${nbToday()}" value="${escapeHtml((trial && trial.status !== 'canceled' && trial.startDate) || '')}" required></div>
      <div class="field"><label for="nbTrialEnd-${k}">End date</label><input type="date" id="nbTrialEnd-${k}" min="${nbToday()}" value="${escapeHtml((trial && trial.status !== 'canceled' && trial.endDate) || '')}" required></div>
    </div>
    ${nbChecklistHtml(key)}
    <p class="tiny">${escapeHtml(NB_TRIAL_ADDRESS_LINE)}</p>
    ${nbCheckHtml(`nbTrialLong-${key}`, 'Longer than 29 nights', ' data-action="nb-trial-long-toggle"')}
    <div class="hidden" data-nb-long>
      <p class="tiny">${escapeHtml(NB_TRIAL_LONG_LINE)}</p>
      ${nbCheckHtml(`nbTrialLongAck-${key}`, NB_TRIAL_LONG_ACK, ' data-nb-long-ack')}
    </div>
    <div class="card-actions"><button type="submit" class="btn btn-primary btn-sm">Suggest these dates</button></div>
    <p class="tiny">${escapeHtml(NB_HOA_CITY_LINE)}</p>
  </form>`;
}
function nbTrialStateText(t) {
  if (t.status === 'canceled') return 'Canceled';
  if (t.status === 'agreed') return `You both said yes: ${t.rangeLabel}`;
  return t.iAgreed ? `Waiting for ${t.other.name}` : `${t.other.name} suggested ${t.rangeLabel}`;
}
// One trial in the list at the top of the Matches tab.
function nbTrialItemHtml(t) {
  const key = `t${Number(t.id)}`;
  const needsMyYes = t.status === 'proposed' && !t.iAgreed;
  const agree = needsMyYes ? `<form data-nb-form="trial-agree" data-id="${Number(t.id)}">
      <p class="tiny">${escapeHtml(NB_TRIAL_LINE)}</p>
      ${nbChecklistHtml(`${key}y`)}
      <p class="tiny">${escapeHtml(NB_TRIAL_ADDRESS_LINE)}</p>
      ${t.longStay ? `<p class="tiny">${escapeHtml(NB_TRIAL_LONG_LINE)}</p>${nbCheckHtml(`nbTrialLongAck-${key}y`, NB_TRIAL_LONG_ACK, ' data-nb-long-ack')}` : ''}
      <div class="card-actions"><button type="submit" class="btn btn-primary btn-sm">Say yes</button></div>
      <p class="tiny">${escapeHtml(NB_HOA_CITY_LINE)}</p>
    </form>` : '';
  return `<div class="side trial-card" id="nbTrial-${Number(t.id)}">
    <strong>${escapeHtml(`Trial stay with ${t.other.name}`)}</strong>
    <p class="tiny">${escapeHtml(t.otherHome)} · ${escapeHtml(`${t.nights} ${t.nights === 1 ? 'night' : 'nights'}`)}</p>
    <p>${escapeHtml(nbTrialStateText(t))}</p>
    ${agree}
    <details class="score-breakdown"><summary>${t.status === 'canceled' ? 'Suggest new dates' : 'Suggest other dates'}</summary>${nbTrialFormHtml(key, t.myListingId, t.otherListingId, t)}</details>
    ${t.status === 'canceled' ? '' : `<div class="card-actions"><button type="button" class="link-btn" data-action="nb-trial-cancel" data-id="${Number(t.id)}">Cancel the trial</button></div>`}
  </div>`;
}
function nbRenderTrials() {
  const matches = document.getElementById('matchesList');
  if (!matches || !matches.parentNode) return;
  let list = document.getElementById('nbTrialsList');
  if (!list) {
    list = document.createElement('div');
    list.id = 'nbTrialsList';
    matches.parentNode.insertBefore(list, matches);
  }
  list.innerHTML = nbTrials.length ? `<h3>Trial stays</h3><div class="stack">${nbTrials.map(nbTrialItemHtml).join('')}</div>` : '';
  // Each mutual-match card: the button while the pair has no trial under way, otherwise where it stands.
  document.querySelectorAll('[data-nb-pair]').forEach(card => {
    const t = nbTrials.find(x => nbPairKey(x.myListingId, x.otherListingId) === card.dataset.nbPair && x.status !== 'canceled');
    const slot = card.querySelector('[data-nb-trial-slot]');
    const btn = card.querySelector('[data-action="nb-trial-open"]');
    if (!slot || !btn) return;
    btn.classList.toggle('hidden', !!t);
    if (t) slot.innerHTML = `<p class="tiny">${escapeHtml(nbTrialStateText(t))} <button type="button" class="link-btn" data-action="nb-trial-show" data-id="${Number(t.id)}">See the trial stay</button></p>`;
    else if (!slot.querySelector('form')) slot.innerHTML = '';
  });
}
async function nbLoadTrials() {
  if (!nbLive('testDrive')) return;
  const data = await nbGet('/api/trade-trials', { trials: [] });
  nbTrials = data.trials || [];
  nbRenderTrials();
}
function nbScheduleTrials() {
  if (nbTrialsTimer) return;
  nbTrialsTimer = setTimeout(() => { nbTrialsTimer = null; nbLoadTrials(); }, 0);
}

// The block on a mutual-match card (main.js renderMatchCard). Nothing for a buyer or rental match.
function nbTradeTrialHtml(match) {
  if (!nbLive('testDrive') || !match || match.isBuyerMatch || match.isRentalMatch || !match.a || !match.b) return '';
  if (typeof currentUser === 'undefined' || !currentUser) return '';
  const mine = match.a.userId === currentUser.id ? match.a : match.b;
  const other = mine === match.a ? match.b : match.a;
  if (mine.userId !== currentUser.id || other.userId === currentUser.id) return '';
  nbScheduleTrials(); // once the cards are on the page, show where each pair's trial stands
  return `<div data-nb-pair="${nbPairKey(mine.listingId, other.listingId)}" data-mine="${Number(mine.listingId)}" data-other="${Number(other.listingId)}">
    <button type="button" class="btn btn-ghost btn-sm" data-action="nb-trial-open">Try each other's homes first</button>
    <div data-nb-trial-slot></div>
  </div>`;
}

// Opens the Matches tab's trial list on one trial (a notification's /app#trade-trial-<id> link).
async function nbOpenTradeTrial(id) {
  if (!nbLive('testDrive')) return;
  await nbLoadTrials();
  const el = document.getElementById(`nbTrial-${Number(id)}`);
  if (el) nbScrollTo(el);
  else toast('That trial stay is no longer available.');
}

function nbReadChecklist(form) {
  return [...form.querySelectorAll('[data-nb-check]')].filter(c => c.checked).map(c => c.dataset.nbCheck);
}

/* ---------------- Listeners (delegated; nothing inline) ---------------- */

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t || !t.dataset) return;
  if (t.dataset.action === 'nb-head-start-toggle') {
    const more = t.closest('[data-nb-head-start]') && t.closest('[data-nb-head-start]').querySelector('[data-nb-head-start-more]');
    if (more) more.classList.toggle('hidden', !t.checked);
  }
  if (t.dataset.action === 'nb-trial-long-toggle') {
    const more = t.closest('form') && t.closest('form').querySelector('[data-nb-long]');
    if (more) more.classList.toggle('hidden', !t.checked);
  }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest && e.target.closest('[data-action^="nb-"]');
  if (!el) return;
  const action = el.dataset.action;
  try {
    if (action === 'nb-area-remove') {
      await apiDelete(`/api/watch-areas/${Number(el.dataset.id)}`);
      await loadWatchAreas();
    } else if (action === 'nb-message-owner') {
      if (typeof startConversationWith === 'function') startConversationWith(Number(el.dataset.id), el.dataset.name || '', `About your home in ZIP ${el.dataset.zip || ''} (Neighbors First): `);
    } else if (action === 'nb-open-link') {
      const link = el.dataset.link || '';
      if (!link.startsWith('/app#')) return;
      e.preventDefault();
      if (link === '/app#watch-areas') nbScrollTo(document.getElementById('watchAreasPanel'));
      else if (typeof openAppLink === 'function') openAppLink(link);
    } else if (action === 'nb-go-interests') {
      e.preventDefault();
      await nbShowPanel('nbReaching');
    } else if (action === 'nb-interest-open') {
      nbPendingTarget = el.dataset.kind === 'pre_listing' ? { kind: 'pre_listing', id: Number(el.dataset.id) } : { kind: 'area', zip: el.dataset.zip || '' };
      await nbShowPanel('nbInterestForm');
    } else if (action === 'nb-interest-clear-target') {
      nbPendingTarget = null;
      nbRenderPanel();
      nbScrollTo(document.getElementById('nbInterestForm'));
    } else if (action === 'nb-interest-renew') {
      await apiPut(`/api/standing-interests/${Number(el.dataset.id)}`, { renew: true });
      toast('Renewed for 90 days.');
      await loadWatchAreas();
    } else if (action === 'nb-interest-withdraw') {
      await apiDelete(`/api/standing-interests/${Number(el.dataset.id)}`);
      toast('Withdrawn.');
      await loadWatchAreas();
    } else if (action === 'nb-claim-remove') {
      await apiDelete(`/api/home-claims/${Number(el.dataset.id)}`);
      await loadWatchAreas();
    } else if (action === 'nb-reply-open') {
      const form = el.closest('.standing-interest-card') && el.closest('.standing-interest-card').querySelector('[data-nb-form="reply"]');
      if (form) { form.classList.toggle('hidden'); const box = form.querySelector('textarea'); if (box && !form.classList.contains('hidden')) box.focus(); }
    } else if (action === 'nb-end-head-start') {
      await apiDelete(`/api/head-start/${el.dataset.kind === 'listing' ? 'listing' : 'pre_listing'}/${Number(el.dataset.id)}`);
      toast('Your home is open to everyone now.');
      const badge = el.closest('.head-start-badge');
      if (badge) badge.remove();
    } else if (action === 'nb-trial-open') {
      const card = el.closest('[data-nb-pair]');
      const slot = card && card.querySelector('[data-nb-trial-slot]');
      if (!slot) return;
      if (slot.querySelector('form')) { slot.innerHTML = ''; return; }
      const pair = card.dataset.nbPair;
      slot.innerHTML = `<div class="trial-card">${nbTrialFormHtml(`p${pair}`, card.dataset.mine, card.dataset.other, nbTrials.find(x => nbPairKey(x.myListingId, x.otherListingId) === pair) || null)}</div>`;
    } else if (action === 'nb-trial-show') {
      nbScrollTo(document.getElementById(`nbTrial-${Number(el.dataset.id)}`));
    } else if (action === 'nb-trial-cancel') {
      await apiPost(`/api/trade-trials/${Number(el.dataset.id)}`, { action: 'cancel' });
      toast('Trial stay canceled.');
      await nbLoadTrials();
    }
  } catch (err) { nbFail(err); }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest && e.target.closest('[data-nb-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.nbForm;
  const val = (id) => { const f = document.getElementById(id); return f ? f.value.trim() : ''; };
  const ticked = (id) => { const f = document.getElementById(id); return !!(f && f.checked); };
  try {
    if (kind === 'area') {
      await apiPost('/api/watch-areas', { zip: val('nbAreaZip'), label: val('nbAreaLabel') });
      await loadWatchAreas();
    } else if (kind === 'interest') {
      const target = form.dataset.preListingId
        ? { kind: 'pre_listing', id: Number(form.dataset.preListingId) }
        : { kind: 'area', zip: val('nbInterestZip'), street: val('nbInterestStreet') };
      await apiPost('/api/standing-interests', {
        target, amount: Number(val('nbInterestAmount')), propertyType: val('nbInterestType'), minBeds: Number(val('nbInterestBeds')),
        financing: val('nbInterestFinancing'), timing: val('nbInterestTiming'), ack: ticked('nbInterestAck'),
      });
      nbPendingTarget = null;
      toast('Standing interest posted.');
      await loadWatchAreas();
    } else if (kind === 'claim') {
      await apiPost('/api/home-claims', { zip: val('nbClaimZip'), street: val('nbClaimStreet'), ack: ticked('nbClaimAck') });
      await loadWatchAreas();
    } else if (kind === 'reply') {
      const box = form.querySelector('textarea');
      await apiPost(`/api/standing-interests/${Number(form.dataset.id)}/reply`, { message: box ? box.value.trim() : '' });
      toast('Sent. The conversation is in Messages.');
      await loadWatchAreas();
    } else if (kind === 'trial') {
      const key = form.dataset.key;
      const longAck = form.querySelector('[data-nb-long-ack]');
      await apiPost('/api/trade-trials', {
        listingIdA: Number(form.dataset.a), listingIdB: Number(form.dataset.b),
        startDate: val(`nbTrialStart-${key}`), endDate: val(`nbTrialEnd-${key}`),
        checklist: nbReadChecklist(form), longStayAck: !!(longAck && longAck.checked),
      });
      toast('Dates suggested. Nothing is recorded as a yes until you both say yes.');
      const holder = form.closest('[data-nb-trial-slot]');
      if (holder) holder.innerHTML = '';
      await nbLoadTrials();
    } else if (kind === 'trial-agree') {
      const longAck = form.querySelector('[data-nb-long-ack]');
      await apiPost(`/api/trade-trials/${Number(form.dataset.id)}`, { action: 'agree', checklist: nbReadChecklist(form), longStayAck: !!(longAck && longAck.checked) });
      toast("You both said yes. This record isn't a contract: write down what you agree between yourselves.");
      await nbLoadTrials();
    }
  } catch (err) { nbFail(err); }
});
