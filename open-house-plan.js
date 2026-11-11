/* Amico Haus — open-house plan in the Saved tab, and the owner's address-sharing controls (loaded before main.js).
   Needs client.js first (api/apiGet/apiPost, escapeHtml, toast). Globals: the 5 functions main.js calls; every other
   name starts with OHP_/ohp. The plan never reads the person's location and never estimates drive times: directions
   open in the maps app the person picks, which uses the phone's own location. Their stop order stays on this device. */

const OHP_PACIFIC = 'America/Los_Angeles';
const OHP_ORDER_KEY = 'amico.ohPlan.v1:'; // + Pacific day key: { order: [stop keys], removed: [stop keys] }
const OHP_MAPS_KEY = 'amico.ohMaps.v1'; // 'google' | 'apple'
const OHP_DAYS = 7;
const OHP_MAX_WAYPOINTS = 9; // Google's limit: a destination plus 9 waypoints = 10 stops
const OHP_API_BASE = { listing: '/api/listings', augmented_home: '/api/augmented-homes', green_home: '/api/green-homes' };
const OHP_RSVP_NAME_LINE = 'When you RSVP, the owner sees your display name.';
let ohpStops = [];
let ohpDay = null;

// Same text as functions/_lib/pacificTime.js: "Sat, Nov 14, 1:00 PM – 4:00 PM Pacific time".
function ohpClean(s) { return String(s).replace(/\s/g, ' '); }
function ohpStartLabel(iso) {
  return ohpClean(new Date(iso).toLocaleString('en-US', { timeZone: OHP_PACIFIC, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
}
function ohpWhenLabel(startIso, endIso) {
  const end = ohpClean(new Date(endIso).toLocaleTimeString('en-US', { timeZone: OHP_PACIFIC, hour: 'numeric', minute: '2-digit' }));
  return `${ohpStartLabel(startIso)} – ${end} Pacific time`;
}
function ohpDayKey(ms) { return new Date(ms).toLocaleDateString('en-CA', { timeZone: OHP_PACIFIC }); }
function ohpDayLabel(iso) { return ohpClean(new Date(iso).toLocaleDateString('en-US', { timeZone: OHP_PACIFIC, weekday: 'short', month: 'short', day: 'numeric' })); }
// The coming Saturday (today when it is Saturday), as a Pacific day key.
function ohpComingSaturday() {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = names.indexOf(new Date().toLocaleDateString('en-US', { timeZone: OHP_PACIFIC, weekday: 'short' }));
  return ohpDayKey(Date.now() + ((6 - Math.max(0, today) + 7) % 7) * 864e5);
}

function ohpRead(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch { return fallback; }
}
function ohpWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: the plan still shows in time order */ }
}
function ohpMapsApp() { return ohpRead(OHP_MAPS_KEY, 'google') === 'apple' ? 'apple' : 'google'; }
function ohpDirectionsHref(address, app) {
  return app === 'apple'
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(address)}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}
// The stops with an address, in the person's order: the last one is the destination, the rest are waypoints.
function ohpRouteHref(addresses) {
  const list = addresses.slice(0, OHP_MAX_WAYPOINTS + 1);
  const destination = list[list.length - 1];
  const waypoints = list.slice(0, -1).map(a => encodeURIComponent(a)).join('%7C');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&waypoints=${waypoints}&travelmode=driving`;
}

// This day's stops in the person's order (time order by default; new stops go where their time puts them).
function ohpDayStops(day) {
  const saved = ohpRead(OHP_ORDER_KEY + day, {});
  const order = Array.isArray(saved.order) ? saved.order : [];
  const removed = new Set(Array.isArray(saved.removed) ? saved.removed : []);
  const all = ohpStops.filter(s => s.day === day);
  const pos = new Map(order.map((k, i) => [k, i]));
  const known = all.filter(s => pos.has(s.key)).sort((a, b) => pos.get(a.key) - pos.get(b.key));
  const fresh = all.filter(s => !pos.has(s.key));
  // A stop not in the saved order goes before the first known stop that starts after it.
  for (const s of fresh) {
    const at = known.findIndex(k => k.startsAt > s.startsAt);
    if (at === -1) known.push(s); else known.splice(at, 0, s);
  }
  return { kept: known.filter(s => !removed.has(s.key)), removedCount: all.filter(s => removed.has(s.key)).length, order: known.map(s => s.key), removed: [...removed] };
}
function ohpSaveDay(day, order, removed) { ohpWrite(OHP_ORDER_KEY + day, { order, removed }); }

function ohpAddressHtml(s, app) {
  const consent = `<p class="tiny">${escapeHtml(OHP_RSVP_NAME_LINE)}</p>`;
  switch (s.addressNote) {
    case 'shared':
      return `<p class="tiny oh-address">Address (shared by the owner with people going): ${escapeHtml(s.address)}</p>
        <p class="tiny"><a href="${escapeHtml(ohpDirectionsHref(s.address, app))}" target="_blank" rel="noopener noreferrer">Directions ↗</a></p>`;
    case 'opens_at':
      return `<p class="tiny">The owner shares the address with people going, starting ${escapeHtml(ohpStartLabel(Date.parse(s.startsAt) - 24 * 3600e3))} Pacific time.</p>`;
    case 'rsvp_to_get':
      return `<p class="tiny">The owner shares the address with people who RSVP, starting 24 hours before it begins.</p>
        <button type="button" class="btn btn-primary btn-sm" data-action="ohp-rsvp" data-kind="${escapeHtml(s.kind)}" data-home-id="${Number(s.homeId)}" data-id="${Number(s.openHouseId)}">I'm Going</button>
        ${consent}`;
    case 'rsvp_again':
      return '<p class="tiny">The owner now shares the address with people going and sees their names. To be included, remove your RSVP on the home\'s page and RSVP again.</p>';
    case 'preview':
      return `<p class="tiny">Broker preview (agents only). The address is on the pre-listing page.</p>
        <p class="tiny"><a href="${escapeHtml(s.href)}">Open pre-listing</a></p>`;
    default:
      return '<p class="tiny">The owner hasn\'t shared the address for this open house. You can message them from the home\'s page.</p>';
  }
}

function ohpOverlaps(a, b) { return !!b && Date.parse(a.endsAt) > Date.parse(b.startsAt) && Date.parse(b.endsAt) > Date.parse(a.startsAt); }

function ohpStopHtml(s, i, list, app) {
  const area = [s.neighborhood && s.neighborhood !== s.city ? s.neighborhood : '', s.city].filter(Boolean).join(', ');
  const title = s.title || s.propertyType;
  return `
    <div class="side oh-plan-stop" data-ohp-key="${escapeHtml(s.key)}">
      <strong>${escapeHtml(ohpWhenLabel(s.startsAt, s.endsAt))}</strong>
      <p><a href="${escapeHtml(s.href)}">${escapeHtml(title)}</a> ${s.going ? '<span class="badge badge-active">Going</span>' : ''} ${s.saved ? '<span class="badge">Saved</span>' : ''}</p>
      <p class="tiny">${escapeHtml(`${s.beds}bd/${s.baths}ba · ${s.propertyType}`)}</p>
      ${area ? `<p class="tiny">${escapeHtml(area)}</p>` : ''}
      ${s.note ? `<p class="tiny">${escapeHtml(`Owner's note: ${s.note}`)}</p>` : ''}
      ${ohpAddressHtml(s, app)}
      ${ohpOverlaps(s, list[i + 1]) ? '<p class="tiny oh-overlap">This overlaps with the next stop\'s time.</p>' : ''}
      <div class="card-actions oh-plan-stop-actions">
        <button type="button" class="link-btn" data-action="ohp-move" data-dir="-1" data-key="${escapeHtml(s.key)}" aria-label="${escapeHtml(`Move ${title} up`)}"${i === 0 ? ' disabled' : ''}>Move up</button>
        <button type="button" class="link-btn" data-action="ohp-move" data-dir="1" data-key="${escapeHtml(s.key)}" aria-label="${escapeHtml(`Move ${title} down`)}"${i === list.length - 1 ? ' disabled' : ''}>Move down</button>
        <button type="button" class="link-btn" data-action="ohp-remove" data-key="${escapeHtml(s.key)}">Remove from plan</button>
      </div>
    </div>`;
}

function ohpRender() {
  const el = document.getElementById('openHousePlan');
  if (!el) return;
  const head = `<h2>Open-house plan</h2>
    <p class="section-sub">Open houses you RSVP'd to or saved, in time order. Move stops up or down; the order stays on this device.</p>`;
  if (!ohpStops.length) {
    el.innerHTML = `<div class="oh-plan">${head}<p class="tiny">No open houses in the next 7 days from your RSVPs or saved homes. RSVP on a home's page to add it here.</p></div>`;
    return;
  }
  const days = [...new Set(ohpStops.map(s => s.day))];
  if (!days.includes(ohpDay)) ohpDay = days.includes(ohpComingSaturday()) ? ohpComingSaturday() : days[0];
  const app = ohpMapsApp();
  const { kept, removedCount } = ohpDayStops(ohpDay);
  const addresses = kept.filter(s => s.address).map(s => s.address);
  const chips = days.map(d => {
    const first = ohpStops.find(s => s.day === d);
    return `<button type="button" class="btn btn-ghost btn-sm oh-plan-day${d === ohpDay ? ' active' : ''}" data-action="ohp-day" data-day="${escapeHtml(d)}" aria-pressed="${d === ohpDay ? 'true' : 'false'}">${escapeHtml(ohpDayLabel(first.startsAt))}</button>`;
  }).join('');
  const mapsBtn = (key, label) => `<button type="button" class="link-btn" data-action="ohp-maps" data-app="${key}" aria-pressed="${app === key ? 'true' : 'false'}">${app === key ? `<strong>${label}</strong>` : label}</button>`;
  el.innerHTML = `<div class="oh-plan">${head}
    <div class="card-actions" role="group" aria-label="Days">${chips}</div>
    <p class="tiny">Directions open in: ${mapsBtn('google', 'Google Maps')} / ${mapsBtn('apple', 'Apple Maps')}</p>
    <div class="stack">${kept.map((s, i) => ohpStopHtml(s, i, kept, app)).join('')}</div>
    ${addresses.length >= 2 ? `<p class="tiny"><a href="${escapeHtml(ohpRouteHref(addresses))}" target="_blank" rel="noopener noreferrer">Open the whole route in Google Maps ↗</a></p>
    <p class="tiny">Only stops with a shared address are included, in your order. Phone browsers may show only the first 3 stops; the Google Maps app shows all of them.</p>` : ''}
    <p class="tiny">Times and order are yours to plan; Amico Haus doesn't estimate drive times.</p>
    <div class="card-actions">
      ${removedCount ? '<button type="button" class="btn btn-ghost btn-sm" data-action="ohp-restore">Put back removed stops</button>' : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-action="ohp-print">Print plan</button>
    </div>
  </div>`;
}

async function loadOpenHousePlan() {
  const el = document.getElementById('openHousePlan');
  if (!el) return;
  try {
    const { stops } = await apiGet(`/api/open-house-plan?days=${OHP_DAYS}`);
    ohpStops = Array.isArray(stops) ? stops : [];
    ohpRender();
  } catch {
    el.innerHTML = '<div class="oh-plan"><h2>Open-house plan</h2><p class="tiny">Could not load your open-house plan.</p></div>';
  }
}

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action^="ohp-"]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'ohp-day') { ohpDay = btn.dataset.day; ohpRender(); return; }
  if (action === 'ohp-maps') { ohpWrite(OHP_MAPS_KEY, btn.dataset.app === 'apple' ? 'apple' : 'google'); ohpRender(); return; }
  if (action === 'ohp-print') { window.print(); return; }
  if (action === 'ohp-move' || action === 'ohp-remove' || action === 'ohp-restore') {
    const day = ohpDayStops(ohpDay);
    let { order, removed } = day;
    if (action === 'ohp-restore') removed = [];
    else if (action === 'ohp-remove') removed = [...removed, btn.dataset.key];
    else {
      // Move within the kept stops, keeping removed ones where they were.
      const keptKeys = day.kept.map(s => s.key);
      const i = keptKeys.indexOf(btn.dataset.key);
      const j = i + Number(btn.dataset.dir);
      if (i < 0 || j < 0 || j >= keptKeys.length) return;
      const a = order.indexOf(keptKeys[i]), b = order.indexOf(keptKeys[j]);
      [order[a], order[b]] = [order[b], order[a]];
    }
    ohpSaveDay(ohpDay, order, removed);
    ohpRender();
    return;
  }
  if (action === 'ohp-rsvp') {
    const base = OHP_API_BASE[btn.dataset.kind];
    if (!base) return;
    btn.disabled = true;
    try {
      await apiPost(`${base}/${Number(btn.dataset.homeId)}/open-houses/${Number(btn.dataset.id)}/rsvp`, {});
      await loadOpenHousePlan();
    } catch (err) { btn.disabled = false; toast(err.message); }
    return;
  }
  if (action === 'ohp-share-toggle') {
    const kind = btn.dataset.kind;
    const base = OHP_API_BASE[kind];
    if (!base) return;
    btn.disabled = true;
    const homeId = btn.dataset.homeId;
    try {
      await api(`${base}/${Number(homeId)}/open-houses/${Number(btn.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ shareAddressWithRsvps: btn.dataset.share === '1' }) });
      const reload = { listing: typeof loadOpenHousesInto === 'function' ? loadOpenHousesInto : null,
        augmented_home: typeof loadAugmentedOpenHousesInto === 'function' ? loadAugmentedOpenHousesInto : null,
        green_home: typeof loadGreenOpenHousesInto === 'function' ? loadGreenOpenHousesInto : null }[kind];
      if (reload) reload(homeId);
    } catch (err) { btn.disabled = false; toast(err.message); }
  }
});

// ---------- Owner helpers (main.js puts them in each open-house form and row) ----------
function openHouseShareFieldHtml(prefix) {
  const id = `${prefix}OhShare`;
  return `<div class="field">
    <label class="checkbox-row" for="${escapeHtml(id)}"><input type="checkbox" id="${escapeHtml(id)}"><span>Share the street address with people who RSVP (from 24 hours before it starts until it ends)</span></label>
    <p class="tiny">Only signed-in people who RSVP see it, and only in that window. You'll see who's going.</p>
  </div>`;
}

function readOpenHouseShare(prefix) {
  const el = document.getElementById(`${prefix}OhShare`);
  return !!(el && el.checked);
}

function openHouseOwnerExtrasHtml(kind, homeId, oh) {
  if (!oh) return '';
  const on = !!oh.shareAddressWithRsvps;
  const names = Array.isArray(oh.goingNames) ? oh.goingNames : [];
  const before = Number(oh.goingBefore) || 0;
  const beforeText = ` (plus ${before} who RSVP'd before names were shown; they don't get the address unless they RSVP again)`;
  // The API sends at most 50 names; goingNamedCount is how many there are in all.
  const n = Math.max(names.length, Number(oh.goingNamedCount) || 0);
  const more = n > names.length ? `, and ${n - names.length} more` : '';
  const going = names.length
    ? `<p class="tiny">${escapeHtml(`Going (${n}): ${names.join(', ')}${more}`)}${before > 0 ? escapeHtml(beforeText) : ''}</p>`
    : before > 0 ? `<p class="tiny">${escapeHtml(`${before} RSVP'd before names were shown; they don't get the address unless they RSVP again.`)}</p>` : '';
  return `<div class="oh-share-state">
    <span class="tiny">${on ? 'Address shared with people going' : 'Address not shared'}</span>
    <button type="button" class="link-btn" data-action="ohp-share-toggle" data-kind="${escapeHtml(kind)}" data-home-id="${Number(homeId)}" data-id="${Number(oh.id)}" data-share="${on ? '0' : '1'}">${on ? 'Stop sharing the address' : 'Share address with people going'}</button>
    ${going}
  </div>`;
}

function openHouseVisitorAddressHtml(oh) {
  if (!oh || !oh.address) return '';
  return `<p class="tiny oh-address">Address for this open house (shared by the owner with people going): ${escapeHtml(oh.address)}</p>`;
}
