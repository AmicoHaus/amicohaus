/* Amico Haus — Ready Meter: weekly check-in, owner tool order, "What agents see" (loaded before main.js, which calls
   these renderers from openPreListingDetail). The check-in answers stay with the owner: they only reorder the owner's
   own tools. Agents see the listing-ready count, target list month and a band only when the owner shares their
   progress. Topic and band labels are kept in sync by hand with functions/_lib/readyMeter.js. */

// About the home and the process only (fair housing): never health, family, jobs, age or other life events.
const READY_TOPIC_LABELS = { timing: 'Timing', money: 'Money', where_next: "Where we'd go next", house_ready: 'Getting the house ready', picking_agent: 'Picking an agent' };
const READY_BAND_LABELS = { exploring: 'Exploring', getting_close: 'Getting close', ready: 'Ready' };
// Owner tools batch: then_now, visit_feedback and binder are new; they are never promoted by a topic.
const READY_DEFAULT_ORDER = ['video', 'opinions', 'agent_view', 'address', 'edit', 'then_now', 'disclosures', 'listing_ready', 'timing', 'previews', 'interviews', 'showings', 'visit_feedback', 'decision_night', 'proposals', 'binder'];
// What moves to the top for each topic. "money" moves only the owner's own fee comparison and take-home estimate:
// the lender note is not a tool and never moves. 'edit' is never promoted.
const READY_PROMOTED = {
  timing: ['timing', 'listing_ready', 'decision_night'],
  money: ['proposals', 'opinions'],
  where_next: ['timing', 'proposals'],
  house_ready: ['listing_ready', 'video', 'opinions', 'previews', 'disclosures'],
  picking_agent: ['proposals', 'interviews', 'decision_night'],
};
const READY_MOVED_LABELS = {
  timing: 'your timing tools', money: 'your proposals and take-home estimate', where_next: 'your next-move tools',
  house_ready: 'your get-ready tools', picking_agent: 'your agent tools',
};

// The pre-listing the check-in card and "What agents see" were last drawn with, for the listener below.
let readyView = null;

function readyToolOrder(topic) {
  const first = Object.hasOwn(READY_PROMOTED, topic || '') ? READY_PROMOTED[topic] : [];
  return [...first, ...READY_DEFAULT_ORDER.filter(k => !first.includes(k))];
}

function readyTopicFor(readyMeter) {
  return readyMeter && readyMeter.latest && readyMeter.latest.fresh ? readyMeter.latest.topic : null;
}

// Back to basics (11.22): the core path (price opinions, proposals, your address, editing) stays on top; every other
// tool waits in one of three drawers, closed until the owner opens one. A tool this week's check-in promotes comes
// up out of its drawer to the top, in the promoted order. Every tool keeps its .owner-tool[data-tool] wrapper.
const READY_CORE = ['opinions', 'proposals', 'address', 'edit'];
const READY_DRAWERS = [
  { key: 'prep', title: 'Get ready to sell', note: 'Your timing, a video walkthrough, the listing-ready checklist, disclosures, broker previews, interviews, showings, visit notes and Decision Night.',
    tools: ['timing', 'video', 'listing_ready', 'disclosures', 'previews', 'interviews', 'showings', 'visit_feedback', 'decision_night'] },
  { key: 'home', title: 'Tell agents more about your home', note: 'See what agents see on your pre-listing, and show them your upgrades with Then & Now.',
    tools: ['agent_view', 'then_now'] },
  { key: 'after', title: 'After you hire', note: 'A handoff binder to print for the next owner.', tools: ['binder'] },
];

// Where each tool goes for this topic: { core: [keys in order], drawers: [{ ...drawer, tools: [keys left in it] }] }.
function readyToolPlacement(topic) {
  const order = readyToolOrder(topic);
  const promoted = Object.hasOwn(READY_PROMOTED, topic || '') ? READY_PROMOTED[topic] : [];
  const core = [...promoted, ...READY_CORE.filter(k => !promoted.includes(k))];
  const placed = new Set(core);
  const drawers = READY_DRAWERS.map(d => ({ ...d, tools: order.filter(k => d.tools.includes(k) && !placed.has(k)) }));
  drawers.forEach(d => d.tools.forEach(k => placed.add(k)));
  // Anything not named above (a tool added later) stays visible on top rather than going missing.
  order.forEach(k => { if (!placed.has(k)) core.push(k); });
  return { core, drawers };
}

function ownerToolsHtml(segments, readyMeter) {
  const { core, drawers } = readyToolPlacement(readyTopicFor(readyMeter));
  const wrap = k => `<div class="owner-tool" data-tool="${k}">${segments[k]}</div>`;
  const has = k => !!(segments && segments[k]);
  const drawerHtml = drawers.map(d => {
    const inside = d.tools.filter(has);
    return `<details class="panel owner-drawer${inside.length ? '' : ' hidden'}" data-drawer="${d.key}"><summary>${escapeHtml(d.title)} <span class="tiny">optional</span></summary><p class="tiny">${escapeHtml(d.note)}</p><div class="owner-drawer-body">${inside.map(wrap).join('')}</div></details>`;
  }).join('');
  return `<div id="ownerTools"><div class="owner-core">${core.filter(has).map(wrap).join('')}</div>${drawerHtml}</div>`;
}

// The six steps of the core path, with where this home is now. Counts only (never a verdict on a price or an agent).
function readyPathHtml(p, { opinions = 0, votes = 0, proposals = 0 } = {}) {
  const hired = p.status === 'awarded';
  const stage = hired ? 6 : proposals > 0 ? 4 : (opinions > 0 || votes > 0) ? 3 : 2;
  const steps = [
    ['Post your home', ''],
    ['Price opinions', opinions > 0 ? `${opinions} in` : votes > 0 ? `${votes} vote${votes === 1 ? '' : 's'}` : ''],
    ['Proposals', proposals > 0 ? `${proposals} in` : ''],
    ['Compare', ''],
    ['Hire', ''],
    ['Review', ''],
  ];
  const items = steps.map(([label, sub], i) => {
    const n = i + 1, state = n < stage ? 'done' : n === stage ? 'current' : 'todo';
    return `<li class="path-step path-${state}"${state === 'current' ? ' aria-current="step"' : ''}><span class="path-num">${state === 'done' ? '✓' : n}</span><span class="path-label">${label}</span>${sub ? `<span class="path-sub">${escapeHtml(sub)}</span>` : ''}</li>`;
  }).join('');
  return `<nav class="panel owner-path" aria-label="Your steps"><ol>${items}</ol></nav>`;
}

function readyPrivacyLine(shareReadiness) {
  return shareReadiness
    ? 'Two taps. Agents see only your band (Exploring, Getting close or Ready), never the number you pick or what\'s on your mind.'
    : 'Two taps. Only you see your answers.';
}

function readyRemindersLinkHtml(remindersOff) {
  return remindersOff
    ? '<button type="button" class="link-btn" data-rm-action="reminders-on">Turn weekly reminders back on</button>'
    : '<button type="button" class="link-btn" data-rm-action="reminders-off">Stop weekly reminders</button>';
}

// The full card (when due, or after tapping Change, with the current answers pressed) or the compact "This week" line.
function readyCardHtml(p, { full = false, readiness = null, topic = null } = {}) {
  const rm = p.readyMeter;
  const id = Number(p.id);
  const latest = rm.latest;
  if (!full && !rm.due && latest && latest.weekKey === rm.weekKey) {
    return `<div class="panel ready-checkin ready-compact" id="readyCheckIn" data-pre-listing-id="${id}"><p class="tiny"><strong>This week:</strong> ${Number(latest.readiness)} of 5 · ${escapeHtml(READY_TOPIC_LABELS[latest.topic] || '')} <button type="button" class="link-btn" data-rm-action="change-checkin">Change</button></p><p class="tiny ready-moved" id="readyCheckInStatus" role="status" aria-live="polite"></p></div>`;
  }
  const scale = [1, 2, 3, 4, 5].map(n => `<button type="button" class="btn btn-ghost btn-sm" data-rm-action="pick-readiness" data-value="${n}" aria-pressed="${readiness === n}" aria-label="${n} of 5">${n}</button>`).join('');
  const topics = Object.entries(READY_TOPIC_LABELS).map(([k, label]) => `<button type="button" class="btn btn-ghost btn-sm" data-rm-action="pick-topic" data-value="${k}" aria-pressed="${topic === k}">${escapeHtml(label)}</button>`).join('');
  return `<div class="panel ready-checkin" id="readyCheckIn" data-pre-listing-id="${id}">
  <h3>Weekly check-in</h3>
  <p class="tiny">${escapeHtml(readyPrivacyLine(rm.shareReadiness))}</p>
  <p class="label" id="readyScaleLabel">How ready do you feel to sell?</p>
  <div class="ready-scale" role="group" aria-labelledby="readyScaleLabel">${scale}</div>
  <div class="ready-scale-ends tiny"><span>Just exploring</span><span>Ready to go</span></div>
  <p class="label" id="readyTopicLabel">What's on your mind most?</p>
  <div class="ready-topics chip-row" role="group" aria-labelledby="readyTopicLabel">${topics}</div>
  <p class="tiny ready-moved" id="readyCheckInStatus" role="status" aria-live="polite"></p>
  <p class="tiny">${readyRemindersLinkHtml(rm.remindersOff)}</p>
</div>`;
}

function readyCheckInHtml(p) {
  if (!p || !p.readyMeter || p.status !== 'open') return '';
  readyView = p;
  return readyCardHtml(p);
}

function readyDueLabel(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
}
function readyMonthLabel(ym) {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function readyWeekLabel(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// The facts list, shared by the agent strip and the owner's preview (the owner sees exactly what agents see).
function readyFactsListHtml(av, isOwner) {
  const item = (label, value) => `<li><span class="label">${label}</span> ${escapeHtml(value)}</li>`;
  const items = [
    item('Photos', String(Number(av.photoCount) || 0)),
    item('Walkthrough video', av.hasVideo ? 'Yes' : 'Not yet'),
    item('Broker preview', av.hasUpcomingPreview ? 'Scheduled' : 'None scheduled'),
    item('Proposals due', av.proposalsDueAt ? readyDueLabel(av.proposalsDueAt) : 'No Decision Night set'),
  ];
  if (av.shared) {
    items.push(item('Listing-ready checklist', `${Number(av.checklistDone) || 0} of ${Number(av.checklistTotal) || 0} done`));
    items.push(item('Target list month', av.targetListMonth ? readyMonthLabel(av.targetListMonth) : 'Not picked yet'));
    items.push(item(isOwner ? 'You said' : 'Owner says', av.band && READY_BAND_LABELS[av.band]
      ? `${READY_BAND_LABELS[av.band]}${av.bandAsOf ? ` (week of ${readyWeekLabel(av.bandAsOf)})` : ''}`
      : 'No recent check-in'));
  } else if (isOwner) {
    items.push('<li class="tiny">Hidden from agents until you share: your listing-ready count, target list month and how ready you feel.</li>');
  }
  return `<ul class="agent-view-list">${items.join('')}</ul>`;
}

// Plain pointers to features for what's missing. Never a claim about results.
function readyTipsHtml(av) {
  const goto = (tool, text) => `<li><button type="button" class="link-btn" data-rm-action="goto" data-tool="${tool}">${text}</button></li>`;
  const tips = [];
  if ((Number(av.photoCount) || 0) < 8) tips.push('<li><button type="button" class="link-btn" data-action="edit-pre-listing">Add photos (up to 8)</button></li>');
  if (!av.hasVideo) tips.push(goto('video', 'Add a walkthrough video'));
  if (!av.hasUpcomingPreview) tips.push(goto('previews', 'Open a broker preview window'));
  if (!av.proposalsDueAt) tips.push(goto('decision_night', 'Set a Decision Night'));
  if (av.shared && !av.targetListMonth) tips.push(goto('listing_ready', 'Pick a target list date'));
  if (av.shared && (Number(av.checklistDone) || 0) < (Number(av.checklistTotal) || 0)) tips.push(goto('listing_ready', 'Tick off your listing-ready checklist'));
  return tips.length ? `<p class="label">Ideas to fill these in</p><ul class="agent-view-tips">${tips.join('')}</ul>` : '';
}

function readyAgentPanelHtml(p, open) {
  const av = p.agentView;
  return `<details class="panel" id="agentViewPanel"${open ? ' open' : ''}>
  <summary>What agents see</summary>
  <p class="tiny">Approved agents see these facts from your dashboard on your pre-listing. They also see your home's details, photos and video, and your closing window and stay if you set them.</p>
  ${readyFactsListHtml(av, true)}
  <label class="checkbox-row" for="shareReadinessToggle"><input type="checkbox" id="shareReadinessToggle"${av.shared ? ' checked' : ''}><span>Share my progress with agents: my listing-ready count, my target list month and how ready I feel (Exploring, Getting close or Ready). The number you pick and what's on your mind always stay private.</span></label>
  ${readyTipsHtml(av)}
</details>`;
}

function agentViewOwnerPanelHtml(p) {
  if (!p || !p.agentView) return '';
  readyView = p;
  return readyAgentPanelHtml(p, false);
}

function agentViewStripHtml(av) {
  if (!av) return '';
  const bandNote = av.band ? '<p class="tiny">"Owner says" is the owner\'s own words from a weekly check-in.</p>' : '';
  return `<div class="agent-view-strip"><p class="tiny"><strong>From the owner's dashboard</strong></p>${readyFactsListHtml(av, false)}${bandNote}</div>`;
}

// ---- Event handling (delegated, so it works for whichever pre-listing is open) ----
(function wireReadyMeter() {
  const preListingId = () => (typeof marketplaceDetail !== 'undefined' && marketplaceDetail && marketplaceDetail.kind === 'pre_listing' ? marketplaceDetail.id : null);
  const sameHome = (id) => !!readyView && String(readyView.id) === String(id);
  let saving = false;

  // Moves the existing tool nodes (typed inputs survive; the detail is never redrawn). True when the order changed.
  // Moves tools between the top and the drawers to match readyToolPlacement (drawers keep their open/closed state).
  function reorderTools(topic) {
    const box = document.getElementById('ownerTools');
    const core = box && box.querySelector('.owner-core');
    if (!box || !core) return false;
    const nodes = [...box.querySelectorAll('.owner-tool')];
    const before = core.querySelectorAll('.owner-tool').length + '|' + nodes.map(n => n.dataset.tool).join();
    const byKey = new Map(nodes.map(n => [n.dataset.tool, n]));
    const { core: coreKeys, drawers } = readyToolPlacement(topic);
    for (const k of coreKeys) if (byKey.has(k)) core.appendChild(byKey.get(k));
    for (const d of drawers) {
      const drawer = box.querySelector(`.owner-drawer[data-drawer="${d.key}"]`);
      const body = drawer && drawer.querySelector('.owner-drawer-body');
      if (!body) continue;
      for (const k of d.tools) if (byKey.has(k)) body.appendChild(byKey.get(k));
      drawer.classList.toggle('hidden', !body.querySelector('.owner-tool'));
    }
    const after = core.querySelectorAll('.owner-tool').length + '|' + [...box.querySelectorAll('.owner-tool')].map(n => n.dataset.tool).join();
    return after !== before;
  }

  async function saveCheckIn(id, card, readiness, topic) {
    saving = true;
    card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const res = await apiPut(`/api/pre-listings/${id}/ready`, { readiness, topic });
      if (!sameHome(id)) return;
      readyView.readyMeter = res.readyMeter;
      if (res.agentView) readyView.agentView = res.agentView;
      const current = document.getElementById('readyCheckIn');
      if (current) current.outerHTML = readyCardHtml(readyView);
      const moved = reorderTools(topic);
      const status = document.getElementById('readyCheckInStatus');
      if (status) status.textContent = moved ? `Thanks! We moved ${READY_MOVED_LABELS[topic]} to the top.` : 'Thanks! See you next week.';
    } catch (err) {
      toastActionError(err);
      card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    } finally { saving = false; }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-rm-action]');
    if (!btn) return;
    const id = preListingId();
    if (!id || !sameHome(id)) return;
    const action = btn.dataset.rmAction;

    if (action === 'pick-readiness' || action === 'pick-topic') {
      const card = btn.closest('#readyCheckIn');
      if (!card || saving) return;
      btn.parentNode.querySelectorAll(`[data-rm-action="${action}"]`).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      const r = card.querySelector('[data-rm-action="pick-readiness"][aria-pressed="true"]');
      const t = card.querySelector('[data-rm-action="pick-topic"][aria-pressed="true"]');
      if (r && t) await saveCheckIn(id, card, Number(r.dataset.value), t.dataset.value);
      return;
    }
    if (action === 'change-checkin') {
      const card = document.getElementById('readyCheckIn');
      const latest = readyView.readyMeter && readyView.readyMeter.latest;
      if (card) card.outerHTML = readyCardHtml(readyView, { full: true, readiness: latest ? latest.readiness : null, topic: latest ? latest.topic : null });
      return;
    }
    if (action === 'reminders-off' || action === 'reminders-on') {
      const remindersOff = action === 'reminders-off';
      btn.disabled = true;
      try {
        const res = await apiPut(`/api/pre-listings/${id}/ready`, { remindersOff });
        if (sameHome(id)) readyView.readyMeter = res.readyMeter;
        toast(remindersOff ? 'Weekly reminders off.' : 'Weekly reminders on.');
        if (document.body.contains(btn)) btn.outerHTML = readyRemindersLinkHtml(remindersOff);
      } catch (err) { toastActionError(err); btn.disabled = false; }
      return;
    }
    if (action === 'goto') {
      const target = document.querySelector(`.owner-tool[data-tool="${btn.dataset.tool}"]`);
      if (!target) return;
      const drawer = target.closest('.owner-drawer');
      if (drawer) drawer.open = true;
      const details = target.querySelector('details');
      if (details) details.open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'shareReadinessToggle') return;
    const box = e.target;
    const id = preListingId();
    if (!id || !sameHome(id)) return;
    const shareReadiness = box.checked;
    box.disabled = true;
    try {
      const res = await apiPut(`/api/pre-listings/${id}/ready`, { shareReadiness });
      if (!sameHome(id)) return;
      readyView.readyMeter = res.readyMeter;
      readyView.agentView = res.agentView;
      const panel = document.getElementById('agentViewPanel');
      if (panel && res.agentView) panel.outerHTML = readyAgentPanelHtml({ ...readyView, agentView: res.agentView }, true);
      const privacy = document.querySelector('#readyCheckIn:not(.ready-compact) > p.tiny');
      if (privacy) privacy.textContent = readyPrivacyLine(!!(res.readyMeter && res.readyMeter.shareReadiness));
      toast(shareReadiness ? 'Agents now see your progress.' : 'Your progress is hidden from agents.');
    } catch (err) {
      if (document.body.contains(box)) box.checked = !shareReadiness;
      toastActionError(err);
    } finally {
      if (document.body.contains(box)) box.disabled = false;
    }
  });
})();
