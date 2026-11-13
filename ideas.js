/* Amico Haus — the Ideas tab (idea cards, idea outlines, Open For) in the app (loaded before main.js).
   Needs client.js first (api/apiGet/apiPost, escapeHtml, toast). Globals: the 2 functions main.js and the other
   scripts call (loadIdeasTab, ideaCardLinkHtml); every other name starts with IDEA_/idea.
   The wording of every legal label, option note and card comes from the server (functions/_lib/dealOutlines.js,
   openFor.js, ideaCards.js) with each response, so it lives in one place. The site lists options and never
   recommends one; an outline is the owner's own words, never a legal document; nothing here has a price to list,
   and nothing says what a use pays. Each part shows only when its tool is on for the viewer (window.NUANCED). */

const IDEA_GRID = 12;
const IDEA_GENERAL_LINE = 'General information. Not legal advice.';
// key -> [gate, title]: the same keys, gates and titles as functions/_lib/ideaCards.js (tools/land-ideas-test.mjs compares).
const IDEA_CARD_INDEX = {
  corner: ['easementIdeas', 'Let someone use a corner of your lot'],
  across: ['easementIdeas', 'Share a driveway or a side path'],
  permanent: ['easementIdeas', 'When a neighbor wants something permanent'],
  long: ['easementIdeas', 'Long leases'],
  together: ['easementIdeas', 'Owning a home with 1 to 3 other people'],
  tower: ['openFor', 'How tower and solar leases work'],
  buyout: ['openFor', 'Lease buyouts, in plain words'],
  minerals: ['openFor', "What's under your land"],
  light: ['openFor', 'Filming, events, storage, gardens'],
  stay: ['sellAndStay', 'Sell and stay'],
  carry: ['ownerCarry', 'Owner will carry, and assumable loans'],
  trial: ['testDrive', 'Test-drive a trade'],
  steps: ['stepDown', 'A price that steps down on a schedule'],
  // The card is named for the head start only while the head start is on for the viewer (a third and fourth entry:
  // [gate, title] that replaces the title when that gate is live).
  first: ['watchAreas', 'Watch a ZIP code', 'headStart', 'Neighbors first'],
};
function ideaCardTitle(key) {
  const c = IDEA_CARD_INDEX[key];
  return c[2] && ideaLive(c[2]) ? c[3] : c[1];
}
const IDEA_STREET_SIDES = [['', 'Not shown'], ['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']];
const ideaState = {
  tools: null, bound: false, cards: [], openCard: '', openPreListingId: 0,
  outlineCfg: null, outlines: [], found: [], findZip: '', findUse: '', draft: null, sketchMode: 'cells', cursor: 0,
  openForCfg: null, flags: [], foundFlags: null, flagFind: { use: '', where: '' }, flagDraft: null,
};

function ideaLive(tool) {
  const tools = window.NUANCED || ideaState.tools || {};
  return !!tools[tool];
}
function ideaTiny(lines) { return (lines || []).map(l => `<p class="tiny">${escapeHtml(l)}</p>`).join(''); }
function ideaList(lines, cls) { return lines && lines.length ? `<ul${cls ? ` class="${cls}"` : ''}>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''; }
function ideaOptions(pairs, selected) {
  return pairs.map(([value, label]) => `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}
function ideaValue(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function ideaChecked(id) { const el = document.getElementById(id); return !!(el && el.checked); }
function ideaAreaText(o) { return [[o.city, o.state].filter(Boolean).join(', '), o.zip].filter(Boolean).join(' '); }

// A link that opens one idea card (key = the card's key), or '' when that card isn't shown to this viewer.
function ideaCardLinkHtml(key) {
  if (!Object.hasOwn(IDEA_CARD_INDEX, key) || !ideaLive(IDEA_CARD_INDEX[key][0])) return '';
  return `<a class="tiny" href="/app#ideas" data-action="idea-open-card" data-idea-card="${escapeHtml(key)}">Idea card: ${escapeHtml(ideaCardTitle(key))}</a>`;
}
function ideaShowCard(key) {
  const card = document.getElementById(`ideaCard-${key}`);
  if (!card) return;
  ideaState.openCard = '';
  card.open = true;
  card.scrollIntoView({ block: 'start' });
}
// The link works from any tab: it switches to Ideas, and the card opens once the tab has drawn it.
document.addEventListener('click', (e) => {
  const link = e.target.closest ? e.target.closest('[data-action="idea-open-card"]') : null;
  if (!link) return;
  e.preventDefault();
  ideaState.openCard = link.dataset.ideaCard || '';
  const panel = document.getElementById('tab-ideas');
  if (panel && panel.classList.contains('active')) { ideaShowCard(ideaState.openCard); return; }
  if (typeof goToTab === 'function') goToTab('ideas');
});

/* ---------------- The sketch (a 12 x 12 tap grid; the same picture as dealOutlines.js sketchSvg) ---------------- */
function ideaCellLook(sketch, i) {
  if (sketch.cells.includes(i)) return ['sk-cell sk-area', '#d9b36c'];
  if (sketch.house.includes(i)) return ['sk-cell sk-house', '#56616b'];
  return ['sk-cell', '#ffffff'];
}
function ideaSketchSvg(sketch, editable) {
  const s = { cells: (sketch && sketch.cells) || [], house: (sketch && sketch.house) || [], street: (sketch && sketch.street) || '' };
  const streetAt = {
    top: 'x="120" y="6"', bottom: 'x="120" y="234"',
    left: 'x="6" y="120" transform="rotate(-90 6 120)"', right: 'x="234" y="120" transform="rotate(90 234 120)"',
  };
  let rects = '';
  for (let i = 0; i < IDEA_GRID * IDEA_GRID; i++) {
    const [cls, fill] = ideaCellLook(s, i);
    rects += `<rect class="${cls}" x="${12 + (i % IDEA_GRID) * 18}" y="${12 + Math.floor(i / IDEA_GRID) * 18}" width="18" height="18" fill="${fill}" stroke="#b9c0c7" stroke-width="1"${editable ? ` data-idea-cell="${i}"` : ''}/>`;
  }
  const street = streetAt[s.street] ? `<text class="sk-street" ${streetAt[s.street]} text-anchor="middle" dominant-baseline="middle" font-size="9">Street</text>` : '';
  const head = editable
    ? '<svg class="sketch-grid" id="ideaSketch" viewBox="0 0 240 240" width="240" height="240" tabindex="0" role="group" aria-label="Sketch grid. Tap squares, or use the arrow keys and the space bar.">'
    : '<svg class="sketch-grid" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Owner\'s rough sketch of the lot">';
  // The keyboard's place: an outline drawn over the grid (hidden until an arrow key is used).
  const cursor = editable ? '<rect id="ideaSketchCursor" x="12" y="12" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" pointer-events="none" visibility="hidden"/>' : '';
  return `${head}${rects}${street}${cursor}</svg>`;
}
// One square: on -> off, off -> on in the current mode (the idea or the house; a square is never both).
function ideaToggleCell(i) {
  const d = ideaState.draft;
  if (!d || !(i >= 0 && i < IDEA_GRID * IDEA_GRID)) return;
  const mine = ideaState.sketchMode === 'house' ? 'house' : 'cells';
  const other = mine === 'house' ? 'cells' : 'house';
  if (d.sketch[mine].includes(i)) d.sketch[mine] = d.sketch[mine].filter(c => c !== i);
  else { d.sketch[mine] = [...d.sketch[mine], i].sort((a, b) => a - b); d.sketch[other] = d.sketch[other].filter(c => c !== i); }
  ideaPaintCell(i);
}
function ideaPaintCell(i) {
  const rect = document.querySelector(`#ideaSketch [data-idea-cell="${i}"]`);
  if (!rect || !ideaState.draft) return;
  const [cls, fill] = ideaCellLook(ideaState.draft.sketch, i);
  rect.setAttribute('class', cls);
  rect.setAttribute('fill', fill);
}
// Moves the keyboard's outline to its square; a tap moves the keyboard's place without showing the outline.
function ideaPaintCursor(show = true) {
  const mark = document.getElementById('ideaSketchCursor');
  if (!mark) return;
  mark.setAttribute('x', String(12 + (ideaState.cursor % IDEA_GRID) * 18));
  mark.setAttribute('y', String(12 + Math.floor(ideaState.cursor / IDEA_GRID) * 18));
  mark.setAttribute('visibility', show ? 'visible' : 'hidden');
}

/* ---------------- 1. Idea cards ---------------- */
function ideaCardHtml(c) {
  const stay = c.action === 'stay' && ideaState.openPreListingId
    ? `<div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="idea-stay" data-id="${escapeHtml(String(ideaState.openPreListingId))}">Set my stay after closing</button></div>` : '';
  return `<details class="card idea-card" id="ideaCard-${escapeHtml(c.key)}">
    <summary><strong>${escapeHtml(c.title)}</strong></summary>
    ${(c.body || []).map(p => `<p>${escapeHtml(p)}</p>`).join('')}
    ${ideaList(c.lines, 'idea-card-lines')}
    ${c.link ? `<p class="tiny"><a href="${escapeHtml(c.link.href)}">${escapeHtml(c.link.label)}</a></p>` : ''}
    ${stay}
  </details>`;
}
function ideaRenderCards() {
  const box = document.getElementById('ideaCardsBox');
  if (!box) return;
  box.innerHTML = ideaState.cards.length
    ? `<h2>Ideas for your home</h2><p class="tiny">${escapeHtml(IDEA_GENERAL_LINE)}</p>${ideaState.cards.map(ideaCardHtml).join('')}` : '';
}
async function ideaLoadCards() {
  const jobs = [apiGet('/api/idea-cards')];
  // The Sell and stay card's button needs the person's open pre-listing, if they have one.
  if (ideaLive('sellAndStay')) jobs.push(apiGet('/api/pre-listings?mine=1').catch(() => null));
  try {
    const [cards, mine] = await Promise.all(jobs);
    ideaState.cards = (cards && cards.cards) || [];
    const open = mine && Array.isArray(mine.preListings) ? mine.preListings.find(p => p.status === 'open') : null;
    ideaState.openPreListingId = open ? open.id : 0;
  } catch (err) { ideaState.cards = []; }
  ideaRenderCards();
}

/* ---------------- 2. My idea outlines + the builder ---------------- */
function ideaKindCfg(kind) {
  const kinds = (ideaState.outlineCfg && ideaState.outlineCfg.kinds) || [];
  return kinds.find(k => k.key === kind) || kinds[0] || { key: '', label: '', uses: [], ladder: [] };
}
function ideaNewDraft() {
  const k = ideaKindCfg('space');
  return {
    id: 0, kind: k.key, useKey: k.uses.length ? k.uses[0].key : '', useNote: '', areaNote: '', termOption: k.ladder.length ? k.ladder[0].key : '',
    sketch: { cells: [], house: [], street: '' }, askAmount: '', askPer: 'month', questions: [], ownQuestion: '',
    zip: '', city: '', state: 'CA', listed: false, ack: false,
  };
}
function ideaDraftFrom(o) {
  return {
    id: o.id, kind: o.kind, useKey: o.useKey, useNote: o.useNote || '', areaNote: o.areaNote || '', termOption: o.termOption,
    sketch: { cells: [...((o.sketch && o.sketch.cells) || [])], house: [...((o.sketch && o.sketch.house) || [])], street: (o.sketch && o.sketch.street) || '' },
    askAmount: o.ask ? String(o.ask.amount) : '', askPer: o.ask ? o.ask.per : 'month', questions: [...(o.questions || [])], ownQuestion: o.ownQuestion || '',
    zip: o.zip || '', city: o.city || '', state: o.state || 'CA', listed: !!o.listed, ack: false,
  };
}
// Copies what is typed in the builder into the draft, so a redraw (a new kind, a new use) keeps it.
function ideaSyncDraft() {
  const d = ideaState.draft;
  if (!d || !document.getElementById('ideaOutlineForm')) return;
  d.useNote = ideaValue('ideaUseNote');
  d.areaNote = ideaValue('ideaAreaNote');
  d.sketch.street = ideaValue('ideaStreet');
  const term = document.querySelector('#ideaOutlineForm input[name="ideaTerm"]:checked');
  if (term) d.termOption = term.value;
  if (document.getElementById('ideaAskAmount')) { d.askAmount = ideaValue('ideaAskAmount'); d.askPer = ideaValue('ideaAskPer') || d.askPer; }
  d.questions = [...document.querySelectorAll('#ideaOutlineForm input[data-idea-question]:checked')].map(el => el.dataset.ideaQuestion);
  d.ownQuestion = ideaValue('ideaOwnQuestion');
  d.zip = ideaValue('ideaZip'); d.city = ideaValue('ideaCity'); d.state = ideaValue('ideaState') || 'CA';
  d.listed = ideaChecked('ideaListYes');
  d.ack = ideaChecked('ideaListAck');
}
function ideaBuilderHtml() {
  const cfg = ideaState.outlineCfg, d = ideaState.draft;
  const kind = ideaKindCfg(d.kind);
  const isPool = d.useKey === 'pool', coOwn = d.kind === 'co_ownership';
  const labels = ideaTiny(cfg.labels);
  const ladder = kind.ladder.map(o => `<div class="outline-option">
      <label for="ideaTerm-${escapeHtml(o.key)}"><input type="radio" name="ideaTerm" id="ideaTerm-${escapeHtml(o.key)}" value="${escapeHtml(o.key)}"${o.key === d.termOption ? ' checked' : ''}><strong>${escapeHtml(o.label)}</strong></label>
      ${ideaList(o.notes, 'outline-notes')}
      <p class="tiny">${escapeHtml(cfg.hoaCityLine)}</p>
    </div>`).join('');
  const ask = isPool ? `<p class="tiny">${escapeHtml(cfg.poolLine)}</p>` : `<div class="form-row two-col">
      <div class="field"><label for="ideaAskAmount">Your ask ($)</label><input type="number" id="ideaAskAmount" min="1" max="50000000" step="1" inputmode="numeric" value="${escapeHtml(d.askAmount)}"></div>
      <div class="field"><label for="ideaAskPer">For</label><select id="ideaAskPer">${ideaOptions((coOwn ? cfg.askPer.filter(p => p.key === 'once') : cfg.askPer).map(p => [p.key, p.label]), coOwn ? 'once' : d.askPer)}</select></div>
    </div>
    <p class="tiny">${escapeHtml(cfg.askLine)}</p>`;
  const questions = cfg.questions.map(q => `<label class="checkbox-row" for="ideaQ-${escapeHtml(q.key)}"><input type="checkbox" id="ideaQ-${escapeHtml(q.key)}" data-idea-question="${escapeHtml(q.key)}"${d.questions.includes(q.key) ? ' checked' : ''}> ${escapeHtml(q.label)}</label>`).join('');
  const listing = coOwn ? '' : `<div class="choice-row">
      <label class="choice" for="ideaListNo"><input type="radio" name="ideaListed" id="ideaListNo" value="0"${d.listed ? '' : ' checked'}><span>Only I see it</span></label>
      <label class="choice" for="ideaListYes"><input type="radio" name="ideaListed" id="ideaListYes" value="1"${d.listed ? ' checked' : ''}><span>List it for members to find</span></label>
    </div>
    <label class="checkbox-row" for="ideaListAck"><input type="checkbox" id="ideaListAck"${d.ack ? ' checked' : ''}> ${escapeHtml(cfg.listAck)}</label>
    ${ideaTiny(cfg.listingLines)}`;
  return `<form id="ideaOutlineForm" class="card outline-builder" novalidate>
    <h3>${d.id ? 'Edit your idea outline' : 'New idea outline'}</h3>
    ${labels}
    <fieldset class="panel"><legend>1. What kind of idea?</legend>
      <div class="form-row two-col">
        <div class="field"><label for="ideaKind">Kind of idea</label><select id="ideaKind">${ideaOptions(cfg.kinds.map(k => [k.key, k.label]), d.kind)}</select></div>
        <div class="field"><label for="ideaUse">Use</label><select id="ideaUse">${ideaOptions(kind.uses.map(u => [u.key, u.label]), d.useKey)}</select></div>
      </div>
      <div class="field"><label for="ideaUseNote">In your own words (needed for "Something else")</label><input type="text" id="ideaUseNote" maxlength="200" value="${escapeHtml(d.useNote)}"></div>
    </fieldset>
    <fieldset class="panel"><legend>2. Where on the lot?</legend>
      <div class="choice-row">
        <label class="choice" for="ideaModeCells"><input type="radio" name="ideaSketchMode" id="ideaModeCells" value="cells"${ideaState.sketchMode === 'house' ? '' : ' checked'}><span>Tap the squares the idea covers</span></label>
        <label class="choice" for="ideaModeHouse"><input type="radio" name="ideaSketchMode" id="ideaModeHouse" value="house"${ideaState.sketchMode === 'house' ? ' checked' : ''}><span>Tap where the house is</span></label>
      </div>
      <div id="ideaSketchBox">${ideaSketchSvg(d.sketch, true)}</div>
      <p class="tiny">${escapeHtml(cfg.sketchLegend)}</p>
      <p class="tiny">${escapeHtml(cfg.sketchLine)}</p>
      <div class="form-row two-col">
        <div class="field"><label for="ideaStreet">Street side</label><select id="ideaStreet">${ideaOptions(IDEA_STREET_SIDES, d.sketch.street)}</select></div>
        <div class="field-end"><button type="button" class="btn btn-ghost btn-sm" data-action="idea-sketch-clear">Clear the sketch</button></div>
      </div>
      <div class="field"><label for="ideaAreaNote">Describe it</label><textarea id="ideaAreaNote" maxlength="200">${escapeHtml(d.areaNote)}</textarea></div>
    </fieldset>
    <fieldset class="panel"><legend>3. Which option are you looking at?</legend>
      <p class="tiny">${escapeHtml(cfg.noRecommendLine)}</p>
      <div class="outline-ladder">${ladder}</div>
    </fieldset>
    <fieldset class="panel"><legend>4. Your ask (optional)</legend>
      ${ask}
    </fieldset>
    <fieldset class="panel"><legend>5. Questions for your attorney</legend>
      ${questions}
      <div class="field"><label for="ideaOwnQuestion">Your own question (optional)</label><textarea id="ideaOwnQuestion" maxlength="300">${escapeHtml(d.ownQuestion)}</textarea></div>
    </fieldset>
    <fieldset class="panel"><legend>6. Keep it private or list it</legend>
      <div class="form-row three-col">
        <div class="field"><label for="ideaZip">ZIP code</label><input type="text" id="ideaZip" maxlength="5" inputmode="numeric" autocomplete="postal-code" value="${escapeHtml(d.zip)}"></div>
        <div class="field"><label for="ideaCity">City</label><input type="text" id="ideaCity" maxlength="60" value="${escapeHtml(d.city)}"></div>
        <div class="field"><label for="ideaState">State</label><input type="text" id="ideaState" maxlength="2" value="${escapeHtml(d.state)}"></div>
      </div>
      ${listing}
    </fieldset>
    ${labels}
    <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button> <button type="button" class="btn btn-ghost" data-action="idea-outline-cancel">Cancel</button></div>
  </form>`;
}
// The lines under every listed outline: the three labels (an idea, not an easement, lease or contract; nothing
// binding), the two listing lines and the HOA-and-city line.
function ideaListedLinesHtml() {
  const cfg = ideaState.outlineCfg;
  return ideaTiny([...cfg.labels, ...cfg.listingLines, cfg.hoaCityLine]);
}
// viewer: the card is another member's listed outline, so the line speaks about the owner's sketch, not "your" sketch.
function ideaSketchBlock(o, viewer) {
  const cfg = ideaState.outlineCfg;
  const drawn = o.sketch && (o.sketch.cells.length || o.sketch.house.length);
  return drawn ? `${ideaSketchSvg(o.sketch, false)}${ideaTiny([cfg.sketchLegend, viewer ? cfg.sketchViewerLine : cfg.sketchLine])}` : '';
}
function ideaMyOutlineHtml(o) {
  const cfg = ideaState.outlineCfg;
  const id = escapeHtml(String(o.id));
  const listBtn = o.kind === 'co_ownership' ? '' : (o.listed
    ? `<button type="button" class="btn btn-ghost btn-sm" data-action="idea-outline-unlist" data-id="${id}">Stop listing</button>`
    : `<button type="button" class="btn btn-ghost btn-sm" data-action="idea-outline-list" data-id="${id}">List it</button>`);
  return `<div class="card">
    <p><span class="badge${o.listed ? ' badge-active' : ''}">${o.listed ? 'Listed for members' : 'Only you see it'}</span></p>
    ${ideaList(o.lines)}
    ${ideaSketchBlock(o)}
    ${o.ask ? ideaTiny([cfg.askLine]) : ''}
    ${o.listed ? ideaListedLinesHtml() : ideaTiny([cfg.labels[0]])}
    <div class="form-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="idea-outline-edit" data-id="${id}">Edit</button>
      <a class="btn btn-ghost btn-sm" href="/idea-outline/${id}" target="_blank" rel="noopener noreferrer">Open the attorney packet</a>
      ${listBtn}
      <button type="button" class="btn btn-danger btn-sm" data-action="idea-outline-delete" data-id="${id}">Delete</button>
    </div>
  </div>`;
}
function ideaRenderOutlines() {
  const box = document.getElementById('ideaOutlinesBox');
  const cfg = ideaState.outlineCfg;
  if (!box || !cfg) return;
  const room = ideaState.outlines.length < cfg.maxOutlines;
  box.innerHTML = `<h2>My idea outlines</h2>
    ${ideaState.outlines.length ? ideaState.outlines.map(ideaMyOutlineHtml).join('') : '<div class="empty-state">No idea outlines yet.</div>'}
    ${ideaState.draft ? ideaBuilderHtml() : (room
    ? '<div class="form-actions"><button type="button" class="btn btn-primary" data-action="idea-outline-new">Start an idea outline</button></div>'
    : `<p class="tiny">You can keep up to ${escapeHtml(String(cfg.maxOutlines))} idea outlines.</p>`)}`;
}
async function ideaLoadOutlines() {
  try {
    const { outlines, config } = await apiGet('/api/deal-outlines?mine=1');
    ideaState.outlines = outlines || [];
    ideaState.outlineCfg = config;
  } catch (err) { return; }
  ideaRenderOutlines();
  ideaRenderOutlineFind();
}
async function ideaSaveOutline() {
  ideaSyncDraft();
  const d = ideaState.draft;
  if (!d) return;
  const body = {
    kind: d.kind, useKey: d.useKey, useNote: d.useNote, areaNote: d.areaNote, termOption: d.termOption, sketch: d.sketch,
    ask: d.useKey !== 'pool' && d.askAmount !== '' ? { amount: Number(d.askAmount), per: d.kind === 'co_ownership' ? 'once' : d.askPer } : null,
    questions: d.questions, ownQuestion: d.ownQuestion, zip: d.zip, city: d.city, state: d.state,
    listed: d.kind !== 'co_ownership' && d.listed, ack: d.ack,
  };
  try {
    if (d.id) await apiPut(`/api/deal-outlines/${d.id}`, body); else await apiPost('/api/deal-outlines', body);
    ideaState.draft = null;
    toast('Idea outline saved.');
    await ideaLoadOutlines();
  } catch (err) { toastActionError(err); }
}

/* ---------------- 3. Find idea outlines ---------------- */
function ideaFoundOutlineHtml(o) {
  const cfg = ideaState.outlineCfg;
  return `<div class="card">
    <p class="tiny"><span class="label">Idea outline (from the owner)</span></p>
    ${ideaList(o.lines)}
    ${ideaSketchBlock(o, true)}
    ${o.ask ? ideaTiny([cfg.askViewerLine]) : ''}
    ${ideaListedLinesHtml()}
    <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="idea-message-owner" data-id="${escapeHtml(String(o.id))}">Message the owner</button></div>
  </div>`;
}
function ideaRenderOutlineFind() {
  const box = document.getElementById('ideaOutlineFindBox');
  const cfg = ideaState.outlineCfg;
  if (!box || !cfg) return;
  // Every use that can be listed, once each ("Something else" is in two kinds; co-ownership is never listed).
  const uses = new Map();
  for (const k of cfg.kinds) if (k.key !== 'co_ownership') for (const u of k.uses) if (!uses.has(u.key)) uses.set(u.key, u.label);
  box.innerHTML = `<h2>Find idea outlines</h2>
    <form id="ideaOutlineFindForm" class="form-row three-col" novalidate>
      <div class="field"><label for="ideaFindZip">ZIP code</label><input type="text" id="ideaFindZip" maxlength="5" inputmode="numeric" value="${escapeHtml(ideaState.findZip)}"></div>
      <div class="field"><label for="ideaFindUse">Use</label><select id="ideaFindUse">${ideaOptions([['', 'Any use'], ...uses], ideaState.findUse)}</select></div>
      <div class="field-end"><button type="submit" class="btn btn-ghost">Search</button></div>
    </form>
    ${ideaState.found.length ? ideaState.found.map(ideaFoundOutlineHtml).join('') : '<div class="empty-state">No listed idea outlines here yet.</div>'}`;
}
async function ideaFindOutlines() {
  try {
    const q = new URLSearchParams();
    if (ideaState.findZip) q.set('zip', ideaState.findZip);
    if (ideaState.findUse) q.set('use', ideaState.findUse);
    const { outlines } = await apiGet(`/api/deal-outlines${q.toString() ? `?${q}` : ''}`);
    ideaState.found = outlines || [];
  } catch (err) { ideaState.found = []; toastActionError(err); }
  ideaRenderOutlineFind();
}

/* ---------------- 4. Open For: my property ---------------- */
function ideaNewFlagDraft() {
  return { id: 0, propertyKind: 'home', uses: [], longAck: false, facts: {}, note: '', zip: '', city: '', state: 'CA' };
}
function ideaFlagDraftFrom(f) {
  const facts = { ...(f.facts || {}) };
  const note = facts.note || '';
  delete facts.note;
  return { id: f.id, propertyKind: f.propertyKind, uses: [...(f.uses || [])], longAck: false, facts, note, zip: f.zip || '', city: f.city || '', state: f.state || 'CA' };
}
function ideaSyncFlagDraft() {
  const d = ideaState.flagDraft;
  if (!d || !document.getElementById('ideaOpenForForm')) return;
  d.propertyKind = ideaValue('ideaOfKind') || d.propertyKind;
  d.uses = [...document.querySelectorAll('#ideaOpenForForm input[data-idea-use]:checked')].map(el => el.dataset.ideaUse);
  d.longAck = ideaChecked('ideaOfLongAck');
  d.facts = {};
  for (const f of ideaState.openForCfg.facts) { const v = ideaValue(`ideaOfFact-${f.key}`); if (v) d.facts[f.key] = v; }
  d.note = ideaValue('ideaOfNote');
  d.zip = ideaValue('ideaOfZip'); d.city = ideaValue('ideaOfCity'); d.state = ideaValue('ideaOfState') || 'CA';
}
function ideaOpenForFormHtml() {
  const cfg = ideaState.openForCfg, d = ideaState.flagDraft;
  const allowed = cfg.uses.filter(u => u.kinds.includes(d.propertyKind));
  const useRow = (u) => {
    const on = d.uses.includes(u.key);
    return `<div><label class="checkbox-row" for="ideaOfUse-${escapeHtml(u.key)}"><input type="checkbox" id="ideaOfUse-${escapeHtml(u.key)}" data-idea-use="${escapeHtml(u.key)}"${on ? ' checked' : ''}> ${escapeHtml(u.label)}</label>${on ? ideaList(u.notes, 'outline-notes') : ''}</div>`;
  };
  const anyLong = allowed.some(u => u.type === 'long' && d.uses.includes(u.key));
  const facts = cfg.facts.map(f => `<div class="field"><label for="ideaOfFact-${escapeHtml(f.key)}">${escapeHtml(f.label)}</label><select id="ideaOfFact-${escapeHtml(f.key)}">${ideaOptions([['', 'Not said'], ...f.choices.map(c => [c.key, c.label])], d.facts[f.key] || '')}</select></div>`).join('');
  return `<form id="ideaOpenForForm" class="card" novalidate>
    <h3>${d.id ? 'Edit your Open For flags' : 'New Open For flags'}</h3>
    <div class="field"><label for="ideaOfKind">Kind of property</label><select id="ideaOfKind">${ideaOptions(cfg.kinds.map(k => [k.key, k.label]), d.propertyKind)}</select></div>
    <fieldset class="panel"><legend>By the day or month-to-month</legend>
      <p class="tiny">${escapeHtml(cfg.lightLine)}</p>
      ${allowed.filter(u => u.type === 'light').map(useRow).join('')}
    </fieldset>
    <fieldset class="panel open-for-long"><legend>Long leases (read the notes first)</legend>
      ${ideaTiny([cfg.longLine, cfg.taxLine])}
      ${allowed.filter(u => u.type === 'long').map(useRow).join('')}
      ${anyLong ? `<label class="checkbox-row" for="ideaOfLongAck"><input type="checkbox" id="ideaOfLongAck"${d.longAck ? ' checked' : ''}> ${escapeHtml(cfg.longAck)}</label>` : ''}
    </fieldset>
    <fieldset class="panel"><legend>About the property (optional)</legend>
      <div class="form-row three-col">${facts}</div>
      <div class="field"><label for="ideaOfNote">Anything else about the property (optional)</label><input type="text" id="ideaOfNote" maxlength="200" value="${escapeHtml(d.note)}"></div>
    </fieldset>
    <div class="form-row three-col">
      <div class="field"><label for="ideaOfZip">ZIP code</label><input type="text" id="ideaOfZip" maxlength="5" inputmode="numeric" autocomplete="postal-code" value="${escapeHtml(d.zip)}"></div>
      <div class="field"><label for="ideaOfCity">City</label><input type="text" id="ideaOfCity" maxlength="60" value="${escapeHtml(d.city)}"></div>
      <div class="field"><label for="ideaOfState">State</label><input type="text" id="ideaOfState" maxlength="2" value="${escapeHtml(d.state)}"></div>
    </div>
    ${ideaTiny([cfg.openForLine, cfg.cityLine, cfg.noPayLine])}
    <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button> <button type="button" class="btn btn-ghost" data-action="idea-flag-cancel">Cancel</button></div>
  </form>`;
}
// One flag set: the uses as chips, the owner's facts, then the lines every flag set carries.
function ideaFlagBodyHtml(f) {
  const long = new Set((ideaState.openForCfg.uses || []).filter(u => u.type === 'long').map(u => u.key));
  const chips = (f.uses || []).map((k, i) => `<span class="chip open-for-chip${long.has(k) ? ' open-for-long' : ''}">${escapeHtml(f.useLabels[i] || k)}</span>`).join('');
  return `<p><strong>${escapeHtml(f.propertyKindLabel)}</strong>${ideaAreaText(f) ? ` · ${escapeHtml(ideaAreaText(f))}` : ''}</p>
    <p class="tiny"><span class="label">Open for</span></p>
    <div class="chip-row">${chips}</div>
    ${f.factLines && f.factLines.length ? `<p class="tiny"><span class="label">About the property (from the owner)</span></p>${ideaList(f.factLines)}` : ''}
    ${ideaTiny(f.lines)}`;
}
function ideaMyFlagHtml(f) {
  const id = escapeHtml(String(f.id));
  const paused = f.status === 'paused';
  return `<div class="card">
    ${paused ? '<p><span class="badge badge-paused">Paused: members can\'t find it</span></p>' : ''}
    ${ideaFlagBodyHtml(f)}
    <div class="form-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="idea-flag-edit" data-id="${id}">Edit</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="idea-flag-pause" data-id="${id}">${paused ? 'Show it again' : 'Pause'}</button>
      <button type="button" class="btn btn-danger btn-sm" data-action="idea-flag-delete" data-id="${id}">Delete</button>
    </div>
  </div>`;
}
function ideaRenderOpenFor() {
  const box = document.getElementById('ideaOpenForBox');
  const cfg = ideaState.openForCfg;
  if (!box || !cfg) return;
  const room = ideaState.flags.length < cfg.max;
  box.innerHTML = `<h2>Open For: my property</h2>
    ${ideaState.flags.length ? ideaState.flags.map(ideaMyFlagHtml).join('') : '<div class="empty-state">No Open For flags yet.</div>'}
    ${ideaState.flagDraft ? ideaOpenForFormHtml() : (room
    ? '<div class="form-actions"><button type="button" class="btn btn-primary" data-action="idea-flag-new">Add Open For flags</button></div>'
    : `<p class="tiny">You can keep up to ${escapeHtml(String(cfg.max))} Open For flag sets.</p>`)}`;
}
async function ideaLoadOpenFor() {
  try {
    const { flags, config } = await apiGet('/api/open-for?mine=1');
    ideaState.flags = flags || [];
    ideaState.openForCfg = config;
  } catch (err) { return; }
  ideaRenderOpenFor();
  ideaRenderOpenForFind();
}
async function ideaSaveFlags() {
  ideaSyncFlagDraft();
  const d = ideaState.flagDraft;
  if (!d) return;
  const body = { propertyKind: d.propertyKind, uses: d.uses, longAck: d.longAck, facts: { ...d.facts, note: d.note }, zip: d.zip, city: d.city, state: d.state };
  try {
    if (d.id) await apiPut(`/api/open-for/${d.id}`, body); else await apiPost('/api/open-for', body);
    ideaState.flagDraft = null;
    toast('Open For flags saved.');
    await ideaLoadOpenFor();
  } catch (err) { toastActionError(err); }
}

/* ---------------- 5. Find properties open for a use ---------------- */
function ideaRenderOpenForFind() {
  const box = document.getElementById('ideaOpenForFindBox');
  const cfg = ideaState.openForCfg;
  if (!box || !cfg) return;
  const found = ideaState.foundFlags;
  const results = found === null ? '' : (found.length
    ? found.map(f => `<div class="card">${ideaFlagBodyHtml(f)}
        <div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-action="idea-message-flag" data-id="${escapeHtml(String(f.id))}">Send a first message</button></div>
      </div>`).join('')
    : '<div class="empty-state">No properties are flagged for that use there yet.</div>');
  box.innerHTML = `<h2>Find properties open for a use</h2>
    <form id="ideaOpenForFindForm" novalidate>
      <div class="field"><label for="ideaOfFindUse">Use</label><select id="ideaOfFindUse">${ideaOptions([['', 'Pick a use'], ...cfg.uses.map(u => [u.key, u.label])], ideaState.flagFind.use)}</select></div>
      <div class="field"><label for="ideaOfFindWhere">ZIP code or city</label><input type="text" id="ideaOfFindWhere" maxlength="60" value="${escapeHtml(ideaState.flagFind.where)}"></div>
      <div class="form-actions"><button type="submit" class="btn btn-ghost">Search</button></div>
    </form>
    ${results}`;
}
async function ideaFindFlags() {
  const { use, where } = ideaState.flagFind;
  if (!use) { toast('Pick a use to search for.'); return; }
  try {
    const q = new URLSearchParams({ use });
    if (/^\d{5}$/.test(where)) q.set('zip', where); else if (where) q.set('city', where);
    const { flags } = await apiGet(`/api/open-for?${q}`);
    ideaState.foundFlags = flags || [];
  } catch (err) { ideaState.foundFlags = []; toastActionError(err); }
  ideaRenderOpenForFind();
}

/* ---------------- Clicks, changes and keys (one set of listeners on #ideasRoot) ---------------- */
function ideaMessage(owner, draft) {
  if (!owner || !owner.id || typeof startConversationWith !== 'function') return;
  startConversationWith(owner.id, owner.name, draft);
}
async function ideaClick(e) {
  const cell = e.target.closest('[data-idea-cell]');
  if (cell && ideaState.draft) {
    ideaState.cursor = Number(cell.dataset.ideaCell);
    ideaToggleCell(ideaState.cursor);
    ideaPaintCursor(false);
    return;
  }
  // A tap anywhere on an option's block (its notes too) picks that option.
  const option = e.target.closest('.outline-option');
  if (option && !e.target.closest('label, input')) {
    const radio = option.querySelector('input[type="radio"]');
    if (radio && !radio.checked) { radio.checked = true; ideaSyncDraft(); }
    return;
  }
  const btn = e.target.closest('[data-action^="idea-"]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = Number(btn.dataset.id) || 0;
  try {
    if (action === 'idea-stay') {
      if (typeof goToTab === 'function') goToTab('marketplace');
      if (typeof openPreListingDetail === 'function') await openPreListingDetail(id);
      const panel = document.getElementById('timingPanel');
      if (panel) { panel.open = true; panel.scrollIntoView({ block: 'start' }); }
    } else if (action === 'idea-outline-new') {
      ideaState.draft = ideaNewDraft(); ideaState.sketchMode = 'cells'; ideaState.cursor = 0;
      ideaRenderOutlines();
      document.getElementById('ideaOutlineForm').scrollIntoView({ block: 'start' });
    } else if (action === 'idea-outline-edit' || action === 'idea-outline-list') {
      const o = ideaState.outlines.find(x => x.id === id);
      if (!o) return;
      ideaState.draft = ideaDraftFrom(o); ideaState.sketchMode = 'cells'; ideaState.cursor = 0;
      if (action === 'idea-outline-list') ideaState.draft.listed = true;
      ideaRenderOutlines();
      const at = document.getElementById(action === 'idea-outline-list' ? 'ideaListAck' : 'ideaOutlineForm');
      if (at) { at.scrollIntoView({ block: 'center' }); if (action === 'idea-outline-list') at.focus(); }
    } else if (action === 'idea-outline-cancel') {
      ideaState.draft = null;
      ideaRenderOutlines();
    } else if (action === 'idea-sketch-clear') {
      ideaSyncDraft();
      ideaState.draft.sketch = { cells: [], house: [], street: ideaState.draft.sketch.street };
      document.getElementById('ideaSketchBox').innerHTML = ideaSketchSvg(ideaState.draft.sketch, true);
    } else if (action === 'idea-outline-unlist') {
      await apiPut(`/api/deal-outlines/${id}`, { listed: false });
      toast('Your outline is no longer listed.');
      await ideaLoadOutlines();
    } else if (action === 'idea-outline-delete') {
      if (!confirm('Delete this idea outline?')) return;
      await apiDelete(`/api/deal-outlines/${id}`);
      if (ideaState.draft && ideaState.draft.id === id) ideaState.draft = null;
      toast('Idea outline deleted.');
      await ideaLoadOutlines();
    } else if (action === 'idea-message-owner') {
      const o = ideaState.found.find(x => x.id === id);
      if (o) ideaMessage(o.owner, `About your idea outline (${o.useLabel}, ${o.zip}): `);
    } else if (action === 'idea-flag-new') {
      ideaState.flagDraft = ideaNewFlagDraft();
      ideaRenderOpenFor();
      document.getElementById('ideaOpenForForm').scrollIntoView({ block: 'start' });
    } else if (action === 'idea-flag-edit') {
      const f = ideaState.flags.find(x => x.id === id);
      if (!f) return;
      ideaState.flagDraft = ideaFlagDraftFrom(f);
      ideaRenderOpenFor();
      document.getElementById('ideaOpenForForm').scrollIntoView({ block: 'start' });
    } else if (action === 'idea-flag-cancel') {
      ideaState.flagDraft = null;
      ideaRenderOpenFor();
    } else if (action === 'idea-flag-pause') {
      const f = ideaState.flags.find(x => x.id === id);
      if (!f) return;
      await apiPut(`/api/open-for/${id}`, { status: f.status === 'paused' ? 'active' : 'paused' });
      await ideaLoadOpenFor();
    } else if (action === 'idea-flag-delete') {
      if (!confirm('Delete these Open For flags?')) return;
      await apiDelete(`/api/open-for/${id}`);
      if (ideaState.flagDraft && ideaState.flagDraft.id === id) ideaState.flagDraft = null;
      toast('Open For flags deleted.');
      await ideaLoadOpenFor();
    } else if (action === 'idea-message-flag') {
      const f = (ideaState.foundFlags || []).find(x => x.id === id);
      const use = ((ideaState.openForCfg.uses || []).find(u => u.key === ideaState.flagFind.use) || {}).label || '';
      if (f) ideaMessage(f.owner, `About your Open For flag (${use}) in ${f.zip}: `);
    }
  } catch (err) { toastActionError(err); }
}
function ideaChange(e) {
  const t = e.target;
  if (!t || !t.id) return;
  if (t.name === 'ideaSketchMode') { ideaState.sketchMode = t.value === 'house' ? 'house' : 'cells'; return; }
  if (t.id === 'ideaKind' || t.id === 'ideaUse') {
    ideaSyncDraft();
    const d = ideaState.draft;
    if (t.id === 'ideaKind') {
      const k = ideaKindCfg(t.value);
      d.kind = k.key; d.useKey = k.uses.length ? k.uses[0].key : ''; d.termOption = k.ladder.length ? k.ladder[0].key : '';
      if (d.kind === 'co_ownership') d.listed = false;
    } else d.useKey = t.value;
    ideaRenderOutlines();
    const again = document.getElementById(t.id);
    if (again) again.focus();
    return;
  }
  if (t.id === 'ideaStreet') {
    ideaSyncDraft();
    document.getElementById('ideaSketchBox').innerHTML = ideaSketchSvg(ideaState.draft.sketch, true);
    return;
  }
  if (t.id === 'ideaOfKind' || t.dataset.ideaUse) {
    ideaSyncFlagDraft();
    if (t.id === 'ideaOfKind') {
      const allowed = new Set(ideaState.openForCfg.uses.filter(u => u.kinds.includes(ideaState.flagDraft.propertyKind)).map(u => u.key));
      ideaState.flagDraft.uses = ideaState.flagDraft.uses.filter(k => allowed.has(k));
    }
    ideaRenderOpenFor();
    const again = document.getElementById(t.id);
    if (again) again.focus();
    return;
  }
  if (t.closest('#ideaOutlineForm')) ideaSyncDraft();
  else if (t.closest('#ideaOpenForForm')) ideaSyncFlagDraft();
}
function ideaSubmit(e) {
  const form = e.target;
  if (!form || !form.id || form.id.indexOf('idea') !== 0) return;
  e.preventDefault();
  if (form.id === 'ideaOutlineForm') ideaSaveOutline();
  else if (form.id === 'ideaOpenForForm') ideaSaveFlags();
  else if (form.id === 'ideaOutlineFindForm') { ideaState.findZip = ideaValue('ideaFindZip'); ideaState.findUse = ideaValue('ideaFindUse'); ideaFindOutlines(); }
  else if (form.id === 'ideaOpenForFindForm') { ideaState.flagFind = { use: ideaValue('ideaOfFindUse'), where: ideaValue('ideaOfFindWhere') }; ideaFindFlags(); }
}
// The sketch by keyboard: arrows move, Space or Enter marks the square.
function ideaKeydown(e) {
  if (!e.target || e.target.id !== 'ideaSketch' || !ideaState.draft) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -IDEA_GRID, ArrowDown: IDEA_GRID }[e.key];
  if (step) {
    const next = ideaState.cursor + step;
    const sameRow = Math.abs(step) !== 1 || Math.floor(next / IDEA_GRID) === Math.floor(ideaState.cursor / IDEA_GRID);
    if (next >= 0 && next < IDEA_GRID * IDEA_GRID && sameRow) ideaState.cursor = next;
    ideaPaintCursor();
    e.preventDefault();
  } else if (e.key === ' ' || e.key === 'Enter') {
    ideaToggleCell(ideaState.cursor);
    ideaPaintCursor();
    e.preventDefault();
  }
}
function ideaBind(root) {
  if (ideaState.bound) return;
  ideaState.bound = true;
  root.addEventListener('click', ideaClick);
  root.addEventListener('change', ideaChange);
  root.addEventListener('submit', ideaSubmit);
  root.addEventListener('keydown', ideaKeydown);
}

// Fills #ideasRoot when the Ideas tab opens: each part only when its tool is on for the viewer.
async function loadIdeasTab() {
  const root = document.getElementById('ideasRoot');
  if (!root) return;
  ideaBind(root);
  if (!window.NUANCED && !ideaState.tools) {
    try { ideaState.tools = (await apiGet('/api/nuanced-tools')).tools || {}; } catch (err) { ideaState.tools = {}; }
  }
  ideaSyncDraft();
  ideaSyncFlagDraft();
  const outlines = ideaLive('easementIdeas'), openFor = ideaLive('openFor');
  root.innerHTML = `<div id="ideaCardsBox"></div>
    ${outlines ? '<div id="ideaOutlinesBox"></div><div id="ideaOutlineFindBox"></div>' : ''}
    ${openFor ? '<div id="ideaOpenForBox"></div><div id="ideaOpenForFindBox"></div>' : ''}`;
  await Promise.all([
    ideaLoadCards(),
    outlines ? ideaLoadOutlines().then(ideaFindOutlines) : null,
    openFor ? ideaLoadOpenFor() : null,
  ]);
  if (ideaState.openCard) ideaShowCard(ideaState.openCard);
}
