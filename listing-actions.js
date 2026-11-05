/* Amico Haus — progressive-enhancement click handlers for the server-rendered
   /listing/{id} page (functions/listing/[id].js). The page's HTML is already
   complete and correct without this file; this just wires up the buttons
   already in it. Needs client.js loaded first (apiPost/toast). */
(function () {
  const listingId = window.location.pathname.split('/').filter(Boolean).pop();

  // Same shape as main.js's renderComment(), duplicated here since this page doesn't load main.js. An approved
  // agent's comment carries their identity line; a hidden one reaches only its author and admins; the home's owner
  // (and admins) get a Hide button on other people's comments (canHide from the API).
  function renderComment(c) {
    return `
      <div class="side" data-comment-id="${c.id}">
        <strong><a class="profile-link" href="/profile/${c.user_id}">${escapeHtml(contentAuthorLabel(c.author_name, c.authorAgent))}</a></strong> <span class="tiny">${timeAgo(c.created_at)}</span>
        ${hiddenContentNoteHtml(c, c.isMine, 'comment')}
        <p class="tiny">${escapeHtml(c.body)}</p>
        <button type="button" class="link-btn" data-action="like-comment" data-id="${c.id}">👍 ${c.like_count || 0}</button>
        ${c.isMine
          ? `<button type="button" class="link-btn danger" data-action="delete-comment" data-id="${c.id}">Delete</button>`
          : `<button type="button" class="link-btn" data-action="report-comment" data-id="${c.id}">Report</button>`}
        ${c.canHide ? `<button type="button" class="link-btn" data-action="hide-comment" data-id="${c.id}">Hide</button>` : ''}
      </div>
    `;
  }

  async function refreshComments(postId) {
    const { comments } = await apiGet(`/api/posts/${postId}/comments`);
    const me = await fetchCurrentUser();
    document.getElementById(`comments-list-${postId}`).innerHTML =
      comments.map(c => renderComment({ ...c, isMine: me && me.id === c.user_id })).join('') || '<p class="tiny">No comments yet.</p>';
  }

  document.addEventListener('click', async e => {
    const rsvpBtn = e.target.closest('[data-action="rsvp-open-house"]');
    const submitOfferBtn = e.target.closest('[data-action="submit-offer"]');
    const withdrawOfferBtn = e.target.closest('[data-action="withdraw-offer"]');
    const respondCounterBtn = e.target.closest('[data-action="respond-counter"]');
    const counterBackBtn = e.target.closest('[data-action="counter-back"]');
    const reportCommentBtn = e.target.closest('[data-action="report-comment"]');
    const unhideBtn = e.target.closest('[data-action="unhide-content"]');
    const deleteCommentBtn = e.target.closest('[data-action="delete-comment"]');
    const likeCommentBtn = e.target.closest('[data-action="like-comment"]');
    const hideCommentBtn = e.target.closest('[data-action="hide-comment"]');
    const sendReportBtn = e.target.closest('[data-action="send-report"]');
    const cancelReportBtn = e.target.closest('[data-action="cancel-report"]');

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
    } else if (counterBackBtn) {
      const price = document.getElementById('counterBackPrice').value;
      if (!price) { toast('Enter a counter-offer price.'); return; }
      try {
        await apiPut(`/api/listings/${listingId}/offers/${counterBackBtn.dataset.id}`, {
          action: 'counter', counterPrice: price, counterMessage: document.getElementById('counterBackMessage').value.trim(),
        });
        toast('Counter-offer sent.');
        window.location.reload();
      } catch (err) { toast(err.message); }
    } else if (unhideBtn) {
      // Admins only (the note is shown only to them): show a hidden comment again.
      if (await unhideContentById(unhideBtn.dataset.kind, unhideBtn.dataset.id)) unhideBtn.closest('.hidden-note').remove();
    } else if (reportCommentBtn) {
      // The same inline report form as the app (presets incl. "Fair housing concern", client.js).
      const host = reportCommentBtn.closest('[data-comment-id]');
      const open = host.querySelector(':scope > .inline-report');
      if (open) { open.remove(); return; }
      host.insertAdjacentHTML('beforeend', inlineReportFormHtml('comment', reportCommentBtn.dataset.id));
    } else if (sendReportBtn) {
      const box = sendReportBtn.closest('.inline-report');
      const preset = box.querySelector('.report-reason').value;
      const details = box.querySelector('.report-details').value.trim();
      if (!preset && !details) { toast('Say what the problem is, then send.'); box.querySelector('.report-details').focus(); return; }
      sendReportBtn.disabled = true;
      try {
        await apiPost('/api/reports', reportPayload(box.dataset.targetType, box.dataset.targetId, preset, details));
        box.innerHTML = '<p class="tiny">Report sent. Thank you.</p>';
      } catch (err) { sendReportBtn.disabled = false; toastActionError(err); }
    } else if (cancelReportBtn) {
      cancelReportBtn.closest('.inline-report').remove();
    } else if (hideCommentBtn) {
      if (await hideCommentWithPrompt(hideCommentBtn.dataset.id)) hideCommentBtn.closest('[data-comment-id]').remove();
    } else if (deleteCommentBtn) {
      if (!confirm('Delete this comment?')) return;
      try {
        await apiDelete(`/api/comments/${deleteCommentBtn.dataset.id}`);
        deleteCommentBtn.closest('[data-comment-id]').remove();
      } catch (err) { toast(err.message); }
    } else if (likeCommentBtn) {
      try {
        const { likeCount } = await apiPost(`/api/comments/${likeCommentBtn.dataset.id}/like`, {});
        likeCommentBtn.textContent = `👍 ${likeCount}`;
      } catch (err) { toast(err.message); }
    }
  });

  document.addEventListener('submit', async e => {
    const form = e.target.closest('.comment-form');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input');
    const postId = form.dataset.postId;
    try {
      await apiPost(`/api/posts/${postId}/comments`, { body: input.value.trim() });
      input.value = '';
      await refreshComments(postId);
    } catch (err) { toastActionError(err); }
  });
})();
