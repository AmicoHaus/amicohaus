/* Amico Haus — price opinion history and refresh requests (loaded before main.js; R3-1b).
   The homeowner sees each agent's own numbers over time on that agent's card, and every 90 days can ask the agents
   who gave a price opinion for a fresh look (Same or Update). An agent sees only their own history and their own
   request. Jury test: one agent's numbers at a time, always "Agent price opinion, not an appraisal"; nothing is
   combined across agents, and the little line chart is neutral (no axis numbers, no percentages, no up/down colors).
   Uses client.js helpers (escapeHtml, money, sqlUtcToDate, toast, toastActionError, apiPost, PRICE_BASIS_NOTE) and,
   at click time, main.js (marketplaceDetail, openPreListingDetail). */

const OPINION_TRAIL = (() => {
  const LABEL = 'Agent price opinion, not an appraisal';
  const PACIFIC = 'America/Los_Angeles';
  const SOURCE_LABELS = { first: 'First opinion', edit: 'Changed', same: 'Same as before', update: 'Updated' };

  // "Nov 4" and "Nov 4, 2026" for a server time (SQL UTC text), read in Pacific time.
  const dayLabel = (s) => {
    const d = sqlUtcToDate(s);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: PACIFIC }) : '';
  };
  const fullDateLabel = (s) => {
    const d = sqlUtcToDate(s);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: PACIFIC }) : '';
  };
  // A sold date ('YYYY-MM-DD', a calendar date with no time zone): "Oct 2, 2026".
  const soldDateLabel = (iso) => {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };
  const hasNumber = (n) => n !== null && n !== undefined && Number(n) > 0;

  const sourceLabel = (e) => (e.source === 'first' && e.onFile ? 'On file' : SOURCE_LABELS[e.source] || '');

  const compLine = (c) => {
    if (!c || !c.address) return '';
    const parts = [`New comparable sale: ${escapeHtml(c.address)} sold for ${money(c.soldPrice)}`];
    if (c.soldDate && soldDateLabel(c.soldDate)) parts.push(` on ${escapeHtml(soldDateLabel(c.soldDate))}`);
    if (c.sqft) parts.push(` · ${Number(c.sqft).toLocaleString('en-US')} sq ft`);
    return `<br><span class="tiny">${parts.join('')}</span>`;
  };

  // One row per version, newest first.
  const rowsHtml = (trail) => trail.slice().reverse().map(e =>
    `<li><span class="trail-date">${escapeHtml(fullDateLabel(e.at))}</span> ${money(e.price)} · ${escapeHtml(sourceLabel(e))}${e.reason ? ` · ${escapeHtml(e.reason)}` : ''}${compLine(e.comp)}</li>`
  ).join('');

  // A plain line through this agent's numbers, oldest to newest (2+ points). No axis, no numbers, one color.
  const sparkHtml = (trail) => {
    const prices = trail.map(e => Number(e.price)).filter(n => Number.isFinite(n));
    if (prices.length < 2) return '';
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const step = 116 / (prices.length - 1);
    const points = prices.map((n, i) => {
      const x = 2 + i * step;
      const y = hi === lo ? 14 : 26 - ((n - lo) / (hi - lo)) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg class="trail-spark" viewBox="0 0 120 28" role="img" aria-label="This agent's price opinion over time"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${points}"/></svg>`;
  };

  return { LABEL, dayLabel, fullDateLabel, hasNumber, rowsHtml, sparkHtml };
})();

// The owner's "Refresh my opinions" bar above the agents' cards ('' when there's nothing to say).
function opinionRefreshBarHtml(priceOpinions, preListingId) {
  const st = priceOpinions && priceOpinions.refresh;
  if (!st || st.reason === 'not_open' || st.reason === 'no_opinions') return '';
  let html = '';
  if (st.canRequest) {
    html = '<div class="refresh-bar"><button type="button" class="btn btn-primary btn-sm" data-or-action="refresh-opinions">Refresh my opinions</button><span class="tiny">Ask each agent for a fresh look: Same or Update. You can ask every 90 days.</span></div>';
  } else if (st.reason === 'too_soon') {
    html = `<p class="tiny refresh-bar">You can ask for fresh opinions on ${escapeHtml(OPINION_TRAIL.fullDateLabel(st.availableAt))}.</p>`;
  } else if (st.reason === 'all_recent') {
    html = "<p class=\"tiny refresh-bar\">Your agents' price opinions are all from the last 30 days.</p>";
  }
  const round = st.lastRound;
  if (round && round.asked) {
    html += `<p class="tiny ask-status">Asked ${round.asked} agent${round.asked === 1 ? '' : 's'} on ${escapeHtml(OPINION_TRAIL.dayLabel(round.askedAt))} · ${round.answered} answered so far.</p>`;
  }
  return html;
}

// Inside each owner opinion card, after the price line: the label, the refresh status and this agent's history.
function opinionCardExtrasHtml(o) {
  if (!o) return '';
  const trail = Array.isArray(o.trail) ? o.trail : [];
  const current = OPINION_TRAIL.hasNumber(o.priceOpinion);
  let html = '';
  if (current) html += `<p class="opinion-label">${OPINION_TRAIL.LABEL}</p>`;
  else if (trail.length) html += '<p class="tiny ask-status">This agent has no current price opinion. Their earlier numbers stay in your history.</p>';
  const ask = o.ask;
  if (ask) {
    let text = '';
    if (ask.answer === 'same') text = `Said Same on ${OPINION_TRAIL.dayLabel(ask.answeredAt)}`;
    else if (ask.answer === 'update') text = `Updated on ${OPINION_TRAIL.dayLabel(ask.answeredAt)}`;
    else if (ask.current) text = `Asked for a fresh look on ${OPINION_TRAIL.dayLabel(ask.askedAt)} · waiting`;
    if (text) html += `<p class="tiny ask-status">${escapeHtml(text)}</p>`;
  }
  if (trail.length >= 2 || (trail.length >= 1 && !current)) {
    html += `<details class="opinion-trail">
  <summary>Price opinion history (${trail.length})</summary>
  <p class="tiny">This agent's own numbers over time. Only you and this agent see this history. ${OPINION_TRAIL.LABEL}.</p>
  ${OPINION_TRAIL.sparkHtml(trail)}
  <ul class="trail-list">${OPINION_TRAIL.rowsHtml(trail)}</ul>
</details>`;
  }
  return html;
}

// For the agent on the home's detail: the homeowner's fresh-look request (when one is waiting), then their own history.
function agentRefreshHtml(p, myRefreshAsk, myOpinionTrail, myVote) {
  let html = '';
  if (p && myRefreshAsk && myRefreshAsk.pending && p.status === 'open') {
    const onFile = myVote && OPINION_TRAIL.hasNumber(myVote.priceOpinion);
    const onFileLine = onFile
      ? `<p class="tiny">Your price opinion on file: <strong>${money(myVote.priceOpinion)}</strong> · ${OPINION_TRAIL.LABEL}</p>`
      : '<p class="tiny">You have no price opinion on file right now. Share your number with Update.</p>';
    const sameBtn = onFile ? '<button type="button" class="btn btn-primary btn-sm" data-or-action="refresh-same">Same</button>' : '';
    html += `<div class="panel refresh-ask-panel" id="refreshAskPanel">
  <h3>Fresh look requested</h3>
  <p>The homeowner asked the agents who gave a price opinion for a fresh look. Is your number the same?</p>
  ${onFileLine}
  <div class="card-actions">${sameBtn}<button type="button" class="btn btn-ghost btn-sm" data-or-action="refresh-update-toggle" aria-expanded="false" aria-controls="refreshUpdateForm">Update</button></div>
  <div class="refresh-update-form hidden" id="refreshUpdateForm">
    <div class="field"><label for="refreshPrice">Your updated price opinion ($)</label><input type="number" id="refreshPrice" min="10000" max="500000000" step="1000"></div>
    <div class="field"><label for="refreshReason">One-line reason (the homeowner sees it)</label><input type="text" id="refreshReason" maxlength="140"><p class="tiny field-hint">${escapeHtml(PRICE_BASIS_NOTE)}</p></div>
    <p class="label">New comparable sale (optional)</p>
    <div class="form-row two-col"><div class="field"><label for="refreshCompAddress">Address</label><input type="text" id="refreshCompAddress" maxlength="120"></div><div class="field"><label for="refreshCompPrice">Sold price ($)</label><input type="number" id="refreshCompPrice" min="1000" step="1000"></div></div>
    <div class="form-row two-col"><div class="field"><label for="refreshCompDate">Sold date</label><input type="date" id="refreshCompDate"></div><div class="field"><label for="refreshCompSqft">Sq ft</label><input type="number" id="refreshCompSqft" min="100" max="100000"></div></div>
    <div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-or-action="refresh-update-save">Send update</button></div>
  </div>
</div>`;
  }
  const trail = Array.isArray(myOpinionTrail) ? myOpinionTrail : [];
  if (trail.length >= 2) {
    html += `<details class="opinion-trail"><summary>Your price opinion history (${trail.length})</summary><p class="tiny">Only you and this homeowner see your history. Other agents never do.</p>${OPINION_TRAIL.sparkHtml(trail)}<ul class="trail-list">${OPINION_TRAIL.rowsHtml(trail)}</ul></details>`;
  }
  return html;
}

// ---- Clicks (delegated, so it works for whichever pre-listing is open) ----
(function wireOpinionRefresh() {
  const preListingId = () => (typeof marketplaceDetail !== 'undefined' && marketplaceDetail && marketplaceDetail.kind === 'pre_listing' ? marketplaceDetail.id : null);
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-or-action]');
    if (!btn) return;
    const id = preListingId();
    if (!id) return;
    const action = btn.dataset.orAction;
    if (action === 'refresh-update-toggle') {
      const form = document.getElementById('refreshUpdateForm');
      if (!form) return;
      const open = form.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { const price = document.getElementById('refreshPrice'); if (price) price.focus(); }
      return;
    }
    btn.disabled = true;
    try {
      if (action === 'refresh-opinions') {
        if (!confirm('Ask your agents for a fresh look? Each agent who gave you a price opinion more than 30 days ago gets a one-tap request. You can ask again in 90 days.')) return;
        const res = await apiPost(`/api/pre-listings/${id}/opinion-refresh`, {});
        const n = Number(res && res.asked) || 0;
        toast(`Asked ${n} agent${n === 1 ? '' : 's'} for a fresh look. You'll get a notification as they answer.`);
        openPreListingDetail(id);
      } else if (action === 'refresh-same') {
        await apiPost(`/api/pre-listings/${id}/opinion-refresh/answer`, { answer: 'same' });
        toast('Thanks! The homeowner will see that your number is the same.');
        openPreListingDetail(id);
      } else if (action === 'refresh-update-save') {
        const price = val('refreshPrice');
        const reason = val('refreshReason');
        if (!price || !reason) { toast('Add your updated number and a one-line reason.'); return; }
        const body = { answer: 'update', priceOpinion: Number(price), reason };
        const comp = { address: val('refreshCompAddress'), soldPrice: val('refreshCompPrice'), soldDate: val('refreshCompDate'), sqft: val('refreshCompSqft') };
        if (comp.address || comp.soldPrice || comp.soldDate || comp.sqft) {
          body.comp = {
            address: comp.address, soldPrice: comp.soldPrice ? Number(comp.soldPrice) : '',
            soldDate: comp.soldDate, sqft: comp.sqft ? Number(comp.sqft) : '',
          };
        }
        await apiPost(`/api/pre-listings/${id}/opinion-refresh/answer`, body);
        toast('Thanks! Your update is on its way to the homeowner.');
        openPreListingDetail(id);
      }
    } catch (err) { toastActionError(err); } finally { btn.disabled = false; }
  });
})();
