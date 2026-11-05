/* Shared client-side helpers used by every page: fetch wrappers and HTML escaping. */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => { /* non-critical */ });
  });
}

// Adds a show/hide toggle to every password field on the page. Runs once at
// load — every password input on this site is present in the markup from
// the start (just hidden behind a parent .hidden class in a couple of
// cases), none are created later via innerHTML, so a single pass here is
// enough without needing a MutationObserver.
(function initPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    const wrap = document.createElement('div');
    wrap.className = 'password-field';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    btn.textContent = '👁';
    btn.setAttribute('aria-label', 'Show password');
    wrap.appendChild(btn);

    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? '👁' : '🙈';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
})();

// Where this visitor came from (an ad, a video link, another site), kept for 30 days so a signup or
// contact form sent later can say so. Only the campaign tags, ad click ids, the landing page path and
// the referring site's name are kept, never a full URL. A new tagged visit replaces an older one; an
// untagged visit never replaces a recent one.
const ATTRIBUTION_KEY = 'ah_source';
const ATTRIBUTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ATTRIBUTION_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid'];

// TikTok's, Instagram's and Facebook's built-in browsers name themselves in the user agent.
// Coming back after signing in or up from a page that needs an account (a past-client review link). Only those
// pages are allowed as a destination, so this can never send someone off to another site; it lasts a day.
const RETURN_TO_KEY = 'ah_return_to';
function rememberReturnTo(path) {
  try { localStorage.setItem(RETURN_TO_KEY, JSON.stringify({ path, at: Date.now() })); } catch { /* optional */ }
}
// Where to come back to, without using it up (signup sends it along in the confirmation email).
function peekReturnTo() {
  try {
    const saved = JSON.parse(localStorage.getItem(RETURN_TO_KEY) || 'null');
    if (saved && Date.now() - saved.at < 86400000 && /^\/past-client-review\?t=[A-Za-z0-9]{8,64}$/.test(saved.path)) return saved.path;
  } catch { /* optional */ }
  return '';
}

function takeReturnTo() {
  try {
    const saved = JSON.parse(localStorage.getItem(RETURN_TO_KEY) || 'null');
    localStorage.removeItem(RETURN_TO_KEY);
    if (saved && Date.now() - saved.at < 86400000 && /^\/past-client-review\?t=[A-Za-z0-9]{8,64}$/.test(saved.path)) return saved.path;
  } catch { /* optional */ }
  return null;
}

function inAppBrowser() {
  const ua = navigator.userAgent || '';
  if (/BytedanceWebview|musical_ly|TikTok/i.test(ua)) return 'tiktok';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook';
  return '';
}

function getAttribution() {
  try {
    const stored = JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) || 'null');
    if (!stored || !(Date.now() - stored.at < ATTRIBUTION_MAX_AGE_MS)) return null;
    const { at, ...source } = stored;
    return source;
  } catch { return null; }
}

(function captureAttribution() {
  try {
    const params = new URLSearchParams(window.location.search);
    const tags = {};
    for (const name of ATTRIBUTION_PARAMS) {
      const value = params.get(name);
      if (value) tags[name] = value.slice(0, 200);
    }
    if (!Object.keys(tags).length && getAttribution()) return;
    let referrer = '';
    try {
      const ref = new URL(document.referrer);
      if (ref.host !== window.location.host) referrer = ref.host;
    } catch { /* no referrer */ }
    const inApp = inAppBrowser();
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ ...tags, landing: window.location.pathname.slice(0, 200), referrer, ...(inApp ? { in_app: inApp } : {}), at: Date.now() }));
  } catch { /* storage blocked (private mode etc.): tracking the source is optional */ }
})();

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data; // e.g. { error, code } so a page can react to a specific failure
    throw err;
  }
  return data;
}

const apiGet = (path) => api(path);
const apiPost = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
const apiPut = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body || {}) });
const apiDelete = (path) => api(path, { method: 'DELETE' });

// Phone photos are often 4–12MB, over the 5MB upload limit, so big images are scaled down (longest side
// 2048px) and re-saved as JPEG in the browser first; small JPEG/PNG/WEBP files and GIFs go as they are.
// Re-saving also drops the photo's hidden location data. If the browser can't read the image, the
// original is sent and the server's own checks decide.
const UPLOAD_MAX_SIDE = 2048;
const UPLOAD_SHRINK_OVER_BYTES = 1.5 * 1024 * 1024;
const UPLOAD_KEEP_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function shrinkImageForUpload(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size <= UPLOAD_SHRINK_OVER_BYTES && UPLOAD_KEEP_TYPES.includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency; a see-through PNG gets a white background, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || (blob.size >= file.size && UPLOAD_KEEP_TYPES.includes(file.type))) return file;
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch { return file; }
}

// For file uploads — deliberately bypasses api()'s JSON Content-Type header
// so the browser can set the correct multipart boundary itself.
async function apiUpload(path, formData) {
  const prepared = new FormData();
  for (const [key, value] of formData.entries()) prepared.append(key, value instanceof File ? await shrinkImageForUpload(value) : value);
  const res = await fetch(path, { method: 'POST', credentials: 'include', body: prepared });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Upload failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Mello-Roos / HOA snapshot (functions/_lib/homeCosts.js holds the same keys). null = the owner didn't say, 0 = none.
const HOA_INCLUDE_LABELS = {
  water: 'Water', trash: 'Trash', sewer: 'Sewer', internet: 'Cable or internet', pool: 'Pool or spa',
  clubhouse: 'Clubhouse or gym', landscaping: 'Landscaping', exterior: 'Exterior upkeep', insurance: 'Building insurance',
  security: 'Gated or security',
};
// California HOAs can't ban renting out (only rentals of 30 days or less) or all pets, so there's no "not allowed".
const HOA_RULE_LABELS = { allowed: 'Allowed', no_short_term: 'Allowed, no short-term (30 days or less)', limited: 'Limited (see HOA rules)' };

// These numbers are what the owner typed, never something Amico Haus checked, so every chip says so in a neutral color.
function homeCostChipsHtml(melloRoosAnnual, hoaMonthly) {
  const chips = [];
  if (melloRoosAnnual === 0) chips.push(chipHtml('Owner says: no Mello-Roos', 'outline'));
  else if (melloRoosAnnual > 0) chips.push(chipHtml(`Owner says: Mello-Roos ${money(melloRoosAnnual)}/yr`, 'outline'));
  if (hoaMonthly === 0) chips.push(chipHtml('Owner says: no HOA', 'outline'));
  else if (hoaMonthly > 0) chips.push(chipHtml(`Owner says: HOA ${money(hoaMonthly)}/mo`, 'outline'));
  return chips.length ? `<div class="chip-row">${chips.join('')}</div>` : '';
}

const HOME_COSTS_CONFIRM_LINE = "Confirm on the property tax bill and in the seller's Mello-Roos and HOA disclosures.";

// The full snapshot for a detail view; costs uses the API's camelCase shape ({ melloRoosAnnual, hoaMonthly, hoaDetails }).
function homeCostsDetailHtml(costs) {
  if (!costs || (costs.melloRoosAnnual === null && costs.hoaMonthly === null)) return '';
  const d = costs.hoaDetails || {};
  const mello = costs.melloRoosAnnual === null ? 'Not shared' : costs.melloRoosAnnual === 0 ? 'None' : `About ${money(costs.melloRoosAnnual)} a year`;
  const hoa = costs.hoaMonthly === null ? 'Not shared' : costs.hoaMonthly === 0 ? 'None' : `${money(costs.hoaMonthly)} a month`;
  const inc = (d.includes || []).map(k => HOA_INCLUDE_LABELS[k]).filter(Boolean);
  const extras = [
    inc.length && `Includes ${inc.join(', ').toLowerCase()}`,
    d.rentals && HOA_RULE_LABELS[d.rentals] && `Renting out: ${HOA_RULE_LABELS[d.rentals].toLowerCase()}`,
    d.pets && HOA_RULE_LABELS[d.pets] && `Pets: ${HOA_RULE_LABELS[d.pets].toLowerCase()}`,
    d.specialAssessment && `Special assessment: ${d.specialAssessment}`,
  ].filter(Boolean);
  return `
    <p class="label home-costs-heading">Costs (from the owner)</p>
    <div class="mini-two">
      <div class="mini-block"><span class="label">Mello-Roos</span>${escapeHtml(mello)}</div>
      <div class="mini-block"><span class="label">HOA</span>${escapeHtml(hoa)}${extras.length ? `<br><span class="tiny">${escapeHtml(extras.join(' · '))}</span>` : ''}</div>
    </div>
    <p class="tiny">${escapeHtml(HOME_COSTS_CONFIRM_LINE)}</p>`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Kept in sync by hand with functions/_lib/lifeEvents.js: a property reason for the move, never who lives there.
// The form offers LIFE_EVENT_ITEMS; keys saved before the relabel still read as their new label.
const LIFE_EVENT_ITEMS = [
  { key: 'more_space', label: 'Need more space' },
  { key: 'less_space', label: 'Need less space' },
  { key: 'relocation', label: 'Relocating' },
  { key: 'estate', label: 'Estate / inherited' },
  { key: 'investment', label: 'Investment' },
  { key: 'life_change', label: 'Life change' },
  { key: 'other', label: 'Other' },
];
const LIFE_EVENT_LEGACY_KEYS = {
  upsizing_growing_family: 'more_space', downsizing: 'less_space', divorce_separation: 'life_change',
  inheritance: 'estate', retirement: 'life_change',
};
// A stored key (old or new) as the key the form uses now, or null when it isn't one we know.
function currentLifeEventKey(key) {
  const k = LIFE_EVENT_LEGACY_KEYS[key] || key;
  return LIFE_EVENT_ITEMS.some(i => i.key === k) ? k : null;
}
function lifeEventLabel(key) {
  const k = currentLifeEventKey(key);
  return k ? LIFE_EVENT_ITEMS.find(i => i.key === k).label : null;
}
// Labels only (a raw key is never printed), each once. Shown only to the owner and their matches.
function renderLifeEventTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  const labels = [...new Set(tags.map(lifeEventLabel).filter(Boolean))];
  return labels.length ? `<p class="tiny">${labels.map(l => `<span class="badge badge-gold">${escapeHtml(l)}</span>`).join(' ')}</p>` : '';
}
function lifeEventCheckboxesHtml(checkClass, checkedKeys = []) {
  const on = new Set((checkedKeys || []).map(currentLifeEventKey).filter(Boolean));
  return LIFE_EVENT_ITEMS.map(i => `
    <label class="checkbox-row"><input type="checkbox" class="${escapeHtml(checkClass)}" value="${i.key}"${on.has(i.key) ? ' checked' : ''}><span>${escapeHtml(i.label)}</span></label>
  `).join('');
}

function renderExternalLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  const tour = links.find(l => l.label === 'Virtual Tour');
  const rest = links.filter(l => l.label !== 'Virtual Tour');
  const tourHtml = tour ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(tour.url)}" target="_blank" rel="noopener noreferrer">🎥 Take the Virtual Tour</a>` : '';
  const restHtml = rest.length
    ? `<div class="mini-block"><span class="label">Links</span>${rest.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || 'Link')}</a>`).join(' · ')}</div>`
    : '';
  return tourHtml + restHtml;
}

// Small listing-card signals shared by the SPA (main.js) and the public directory (page-home.js).
function daysOnMarketLabel(createdAt) {
  if (!createdAt) return '';
  const days = Math.floor((Date.now() - new Date(createdAt + 'Z').getTime()) / 86400000);
  if (days <= 0) return 'Listed today';
  return `${days} day${days === 1 ? '' : 's'} on market`;
}

const ACTIVITY_RIBBON = { new_listing: { text: 'Just listed', tone: 'ticker-neutral' }, price_drop: { text: 'Price cut', tone: 'ticker-down' } };
function activityRibbonHtml(recentActivity) {
  const r = ACTIVITY_RIBBON[recentActivity];
  return r ? `<span class="activity-ribbon ${r.tone}">${r.text}</span>` : '';
}
function activityAccentClass(recentActivity) {
  return recentActivity === 'price_drop' ? 'card-accent-drop' : recentActivity === 'new_listing' ? 'card-accent-new' : '';
}

// A small "♥ saved · 💬 comments" line of social proof -- how many other people have already engaged,
// not just your own state. A flame marks a thread with real back-and-forth (3+ comments), not just one post.
function socialProofHtml(favoriteCount, commentCount) {
  const parts = [];
  if (favoriteCount) parts.push(`♥ ${favoriteCount} saved`);
  if (commentCount) parts.push(`💬 ${commentCount}${commentCount >= 3 ? ' 🔥' : ''}`);
  return parts.length ? `<p class="tiny card-social-proof">${parts.join(' · ')}</p>` : '';
}

function pricePerSqftLabel(price, sqft) {
  return price && sqft ? ` · $${Math.round(price / sqft)}/sqft` : '';
}

// Where a market_events entity actually lives -- same /app#kind-id convention the existing needs-alert
// notifications already use (regular listings have a public page; the other 3 verticals don't, so they
// route back into the app).
function marketEntityHref(entityKind, entityId) {
  if (entityKind === 'listing') return `/listing/${entityId}`;
  if (entityKind === 'augmented_home') return `/app#augmented-home-${entityId}`;
  if (entityKind === 'green_home') return `/app#green-home-${entityId}`;
  if (entityKind === 'dev_project') return `/app#dev-project-${entityId}`;
  return '/app#marketpulse';
}

// A one-line "🔥 N new, N price drops this week [in City]" banner -- the same real event counts behind
// Market Pulse, condensed to a single ambient line above a browse grid. Nothing to show, nothing rendered.
function momentumBannerHtml(trends, scopeLabel) {
  if (!trends) return '';
  const counts = trends.eventCounts7d || {};
  const parts = [];
  if (counts.new_listing) parts.push(`${counts.new_listing} new`);
  if (counts.price_drop) parts.push(`${counts.price_drop} price drop${counts.price_drop === 1 ? '' : 's'}`);
  // An accepted offer here is not a closed sale.
  if (counts.offer_accepted) parts.push(`${counts.offer_accepted} offer${counts.offer_accepted === 1 ? '' : 's'} accepted`);
  if (!parts.length) return '';
  return `<p class="momentum-banner">🔥 ${parts.join(' · ')} this week${scopeLabel ? ` in ${escapeHtml(scopeLabel)}` : ''}</p>`;
}

// Fetches and renders the momentum banner into the given container -- called from each browse grid's own
// load function, scoped to that vertical and whatever city/state filter is currently active there.
async function loadMomentumBanner(containerId, entityKind, city, state) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const params = new URLSearchParams({ entityKind });
    if (city) params.set('city', city);
    if (state) params.set('state', state);
    const { trends } = await apiGet(`/api/market-trends?${params.toString()}`);
    el.innerHTML = momentumBannerHtml(trends, city || null);
  } catch { el.innerHTML = ''; }
}

// Fallback photos for listings without a real uploaded photo — keyed by
// property type, so the directory/demo/profile pages never show a bare text
// card even for seeded demo data that has no actual photos in R2. These are
// Pexels stock photos (Pexels License: free to use, no attribution required)
// SELF-HOSTED under /img/property/ rather than hotlinked — the hotlinks were
// failing to load in some browsers, leaving every card without a picture. A
// `seed` (listing id, owner name, etc.) picks a specific photo within the
// type's pool so multiple listings of the same type don't all show the same image.
const PROPERTY_ART = {"Single Family Home":["/img/property/single-family-home-1.jpg","/img/property/single-family-home-2.jpg","/img/property/single-family-home-3.jpg","/img/property/single-family-home-4.jpg","/img/property/single-family-home-5.jpg","/img/property/single-family-home-6.jpg","/img/property/single-family-home-7.jpg","/img/property/single-family-home-8.jpg"],"Condo":["/img/property/condo-1.jpg","/img/property/condo-3.jpg","/img/property/condo-4.jpg","/img/property/condo-5.jpg","/img/property/condo-6.jpg","/img/property/condo-7.jpg","/img/property/condo-8.jpg"],"Townhouse":["/img/property/townhouse-1.jpg","/img/property/townhouse-2.jpg","/img/property/townhouse-3.jpg","/img/property/townhouse-4.jpg","/img/property/townhouse-5.jpg","/img/property/townhouse-6.jpg","/img/property/townhouse-7.jpg","/img/property/townhouse-8.jpg"],"Penthouse":["/img/property/penthouse-1.jpg","/img/property/penthouse-2.jpg","/img/property/penthouse-3.jpg","/img/property/penthouse-4.jpg","/img/property/penthouse-5.jpg","/img/property/penthouse-6.jpg","/img/property/penthouse-7.jpg","/img/property/penthouse-8.jpg"],"Ranch / Land":["/img/property/ranch-land-1.jpg","/img/property/ranch-land-2.jpg","/img/property/ranch-land-3.jpg","/img/property/ranch-land-4.jpg","/img/property/ranch-land-5.jpg","/img/property/ranch-land-6.jpg","/img/property/ranch-land-7.jpg","/img/property/ranch-land-8.jpg"],"Multi-Family":["/img/property/multi-family-1.jpg","/img/property/multi-family-2.jpg","/img/property/multi-family-3.jpg","/img/property/multi-family-4.jpg","/img/property/multi-family-5.jpg","/img/property/multi-family-6.jpg","/img/property/multi-family-7.jpg","/img/property/multi-family-8.jpg"],"Investment Property":["/img/property/investment-property-1.jpg","/img/property/investment-property-2.jpg","/img/property/investment-property-3.jpg","/img/property/investment-property-4.jpg","/img/property/investment-property-5.jpg","/img/property/investment-property-6.jpg","/img/property/investment-property-7.jpg","/img/property/investment-property-8.jpg"]};
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return h;
}
function propertyArtUrl(propertyType, seed) {
  const pool = PROPERTY_ART[propertyType] || PROPERTY_ART['Single Family Home'];
  const idx = seed !== undefined ? hashSeed(seed) % pool.length : 0;
  return pool[idx];
}

// Approximate coordinates for the directory map view. Listings only store
// city/state (no lat/lng), so this is a static lookup covering the seed
// data's cities plus a few not in the seed set — a listing whose city isn't
// here just doesn't get a map pin (it still shows in the regular list).
const CITY_COORDS = {
  'San Diego,CA': [32.7157, -117.1611], 'Los Angeles,CA': [34.0522, -118.2437],
  'San Francisco,CA': [37.7749, -122.4194], 'San Jose,CA': [37.3382, -121.8863],
  'Sacramento,CA': [38.5816, -121.4944], 'Fresno,CA': [36.7378, -119.7871],
  'Oakland,CA': [37.8044, -122.2712], 'Long Beach,CA': [33.7701, -118.1937],
  'Coronado,CA': [32.6859, -117.1831], 'Beverly Hills,CA': [34.0736, -118.4004],
  'Miami,FL': [25.7617, -80.1918], 'Tampa,FL': [27.9506, -82.4572],
  'Orlando,FL': [28.5383, -81.3792], 'Jacksonville,FL': [30.3322, -81.6557],
  'Fort Lauderdale,FL': [26.1224, -80.1373], 'Tallahassee,FL': [30.4383, -84.2807],
  'Sarasota,FL': [27.3364, -82.5307], 'Naples,FL': [26.1420, -81.7948],
  'New York,NY': [40.7128, -74.0060], 'Brooklyn,NY': [40.6782, -73.9442],
  'Buffalo,NY': [42.8864, -78.8784], 'Albany,NY': [42.6526, -73.7562],
  'Rochester,NY': [43.1566, -77.6088], 'Syracuse,NY': [43.0481, -76.1474],
  'Yonkers,NY': [40.9312, -73.8988],
  'Seattle,WA': [47.6062, -122.3321], 'Spokane,WA': [47.6588, -117.4260],
  'Tacoma,WA': [47.2529, -122.4443], 'Bellevue,WA': [47.6101, -122.2015],
  'Olympia,WA': [47.0379, -122.9007], 'Vancouver,WA': [45.6387, -122.6615],
  'Chula Vista,CA': [32.6401, -117.0842], 'La Jolla,CA': [32.8328, -117.2713],
};
function cityCoords(city, state) {
  return CITY_COORDS[`${(city || '').trim()},${(state || '').trim().toUpperCase()}`] || null;
}

function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

/* ---------------- You're in Control: shared copy and small pure helpers ---------------- */
// A homeowner may leave the asking price blank ("Open to price opinions"). The API sends askingPrice 0 then, plus
// priceOpen; older responses (and snake_case rows) only have the number, and anything under $1,000 counts as open.
const PRICE_OPEN_LABEL = 'Open to price opinions';
function isPriceOpen(p) {
  if (!p) return false;
  if (typeof p.priceOpen === 'boolean') return p.priceOpen;
  return !(Number(p.askingPrice ?? p.asking_price) >= 1000);
}
// "$750,000 asking" or "Open to price opinions" -- the one place a pre-listing's price turns into words.
function askingPriceLabel(p, { suffix = '' } = {}) {
  return isPriceOpen(p) ? PRICE_OPEN_LABEL : `${money(p.askingPrice ?? p.asking_price)}${suffix}`;
}
// One price on its own (a price-history entry): 0 means the owner had no price set then.
function priceAmountLabel(n) {
  return Number(n) >= 1000 ? money(n) : PRICE_OPEN_LABEL;
}
// What the owner typed in the asking price box: blank is fine (open to price opinions); "$750,000" works too.
function parseAskingPriceInput(raw) {
  const s = String(raw ?? '').replace(/[$,\s]/g, '');
  if (s === '') return { value: null };
  const n = /^\d+(\.0+)?$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n) || n < 1000 || n > 500000000) return { error: 'Enter an asking price as a whole-dollar amount, or leave it blank.' };
  return { value: n };
}
// The middle of a list of numbers (blanks and non-numbers skipped), rounded to whole dollars; null when empty.
function medianOf(values) {
  const nums = (values || []).map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

// Every agent shown to a homeowner at a point of contact carries this (California DRE rule):
// "Name · DRE #01234567 on file · Brokerage", leaving out any missing part. "On file", never "verified": the site
// doesn't vouch for anyone's license status today. Plain text: escape it where it's used.
function agentCredentialsLine(licenseNumber, brokerageName) {
  return agentLicenseOnFileLine(licenseNumber, brokerageName);
}
function agentIdentityLine({ name, licenseNumber, brokerageName } = {}) {
  return [String(name ?? '').trim(), agentCredentialsLine(licenseNumber, brokerageName)].filter(Boolean).join(' · ');
}

// A post or comment author: an approved agent's name carries their identity line (authorAgent from the API).
// The account that runs Amico Haus also carries the operator label (authorAgent.isPlatformOperator, F6).
function contentAuthorLabel(name, authorAgent) {
  if (!authorAgent) return String(name ?? '');
  const line = agentIdentityLine({ name, licenseNumber: authorAgent.licenseNumber, brokerageName: authorAgent.brokerageName });
  return authorAgent.isPlatformOperator ? `${line} · ${PLATFORM_OPERATOR_LABEL}` : line;
}
// A hidden post or comment reaches only its author and admins (the API leaves it out for everyone else), so anyone
// who isn't the author here is an admin and gets an Unhide button (data-action="unhide-content"). kind: 'post' or 'comment'.
function hiddenContentNoteHtml(item, isMine, kind) {
  if (!item || !item.hidden) return '';
  const reason = item.hiddenReason ? `: ${escapeHtml(item.hiddenReason)}` : '';
  const k = kind === 'post' ? 'post' : 'comment';
  return isMine
    ? `<p class="tiny">Hidden by moderation${reason}. Only you can see this.</p>`
    : `<p class="tiny hidden-note">Hidden (only admins see this)${reason} <button type="button" class="link-btn" data-action="unhide-content" data-kind="${k}" data-id="${Number(item.id)}">Unhide</button></p>`;
}
// An admin shows a hidden post or comment again (POST /api/{posts|comments}/:id/hide { action: 'unhide' }). True on success.
async function unhideContentById(kind, id) {
  try {
    await apiPost(`/api/${kind === 'post' ? 'posts' : 'comments'}/${Number(id)}/hide`, { action: 'unhide' });
    toast('Shown again.');
    return true;
  } catch (err) { toastActionError(err); return false; }
}
// An admin hides someone else's post: a reason is required (the author is told). True when it was hidden.
async function hidePostWithPrompt(postId) {
  const reason = (prompt('Hide this post? Give a reason (the author is told; kept on the activity log):') || '').trim();
  if (!reason) return false;
  try {
    await apiPost(`/api/posts/${Number(postId)}/hide`, { reason });
    toast('Post hidden.');
    return true;
  } catch (err) { toastActionError(err); return false; }
}
// The home's owner (or an admin) hides someone's comment on the home's thread. The author is told the reason; an
// owner may leave it blank (a short default is used), an admin must give one. True when it was hidden.
async function hideCommentWithPrompt(commentId) {
  const reason = prompt('Hide this comment? Add a short reason (the author is told):');
  if (reason === null) return false;
  try {
    await apiPost(`/api/comments/${Number(commentId)}/hide`, { reason: reason.trim() });
    toast('Comment hidden.');
    return true;
  } catch (err) { toastActionError(err); return false; }
}

// The server's UTC "YYYY-MM-DD HH:MM:SS" text (same as SQLite datetime('now')) as a Date, or null.
function sqlUtcToDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
}
// "Oct 31" for a server timestamp, read in Pacific time like everything else on the platform.
function shortDateLabel(s) {
  const d = sqlUtcToDate(s);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '';
}
// The sender's own held (weekly) message: "Delivers Sun, Nov 8" (always a Sunday morning, Pacific). If the person
// has since switched to Quiet, it waits until they switch back (stored as the year 9999).
function heldDeliveryLabel(deliverAfter) {
  if (String(deliverAfter || '').startsWith('9999')) return 'Waiting: this homeowner turned on Quiet mode';
  const d = sqlUtcToDate(deliverAfter);
  if (!d) return 'Delivers Sunday morning';
  return `Delivers ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })}`;
}
// "21:00" -> "9:00 PM"; a quiet-hours window reads "9:00 PM to 8:00 AM".
function clockLabel(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
function quietHoursLabel(start, end) {
  return clockLabel(start) && clockLabel(end) ? `${clockLabel(start)} to ${clockLabel(end)}` : '';
}

// The contact dial's choices, word for word everywhere they show.
const CONTACT_MODE_LABELS = {
  open: 'Open — agents can message me anytime',
  weekly: 'Weekly — one message per agent, delivered together Sunday morning',
  quiet: "Quiet — no agent messages; I'll get price opinions and proposals only",
};
// Friendly words for the server's "you can't do that right now" codes. `where` = 'showing' picks the showing-request
// wording for Quiet mode. Anything else falls back to the server's own message.
const CONTACT_ERROR_COPY = {
  contact_quiet: "This homeowner has chosen Quiet mode, so they hear from agents through price opinions and proposals. Send one of those and they'll see it right away.",
  contact_quiet_showing: "This homeowner has chosen Quiet mode, so showing requests are off for now. A price opinion or a proposal reaches them right away.",
  weekly_limit: "Your message for this week is already on its way. It will be delivered Sunday morning, together with other agents' messages.",
  proposals_paused: "This homeowner has paused new proposals for now. Check back soon: you'll be able to send one when they reopen.",
  showing_pending: 'You already have a showing request waiting for this home. You can change it or cancel it first.',
};
function apiErrorCode(err) {
  return (err && err.data && err.data.code) || '';
}
function contactErrorMessage(err, where = '') {
  const code = apiErrorCode(err);
  if (code === 'contact_quiet' && where === 'showing') return CONTACT_ERROR_COPY.contact_quiet_showing;
  return CONTACT_ERROR_COPY[code] || (err && err.message) || 'Something went wrong. Please try again.';
}

// A per-person limit (HTTP 429, code rate_limited): the toast shows the server's own words, a little longer.
const RATE_LIMITED_COPY = "You're doing that a lot right now. Please take a short break and try again later.";
function isRateLimitedError(err) {
  return !!err && (apiErrorCode(err) === 'rate_limited' || err.status === 429);
}
function actionErrorMessage(err) {
  if (isRateLimitedError(err)) return (err && err.message) || RATE_LIMITED_COPY;
  return contactErrorMessage(err);
}
function toastActionError(err) {
  toast(actionErrorMessage(err), { durationMs: isRateLimitedError(err) ? 7000 : 4000 });
}

/* ---------------- Shared wording (Rudy's "jury test": the site never vouches, ranks, verifies or advises) ---------------- */
const HOME_TEXT_NOTE = 'Describe the home, not who should live there or who lives nearby.';
const AGENT_TEXT_NOTE = 'Keep it to your work and the homes: no talk about schools, crime or who lives in an area (fair housing).';
const OFFER_MESSAGE_NOTE = 'Stick to price, terms and timing. Leave out personal details like family, religion, age or background.';
const OFFER_OWNER_NOTE = 'Weigh offers on price, terms and timing only, not on who the buyer is (fair housing).';
const OWNER_CONFIRM_TEXT = "I own this home, or I'm its trustee, executor or attorney-in-fact, or I'm a California-licensed agent with the owner's written permission to post it here.";
const OWNER_CONFIRM_BULK_TEXT = "For every home in this file: I own it, or I'm its trustee, executor or attorney-in-fact, or I'm a California-licensed agent with the owner's written permission to post it here.";
const OWNER_CONFIRM_REQUIRED = "Please confirm you own this home or have the owner's written permission to post it.";
const CLEAR_COOP_NOTE = "Agents: if this home is under your listing agreement, posting it here counts as public marketing under your MLS's Clear Cooperation rule (CRMLS Rule 7.9), which can require MLS entry within one business day. Check your MLS rules before posting.";
const PLATFORM_OPERATOR_LABEL = 'Platform operator: runs Amico Haus';
const PRICE_BASIS_NOTE = 'Base your price on the home and comparable sales only.';
const OFFER_TOOLS_NOTE = "Not a purchase agreement. A California home sale needs a written contract signed by both sides, usually prepared by your agents. Accepting here only tells the other side you'd like to move forward.";
const FEE_NOTE = 'Each agent sets their own fees; commissions are negotiable and not set by law or by Amico Haus.';
const OPERATOR_NOTE = 'Amico Haus is run by Rudy Flores, a Coldwell Banker West agent who may compete for the same homes.';
const ESTIMATE_LABEL = 'Your estimate, from the numbers you entered';
const MONEY_TOOL_NOTE = 'An estimate only, not tax, legal or financial advice. Confirm the numbers with your agent, your lender and a tax professional.';
const PHOTO_RIGHTS_NOTE = 'By adding photos you confirm: I took these photos or have permission to use them.';
const DUAL_AGENCY_NOTE = "One agent for both homes, or two agents under the same brokerage, is dual agency and needs both owners' written consent. Each of you can choose your own agent.";
const NO_DISPUTES_LINE = "Amico Haus doesn't decide disputes between homeowners and agents.";
const PRE_LISTING_TEASER_NOTE = 'Pre-listings open to approved local agents. Thinking of selling?';
const UNBLOCK_NOTE = "Unblocking lets them reach you again. Shared contact info, broker preview RSVPs, showing requests and interviews that ended with the block don't come back.";
const DRE_COMPLAINT_URL = 'https://www.dre.ca.gov/consumers/filecomplaint.html';
const SMALL_CLAIMS_URL = 'https://selfhelp.courts.ca.gov/small-claims-california';

function offerToolsNoteHtml() {
  return `<p class="tiny offer-tools-note">${escapeHtml(OFFER_TOOLS_NOTE)}</p>`;
}

// "DRE #01234567 on file": what cards, proposals and opinions say about a license (never "verified" or "checked").
function licenseOnFileLabel(licenseNumber) {
  const lic = String(licenseNumber ?? '').trim();
  return lic ? `DRE #${lic} on file` : '';
}
function agentLicenseOnFileLine(licenseNumber, brokerageName) {
  return [licenseOnFileLabel(licenseNumber), String(brokerageName ?? '').trim()].filter(Boolean).join(' · ');
}
// The DRE's public license lookup (same link as functions/_lib/agents.js dreLookupUrl).
function dreLookupUrl(licenseNumber) {
  return `https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=${encodeURIComponent(String(licenseNumber || ''))}`;
}

// Founding agents: "Among the first 3 approved agents in 91913; recognition only."
function foundingCaption(zips) {
  const list = (zips || []).map(z => String(z).trim()).filter(Boolean);
  return list.length ? `Among the first 3 approved agents in ${list.join(', ')}; recognition only.` : '';
}
function foundingCaptionHtml(zips) {
  const text = foundingCaption(zips);
  return text ? `<p class="tiny founding-caption">${escapeHtml(text)}</p>` : '';
}

// A saved search's price range: "$500,000–$800,000", "under $800,000", "over $500,000", or nothing.
function priceRangeLabel(min, max) {
  const lo = Number(min) > 0 ? Number(min) : 0;
  const hi = Number(max) > 0 ? Number(max) : 0;
  if (lo && hi) return `${money(lo)}–${money(hi)}`;
  if (hi) return `under ${money(hi)}`;
  if (lo) return `over ${money(lo)}`;
  return '';
}
// "Condo in Chula Vista, CA $500,000–$800,000" (plain text: escape it where it's used).
function savedSearchLabel(s) {
  const range = priceRangeLabel(s.price_min ?? s.priceMin, s.price_max ?? s.priceMax);
  const type = s.property_type || s.propertyType || 'Any';
  return `${type === 'Any' ? 'Any type' : type} in ${s.locations || ''}${range ? ` ${range}` : ''}`;
}

// Real alt text for a home's own photo: "Photo of this condo in Chula Vista".
function homePhotoAlt(h) {
  const type = String((h && (h.propertyType || h.property_type)) || 'home').trim().toLowerCase();
  const city = String((h && h.city) || '').trim();
  return `Photo of this ${type}${city ? ` in ${city}` : ''}`;
}

// "Blocked on Nov 4, 2026" for a server timestamp (Pacific time).
function blockedOnLabel(createdAt) {
  const d = sqlUtcToDate(createdAt);
  return d ? `Blocked on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })}` : '';
}
function blockConfirmText(name) {
  return `Block ${name || 'this person'}? They won't be able to send you proposals, price opinions, showing or interview requests, or messages, and won't see your homes. You can unblock anytime in Account › Blocked Users. Blocking is for spam, harassment or safety, not for turning away a buyer or renter because of who they are.`;
}

// Reports (POST /api/reports): a preset the server knows, or "Something else" with the person's own words.
const REPORT_REASON_PRESETS = ['Rules problem', 'Fair housing concern'];
function reportPayload(targetType, targetId, preset, details = '') {
  const known = REPORT_REASON_PRESETS.includes(preset) ? preset : null;
  const text = String(details || '').trim().slice(0, 500);
  return known ? { targetType, targetId: Number(targetId), preset: known, reason: text } : { targetType, targetId: Number(targetId), reason: text };
}
// The short report form, under the thing being reported (cancel: false when it's always on screen).
function inlineReportFormHtml(targetType, targetId, { presets = REPORT_REASON_PRESETS, other = true, cancel = true } = {}) {
  const uid = `rpt-${String(targetType).replace(/[^a-z]/g, '')}-${Number(targetId)}`;
  const options = presets.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('') + (other ? '<option value="">Something else (say what below)</option>' : '');
  return `
    <div class="inline-report" data-target-type="${escapeHtml(targetType)}" data-target-id="${Number(targetId)}">
      <div class="field"><label for="${uid}-reason">What's the problem?</label><select id="${uid}-reason" class="report-reason">${options}</select></div>
      <div class="field"><label for="${uid}-details">Details (optional for a preset)</label><textarea id="${uid}-details" class="report-details" maxlength="500"></textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="send-report">Send report</button>${cancel ? '<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-report">Cancel</button>' : ''}</div>
    </div>`;
}

// For fee or service problems, where to go instead (Amico Haus doesn't decide disputes between homeowners and agents).
function feeHelpHtml(agent) {
  const a = agent || {};
  const who = a.name ? `${a.name}'s` : "the agent's";
  const at = a.brokerageName ? ` at ${a.brokerageName}` : '';
  const lic = a.licenseNumber ? ` (DRE #${a.licenseNumber})` : '';
  return `<div class="help-box"><p class="tiny"><strong>Fee or service problem?</strong> Contact ${escapeHtml(who)} managing broker${escapeHtml(at)}${escapeHtml(lic)}. You can also <a href="${DRE_COMPLAINT_URL}" target="_blank" rel="noopener noreferrer">file a complaint with the California DRE</a> or use <a href="${SMALL_CLAIMS_URL}" target="_blank" rel="noopener noreferrer">small claims court</a>. ${escapeHtml(NO_DISPUTES_LINE)}</p></div>`;
}

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString + 'Z').getTime()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(seconds / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

let currentUser = undefined; // undefined = not yet checked, null = signed out

async function fetchCurrentUser() {
  if (currentUser !== undefined) return currentUser;
  const data = await apiGet('/api/me').catch(() => ({ user: null }));
  currentUser = data.user;
  return currentUser;
}

async function requireAuthOrRedirect() {
  const user = await fetchCurrentUser();
  if (!user) { window.location.href = '/login'; return null; }
  return user;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function isPushSubscribed() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const { publicKey } = await apiGet('/api/push/vapid-public-key');
  if (!publicKey) throw new Error('Push notifications are not configured yet.');

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await apiPost('/api/push/subscribe', sub.toJSON());
}

async function disablePushNotifications() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await apiPost('/api/push/unsubscribe', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}

// Print button on the listing/AugmentedHomes/GreenHomes flyer pages (functions/_lib/flyerShell.js) --
// window.print() itself can't be an inline onclick under this site's CSP (script-src has no 'unsafe-inline'),
// so it's a plain data-action handled here like every other button on the site.
document.addEventListener('click', e => {
  if (e.target.closest('[data-action="print-page"]')) window.print();
});

let toastTimer = null;
function toast(msg, { durationMs = 2800 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), durationMs);
}

/* ---------------- Agent cards: profile pictures and pill layout ----------------
   Shared by /demo and the signed-in app so an agent reads the same in both. */

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const first = (parts[0] || '?')[0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Round profile picture. With `src` it shows that image; without, coloured
// initials (the colour is picked from `seed` so a person keeps the same one).
function avatarHtml(name, { src = null, seed = name, size = '' } = {}) {
  const sizeClass = size ? ` avatar-${size}` : '';
  if (src) {
    return `<span class="avatar avatar-photo${sizeClass}" aria-hidden="true"><img src="${escapeHtml(src)}" alt="" width="64" height="64" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="avatar avatar-tone-${hashSeed(seed) % 6}${sizeClass}" aria-hidden="true">${escapeHtml(initialsOf(name))}</span>`;
}

function chipHtml(text, tone = '') {
  return `<span class="chip${tone ? ` chip-${tone}` : ''}">${escapeHtml(text)}</span>`;
}

// "label  value" pill, e.g. Replies ~2h
function statChipHtml(label, value) {
  return `<span class="chip chip-stat"><span class="chip-k">${escapeHtml(label)}</span><span class="chip-v">${escapeHtml(value)}</span></span>`;
}

function chipBlockHtml(label, chips, { hint = '', extraClass = '' } = {}) {
  if (!chips.length) return '';
  return `<div class="chip-block${extraClass ? ` ${extraClass}` : ''}"><span class="chip-label">${escapeHtml(label)}</span><div class="chip-row">${chips.join('')}</div>${hint ? `<span class="chip-hint">${escapeHtml(hint)}</span>` : ''}</div>`;
}

// A package shows only its name; hovering (or focusing / tapping) it reveals
// what's included. Prices are deliberately left out of this view.
function packageChipHtml(pkg) {
  const features = (pkg.services || []).map(s => `<span class="pkg-feat">${escapeHtml(s)}</span>`).join('');
  const days = pkg.turnaroundDays ? `<span class="pkg-days">Ready in about ${pkg.turnaroundDays} day${pkg.turnaroundDays === 1 ? '' : 's'}</span>` : '';
  const desc = pkg.description ? `<span class="pkg-desc">${escapeHtml(String(pkg.description).slice(0, 140))}</span>` : '';
  return `<button type="button" class="pkg-chip"><span class="chip chip-gold">${escapeHtml(pkg.label)}</span><span class="pkg-pop" role="tooltip"><strong>${escapeHtml(pkg.label)} package</strong>${days}${desc}${features}</span></button>`;
}

// Name, subtitle and a row of small pills, beside a profile picture.
function personHeadHtml({ avatar, nameHtml, sub = '', chips = [], aside = '' }) {
  return `<div class="person-head">${avatar}<div class="person-main"><h3>${nameHtml}</h3>${sub ? `<p class="tiny">${escapeHtml(sub)}</p>` : ''}${chips.length ? `<div class="chip-row chip-row-tight">${chips.join('')}</div>` : ''}</div>${aside}</div>`;
}

function ratingChipHtml(rating, reviewCount) {
  return rating
    ? `<span class="chip chip-star"><span class="chip-star-mark" aria-hidden="true">★</span>${escapeHtml(String(rating))} <span class="chip-k">· ${reviewCount} review${reviewCount === 1 ? '' : 's'}</span><span class="chip-k"> from ${reviewCount === 1 ? 'a homeowner' : 'homeowners'} who hired them here</span></span>`
    : chipHtml('No reviews yet', 'outline');
}

// `info` is a plain description of an agent, so the demo's hand-written data
// and the live directory's API data can both feed the same layout:
//   status:       [{ text, tone }]        e.g. Accepting new clients
//   stats:        [{ k, v }]              measured by the platform
//   selfReported: [{ k, v }]              typed in by the agent
//   specialties, languages, area: [string]
//   commission:   '2.5%' | null
//   packages:     [{ label, turnaroundDays, description, services: [string] }]
function agentDetailsHtml(info) {
  const status = (info.status || []).map(s => chipHtml(s.text, s.tone));
  const feeChips = [];
  if (info.commission) feeChips.push(statChipHtml('Commission', info.commission));
  (info.packages || []).forEach(p => feeChips.push(packageChipHtml(p)));
  const hasPackages = (info.packages || []).length > 0;
  const parts = [
    status.length ? `<div class="chip-row">${status.join('')}</div>` : '',
    chipBlockHtml('On Amico Haus', (info.stats || []).map(s => statChipHtml(s.k, s.v))),
    chipBlockHtml('Self-reported', (info.selfReported || []).map(s => statChipHtml(s.k, s.v))),
    chipBlockHtml('Specialties', (info.specialties || []).map(t => chipHtml(t, 'gold'))),
    chipBlockHtml('Speaks', (info.languages || []).map(t => chipHtml(t, 'outline'))),
    chipBlockHtml('Service area', (info.area || []).map(t => chipHtml(t))),
    // The fee line sits beside every agent's fees (each agent sets their own; commissions are negotiable).
    chipBlockHtml('Fees & packages', feeChips, { extraClass: 'pkg-block', hint: `${hasPackages ? 'Hover or tap a package to see what’s included. ' : ''}${FEE_NOTE}` }),
  ].filter(Boolean);
  return parts.length ? `<div class="agent-details">${parts.join('')}</div>` : '';
}

// Touch screens have no hover, so a tap opens a package's details and a tap
// anywhere else (or Escape) closes them. Mouse users just hover.
document.addEventListener('click', e => {
  if (!window.matchMedia('(hover: none)').matches) return;
  const chip = e.target.closest('.pkg-chip');
  document.querySelectorAll('.pkg-chip.open').forEach(c => { if (c !== chip) c.classList.remove('open'); });
  if (chip) chip.classList.toggle('open');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.pkg-chip.open').forEach(c => c.classList.remove('open'));
});

// "Recently viewed" strip -- entirely client-side via localStorage, so it works across the 4 public detail
// page kinds without a server round trip and without needing sign-in. Each detail page (functions/listing,
// augmented-home, green-home, project [id].js) emits a hidden #entityMeta div with its own data; this reads
// it, records it, and (if the page has a #recentlyViewedStrip container) renders the OTHER recent items.
const RECENTLY_VIEWED_KEY = 'ah_recently_viewed';
const RECENTLY_VIEWED_MAX = 20;

function recentlyViewedHref(kind, id) {
  if (kind === 'listing') return `/listing/${id}`;
  if (kind === 'augmented_home') return `/augmented-home/${id}`;
  if (kind === 'green_home') return `/green-home/${id}`;
  if (kind === 'dev_project') return `/project/${id}`;
  return '#';
}

(function trackAndRenderRecentlyViewed() {
  const meta = document.getElementById('entityMeta');
  const current = meta && meta.dataset.kind ? { ...meta.dataset } : null;

  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];

  if (current) {
    list = list.filter(it => !(it.kind === current.kind && String(it.id) === String(current.id)));
    list.unshift(current);
    try { localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list.slice(0, RECENTLY_VIEWED_MAX))); } catch {}
  }

  const strip = document.getElementById('recentlyViewedStrip');
  if (!strip) return;
  const others = list.filter(it => !current || !(it.kind === current.kind && String(it.id) === String(current.id))).slice(0, 4);
  if (!others.length) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  strip.innerHTML = `
    <h2>Recently Viewed</h2>
    <div class="recently-viewed-grid">
      ${others.map(it => `
        <a class="recently-viewed-card" href="${recentlyViewedHref(it.kind, it.id)}">
          <strong>${escapeHtml(it.title || '')}</strong>
          <span class="tiny">${escapeHtml(it.city || '')}, ${escapeHtml(it.state || '')}</span>
          <span class="tiny">${it.amount ? money(it.amount) : ''}</span>
        </a>
      `).join('')}
    </div>`;
})();

// Mortgage affordability widget on detail pages (functions/_lib/mortgageCalc.js emits the markup) -- standard
// fixed-rate amortization, computed live in the browser as the visitor adjusts down payment/rate/term. The site
// never suggests a rate: until the visitor types one, the result stays "—".
(function initMortgageCalculators() {
  document.querySelectorAll('.mortgage-calc').forEach(calc => {
    const priceEl = calc.querySelector('.mc-price');
    const downPctEl = calc.querySelector('.mc-down-pct');
    const rateEl = calc.querySelector('.mc-rate');
    const termEl = calc.querySelector('.mc-term');
    const outEl = calc.querySelector('.mc-monthly');
    if (!downPctEl || !rateEl || !termEl || !outEl) return;

    function recompute() {
      if (String(rateEl.value).trim() === '') { outEl.textContent = '—'; return; }
      const price = priceEl ? Math.max(Number(priceEl.value) || 0, 0) : (Number(calc.dataset.price) || 0);
      const downPct = Math.min(Math.max(Number(downPctEl.value) || 0, 0), 100);
      const rate = Math.max(Number(rateEl.value) || 0, 0);
      const years = Number(termEl.value) || 30;
      const loanAmount = price * (1 - downPct / 100);
      const monthlyRate = rate / 100 / 12;
      const n = years * 12;
      const payment = monthlyRate === 0 ? loanAmount / n : loanAmount * monthlyRate * Math.pow(1 + monthlyRate, n) / (Math.pow(1 + monthlyRate, n) - 1);
      outEl.textContent = Number.isFinite(payment) && payment > 0 ? money(Math.round(payment)) : '—';
    }
    [priceEl, downPctEl, rateEl, termEl].filter(Boolean).forEach(el => el.addEventListener('input', recompute));
    recompute();
  });
})();

// Keeps --topbar-h equal to the sticky header's height (0 when it isn't
// sticky) so in-page jumps land below it — see scroll-padding-top in styles.css.
(function trackStickyHeader() {
  const root = document.documentElement;
  const start = () => {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const apply = () => {
      const stuck = getComputedStyle(bar).position === 'sticky';
      root.style.setProperty('--topbar-h', `${stuck ? bar.offsetHeight : 0}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    if (window.ResizeObserver) new ResizeObserver(apply).observe(bar);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
