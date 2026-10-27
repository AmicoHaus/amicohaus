/* Amico Haus — homepage: auth-aware header + public directory feed.
   Pulled out of index.html into its own file so it loads under a strict
   script-src 'self' CSP (inline scripts are blocked without a nonce/hash). */

const PROPERTY_TYPES = ['Single Family Home', 'Condo', 'Townhouse', 'Penthouse', 'Ranch / Land', 'Multi-Family', 'Investment Property'];

let currentView = 'list';
let map = null;
let mapMarkers = [];
const DIRECTORY_PAGE_SIZE = 40;
let directoryOffset = 0;
let directoryHasMore = false;

function directoryCardHtml(l) {
  return `
    <div class="card ${activityAccentClass(l.recent_activity)}" data-listing-id="${l.id}">
      <div class="directory-thumb-wrap">
        <img class="directory-thumb" src="${l.photo_id ? `/api/photos/${l.photo_id}` : propertyArtUrl(l.property_type, l.id)}" alt="${l.photo_id ? '' : 'Illustrative photo, not this home'}" loading="lazy">
        ${activityRibbonHtml(l.recent_activity)}
      </div>
      ${l.photo_id ? '' : '<span class="photo-caption">Illustrative photo</span>'}
      <div class="card-head">
        <div>
          <h3><a class="profile-link" href="/listing/${l.id}">${escapeHtml(l.title || l.property_type)}</a></h3>
          <div class="card-agent">${escapeHtml(l.owner_name)}</div>
        </div>
        <span class="badge badge-gold">${l.is_portfolio ? `Portfolio · ${(l.portfolio_members || []).length}` : (l.is_rental ? 'For Rent' : escapeHtml(l.price_tier))}</span>
      </div>
      <div class="mini-block">
        <span class="label">Has</span>
        ${l.is_portfolio ? `${(l.portfolio_members || []).length} properties, ${money(l.estimated_value)} combined` : `${escapeHtml(l.property_type)} · ${l.beds}bd/${l.baths}ba${pricePerSqftLabel(l.estimated_value, l.sqft)}`}<br>
        ${escapeHtml(l.neighborhood ? l.neighborhood + ', ' : '')}${escapeHtml(l.city)}, ${escapeHtml(l.state)}${l.is_portfolio ? ' (primary property)' : ''}
      </div>
      <p class="tiny">${daysOnMarketLabel(l.created_at)}</p>
      ${socialProofHtml(l.favorite_count, l.comment_count)}
      ${l.is_portfolio ? `<div class="mini-block"><span class="label">Includes</span>${(l.portfolio_members || []).map(m => `${escapeHtml(m.propertyType)} in ${escapeHtml(m.city)}, ${escapeHtml(m.state)} (${money(m.estimatedValue)})`).join('<br>')}</div>` : ''}
      ${l.is_rental
        ? `<div class="mini-block"><span class="label">Rent</span>${money(l.rent_amount)}/mo · ${l.min_lease_months}-month min lease</div>`
        : (l.desired_type ? `<div class="mini-block"><span class="label">Wants</span>${escapeHtml(l.desired_type)} in ${escapeHtml(l.locations || 'Anywhere')}</div>` : '')}
      ${renderLifeEventTags(l.life_event_tags)}
      ${renderExternalLinks(l.external_links)}
      <div class="card-actions">
        <button type="button" class="btn btn-ghost btn-sm thumb-btn ${l.my_feedback === 'up' ? 'active' : ''}" data-action="thumb-up" data-id="${l.id}" title="Save to your favorites">👍</button>
        <button type="button" class="btn btn-ghost btn-sm thumb-btn" data-action="thumb-down" data-id="${l.id}" title="Not interested — hide this listing">👎</button>
      </div>
    </div>
  `;
}

function renderDirectory(listings, append = false) {
  const grid = document.getElementById('directoryGrid');
  if (!append && listings.length === 0) {
    grid.innerHTML = '<div class="empty-state">No listings match those filters yet.</div>';
    return;
  }
  const html = listings.map(directoryCardHtml).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html;
}

function renderMap(listings) {
  const el = document.getElementById('directoryMap');
  if (!map) {
    map = L.map(el).setView([39.5, -98.35], 4); // continental US default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);
  }
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];

  const withCoords = listings.map(l => ({ l, coords: cityCoords(l.city, l.state) })).filter(x => x.coords);
  withCoords.forEach(({ l, coords }) => {
    const marker = L.marker(coords).addTo(map);
    marker.bindPopup(`
      <strong>${escapeHtml(l.title || l.property_type)}</strong><br>
      ${escapeHtml(l.property_type)} · ${l.beds}bd/${l.baths}ba<br>
      ${escapeHtml(l.city)}, ${escapeHtml(l.state)}<br>
      ${l.is_rental ? `${money(l.rent_amount)}/mo<br>` : ''}
      <a href="/listing/${l.id}">View listing →</a>
    `);
    mapMarkers.push(marker);
  });

  if (withCoords.length > 0) {
    map.fitBounds(L.latLngBounds(withCoords.map(x => x.coords)).pad(0.2));
  }
}

function directoryFilterParams() {
  const params = new URLSearchParams({ limit: String(DIRECTORY_PAGE_SIZE) });
  const city = document.getElementById('filterCity').value.trim();
  const state = document.getElementById('filterState').value.trim();
  const propertyType = document.getElementById('filterType').value;
  const priceMin = document.getElementById('filterPriceMin').value;
  const priceMax = document.getElementById('filterPriceMax').value;
  const sort = document.getElementById('filterSort').value;
  const kind = document.getElementById('filterKind').value;
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (propertyType) params.set('propertyType', propertyType);
  if (priceMin) params.set('priceMin', priceMin);
  if (priceMax) params.set('priceMax', priceMax);
  if (sort && sort !== 'newest') params.set('sort', sort);
  if (kind) params.set('kind', kind);
  return { params, city, state };
}

function updateDirectoryLoadMoreBtn() {
  document.getElementById('directoryLoadMoreBtn')?.classList.toggle('hidden', !directoryHasMore);
}

async function loadDirectory() {
  const grid = document.getElementById('directoryGrid');
  const { params, city, state } = directoryFilterParams();
  loadMomentumBanner('directoryMomentum', 'listing', city, state);
  try {
    const { listings, hasMore } = await apiGet(`/api/directory?${params.toString()}`);
    window.__lastListings = listings; // cached so toggling to map view doesn't need a re-fetch
    directoryOffset = listings.length;
    directoryHasMore = !!hasMore;
    updateDirectoryLoadMoreBtn();
    renderDirectory(listings);
    if (currentView === 'map') renderMap(listings);
  } catch (e) {
    grid.innerHTML = '<div class="empty-state">Could not load the directory right now.</div>';
  }
}

async function loadMoreDirectory() {
  if (!directoryHasMore) return;
  const btn = document.getElementById('directoryLoadMoreBtn');
  const { params } = directoryFilterParams();
  params.set('offset', String(directoryOffset));
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const { listings, hasMore } = await apiGet(`/api/directory?${params.toString()}`);
    window.__lastListings = [...(window.__lastListings || []), ...listings];
    directoryOffset += listings.length;
    directoryHasMore = !!hasMore;
    updateDirectoryLoadMoreBtn();
    renderDirectory(listings, true);
    if (currentView === 'map') renderMap(window.__lastListings);
  } catch (e) { toast(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Load More'; }
}

// The map library (~150 KB) is only fetched the first time someone taps "Map", so it never slows down the homepage
// for the many visitors who never open the map.
const LEAFLET_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
let leafletLoading = null;
let leafletReady = false;
function loadLeaflet() {
  if (leafletReady) return Promise.resolve();
  if (!leafletLoading) {
    // Waits for the stylesheet as well as the script: a map drawn before its CSS arrives has broken tiles
    // and markers.
    const load = (el) => new Promise((resolve, reject) => {
      el.onload = resolve;
      el.onerror = () => reject(new Error('map failed to load'));
      document.head.appendChild(el);
    });
    // A retry after a partial failure only adds back what didn't load.
    const cssLoaded = [...document.styleSheets].some(sheet => (sheet.href || '').startsWith(`${LEAFLET_BASE}leaflet`));
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${LEAFLET_BASE}leaflet.min.css` });
    const script = Object.assign(document.createElement('script'), { src: `${LEAFLET_BASE}leaflet.min.js` });
    leafletLoading = Promise.all([cssLoaded ? null : load(css), typeof L !== 'undefined' ? null : load(script)])
      .then(() => { L.Icon.Default.imagePath = `${LEAFLET_BASE}images/`; leafletReady = true; })
      .catch((err) => { leafletLoading = null; throw err; });
  }
  return leafletLoading;
}

let requestedView = 'list';
async function setView(view) {
  // Leaflet loads from a CDN, so when that's blocked or offline `L` never
  // exists. Stay on the list rather than swap it for a blank map pane (and
  // rather than throw, which the directory loader would report as "could not
  // load the directory").
  requestedView = view;
  if (view === 'map') {
    let loaded = true;
    try { await loadLeaflet(); } catch { loaded = false; }
    if (requestedView !== 'map') return; // they tapped List while the map was still loading
    if (!loaded || typeof L === 'undefined') {
      toast("The map couldn't load right now — staying in list view.");
      return;
    }
  }
  currentView = view;
  document.getElementById('viewListBtn').classList.toggle('active', view === 'list');
  document.getElementById('viewMapBtn').classList.toggle('active', view === 'map');
  document.getElementById('directoryGrid').classList.toggle('hidden', view === 'map');
  document.getElementById('directoryMap').classList.toggle('hidden', view === 'list');
  if (view === 'map') {
    renderMap(window.__lastListings || []);
    setTimeout(() => map && map.invalidateSize(), 50); // Leaflet needs this after unhiding its container
  }
}

// Real, approved agents only — never the demo's fictional ones. Up to three,
// best-reviewed first; until an admin approves the first agent it says so.
async function loadRealAgents() {
  const el = document.getElementById('realAgents');
  try {
    const { agents } = await apiGet('/api/agents/directory');
    if (!agents.length) {
      el.innerHTML = `<div class="empty-state agents-empty">
        <p><strong>We're welcoming our founding agents in San Diego County now.</strong></p>
        <p>Homeowners: post your pre-listing today and you'll be notified as soon as local agents weigh in. Agents: applications are open.</p>
        <a class="btn btn-primary btn-sm" href="/signup?as=homeowner">Post a Pre-Listing</a>
        <a class="btn btn-ghost btn-sm" href="/signup?as=agent">Apply as an Agent</a>
      </div>`;
      return;
    }
    agents.sort((a, b) => (b.topRated - a.topRated) || (b.reviewCount - a.reviewCount));
    el.innerHTML = agents.slice(0, 3).map(a => directoryAgentCardHtml(a)).join('');
  } catch {
    el.innerHTML = '<div class="empty-state">Could not load agents right now.</div>';
  }
}

// The true counts, straight from the database (demo accounts excluded on the
// server). Never inflated -- but a zero isn't shown as "0 vetted agents" either:
// while the first agents are being approved the strip says so instead, and an
// empty count is simply left out.
async function loadLiveNumbers() {
  const strip = document.getElementById('liveNumbers');
  try {
    const stats = await apiGet('/api/public-stats');
    const item = (id, n, one, many) => {
      const el = document.getElementById(id);
      el.innerHTML = `<strong>${n}</strong> ${n === 1 ? one : many}`;
      el.classList.toggle('hidden', !n);
    };
    item('liveAgents', stats.agents, 'vetted agent', 'vetted agents');
    item('liveRequests', stats.openRequests, 'open request', 'open requests');
    item('liveListings', stats.listings, 'live listing', 'live listings');
    if (!stats.agents) {
      const agentsEl = document.getElementById('liveAgents');
      agentsEl.textContent = 'Now welcoming founding agents in San Diego County';
      agentsEl.classList.remove('hidden');
    }
    strip.classList.remove('hidden');
  } catch { /* the strip just stays hidden */ }
}

(async function () {
  // These don't depend on who is signed in, so they start straight away rather
  // than waiting behind the /api/me round trip.
  loadRealAgents();
  loadLiveNumbers();

  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  }
  // Admin-only nav link — separate from the public "Demo" tab above, this is
  // the real moderation/seed-generation/audit-log tooling, and only renders
  // when the logged-in account actually has the admin role.
  if (user && user.role === 'admin') {
    document.getElementById('mainNav').insertAdjacentHTML('beforeend', '<a class="tab" href="/admin-seed">Admin</a>');
  }

  const typeSelect = document.getElementById('filterType');
  PROPERTY_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    typeSelect.appendChild(opt);
  });

  document.getElementById('directoryFilters').addEventListener('input', () => loadDirectory());
  document.getElementById('directoryFilters2').addEventListener('input', () => loadDirectory());
  document.getElementById('directoryFilters2').addEventListener('change', () => loadDirectory());
  document.getElementById('directoryFilters3').addEventListener('change', () => loadDirectory());
  document.getElementById('viewListBtn').addEventListener('click', () => setView('list'));
  document.getElementById('viewMapBtn').addEventListener('click', () => setView('map'));
  document.getElementById('directoryLoadMoreBtn')?.addEventListener('click', () => loadMoreDirectory());

  document.getElementById('directoryGrid').addEventListener('click', async (e) => {
    const btn = e.target.closest('.thumb-btn');
    if (!btn) return;
    const viewer = await fetchCurrentUser();
    if (!viewer) { toast('Log in to save or hide listings.'); return; }

    const listingId = btn.dataset.id;
    const feedback = btn.dataset.action === 'thumb-up' ? 'up' : 'down';
    const card = btn.closest('[data-listing-id]');
    const upBtn = card.querySelector('[data-action="thumb-up"]');

    try {
      if (feedback === 'up' && upBtn.classList.contains('active')) {
        await apiDelete(`/api/listings/${listingId}/feedback`);
        upBtn.classList.remove('active');
        toast('Removed from your saved listings.');
      } else if (feedback === 'up') {
        await apiPut(`/api/listings/${listingId}/feedback`, { feedback: 'up' });
        upBtn.classList.add('active');
        toast('Saved to your favorites.');
      } else {
        await apiPut(`/api/listings/${listingId}/feedback`, { feedback: 'down' });
        card.remove();
        window.__lastListings = (window.__lastListings || []).filter(l => String(l.id) !== String(listingId));
        if (currentView === 'map') renderMap(window.__lastListings);
        toast('Hidden — you can undo this from the Saved tab in the app.');
      }
    } catch (err) { toast(err.message); }
  });

  loadDirectory();
})();
