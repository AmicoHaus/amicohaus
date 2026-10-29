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
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ ...tags, landing: window.location.pathname.slice(0, 200), referrer, at: Date.now() }));
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
  if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
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

function homeCostChipsHtml(melloRoosAnnual, hoaMonthly) {
  const chips = [];
  if (melloRoosAnnual === 0) chips.push(chipHtml('No Mello-Roos', 'good'));
  else if (melloRoosAnnual > 0) chips.push(chipHtml(`Mello-Roos ${money(melloRoosAnnual)}/yr`, 'outline'));
  if (hoaMonthly === 0) chips.push(chipHtml('No HOA', 'good'));
  else if (hoaMonthly > 0) chips.push(chipHtml(`HOA ${money(hoaMonthly)}/mo`, 'outline'));
  return chips.length ? `<div class="chip-row">${chips.join('')}</div>` : '';
}

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
    <div class="mini-two">
      <div class="mini-block"><span class="label">Mello-Roos</span>${escapeHtml(mello)}</div>
      <div class="mini-block"><span class="label">HOA</span>${escapeHtml(hoa)}${extras.length ? `<br><span class="tiny">${escapeHtml(extras.join(' · '))}</span>` : ''}</div>
    </div>`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Kept in sync by hand with functions/_lib/lifeEvents.js.
const LIFE_EVENT_LABELS = {
  relocation: 'Relocating for work or family', upsizing_growing_family: 'Growing family, need more space',
  downsizing: 'Downsizing, need less space', divorce_separation: 'Divorce or separation',
  inheritance: 'Inherited property', investment: 'Investment property', retirement: 'Retirement', other: 'Other',
};
function renderLifeEventTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return `<p class="tiny">${tags.map(k => `<span class="badge badge-gold">${escapeHtml(LIFE_EVENT_LABELS[k] || k)}</span>`).join(' ')}</p>`;
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
  if (counts.offer_accepted) parts.push(`${counts.offer_accepted} deal${counts.offer_accepted === 1 ? '' : 's'} closed`);
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
    ? `<span class="chip chip-star"><span class="chip-star-mark" aria-hidden="true">★</span>${escapeHtml(String(rating))} <span class="chip-k">· ${reviewCount} review${reviewCount === 1 ? '' : 's'}</span></span>`
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
    chipBlockHtml('Fees & packages', feeChips, { extraClass: 'pkg-block', hint: hasPackages ? 'Hover or tap a package to see what’s included.' : '' }),
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
// fixed-rate amortization, computed live in the browser as the visitor adjusts down payment/rate/term.
(function initMortgageCalculators() {
  document.querySelectorAll('.mortgage-calc').forEach(calc => {
    const price = Number(calc.dataset.price) || 0;
    const downPctEl = calc.querySelector('.mc-down-pct');
    const rateEl = calc.querySelector('.mc-rate');
    const termEl = calc.querySelector('.mc-term');
    const outEl = calc.querySelector('.mc-monthly');
    if (!downPctEl || !rateEl || !termEl || !outEl) return;

    function recompute() {
      const downPct = Math.min(Math.max(Number(downPctEl.value) || 0, 0), 100);
      const rate = Math.max(Number(rateEl.value) || 0, 0);
      const years = Number(termEl.value) || 30;
      const loanAmount = price * (1 - downPct / 100);
      const monthlyRate = rate / 100 / 12;
      const n = years * 12;
      const payment = monthlyRate === 0 ? loanAmount / n : loanAmount * monthlyRate * Math.pow(1 + monthlyRate, n) / (Math.pow(1 + monthlyRate, n) - 1);
      outEl.textContent = Number.isFinite(payment) && payment > 0 ? money(Math.round(payment)) : '—';
    }
    [downPctEl, rateEl, termEl].forEach(el => el.addEventListener('input', recompute));
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
