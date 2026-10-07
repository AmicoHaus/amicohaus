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
        <textarea id="bioInput" maxlength="500" placeholder="Tell other homeowners a bit about yourself and what you're hoping to find…">${escapeHtml(currentBio)}</textarea>
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

  const editPhoneBtn = document.getElementById('editPhoneBtn');
  if (editPhoneBtn) {
    editPhoneBtn.addEventListener('click', () => {
      const section = document.getElementById('phoneSection');
      const currentPhone = section.dataset.phone || '';
      section.innerHTML = `
        <input type="tel" id="phoneInput" maxlength="30" placeholder="e.g. (619) 555-0123" value="${escapeHtml(currentPhone)}">
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
