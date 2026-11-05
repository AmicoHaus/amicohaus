/* Amico Haus — progressive-enhancement click handlers for the server-rendered
   /profile/{id} page (functions/profile/[id].js). The page's HTML is already
   complete and correct without this file; this just wires up the buttons
   already in it. Needs client.js loaded first (apiGet/apiPost/apiPut/toast). */
(function () {
  const card = document.getElementById('profileCard');
  if (!card) return;
  const userId = card.dataset.userId;

  const messageBtn = document.getElementById('messageUserBtn');
  if (messageBtn) {
    messageBtn.addEventListener('click', async () => {
      try {
        const { id: conversationId } = await apiPost('/api/conversations', { userId: Number(messageBtn.dataset.id) });
        window.location.href = `/app#messages-${conversationId}`;
      } catch (err) { toast(err.message); }
    });
  }

  const favoriteBtn = document.getElementById('favoriteAgentBtn');
  if (favoriteBtn) {
    favoriteBtn.addEventListener('click', async () => {
      try {
        const { favorited } = await apiPost(`/api/agents/${favoriteBtn.dataset.id}/favorite`, {});
        favoriteBtn.textContent = favorited ? '★ Favorited' : '☆ Favorite';
      } catch (err) { toast(err.message); }
    });
  }

  const verifyBtn = document.getElementById('toggleVerifiedBtn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      try {
        await apiPost(`/api/admin/users/${verifyBtn.dataset.id}`, { action: verifyBtn.dataset.action });
        window.location.reload();
      } catch (err) { toast(err.message); }
    });
  }

  const editBioBtn = document.getElementById('editBioBtn');
  if (editBioBtn) {
    editBioBtn.addEventListener('click', () => {
      const section = document.getElementById('bioSection');
      const currentBio = section.dataset.bio || '';
      section.innerHTML = `
        <textarea id="bioInput" maxlength="500" placeholder="What kind of home you have and what you're hoping to find…">${escapeHtml(currentBio)}</textarea>
        <p class="tiny field-hint composer-note">${escapeHtml(HOME_TEXT_NOTE)}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-primary btn-sm" id="saveBioBtn">Save</button>
          <button type="button" class="btn btn-ghost btn-sm" id="cancelBioBtn">Cancel</button>
        </div>
      `;
      document.getElementById('saveBioBtn').addEventListener('click', async () => {
        try {
          await apiPut('/api/me', { bio: document.getElementById('bioInput').value.trim() });
          window.location.reload();
        } catch (err) { toast(err.message); }
      });
      document.getElementById('cancelBioBtn').addEventListener('click', () => window.location.reload());
    });
  }

  // "Report" on a past-client review or on the person: the same short report form as the app (client.js
  // inlineReportFormHtml, presets incl. "Fair housing concern").
  document.addEventListener('click', async e => {
    const reportBtn = e.target.closest('[data-action="report-past-review"], [data-action="report-user"]');
    if (reportBtn) {
      const host = reportBtn.closest('[data-report-host]');
      const open = host && host.querySelector(':scope > .inline-report');
      if (open) { open.remove(); return; }
      const targetType = reportBtn.dataset.action === 'report-user' ? 'user' : 'past_client_review';
      if (host) host.insertAdjacentHTML('beforeend', inlineReportFormHtml(targetType, reportBtn.dataset.id));
      return;
    }
    const sendBtn = e.target.closest('[data-action="send-report"]');
    if (sendBtn) {
      const box = sendBtn.closest('.inline-report');
      const preset = box.querySelector('.report-reason').value;
      const details = box.querySelector('.report-details').value.trim();
      if (!preset && !details) { toast('Say what the problem is, then send.'); box.querySelector('.report-details').focus(); return; }
      sendBtn.disabled = true;
      try {
        await apiPost('/api/reports', reportPayload(box.dataset.targetType, box.dataset.targetId, preset, details));
        box.innerHTML = '<p class="tiny">Report sent. Thank you.</p>';
      } catch (err) { sendBtn.disabled = false; toastActionError(err); }
      return;
    }
    const cancelBtn = e.target.closest('[data-action="cancel-report"]');
    if (cancelBtn) cancelBtn.closest('.inline-report').remove();
  });

  const editPhoneBtn = document.getElementById('editPhoneBtn');
  if (editPhoneBtn) {
    editPhoneBtn.addEventListener('click', () => {
      const section = document.getElementById('phoneSection');
      const currentPhone = section.dataset.phone || '';
      section.innerHTML = `
        <input type="tel" id="phoneInput" maxlength="30" placeholder="e.g. (619) 555-0123" value="${escapeHtml(currentPhone)}">
        <p class="tiny">Private unless you turn on 'Show my phone number' in You're in Control. <a href="/app#control">Change this setting</a></p>
        <div class="form-actions">
          <button type="button" class="btn btn-primary btn-sm" id="savePhoneBtn">Save</button>
          <button type="button" class="btn btn-ghost btn-sm" id="cancelPhoneBtn">Cancel</button>
        </div>
      `;
      document.getElementById('savePhoneBtn').addEventListener('click', async () => {
        try {
          await apiPut('/api/me', { phone: document.getElementById('phoneInput').value.trim() });
          window.location.reload();
        } catch (err) { toast(err.message); }
      });
      document.getElementById('cancelPhoneBtn').addEventListener('click', () => window.location.reload());
    });
  }
})();
