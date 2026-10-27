/* Amico Haus — signup form wiring.
   Pulled out of signup.html into its own file so it loads under a strict
   script-src 'self' CSP (inline scripts are blocked without a nonce/hash).

   Signing up only asks for a name and email. The account isn't usable until
   the emailed link is opened (that page is where the password is chosen), so
   success here swaps the form for a "check your email" message instead of
   signing anyone in. */
let signedUpEmail = '';
let signedUpIntent = '';

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
    });
    signedUpEmail = result.email;
    signedUpIntent = intent;
    document.getElementById('sentTo').textContent = signedUpEmail;
    document.getElementById('signupPanel').classList.add('hidden');
    document.getElementById('checkEmailPanel').classList.remove('hidden');
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
  btn.disabled = true;
  try {
    await apiPost('/api/auth/resend-confirmation', { email: signedUpEmail, intent: signedUpIntent });
    status.textContent = 'Sent again — check your inbox in a minute.';
  } catch (err) {
    status.textContent = err.message;
  }
  // The server allows one email per address every couple of minutes anyway.
  setTimeout(() => { btn.disabled = false; }, 30000);
});
