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

// For file uploads — deliberately bypasses api()'s JSON Content-Type header
// so the browser can set the correct multipart boundary itself.
async function apiUpload(path, formData) {
  const res = await fetch(path, { method: 'POST', credentials: 'include', body: formData });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
  return data;
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

let toastTimer = null;
function toast(msg) {
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
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
