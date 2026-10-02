(async function () {
  const user = await requireAuthOrRedirect();
  if (!user) return;

  function render() {
    document.getElementById('statusLine').textContent = `Signed in as ${user.displayName}.`;
    document.getElementById('twoFactorOn').classList.toggle('hidden', !user.totpEnabled);
    document.getElementById('twoFactorOff').classList.toggle('hidden', user.totpEnabled);
    document.getElementById('notifyMatchesCheckbox').checked = user.notifyMatches;
    document.getElementById('emailFrequencySelect').value = user.emailFrequency || 'capped';
    document.getElementById('emailFrequencyField').classList.toggle('hidden', !user.notifyMatches);
  }
  render();

  document.getElementById('notifyMatchesCheckbox').addEventListener('change', async (e) => {
    try {
      await apiPut('/api/me', { bio: user.bio, notifyMatches: e.target.checked });
      user.notifyMatches = e.target.checked;
      render();
      toast(e.target.checked ? 'You\'ll get an email for new matches.' : 'Match emails turned off.');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message);
    }
  });

  document.getElementById('emailFrequencySelect').addEventListener('change', async (e) => {
    const previous = user.emailFrequency || 'capped';
    try {
      await apiPut('/api/me', { bio: user.bio, emailFrequency: e.target.value });
      user.emailFrequency = e.target.value;
      toast(e.target.value === 'every' ? 'You\'ll get an email for every match.' : 'Match emails limited to a few a day.');
    } catch (err) {
      e.target.value = previous;
      toast(err.message);
    }
  });

  const pushCheckbox = document.getElementById('pushNotifCheckbox');
  const testPushBtn = document.getElementById('sendTestPushBtn');
  isPushSubscribed().then(subscribed => {
    pushCheckbox.checked = subscribed;
    testPushBtn.classList.toggle('hidden', !subscribed);
  });
  pushCheckbox.addEventListener('change', async (e) => {
    const wantsOn = e.target.checked;
    try {
      if (wantsOn) {
        await enablePushNotifications();
        toast('Push notifications enabled on this device.');
      } else {
        await disablePushNotifications();
        toast('Push notifications disabled on this device.');
      }
      testPushBtn.classList.toggle('hidden', !wantsOn);
    } catch (err) {
      e.target.checked = !wantsOn;
      toast(err.message);
    }
  });

  testPushBtn.addEventListener('click', async () => {
    testPushBtn.disabled = true;
    try {
      const { configured, results } = await apiPost('/api/push/test');
      if (!configured) { toast('Push isn\'t configured on the server yet.'); return; }
      if (results.length === 0) { toast('No active subscription found — try re-enabling the checkbox above.'); return; }
      const failed = results.filter(r => !r.ok);
      toast(failed.length === 0
        ? 'Sent — check for a system notification in a few seconds.'
        : `Push service rejected it: ${failed[0].status || failed[0].error}`);
    } catch (err) {
      toast(err.message);
    } finally {
      testPushBtn.disabled = false;
    }
  });

  document.getElementById('startSetupBtn').addEventListener('click', async () => {
    try {
      const { secret } = await apiPost('/api/auth/2fa/setup');
      document.getElementById('secretDisplay').textContent = secret;
      document.getElementById('setupPanel').classList.remove('hidden');
    } catch (err) { toast(err.message); }
  });

  document.getElementById('confirmSetupBtn').addEventListener('click', async () => {
    try {
      await apiPost('/api/auth/2fa/verify', { code: document.getElementById('setupCode').value.trim() });
      toast('Two-factor authentication enabled.');
      user.totpEnabled = true;
      render();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('disableBtn').addEventListener('click', async () => {
    try {
      await apiPost('/api/auth/2fa/disable', { password: document.getElementById('disablePassword').value });
      toast('Two-factor authentication disabled.');
      user.totpEnabled = false;
      render();
    } catch (err) { toast(err.message); }
  });

  async function loadBlocked() {
    const el = document.getElementById('blockedList');
    try {
      const { blocked } = await apiGet('/api/blocks');
      el.innerHTML = blocked.length ? blocked.map(b => `
        <div class="side">
          <strong>${escapeHtml(b.display_name)}</strong>
          <button class="link-btn" data-action="unblock" data-id="${b.blocked_id}">Unblock</button>
        </div>
      `).join('') : '<span class="tiny">You haven\'t blocked anyone.</span>';
    } catch (err) {
      el.innerHTML = `<span class="tiny">${escapeHtml(err.message)}</span>`;
    }
  }
  document.getElementById('blockedList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="unblock"]');
    if (!btn) return;
    await apiDelete(`/api/blocks/${btn.dataset.id}`);
    loadBlocked();
  });
  loadBlocked();

  async function loadReferrals() {
    try {
      const { referralCode, referredCount } = await apiGet('/api/referrals');
      document.getElementById('referralLink').value = `${window.location.origin}/signup?ref=${referralCode}`;
      document.getElementById('referralCount').textContent = `${referredCount} friend${referredCount === 1 ? '' : 's'} signed up through your link so far.`;
    } catch (err) { /* non-critical */ }
  }
  loadReferrals();

  document.getElementById('copyReferralBtn').addEventListener('click', async () => {
    const input = document.getElementById('referralLink');
    try {
      await navigator.clipboard.writeText(input.value);
      toast('Referral link copied.');
    } catch {
      input.select();
      toast('Select and copy the link above.');
    }
  });

  document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
    if (!confirm('This permanently deletes your account and everything in it. This cannot be undone. Continue?')) return;
    try {
      await apiPost('/api/account/delete', { password: document.getElementById('deletePassword').value });
      window.location.href = '/';
    } catch (err) { toast(err.message); }
  });
})();
