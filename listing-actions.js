/* Amico Haus — progressive-enhancement click handlers for the server-rendered
   /listing/{id} page (functions/listing/[id].js). The page's HTML is already
   complete and correct without this file; this just wires up the buttons
   already in it. Needs client.js loaded first (apiPost/toast). */
(function () {
  const listingId = window.location.pathname.split('/').filter(Boolean).pop();

  document.addEventListener('click', async e => {
    const rsvpBtn = e.target.closest('[data-action="rsvp-open-house"]');
    const submitOfferBtn = e.target.closest('[data-action="submit-offer"]');
    const withdrawOfferBtn = e.target.closest('[data-action="withdraw-offer"]');
    const respondCounterBtn = e.target.closest('[data-action="respond-counter"]');

    if (rsvpBtn) {
      try {
        const { going } = await apiPost(`/api/listings/${listingId}/open-houses/${rsvpBtn.dataset.id}/rsvp`, {});
        rsvpBtn.textContent = going ? "I'm Going ✓" : "I'm Going";
        rsvpBtn.classList.toggle('btn-primary', !going);
        rsvpBtn.classList.toggle('btn-ghost', going);
        const row = rsvpBtn.closest('[data-open-house-id]');
        const countEl = row && row.querySelector('[data-rsvp-count]');
        if (countEl) {
          const delta = going ? 1 : -1;
          const current = parseInt(countEl.textContent, 10) || 0;
          const next = Math.max(0, current + delta);
          countEl.textContent = `${next} ${next === 1 ? 'person is' : 'people are'} going`;
        }
      } catch (err) { toast(err.message); }
    } else if (submitOfferBtn) {
      const price = document.getElementById('offerPrice').value;
      if (!price) { toast('Enter an offer price.'); return; }
      try {
        await apiPost(`/api/listings/${submitOfferBtn.dataset.listingId}/offers`, {
          offerPrice: price,
          financingType: document.getElementById('offerFinancingType').value,
          closingTimeline: document.getElementById('offerClosingTimeline').value.trim(),
          contingencies: document.getElementById('offerContingencies').value.trim(),
          message: document.getElementById('offerMessage').value.trim(),
        });
        toast('Offer submitted!');
        window.location.reload();
      } catch (err) { toast(err.message); }
    } else if (withdrawOfferBtn) {
      if (!confirm('Withdraw your offer?')) return;
      try {
        await apiPut(`/api/listings/${listingId}/offers/${withdrawOfferBtn.dataset.id}`, { action: 'withdraw' });
        toast('Offer withdrawn.');
        window.location.reload();
      } catch (err) { toast(err.message); }
    } else if (respondCounterBtn) {
      const decision = respondCounterBtn.dataset.decision;
      if (decision === 'decline_counter' && !confirm('Decline the counter-offer?')) return;
      try {
        await apiPut(`/api/listings/${listingId}/offers/${respondCounterBtn.dataset.id}`, { action: decision });
        toast(decision === 'accept_counter' ? 'Counter-offer accepted!' : 'Counter-offer declined.');
        window.location.reload();
      } catch (err) { toast(err.message); }
    }
  });
})();
