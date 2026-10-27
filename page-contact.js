(async function () {
  const user = await fetchCurrentUser();
  if (user) {
    document.getElementById('authCta').innerHTML =
      `<span class="tiny">Hi, ${escapeHtml(user.displayName)}</span> <a class="btn btn-primary btn-sm" href="/app">Go to App</a>`;
  }
})();

document.getElementById('contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const note = document.getElementById('resultNote');
  const errorEl = document.getElementById('contactError');
  btn.disabled = true; btn.textContent = 'Sending…';
  errorEl.classList.add('hidden');
  try {
    await apiPost('/api/contact', {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      message: document.getElementById('message').value.trim(),
      source: getAttribution(),
    });
    note.textContent = "Thanks — Rudy will get back to you soon.";
    document.getElementById('contactForm').classList.add('hidden');
  } catch (err) {
    // A 503 marked saved means the message is stored but Rudy's notification email didn't go out: treat it as sent
    // (so nobody sends it twice) and show the call/text fallback the server includes.
    if (err.status === 503 && err.data && err.data.saved) {
      note.textContent = err.message;
      document.getElementById('contactForm').classList.add('hidden');
      return;
    }
    // stays on screen (a toast can hide behind a phone keyboard)
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Send';
  }
});
