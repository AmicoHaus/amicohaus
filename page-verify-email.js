/* Amico Haus — the page an emailed sign-up link opens.

   Two steps on purpose. Loading the page only *looks at* the link (a GET that
   changes nothing), and the account is finished when the person submits a
   password. That way an email scanner that fetches every link in a message
   can't use the link up before its owner gets to it. */
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';
// The signup form records which side someone came for (homeowner / agent), so
// once they're in, drop them where that side starts.
const LANDING = { homeowner: '/app#post-home', agent: '/app#become-agent' };
const landing = LANDING[params.get('as')] || '/app';

function showResend(message) {
  $('verifyTitle').textContent = 'This link can’t be used';
  $('statusLine').textContent = message;
  $('passwordForm').classList.add('hidden');
  $('resendForm').classList.remove('hidden');
}

async function checkLink() {
  if (!token) { showResend('This link is missing its token. Enter your email and we’ll send a new one.'); return; }
  try {
    const info = await apiGet(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    if (info.legacy) {
      // A link from the old flow: it only ever marked the email as verified.
      await apiPost('/api/auth/verify-email', { token });
      $('verifyTitle').textContent = 'Email verified';
      $('statusLine').textContent = 'Your email is verified.';
      return;
    }
    $('verifyTitle').textContent = `Welcome, ${info.displayName}!`;
    $('statusLine').textContent = `Your email ${info.email} is confirmed. Choose a password to finish creating your account.`;
    $('passwordForm').classList.remove('hidden');
    $('password').focus();
  } catch (err) {
    showResend(err.message);
  }
}

$('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('submitBtn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await apiPost('/api/auth/verify-email', { token, password: $('password').value });
    $('verifyTitle').textContent = 'You’re in!';
    $('statusLine').textContent = 'Taking you to your account…';
    $('passwordForm').classList.add('hidden');
    window.location.href = landing;
  } catch (err) {
    const code = err.data && err.data.code;
    if (code === 'expired' || code === 'invalid') { showResend(err.message); return; }
    toast(err.message);
    btn.disabled = false; btn.textContent = 'Create My Account';
  }
});

$('resendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('resendSubmit');
  btn.disabled = true;
  try {
    const result = await apiPost('/api/auth/resend-confirmation', { email: $('resendEmail').value.trim() });
    $('statusLine').textContent = result.message;
  } catch (err) {
    $('statusLine').textContent = err.message;
  }
  // The server allows one email per address every couple of minutes anyway.
  setTimeout(() => { btn.disabled = false; }, 30000);
});

checkLink();
