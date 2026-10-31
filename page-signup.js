/* Amico Haus — signup form wiring.
   Pulled out of signup.html into its own file so it loads under a strict
   script-src 'self' CSP (inline scripts are blocked without a nonce/hash).

   Signing up only asks for a name and email. The account isn't usable until
   the emailed link is opened (that page is where the password is chosen), so
   success here swaps the form for a "check your email" message instead of
   signing anyone in. */
let signedUpEmail = '';
let signedUpIntent = '';

// The check-email screen is remembered for 30 minutes on this device, so someone who switches to their email app
// and comes back (in-app browsers often reload the page) still finds the code box waiting.
const PENDING_KEY = 'ah_pending_signup';
const PENDING_MINUTES = 30;
function rememberPending(email, intent) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ email, intent, at: Date.now() })); } catch { /* optional */ }
}
function forgetPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* optional */ }
}
function readPending() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (p && p.email && Date.now() - p.at < PENDING_MINUTES * 60000) return p;
  } catch { /* optional */ }
  forgetPending();
  return null;
}

function showCheckEmail(email, intent, { askEmail = false } = {}) {
  signedUpEmail = email || '';
  signedUpIntent = intent || '';
  document.getElementById('sentTo').textContent = signedUpEmail || 'your email';
  document.getElementById('codeEmailField').classList.toggle('hidden', !askEmail);
  document.getElementById('signupPanel').classList.add('hidden');
  document.getElementById('checkEmailPanel').classList.remove('hidden');
}

// A ZIP from "Unlock your ZIP" or an agent invite link (?zip=91913) pre-fills the agent application after signup.
const zipParam = new URLSearchParams(window.location.search).get('zip');
if (zipParam && /^\d{5}$/.test(zipParam)) {
  try { localStorage.setItem('ah_claim_zip', zipParam); } catch { /* optional */ }
}

// Inside TikTok's, Instagram's or Facebook's built-in browser the emailed link opens a different browser, so the
// check-email screen points at the code instead (see captureAttribution in client.js for the detection).
const IN_APP_NAMES = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
const inApp = inAppBrowser();
if (inApp) {
  document.getElementById('inAppName').textContent = IN_APP_NAMES[inApp];
  document.getElementById('inAppHint').classList.remove('hidden');
  // Gmail/Outlook on the web would open inside the app's browser, signed out; the email app is the way there.
  document.getElementById('mailButtons').classList.add('hidden');
}

const pending = readPending();
if (pending) showCheckEmail(pending.email, pending.intent);

document.getElementById('haveCodeBtn').addEventListener('click', () => showCheckEmail('', '', { askEmail: true }));
// Starting over keeps ?as=, ?ref= and ?zip=, so the side, the referral and the ZIP aren't lost to a typo.
const differentEmailLink = document.getElementById('differentEmailLink');
differentEmailLink.href = location.pathname + location.search;
differentEmailLink.addEventListener('click', forgetPending);

document.getElementById('codeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('codeBtn');
  const errorEl = document.getElementById('codeError');
  errorEl.classList.add('hidden');
  btn.disabled = true;
  try {
    const email = signedUpEmail || document.getElementById('codeEmail').value.trim();
    if (!email) {
      errorEl.textContent = 'Type the email you signed up with above.';
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      return;
    }
    const { token, as } = await apiPost('/api/auth/verify-code', { email, code: document.getElementById('confirmCode').value });
    forgetPending();
    // Same screen the emailed link opens: choose a password, then in.
    window.location.href = `/verify-email?token=${encodeURIComponent(token)}${as ? `&as=${as}` : ''}`;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
  }
});

// Errors stay on screen under the button (a 3-second toast is easy to miss behind a phone keyboard). An
// "already registered" error also offers the two ways forward.
function showSignupError(message) {
  const el = document.getElementById('signupError');
  el.textContent = message;
  if (/already registered/i.test(message)) {
    el.append(' ');
    const login = Object.assign(document.createElement('a'), { href: '/login', textContent: 'Log in' });
    const reset = Object.assign(document.createElement('a'), { href: '/forgot-password', textContent: 'Forgot password?' });
    el.append(login, ' · ', reset);
  }
  el.classList.remove('hidden');
}

// Links from the home page and demo say which side to preselect (?as=agent).
const wantedSide = new URLSearchParams(window.location.search).get('as');
const wantedRadio = document.querySelector(`input[name="intent"][value="${wantedSide === 'agent' ? 'agent' : 'homeowner'}"]`);
if (wantedRadio) wantedRadio.checked = true;

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  document.getElementById('signupError').classList.add('hidden');
  try {
    const intent = document.querySelector('input[name="intent"]:checked').value;
    const result = await apiPost('/api/auth/signup', {
      displayName: document.getElementById('displayName').value.trim(),
      email: document.getElementById('email').value.trim(),
      intent,
      referralCode: new URLSearchParams(window.location.search).get('ref') || '',
      source: getAttribution(),
      next: peekReturnTo(),
    });
    showCheckEmail(result.email, intent);
    rememberPending(result.email, intent);
    // Account saved but the email didn't go out on the first try: say so calmly and point at the retry.
    document.getElementById('resendStatus').textContent = result.emailDelayed
      ? "Your account is saved, but the email didn't go out on the first try. Give it a minute, then tap send it again."
      : '';
  } catch (err) {
    showSignupError(err.message);
    btn.disabled = false; btn.textContent = 'Email Me a Link';
  }
});

document.getElementById('resendBtn').addEventListener('click', async () => {
  const btn = document.getElementById('resendBtn');
  const status = document.getElementById('resendStatus');
  const email = signedUpEmail || document.getElementById('codeEmail').value.trim();
  if (!email) { status.textContent = 'Type the email you signed up with above, then tap send it again.'; return; }
  btn.disabled = true;
  try {
    await apiPost('/api/auth/resend-confirmation', { email, intent: signedUpIntent });
    status.textContent = 'Sent again — check your inbox in a minute.';
    // Came in through "Type the code": remember this address too, so switching to the email app and back keeps the box.
    if (!signedUpEmail) { signedUpEmail = email; rememberPending(email, signedUpIntent); }
  } catch (err) {
    status.textContent = err.message;
  }
  // The server allows one email per address every couple of minutes anyway.
  setTimeout(() => { btn.disabled = false; }, 30000);
});
