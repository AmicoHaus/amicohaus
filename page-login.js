/* Amico Haus — login form wiring.
   Pulled out of login.html into its own file so it loads under a strict
   script-src 'self' CSP (inline scripts are blocked without a nonce/hash). */

let pendingTwoFactorToken = null;

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    const result = await apiPost('/api/auth/login', {
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    if (result.requiresTwoFactor) {
      pendingTwoFactorToken = result.pendingToken;
      document.getElementById('loginForm').classList.add('hidden');
      document.getElementById('twoFactorForm').classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Log In';
      return;
    }
    window.location.href = '/app';
  } catch (err) {
    toast(err.message);
    // Signed up but never finished: offer a fresh link right here.
    document.getElementById('unconfirmedRow').classList.toggle('hidden', !(err.data && err.data.code === 'email_unconfirmed'));
    btn.disabled = false; btn.textContent = 'Log In';
  }
});

document.getElementById('resendLinkBtn').addEventListener('click', async () => {
  const btn = document.getElementById('resendLinkBtn');
  btn.disabled = true;
  try {
    const result = await apiPost('/api/auth/resend-confirmation', { email: document.getElementById('email').value.trim() });
    toast(result.message);
  } catch (err) { toast(err.message); }
  setTimeout(() => { btn.disabled = false; }, 30000);
});

document.getElementById('twoFactorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('twoFactorSubmitBtn');
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    await apiPost('/api/auth/2fa/challenge', {
      pendingToken: pendingTwoFactorToken,
      code: document.getElementById('twoFactorCode').value.trim(),
    });
    window.location.href = '/app';
  } catch (err) {
    toast(err.message);
    btn.disabled = false; btn.textContent = 'Verify';
  }
});
