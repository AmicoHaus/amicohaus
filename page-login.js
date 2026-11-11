/* Amico Haus — login form wiring.
   Pulled out of login.html into its own file so it loads under a strict
   script-src 'self' CSP (inline scripts are blocked without a nonce/hash). */

// es/iniciar-sesion.html (lang="es") loads this same file: ES_MSG holds its visible messages in both languages, and
// the English page shows exactly what it showed before. Server errors stay English in v1 (shown with ES_DETAIL).
const ES_LANG = document.documentElement.lang === 'es';
const ES_MSG = {
  en: { loggingIn: 'Logging in…', logIn: 'Log In', verifying: 'Verifying…', verify: 'Verify' },
  es: {
    loggingIn: 'Iniciando sesión…', logIn: 'Iniciar sesión', verifying: 'Confirmando…', verify: 'Confirmar',
    resent: 'Si esa dirección está esperando confirmación, va en camino un enlace nuevo.',
  },
}[ES_LANG ? 'es' : 'en'];
const ES_DETAIL = (message) => (ES_LANG ? `No se pudo completar. Detalle (en inglés): ${message}` : message);

let pendingTwoFactorToken = null;

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = ES_MSG.loggingIn;
  try {
    const result = await apiPost('/api/auth/login', {
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    if (result.requiresTwoFactor) {
      pendingTwoFactorToken = result.pendingToken;
      document.getElementById('loginForm').classList.add('hidden');
      document.getElementById('twoFactorForm').classList.remove('hidden');
      btn.disabled = false; btn.textContent = ES_MSG.logIn;
      return;
    }
    window.location.href = takeReturnTo() || '/app';
  } catch (err) {
    toast(ES_DETAIL(err.message));
    // Signed up but never finished: offer a fresh link right here.
    document.getElementById('unconfirmedRow').classList.toggle('hidden', !(err.data && err.data.code === 'email_unconfirmed'));
    btn.disabled = false; btn.textContent = ES_MSG.logIn;
  }
});

document.getElementById('resendLinkBtn').addEventListener('click', async () => {
  const btn = document.getElementById('resendLinkBtn');
  btn.disabled = true;
  try {
    const result = await apiPost('/api/auth/resend-confirmation', { email: document.getElementById('email').value.trim() });
    toast(ES_MSG.resent || result.message);
  } catch (err) { toast(ES_DETAIL(err.message)); }
  setTimeout(() => { btn.disabled = false; }, 30000);
});

document.getElementById('twoFactorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('twoFactorSubmitBtn');
  btn.disabled = true; btn.textContent = ES_MSG.verifying;
  try {
    await apiPost('/api/auth/2fa/challenge', {
      pendingToken: pendingTwoFactorToken,
      code: document.getElementById('twoFactorCode').value.trim(),
    });
    window.location.href = takeReturnTo() || '/app';
  } catch (err) {
    toast(ES_DETAIL(err.message));
    btn.disabled = false; btn.textContent = ES_MSG.verify;
  }
});
