/* Amico Haus — signup form wiring.
   Pulled out of signup.html into its own file so it loads under a strict
   script-src 'self' CSP (inline scripts are blocked without a nonce/hash).

   Signing up only asks for a name and email. The account isn't usable until
   the emailed link is opened (that page is where the password is chosen), so
   success here swaps the form for a "check your email" message instead of
   signing anyone in. */
let signedUpEmail = '';

// Links from the home page and demo say which side to preselect (?as=agent).
const wantedSide = new URLSearchParams(window.location.search).get('as');
const wantedRadio = document.querySelector(`input[name="intent"][value="${wantedSide === 'agent' ? 'agent' : 'homeowner'}"]`);
if (wantedRadio) wantedRadio.checked = true;

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const result = await apiPost('/api/auth/signup', {
      displayName: document.getElementById('displayName').value.trim(),
      email: document.getElementById('email').value.trim(),
      intent: document.querySelector('input[name="intent"]:checked').value,
      referralCode: new URLSearchParams(window.location.search).get('ref') || '',
    });
    signedUpEmail = result.email;
    document.getElementById('sentTo').textContent = signedUpEmail;
    document.getElementById('signupPanel').classList.add('hidden');
    document.getElementById('checkEmailPanel').classList.remove('hidden');
    document.getElementById('resendStatus').textContent = '';
  } catch (err) {
    toast(err.message);
    btn.disabled = false; btn.textContent = 'Email Me a Link';
  }
});

document.getElementById('resendBtn').addEventListener('click', async () => {
  const btn = document.getElementById('resendBtn');
  const status = document.getElementById('resendStatus');
  btn.disabled = true;
  try {
    await apiPost('/api/auth/resend-confirmation', { email: signedUpEmail });
    status.textContent = 'Sent again — check your inbox in a minute.';
  } catch (err) {
    status.textContent = err.message;
  }
  // The server allows one email per address every couple of minutes anyway.
  setTimeout(() => { btn.disabled = false; }, 30000);
});
