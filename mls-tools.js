/* Amico Haus — the MLS tools in the app (loaded after ideas.js, before main.js). Needs client.js first (apiGet,
   apiPost, escapeHtml, toast). Globals main.js calls: mlLoadAreaPulse (Saved tab), mlLoadLens (Market Pulse tab),
   mlMountHomeFits (Agent Strategy tab); every other name starts with ML_/ml. Each part shows only when its tool is live
   for this viewer (window.NUANCED, from /api/nuanced-tools; all seven are on since Rudy's 11.16 broker OK, nuancedGate.js).
   The Five Years card (phase 2) comes with Market Pace: two small SVG charts (homes sold, months of supply) per month,
   with the months-of-supply footnote right under the charts (Rudy 11.17). Every MLS endpoint needs a sign-in.
   The server sends finished lines (functions/_lib/mlsTools.js): this file escapes and draws them, adds no number of its
   own, stores nothing and never reads the visitor's location. Bars and curves are SVG attributes, never inline CSS (the CSP blocks it). */

const ML_LENS_TOOLS = ['pricePath', 'marketPace', 'featureLens', 'daysCurve', 'watchersPulse'];
// Card order on the Market Pulse tab (fiveYear rides on the marketPace gate key; the server only sends live cards).
const ML_LENS_ORDER = ['pricePath', 'marketPace', 'fiveYear', 'featureLens', 'daysCurve', 'watchersPulse'];
const ML_FITS_FIELDS = [['beds', 'Bedrooms', 0, 20, 1], ['baths', 'Bathrooms', 0, 20, 0.5], ['sqft', 'Living area (sq ft)', 200, 20000, 10],
  ['lot', 'Lot size (sq ft)', 200, 2000000, 10], ['year', 'Year built', 1850, 2100, 1], ['stories', 'Stories', 1, 4, 1], ['garage', 'Garage spaces', 0, 10, 1]];
let mlLensState = { scope: '', type: 'all' };
let mlLensSeq = 0;
let mlPulseSeq = 0;
let mlFitsDraft = null;

function mlLive(tool) { return !!(window.NUANCED && window.NUANCED[tool] === true); }
function mlEl(id) { return document.getElementById(id); }
function mlFail(err) { if (typeof toastActionError === 'function') toastActionError(err); else toast((err && err.message) || 'Something went wrong. Please try again.'); }

/* ---------------- Drawing a view ---------------- */

function mlTableHtml(t) {
  if (!t || !Array.isArray(t.rows) || !t.rows.length) return '';
  return `<div class="ml-table-wrap"><table class="ml-table">
    ${t.caption ? `<caption>${escapeHtml(t.caption)}</caption>` : ''}
    <thead><tr>${(t.head || []).map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
// A neutral scale: a track, a filled part and a dot. Widths are SVG attributes (the CSP blocks inline styles).
function mlGaugeHtml(g) {
  if (!g || !(Number(g.max) > 0)) return '';
  const pct = Math.max(0, Math.min(100, (Number(g.value) / Number(g.max)) * 100));
  const at = Math.round(pct * 10) / 10;
  const ticks = [0, 2, 4, 6, 8].filter(x => x <= g.max).map(x => `<span>${x}${x === g.max ? '+' : ''}</span>`).join('');
  return `<div class="ml-gauge-wrap"><svg class="ml-gauge" viewBox="0 0 100 12" role="img" aria-label="${escapeHtml(g.label || '')}" preserveAspectRatio="none">
      <rect class="ml-gauge-track" x="0" y="4" width="100" height="4" rx="2"></rect>
      <rect class="ml-gauge-fill" x="0" y="4" width="${at}" height="4" rx="2"></rect>
      <circle class="ml-gauge-dot" cx="${Math.max(2, Math.min(98, at))}" cy="6" r="3"></circle>
    </svg><div class="ml-gauge-ticks">${ticks}</div><p class="tiny ml-gauge-unit">months of supply</p></div>`;
}
// The days curve: points evenly spaced by step (labels under it), share 0 to 100 up the side.
function mlCurveHtml(points, label) {
  if (!Array.isArray(points) || points.length < 2) return label ? `<p class="tiny ml-note">${escapeHtml(label)}</p>` : '';
  const step = 100 / (points.length - 1);
  const xy = points.map((p, i) => `${Math.round(i * step * 10) / 10},${Math.round((44 - Number(p.share) * 0.4) * 10) / 10}`).join(' ');
  const dots = points.map((p, i) => `<circle class="ml-curve-dot" cx="${Math.round(i * step * 10) / 10}" cy="${Math.round((44 - Number(p.share) * 0.4) * 10) / 10}" r="1.2"><title>${escapeHtml(`Day ${p.d}: ${p.share}% sold`)}</title></circle>`).join('');
  return `<div class="ml-curve-wrap"><svg class="ml-curve" viewBox="0 0 100 46" role="img" aria-label="${escapeHtml(label || '')}" preserveAspectRatio="none">
      <line class="ml-curve-axis" x1="0" y1="44" x2="100" y2="44"></line>
      <polyline class="ml-curve-line" points="${xy}"></polyline>${dots}
    </svg><div class="ml-curve-ticks">${points.map(p => `<span>${escapeHtml(String(p.d))}</span>`).join('')}</div>
    <p class="tiny ml-note">${escapeHtml(label || '')}</p></div>`;
}
// Five Years: bars for homes sold each month, a line for months of supply each month, year marks under both. A month
// with no number (under its floor, or not in the export) is a gap: no bar, and the line breaks there.
const ML_TW = 280, ML_TH = 70, ML_TTOP = 4;
function mlNum(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function mlR(v) { return Math.round(v * 10) / 10; }
function mlTrendFrame(t, inner, cls, label) {
  const n = t.months.length;
  const marks = (t.yearTicks || []).map(y => {
    const x = mlR((Number(y.at) / n) * ML_TW);
    return `<line class="ml-trend-grid" x1="${x}" y1="${ML_TTOP}" x2="${x}" y2="${ML_TTOP + ML_TH}"></line><text class="ml-trend-year" x="${mlR(x + 2)}" y="${ML_TTOP + ML_TH + 11}">${escapeHtml(String(y.label))}</text>`;
  }).join('');
  return `<svg class="ml-trend ${cls}" viewBox="0 0 ${ML_TW} ${ML_TTOP + ML_TH + 14}" role="img" aria-label="${escapeHtml(label || '')}">
      <line class="ml-curve-axis" x1="0" y1="${ML_TTOP + ML_TH}" x2="${ML_TW}" y2="${ML_TTOP + ML_TH}"></line>${marks}${inner}
    </svg><p class="tiny ml-note">${escapeHtml(label || '')}</p>`;
}
function mlTrendHtml(t) {
  if (!t || !Array.isArray(t.months) || t.months.length < 2) return '';
  const n = t.months.length, w = ML_TW / n;
  const soldMax = mlNum(t.soldMax) || 0, mosMax = mlNum(t.mosMax) || 0;
  const bars = soldMax > 0 ? t.months.map((m, i) => {
    const v = mlNum(m.sold);
    if (v == null) return '';
    const h = mlR((v / soldMax) * ML_TH);
    return `<rect class="ml-trend-bar" x="${mlR(i * w + w * 0.12)}" y="${mlR(ML_TTOP + ML_TH - h)}" width="${mlR(w * 0.76)}" height="${h}"><title>${escapeHtml(`${m.label}: ${v} homes sold`)}</title></rect>`;
  }).join('') : '';
  const runs = []; let cur = [];
  t.months.forEach((m, i) => {
    const v = mlNum(m.mos);
    if (v == null || mosMax <= 0) { if (cur.length) runs.push(cur); cur = []; return; }
    cur.push(`${mlR(i * w + w / 2)},${mlR(ML_TTOP + ML_TH - (Math.min(v, mosMax) / mosMax) * ML_TH)}`);
  });
  if (cur.length) runs.push(cur);
  const lines = runs.map(r => (r.length === 1 ? `<circle class="ml-trend-dot" cx="${r[0].split(',')[0]}" cy="${r[0].split(',')[1]}" r="1.4"></circle>` : `<polyline class="ml-trend-line" points="${r.join(' ')}"></polyline>`)).join('');
  const last = [...t.months].reverse().find(m => mlNum(m.mos) != null);
  const lastDot = last && mosMax > 0 ? (() => { const i = t.months.indexOf(last); return `<circle class="ml-trend-dot" cx="${mlR(i * w + w / 2)}" cy="${mlR(ML_TTOP + ML_TH - (Math.min(mlNum(last.mos), mosMax) / mosMax) * ML_TH)}" r="1.8"><title>${escapeHtml(`${last.label}: ${last.mos} months of supply*`)}</title></circle>`; })() : '';
  return `<div class="ml-trend-wrap">${mlTrendFrame(t, bars, 'ml-trend-sold', t.soldLabel)}${mlTrendFrame(t, lines + lastDot, 'ml-trend-mos', t.mosLabel)}</div>`;
}
function mlViewHtml(v) {
  if (!v) return '';
  const lines = Array.isArray(v.lines) && v.lines.length ? `<ul class="ml-lines">${v.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '';
  return `<div class="card ml-card" data-ml-tool="${escapeHtml(v.tool || '')}">
    <h3>${escapeHtml(v.heading || '')}</h3>
    ${v.scope ? `<p class="tiny ml-scope">${escapeHtml(v.scope)}</p>` : ''}
    ${lines}
    ${mlGaugeHtml(v.gauge)}
    ${v.curve !== undefined ? mlCurveHtml(v.curve, v.curveLabel) : ''}
    ${v.trend ? mlTrendHtml(v.trend) : ''}
    ${v.footnote ? `<p class="tiny ml-note ml-footnote">${escapeHtml(v.footnote)}</p>` : ''}
    ${mlTableHtml(v.table)}
    ${v.trending ? `<p class="tiny ml-trending">${escapeHtml(v.trending)}</p>` : ''}
    ${v.note ? `<p class="tiny ml-note">${escapeHtml(v.note)}</p>` : ''}
    ${v.credit ? `<p class="tiny ml-credit">${escapeHtml(v.credit)}</p>` : ''}
  </div>`;
}
function mlCtaHtml(cta) {
  if (!cta || !cta.text) return '';
  return `<div class="ml-cta"><p>${escapeHtml(cta.text)}</p><button type="button" class="btn btn-primary btn-sm" data-action="ml-post-home">${escapeHtml(cta.button || '')}</button></div>`;
}

/* ---------------- 1. Area Pulse (Saved tab, under the watch areas) ---------------- */

async function mlLoadAreaPulse() {
  const el = mlEl('mlsAreaPulse');
  if (!el) return;
  if (!mlLive('areaPulse')) { el.innerHTML = ''; return; }
  const seq = ++mlPulseSeq;
  let data;
  try { data = await apiGet('/api/mls/area-pulse'); } catch { data = null; }
  if (seq !== mlPulseSeq) return;
  if (!data) { el.innerHTML = ''; return; }
  const cards = (data.cards || []).map(c => mlViewHtml({ ...c, heading: c.heading })).join('');
  el.innerHTML = `<div class="ml-pulse"><h2>Area Pulse</h2>
    ${cards ? `<div class="ml-grid">${cards}</div>` : `<p class="tiny">${escapeHtml(data.empty || '')}</p>`}
    ${mlCtaHtml(data.cta)}</div>`;
}

/* ---------------- 2, 3, 5, 6, 7: the lenses (Market Pulse tab) ---------------- */

function mlSelectHtml(id, options, selected, action) {
  return `<select id="${escapeHtml(id)}" data-ml-change="${escapeHtml(action)}">${options.map(o => `<option value="${escapeHtml(o.key)}"${o.key === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
}
function mlRenderLens(el, data) {
  const views = data.views || {};
  const cards = ML_LENS_ORDER.filter(t => views[t]).map(t => mlViewHtml(views[t])).join('');
  el.innerHTML = `<div class="ml-lens"><h2>Local MLS numbers</h2>
    <div class="form-row two-col">
      <div class="field"><label for="mlLensScope">Area or ZIP code</label>${mlSelectHtml('mlLensScope', data.scopes || [], data.scope, 'lens')}</div>
      <div class="field"><label for="mlLensType">Home type</label>${mlSelectHtml('mlLensType', data.types || [], data.type, 'lens')}</div>
    </div>
    <div class="ml-grid">${cards}</div>
    ${mlCtaHtml(data.cta)}</div>`;
}
async function mlLoadLens() {
  const el = mlEl('mlsLensRoot');
  if (!el) return;
  if (!ML_LENS_TOOLS.some(mlLive)) { el.innerHTML = ''; return; }
  const seq = ++mlLensSeq;
  const q = new URLSearchParams();
  if (mlLensState.scope) q.set('scope', mlLensState.scope);
  if (mlLensState.type) q.set('type', mlLensState.type);
  let data;
  try { data = await apiGet(`/api/mls/lens?${q.toString()}`); } catch { data = null; }
  if (seq !== mlLensSeq) return;
  if (!data) { el.innerHTML = ''; return; }
  mlLensState = { scope: data.scope || '', type: data.type || 'all' };
  mlRenderLens(el, data);
}

/* ---------------- 4. Where My Home Fits (Agent Strategy tab, next to the showcase form) ---------------- */

function mlFitsFormHtml(data) {
  const zips = (data.zips || []).map(z => ({ key: z, label: z }));
  const fields = ML_FITS_FIELDS.map(([k, label, min, max, step]) => `<div class="field"><label for="mlFits-${k}">${escapeHtml(label)}</label><input type="number" id="mlFits-${k}" data-ml-fit="${k}" min="${min}" max="${max}" step="${step}" inputmode="decimal"></div>`).join('');
  return `<details class="panel bulk-upload ml-fits" id="mlFitsWrap">
    <summary>Where my home fits</summary>
    <form data-ml-form="fits">
      <div class="form-row two-col">
        <div class="field"><label for="mlFitsZip">ZIP code</label>${mlSelectHtml('mlFitsZip', zips, zips.length ? zips[0].key : '', 'none')}</div>
        <div class="field"><label for="mlFitsType">Home type</label>${mlSelectHtml('mlFitsType', data.types || [], 'sfr', 'none')}</div>
      </div>
      <div class="ml-fits-fields">${fields}</div>
      <p class="tiny field-hint">${escapeHtml(data.line || '')}</p>
      <button type="submit" class="btn btn-primary btn-sm">See where it lands</button>
    </form>
    <div data-ml-fits-out></div>
  </details>`;
}
async function mlMountHomeFits() {
  const el = mlEl('mlsHomeFits');
  if (!el) return;
  if (!mlLive('homeFits')) { el.innerHTML = ''; return; }
  if (el.querySelector && el.querySelector('[data-ml-form="fits"]')) return; // already drawn; keep what was typed
  let data;
  try { data = await apiGet('/api/mls/home-fits'); } catch { data = null; }
  el.innerHTML = data ? mlFitsFormHtml(data) : '';
}
function mlReadFits(form) {
  const body = { zip: (mlEl('mlFitsZip') || {}).value || '', type: (mlEl('mlFitsType') || {}).value || 'all' };
  for (const input of form.querySelectorAll('[data-ml-fit]')) if (String(input.value || '').trim() !== '') body[input.dataset.mlFit] = input.value.trim();
  return body;
}
async function mlSubmitFits(form) {
  const out = form.parentNode && form.parentNode.querySelector ? form.parentNode.querySelector('[data-ml-fits-out]') : null;
  try {
    const { view } = await apiPost('/api/mls/home-fits', mlReadFits(form));
    mlFitsDraft = view && view.draft ? view.draft : null;
    if (out) {
      out.innerHTML = `${mlViewHtml(view)}
        ${view && view.button ? `<p class="tiny">${escapeHtml(view.carry || '')}</p><div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-action="ml-fits-draft">${escapeHtml(view.button)}</button></div>` : ''}`;
    }
  } catch (err) { mlFail(err); }
}
// Copies the draft into the existing pre-listing showcase form and opens it. Nothing is posted until the owner does.
function mlStartShowcase() {
  const d = mlFitsDraft;
  if (!d) return;
  const put = (id, v) => { const input = mlEl(id); if (input && v !== null && v !== undefined && v !== '') input.value = String(v); };
  put('plZip', d.zip); put('plBeds', d.beds); put('plBaths', d.baths); put('plSqft', d.sqft); put('plfToyGarage', d.garage);
  if (d.propertyType) put('plPropertyType', d.propertyType);
  if (typeof goToTab === 'function') goToTab('marketplace');
  if (typeof openAgentTabSection === 'function') openAgentTabSection('postHomeWrap');
  toast('Your showcase draft has those details. Add photos and anything else, then post it when you are ready.');
}

/* ---------------- Wiring ---------------- */

document.addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-action^="ml-"]') : null;
  if (!btn) return;
  if (btn.dataset.action === 'ml-post-home') {
    if (typeof goToTab === 'function') goToTab('marketplace');
    if (typeof openAgentTabSection === 'function') openAgentTabSection('postHomeWrap');
  } else if (btn.dataset.action === 'ml-fits-draft') mlStartShowcase();
});
document.addEventListener('change', e => {
  const sel = e.target && e.target.closest ? e.target.closest('[data-ml-change="lens"]') : null;
  if (!sel) return;
  mlLensState = { scope: (mlEl('mlLensScope') || {}).value || '', type: (mlEl('mlLensType') || {}).value || 'all' };
  mlLoadLens();
});
document.addEventListener('submit', e => {
  const form = e.target && e.target.closest ? e.target.closest('[data-ml-form="fits"]') : null;
  if (!form) return;
  e.preventDefault();
  mlSubmitFits(form);
});
