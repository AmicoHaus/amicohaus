/* Amico Haus — the "Unlock your ZIP" board. Each card links to the agent signup with its ZIP (?zip=), and the ZIP is
   remembered (localStorage) so the agent application starts with it filled in. Signed-in visitors go straight to the
   agent application. No utm tags on these links: they're internal, and a tagged click would replace the ad or video
   the visitor first came from. */
(async function () {
  const el = document.getElementById('zipBoard');
  if (!el) return;
  const plural = (n, one, many) => (typeof n === 'number' ? `${n} ${n === 1 ? one : many}` : `${n} ${many}`);
  try {
    const [{ zips, foundingSpots }, me] = await Promise.all([apiGet('/api/zip-board'), fetchCurrentUser().catch(() => null)]);
    const joinHref = (zip) => (me ? '/app#become-agent' : `/signup?as=agent&zip=${zip}`);
    el.innerHTML = zips.map(z => `
      <div class="card zip-card" id="zip-${z.zip}">
        <div class="card-head"><h2>${z.zip}</h2><span class="tiny">${escapeHtml(z.city)}</span></div>
        <ul class="zip-stats">
          <li><strong>${plural(z.homeownersWaiting, 'homeowner', 'homeowners')}</strong> with an open pre-listing</li>
          <li><strong>${plural(z.buyersWatching, 'buyer', 'buyers')}</strong> watching ${escapeHtml(z.city)}</li>
          <li><strong>${plural(z.agents, 'agent', 'agents')}</strong> serving this ZIP${z.agents === 0 ? ' yet' : ''}${z.onDutyNow > 0 ? `, ${z.onDutyNow} on duty now` : ''}</li>
        </ul>
        <p class="tiny">${z.foundingOpen ? `${z.foundingOpen} of ${foundingSpots} founding agent spots open` : 'Founding agent spots are filled'}</p>
        <a class="btn ${z.foundingOpen ? 'btn-primary' : 'btn-ghost'} btn-sm" data-claim-zip="${z.zip}" href="${joinHref(z.zip)}">${z.foundingOpen ? `Claim a spot in ${z.zip}` : `Join agents in ${z.zip}`}</a>
      </div>`).join('');
    el.addEventListener('click', (e) => {
      const link = e.target.closest('[data-claim-zip]');
      if (!link) return;
      try { localStorage.setItem('ah_claim_zip', link.dataset.claimZip); } catch { /* optional */ }
    });
    // Arrived on a ZIP's card (#zip-91913, e.g. from a pre-listing): bring it into view and mark it.
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && target.classList.contains('zip-card')) {
      target.classList.add('zip-card-focus');
      target.scrollIntoView({ block: 'center' });
    }
    if (me) {
      document.querySelectorAll('[data-join-agent]').forEach(a => { a.href = '/app#become-agent'; });
      document.querySelectorAll('[data-join-homeowner]').forEach(a => { a.href = '/app#post-home'; });
    }
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
})();
