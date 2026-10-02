/* Amico Haus — public demo showcase. No login required; the backend
   (/api/demo-overview) scopes every query to @demo.amicohaus.local accounts
   only, so this page never exposes real users' data even after signups start.
   The "Agent Strategy" section is a static, fictional walkthrough from
   demo-sample-data.js and touches no database rows. */

// Agent Strategy leads: that is the main focus of the site. Order here must
// match the order of the <section>s in demo.html.
const SECTIONS = [
  { id: 'agents', label: 'Agent Strategy' },
  { id: 'overview', label: 'Overview' },
  { id: 'listings', label: 'Listings' },
  { id: 'matches', label: 'Matches' },
  { id: 'chains', label: 'Daisy Chains' },
  { id: 'feed', label: 'Feed' },
];

function summaryLabel(s) {
  if (!s) return 'Unknown';
  const loc = `${s.neighborhood ? escapeHtml(s.neighborhood) + ', ' : ''}${escapeHtml(s.city)}, ${escapeHtml(s.state)}`;
  return `${escapeHtml(s.propertyType)} · ${s.beds}bd/${s.baths}ba in ${loc} (${money(s.estimatedValue)})`;
}

/* ---------------- Section pills ---------------- */
function pillsHtml(activeId) {
  return SECTIONS.map(s =>
    `<a class="pill${s.id === activeId ? ' active' : ''}" href="#${s.id}" data-section="${s.id}"${s.id === activeId ? ' aria-current="true"' : ''}>${s.label}</a>`
  ).join('');
}

function renderPills() {
  document.getElementById('demoPills').innerHTML = pillsHtml(SECTIONS[0].id);
  // Every section gets the same row, with its own pill highlighted, so you
  // can hop to any other area without scrolling back to the top.
  document.querySelectorAll('.demo-section [data-pills]').forEach(nav => {
    nav.innerHTML = pillsHtml(nav.closest('.demo-section').id);
  });
}

let activeTopId = null;
function setActiveTopPill(id) {
  if (id === activeTopId) return;
  activeTopId = id;
  document.querySelectorAll('#demoPills .pill').forEach(p => {
    const on = p.dataset.section === id;
    p.classList.toggle('active', on);
    if (on) p.setAttribute('aria-current', 'true'); else p.removeAttribute('aria-current');
  });
  const active = document.querySelector('#demoPills .pill.active');
  // Keep the highlighted pill in view when the bar scrolls sideways on phones.
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// The header and the pill bar are both sticky, so jump targets need to clear
// the two of them stacked. The heights vary (the header wraps on narrow
// screens), so measure them instead of guessing. CSSOM writes like these are
// fine under the site's CSP; inline style="" attributes are not.
function setupStickyOffsets() {
  const root = document.documentElement;
  const topbar = document.querySelector('.topbar');
  const pills = document.getElementById('demoPills');
  const apply = () => {
    const stuck = topbar && getComputedStyle(topbar).position === 'sticky';
    const tb = stuck ? topbar.offsetHeight : 0;
    root.style.setProperty('--topbar-h', `${tb}px`);
    root.style.setProperty('--stack-h', `${tb + (pills ? pills.offsetHeight : 0)}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(apply);
    if (topbar) ro.observe(topbar);
    if (pills) ro.observe(pills);
  }
}

// The active pill is whichever section's top has scrolled past a "reading
// line" a little below the sticky bars; before the first section reaches it
// (top of the page) that's Overview. Computed straight from positions rather
// than tracked through observer events, so it can't get stuck on a stale value.
function updateActiveFromScroll() {
  const stack = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stack-h')) || 0;
  const line = stack + window.innerHeight * 0.2;
  let current = SECTIONS[0].id;
  for (const s of SECTIONS) {
    const el = document.getElementById(s.id);
    if (el && el.getBoundingClientRect().top <= line) current = s.id;
  }
  setActiveTopPill(current);
}

function setupScrollSpy() {
  let ticking = false;
  let jumping = false;
  let jumpTimer = null;

  const endJump = () => {
    jumping = false;
    clearTimeout(jumpTimer);
    updateActiveFromScroll();
  };

  // Clicking a pill smooth-scrolls past every section in between. Highlight
  // the destination right away and hold the spy until the scroll settles, so
  // the highlight doesn't flicker through each section on the way.
  document.addEventListener('click', e => {
    const pill = e.target.closest('a.pill[data-section]');
    if (!pill) return;
    jumping = true;
    setActiveTopPill(pill.dataset.section);
    clearTimeout(jumpTimer);
    jumpTimer = setTimeout(endJump, 1800);
  });
  window.addEventListener('scrollend', () => { if (jumping) endJump(); });

  window.addEventListener('scroll', () => {
    if (jumping || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateActiveFromScroll(); });
  }, { passive: true });
  window.addEventListener('resize', updateActiveFromScroll);
  updateActiveFromScroll();
}

// Bars are sized from data-w after render: the site's CSP blocks inline
// style="" attributes, but setting el.style from script is allowed.
function applyDynamicWidths(root) {
  const fills = root.querySelectorAll('[data-w]');
  requestAnimationFrame(() => fills.forEach(el => { el.style.width = `${el.dataset.w}%`; }));
}

/* ---------------- Agent Strategy (static walkthrough) ---------------- */
const AGENT_FILTERS = [
  { key: 'local', label: '📍 Local specialist', test: a => a.localSpecialist },
  { key: 'accepting', label: 'Accepting new clients', test: a => a.accepting },
  { key: 'spanish', label: 'Speaks Spanish', test: a => a.languages.includes('Spanish') },
  { key: 'lowcomm', label: 'Commission ≤ 2.5%', test: a => a.commission !== null && a.commission <= 2.5 },
  { key: 'cases', label: 'Has case studies', test: a => a.caseStudies > 0 },
  { key: 'top', label: '🏆 Top Rated', test: a => a.topRated },
];
const activeAgentFilters = new Set();

function renderAgentFilters() {
  const el = document.getElementById('demoAgentFilters');
  el.innerHTML = AGENT_FILTERS.map(f => {
    const on = activeAgentFilters.has(f.key);
    return `<button type="button" class="pill pill-toggle${on ? ' active' : ''}" data-filter="${f.key}" aria-pressed="${on}">${f.label}</button>`;
  }).join('');
}

function renderAgents() {
  const tests = AGENT_FILTERS.filter(f => activeAgentFilters.has(f.key));
  const shown = DEMO_AGENTS.filter(a => tests.every(f => f.test(a)));
  document.getElementById('demoAgentCount').textContent =
    `Showing ${shown.length} of ${DEMO_AGENTS.length} sample agents${tests.length ? ' matching every selected filter' : ''}.`;
  document.getElementById('demoAgents').innerHTML = shown.length
    ? shown.map(agentCard).join('')
    : '<div class="empty-state">No sample agents match all of those filters.</div>';
}

function setupAgentFilters() {
  renderAgentFilters();
  renderAgents();
  document.getElementById('demoAgentFilters').addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    const key = btn.dataset.filter;
    if (activeAgentFilters.has(key)) activeAgentFilters.delete(key); else activeAgentFilters.add(key);
    renderAgentFilters();
    renderAgents();
  });
}

function proposalCard(p) {
  const a = DEMO_AGENTS.find(x => x.id === p.agent);
  const badge = p.status === 'accepted' ? 'badge-active' : p.status === 'declined' ? 'badge-paused' : 'badge-gold';
  return `
    <div class="card">
      ${agentHead(a, `<span class="badge ${badge}">${p.status}</span>`)}
      ${p.invited ? '<p class="tiny"><span class="badge badge-gold">Invited directly by the homeowner</span></p>' : ''}
      <p>${escapeHtml(p.message)}</p>
      <div class="mini-two">
        <div class="mini-block"><span class="label">Proposed fee</span>${money(p.flat)} flat + ${p.pct}% commission</div>
        <div class="mini-block"><span class="label">Included services</span>${p.services.map(escapeHtml).join('<br>')}</div>
      </div>
      <p class="tiny">Ready in about ${p.days} days</p>
    </div>`;
}

function renderStory() {
  const s = DEMO_STORY;
  const h = s.home;
  const totalVotes = s.votes.tooHigh + s.votes.justRight + s.votes.tooLow;
  const voteRow = (label, count, cls) => `
    <div class="vote-row">
      <span>${label}</span>
      <div class="vote-track"><div class="vote-fill ${cls}" data-w="${Math.round((count / totalVotes) * 100)}"></div></div>
      <strong>${count}</strong>
    </div>`;

  const steps = [
    {
      title: 'A homeowner posts a pre-listing showcase',
      body: `
        <div class="card">
          ${personHeadHtml({
            avatar: avatarHtml(h.poster, { src: h.posterAvatar, size: 'sm' }),
            nameHtml: escapeHtml(h.poster),
            sub: 'Posting a pre-listing to hear from agents',
          })}
          <img class="directory-thumb" src="${propertyArtUrl(h.type, 'demo-story-home')}" alt="${escapeHtml(h.type)} in ${escapeHtml(h.neighborhood)}, ${escapeHtml(h.city)}">
          <div class="card-head"><h3>${escapeHtml(h.title)}</h3><span class="badge badge-active">open</span></div>
          <div class="mini-block">${escapeHtml(h.type)} · ${h.beds}bd/${h.baths}ba · ${h.sqft.toLocaleString('en-US')} sqft in ${escapeHtml(h.neighborhood)}, ${escapeHtml(h.city)}, ${escapeHtml(h.state)} ${escapeHtml(h.zip)}<br>${money(h.asking)} asking</div>
          <div class="mini-two">
            <div class="mini-block"><span class="label">Occupancy</span>${escapeHtml(h.occupancy)} during the sale</div>
            <div class="mini-block"><span class="label">Showing notice</span>${h.showingNoticeHours} hours required</div>
          </div>
          <p class="tiny"><span class="label">Special instructions</span> ${escapeHtml(h.instructions)}</p>
          <p class="tiny"><span class="label">Seller preferences</span> ${h.preferences.map(escapeHtml).join(' · ')}</p>
          <p class="tiny">The street address stays private.</p>
        </div>`,
    },
    {
      title: 'Local agent experts evaluate the price',
      body: `
        <div class="card">
          <p class="tiny">Approved agents weigh in on whether the asking price looks too high, too low, or about right, so the homeowner hears it from people who know the market before listing. It's an opinion, not an appraisal.</p>
          ${voteRow('Too high', s.votes.tooHigh, '')}
          ${voteRow('Just right', s.votes.justRight, 'just-right')}
          ${voteRow('Too low', s.votes.tooLow, '')}
          <p class="tiny">${s.votes.nearby} of ${totalVotes} votes came from agents whose service area covers this home (within 20 miles).</p>
        </div>`,
    },
    {
      title: 'Agents share their strategy',
      body: `<div class="stack stack-tight">${s.proposals.map(proposalCard).join('')}</div>`,
    },
    {
      title: 'The homeowner chooses a strategy',
      body: `
        <div class="card">
          <p>Accepting a proposal declines every other pending one automatically. It is a record on the platform, not a contract, and no payment moves through Amico Haus. The two sides handle payment directly, the way they would anyway.</p>
        </div>`,
    },
    {
      title: 'Both sides track progress',
      body: `
        <div class="card">
          <p class="tiny">A shared checklist either side can update. Adding or checking off an item is a status note, not proof that anything was paid.</p>
          <ul class="check-list">
            ${s.milestones.map(m => `<li class="${m.done ? 'done' : ''}"><span class="check-box">${m.done ? '✓' : ''}</span><span>${escapeHtml(m.label)}</span></li>`).join('')}
          </ul>
        </div>`,
    },
    {
      title: 'Both sides review each other',
      body: `
        <div class="stack stack-tight">
          ${s.reviews.map(r => `
            <div class="card review-card">
              ${personHeadHtml({
                avatar: avatarHtml(r.from, { src: r.fromAvatar, size: 'sm' }),
                nameHtml: `${escapeHtml(r.from)} <span class="review-about">reviewing ${escapeHtml(r.about)}</span>`,
                aside: `<span class="chip chip-star"><span class="chip-star-mark" aria-hidden="true">★</span>${r.rating}.0</span>`,
              })}
              <p class="quote">“${escapeHtml(r.text)}”</p>
            </div>`).join('')}
          <p class="tiny">Reviews go both ways, and either side can report an issue to an admin if something goes wrong.</p>
        </div>`,
    },
  ];

  const el = document.getElementById('demoStory');
  el.innerHTML = steps.map((st, i) => `
    <div class="timeline-step">
      <span class="step-num">${i + 1}</span>
      <div class="step-title">${st.title}</div>
      ${st.body}
    </div>`).join('');
  applyDynamicWidths(el);
}

function renderTransaction() {
  const t = DEMO_TRANSACTION;
  const side = x => `
    <div class="side">
      <img class="side-thumb" src="${propertyArtUrl(x.type, x.seed)}" alt="">
      <h4 class="side-owner">${avatarHtml(x.owner, { src: x.avatar, size: 'sm' })}<span>${escapeHtml(x.owner)}</span></h4>
      <p class="tiny">${escapeHtml(x.type)} in ${escapeHtml(x.city)}, ${escapeHtml(x.state)} (${money(x.value)})</p>
    </div>`;
  document.getElementById('demoTransaction').innerHTML = `
    <div class="stack stack-tight">
      <div class="card">
        <div class="card-head"><h3>${escapeHtml(t.a.owner)} ⇄ ${escapeHtml(t.b.owner)}</h3><span class="badge badge-active">open</span></div>
        <div class="match-pair">${side(t.a)}<div class="swap-icon">⇄</div>${side(t.b)}</div>
        <p class="tiny">“${escapeHtml(t.note)}”</p>
      </div>
      ${t.proposals.map(proposalCard).join('')}
    </div>`;
}

/* ---------------- Live demo data ---------------- */
function wantsLine(w) {
  const bits = [];
  if (w.type && w.type !== 'Any') bits.push(escapeHtml(w.type));
  if (w.minBeds) bits.push(`${w.minBeds}+ bd`);
  if (w.minBaths) bits.push(`${w.minBaths}+ ba`);
  // Stored as a flat list ("Beverly Hills", "CA", …); the rest of the app shows
  // it comma-joined as-is, so do the same.
  const where = w.locations.length ? ` in ${w.locations.map(escapeHtml).join(', ')}` : ' anywhere';
  const price = w.priceMax ? ` · ${money(w.priceMin || 0)}–${money(w.priceMax)}` : '';
  return `${bits.length ? bits.join(', ') : 'Open to anything'}${where}${price}`;
}

function listingCard(l) {
  const where = `${escapeHtml(l.city)}, ${escapeHtml(l.state)}`;
  return `
    <div class="card demo-listing">
      <img class="directory-thumb" src="${propertyArtUrl(l.propertyType, l.id)}" alt="${escapeHtml(l.propertyType)} in ${where}" loading="lazy" decoding="async">
      <div class="card-head"><h3>${escapeHtml(l.propertyType)} in ${where}</h3><span class="badge badge-gold">${money(l.estimatedValue)}</span></div>
      <p class="tiny">${l.beds}bd/${l.baths}ba${l.neighborhood ? ` · ${escapeHtml(l.neighborhood)}` : ''}</p>
      <div class="mini-block"><span class="label">Would move for</span>${wantsLine(l.wants)}</div>
      <p class="tiny">Listed by ${escapeHtml(l.owner)} · ${l.matchCount ? `in ${l.matchCount} mutual match${l.matchCount === 1 ? '' : 'es'}` : 'no mutual matches yet'}</p>
    </div>`;
}

function matchCard(m) {
  return `
    <div class="match-card">
      <div class="match-top"><span class="score-pill" title="How well this trade works for both sides — the average of what each of you wants against what the other has to offer.">${Math.round((m.scoreAWantsB + m.scoreBWantsA) / 2)}% match</span></div>
      <div class="match-pair">
        <div class="side"><img class="side-thumb" src="${propertyArtUrl(m.a.propertyType, m.a.owner)}" alt="" loading="lazy" decoding="async"><h4>${escapeHtml(m.a.owner)}</h4><p class="tiny">${summaryLabel(m.a)}</p></div>
        <div class="swap-icon">⇄</div>
        <div class="side"><img class="side-thumb" src="${propertyArtUrl(m.b.propertyType, m.b.owner)}" alt="" loading="lazy" decoding="async"><h4>${escapeHtml(m.b.owner)}</h4><p class="tiny">${summaryLabel(m.b)}</p></div>
      </div>
    </div>`;
}

function chainCard(c) {
  return `
    <div class="chain-card">
      <div class="match-top"><span class="score-pill" title="Average match quality across every leg of this multi-party trade chain.">${c.avg}% avg match</span><span class="badge badge-gold">${c.path.length}-party chain</span></div>
      <div class="chain-flow">
        ${c.path.map((n, i) => `<div class="chain-node"><img class="chain-thumb" src="${propertyArtUrl(n.propertyType, n.owner)}" alt="" loading="lazy" decoding="async"><strong>${escapeHtml(n.owner)}</strong><span>${escapeHtml(n.propertyType)} in ${escapeHtml(n.city)}, ${escapeHtml(n.state)}</span></div>${i < c.path.length - 1 ? '<span class="chain-arrow">→</span>' : ''}`).join('')}
        <span class="chain-arrow">↩</span>
      </div>
    </div>`;
}

function feedCard(p) {
  return `
    <div class="match-card">
      <div class="card-agent">${escapeHtml(p.author_name)} · ${p.group_label ? `in <strong>${escapeHtml(p.group_label)}</strong>` : 'Global feed'} · ${timeAgo(p.created_at)}</div>
      <p>${escapeHtml(p.body)}</p>
      <p class="tiny">👍 ${p.like_count} · 💬 ${p.comment_count}</p>
    </div>`;
}

/* Long lists render only what is visible, then grow on request. Rendering all
   50 chain cards up front was ~16,000px of page and ~250 photos requested at
   once. Newly revealed items are appended (not re-rendered) so photos already
   on screen do not reload. */
function renderCollapsible(listEl, items, renderItem, { initial, step, noun, emptyText }) {
  if (!items.length) { listEl.innerHTML = `<div class="empty-state">${emptyText}</div>`; return; }

  const total = items.length;
  let shown = Math.min(initial, total);
  listEl.innerHTML = items.slice(0, shown).map(renderItem).join('');
  if (total <= initial) return;

  const row = document.createElement('div');
  row.className = 'show-more-row';
  row.innerHTML = `
    <span class="tiny" aria-live="polite"></span>
    <button type="button" class="btn btn-ghost btn-sm" data-more></button>
    <button type="button" class="btn btn-ghost btn-sm" data-less>Show fewer</button>`;
  listEl.insertAdjacentElement('afterend', row);
  const status = row.querySelector('.tiny');
  const moreBtn = row.querySelector('[data-more]');
  const lessBtn = row.querySelector('[data-less]');

  const sync = () => {
    status.textContent = `Showing ${shown} of ${total} sample ${noun}`;
    moreBtn.hidden = shown >= total;
    lessBtn.hidden = shown <= initial;
    moreBtn.textContent = `Show ${Math.min(step, total - shown)} more`;
  };

  moreBtn.addEventListener('click', () => {
    const next = Math.min(shown + step, total);
    listEl.insertAdjacentHTML('beforeend', items.slice(shown, next).map(renderItem).join(''));
    shown = next;
    sync();
    // The button vanishes once everything is showing; keep keyboard focus useful.
    if (moreBtn.hidden) lessBtn.focus();
  });

  lessBtn.addEventListener('click', () => {
    while (listEl.children.length > initial) listEl.lastElementChild.remove();
    shown = initial;
    sync();
    moreBtn.focus();
    // Otherwise the user is left staring at whatever was further down the page.
    const section = listEl.closest('.demo-section');
    if (section) section.scrollIntoView();
  });

  sync();
}

async function loadLiveSections() {
  const statsEl = document.getElementById('demoStats');
  const listingsEl = document.getElementById('demoListings');
  const matchesEl = document.getElementById('demoMatches');
  const chainsEl = document.getElementById('demoChains');
  const feedEl = document.getElementById('demoFeed');

  try {
    const { stats, listings, matches, chains, feed } = await apiGet('/api/demo-overview');

    statsEl.innerHTML = [
      ['Sample users', stats.users], ['Sample listings', stats.activeListings],
      ['Sample matches', stats.matches], ['Sample daisy chains', stats.chains], ['Sample posts', stats.posts],
    ].map(([label, value]) => `<div class="stat-tile"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`).join('');

    renderCollapsible(listingsEl, listings, listingCard, { initial: 9, step: 9, noun: 'listings', emptyText: 'No demo listings yet.' });
    renderCollapsible(matchesEl, matches, matchCard, { initial: 6, step: 10, noun: 'matches', emptyText: 'No demo matches yet.' });
    renderCollapsible(chainsEl, chains, chainCard, { initial: 4, step: 8, noun: 'chains', emptyText: 'No demo chains yet.' });
    renderCollapsible(feedEl, feed, feedCard, { initial: 8, step: 12, noun: 'posts', emptyText: 'No demo posts yet.' });
  } catch (err) {
    [statsEl, listingsEl, matchesEl, chainsEl, feedEl].forEach(el => {
      el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
    });
  }
}

(async function init() {
  renderPills();
  setupStickyOffsets();
  setupScrollSpy();
  setupAgentFilters();
  renderStory();
  renderTransaction();

  await loadLiveSections();

  // Content above a #hash target finishes loading after the browser's first
  // jump, which leaves the page short of where it should be — re-jump once.
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView();
})();
